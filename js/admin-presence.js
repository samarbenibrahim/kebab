// SOUCOFFE - Admin : surveillance des sessions clients (api/services/PresenceService.php).
//
//  - Cloche + badge (alertes non lues) dans la barre latérale et l'en-tête mobile ;
//    panneau des notifications : client, table, connexion, durée, statut,
//    heure de l'événement, « Voir la session », « Marquer lu », « Clôturer ».
//  - Vue « Clients connectés » : sessions en direct, santé de l'API, réglages.
//  - Polling léger toutes les 15 s, suspendu quand l'onglet est caché (le
//    serveur php -S ne supporte ni SSE ni WebSocket). Une nouvelle ALERTE joue
//    le son existant (adminAlert) ; un simple « événement enregistré » non.
// Réservé à la permission presence.view (admin, manager) : l'API refuse sinon.
(function () {
    var POLL_MS = 15000;
    var ICON_STATUS = { active: 'check_circle', idle: 'hourglass_top', interrupted: 'warning', ended: 'logout' };
    var CHIP_STATUS = {
        active: 'bg-secondary-container text-on-secondary-container',
        idle: 'bg-surface-container text-on-surface-variant',
        interrupted: 'bg-tertiary-container text-on-tertiary-container',
        ended: 'bg-surface-container text-outline'
    };
    var END_REASON = { logout: 'Déconnexion', expired: 'Expiration', revoked: 'Table libérée' };
    var notifs = [], unread = 0, knownAlertIds = null, panelOpen = false, overview = null, timer = null;

    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name, cls, filled) { return window.iconHtml ? window.iconHtml(name, cls, filled) : ''; }
    function toast(m) { if (window.showToast) window.showToast(m); }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }
    function allowed() { return Auth.can('presence.view'); }
    function hhmm(dt) { return dt ? String(dt).slice(11, 16) : '—'; }
    function dayHhmm(dt) {
        if (!dt) return '—';
        var d = String(dt).slice(0, 10), today = new Date();
        var t = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        return d === t ? hhmm(dt) : d.slice(8, 10) + '/' + d.slice(5, 7) + ' ' + hhmm(dt);
    }
    function dur(sec) {
        sec = Math.max(0, sec | 0);
        if (sec < 60) return sec + ' s';
        var m = Math.floor(sec / 60);
        if (m < 60) return m + ' min';
        return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
    }
    function chip(p) {
        return '<span class="inline-flex items-center gap-1 font-label-md text-xs px-2 py-0.5 rounded-full whitespace-nowrap ' + CHIP_STATUS[p.status] + '">' +
            ic(ICON_STATUS[p.status]) + ' ' + esc(p.statusLabel) + '</span>' +
            (p.serverIssue ? ' <span class="inline-flex items-center gap-1 font-label-md text-xs px-2 py-0.5 rounded-full whitespace-nowrap bg-error-container text-on-error-container">' + ic('warning') + ' Problème serveur confirmé</span>' : '');
    }

    // ------------------------------------------------------------------
    // Cloche + panneau des notifications
    // ------------------------------------------------------------------
    function paintBadge() {
        document.querySelectorAll('[data-notif-badge]').forEach(function (b) {
            b.textContent = unread > 99 ? '99+' : String(unread);
            b.classList.toggle('hidden', unread === 0);
        });
        document.querySelectorAll('[data-notif-bell]').forEach(function (b) {
            b.setAttribute('aria-label', unread ? 'Notifications (' + unread + ' non lue' + (unread > 1 ? 's' : '') + ')' : 'Notifications');
        });
    }

    function notifPanel() {
        var p = document.getElementById('notif-panel');
        if (!p) {
            p = document.createElement('div');
            p.id = 'notif-panel';
            p.setAttribute('role', 'dialog');
            p.setAttribute('aria-label', 'Notifications');
            p.className = 'hidden fixed z-[55] inset-x-2 top-16 lg:inset-x-auto lg:left-[17rem] lg:top-auto lg:bottom-4 lg:w-[26rem] max-h-[75vh] flex-col bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl overflow-hidden';
            document.body.appendChild(p);
            document.addEventListener('click', function (e) {
                if (panelOpen && !p.contains(e.target) && !e.target.closest('[data-notif-bell]')) setPanel(false);
            });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panelOpen) setPanel(false); });
        }
        return p;
    }
    function setPanel(open) {
        panelOpen = open;
        var p = notifPanel();
        p.classList.toggle('hidden', !open);
        p.classList.toggle('flex', open);
        if (open) { renderPanel(); syncNotifications(); }
    }
    window.toggleNotifPanel = function (e) { if (e) e.stopPropagation(); setPanel(!panelOpen); return false; };

    function notifCard(n) {
        var s = n.session;
        var alert = n.level === 'alert';
        var icon = n.type === 'server_issue' ? 'warning' : n.type === 'inactivity' ? 'hourglass_top' : alert ? 'notification_important' : 'info';
        return '<div class="p-3 border-b border-outline-variant ' + (n.read ? '' : 'bg-surface-container-low') + '">' +
            '<div class="flex items-start gap-2">' +
            '<span class="mt-0.5 ' + (n.type === 'server_issue' ? 'text-error' : alert ? 'text-primary' : 'text-outline') + '">' + ic(icon, '', true) + '</span>' +
            '<div class="flex-1 min-w-0">' +
            '<div class="font-label-md text-sm text-on-surface' + (n.read ? '' : ' font-bold') + '">' + esc(n.title) + (alert ? '' : ' <span class="text-xs text-outline font-normal">(événement enregistré)</span>') + '</div>' +
            '<div class="text-sm text-on-surface">' + esc(s.name) + ' · Table ' + esc(s.tableNumber) + '</div>' +
            '<div class="text-xs text-on-surface-variant mt-0.5">Connexion ' + hhmm(s.startedAt) + ' · durée ' + dur(s.durationSeconds) + ' · signalé à ' + dayHhmm(n.createdAt) + '</div>' +
            '<div class="mt-1 flex flex-wrap gap-1">' + chip(s) + '</div>' +
            '<div class="mt-2 flex flex-wrap gap-2">' +
            '<button onclick="return openPresenceDetail(' + s.id + ',' + n.id + ')" class="h-8 px-3 rounded-lg text-xs font-label-md bg-primary-container text-on-primary hover:bg-primary inline-flex items-center gap-1">' + ic('visibility') + ' Voir la session</button>' +
            (n.read ? '' : '<button onclick="return notifAction(' + n.id + ',\'read\')" class="h-8 px-3 rounded-lg text-xs font-label-md bg-surface-container text-on-surface hover:bg-surface-variant inline-flex items-center gap-1">' + ic('check') + ' Marquer lu</button>') +
            '<button onclick="return notifAction(' + n.id + ',\'close\')" class="h-8 px-3 rounded-lg text-xs font-label-md bg-surface-container text-on-surface hover:bg-surface-variant inline-flex items-center gap-1">' + ic('close') + ' Clôturer</button>' +
            '</div></div></div></div>';
    }

    function renderPanel() {
        var p = notifPanel();
        p.innerHTML =
            '<div class="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-outline-variant">' +
            '<div class="font-title-lg text-base text-primary">Notifications' + (unread ? ' <span class="text-xs text-on-surface-variant">(' + unread + ' alerte' + (unread > 1 ? 's' : '') + ' non lue' + (unread > 1 ? 's' : '') + ')</span>' : '') + '</div>' +
            '<div class="flex items-center gap-1">' +
            (unread ? '<button onclick="return notifReadAll()" class="h-8 px-2 rounded-lg text-xs font-label-md text-tertiary hover:bg-surface-variant inline-flex items-center gap-1">' + ic('done_all') + ' Tout lire</button>' : '') +
            '<button onclick="return toggleNotifPanel(event)" aria-label="Fermer" class="w-8 h-8 rounded-lg inline-flex items-center justify-center text-on-surface-variant hover:bg-surface-variant">' + ic('close') + '</button>' +
            '</div></div>' +
            '<div class="overflow-y-auto flex-1">' +
            (notifs.length ? notifs.map(notifCard).join('') : '<div class="p-6 text-center text-sm text-on-surface-variant">Aucune notification ouverte.</div>') +
            '</div>' +
            '<button onclick="setPanel_presence()" class="px-3 py-2.5 text-sm font-label-md text-primary hover:bg-surface-variant border-t border-outline-variant text-left inline-flex items-center gap-2">' + ic('groups') + ' Voir tous les clients connectés</button>';
        if (window.renderIcons) window.renderIcons();
    }
    window.setPanel_presence = function () { setPanel(false); showAdminView('presence'); };

    window.notifAction = function (id, action) {
        Auth.api('/admin/notifications/' + id, Auth.json('PATCH', { action: action })).then(function () {
            notifs.forEach(function (n) { if (n.id === id) { n.read = true; if (action === 'close') n.closed = true; } });
            notifs = notifs.filter(function (n) { return !n.closed; });
            syncNotifications();
        }).catch(function (e) { toast('Action impossible : ' + errText(e)); });
        return false;
    };
    window.notifReadAll = function () {
        Auth.api('/admin/notifications/read-all', Auth.json('PATCH')).then(syncNotifications).catch(function (e) { toast('Action impossible : ' + errText(e)); });
        return false;
    };

    function syncNotifications() {
        if (!allowed()) return Promise.resolve();
        return Auth.api('/admin/notifications?status=open').then(function (r) {
            notifs = r.content || [];
            unread = r.unreadCount || 0;
            var alertIds = notifs.filter(function (n) { return n.level === 'alert' && !n.read; }).map(function (n) { return n.id; });
            if (knownAlertIds !== null) {
                var fresh = notifs.filter(function (n) { return n.level === 'alert' && !n.read && knownAlertIds.indexOf(n.id) === -1; });
                if (fresh.length) {
                    if (window.adminAlert) window.adminAlert();
                    toast(fresh.length === 1 ? fresh[0].title + ' — ' + fresh[0].session.name + ' (table ' + fresh[0].session.tableNumber + ')' : fresh.length + ' nouvelles alertes clients');
                }
            }
            knownAlertIds = alertIds; // 1er passage : les alertes déjà là ne sonnent pas
            paintBadge();
            if (panelOpen) renderPanel();
        }).catch(function () { /* API injoignable : on garde l'affichage actuel */ });
    }

    // ------------------------------------------------------------------
    // Vue « Clients connectés »
    // ------------------------------------------------------------------
    function viewVisible() { var v = document.getElementById('view-presence'); return v && !v.classList.contains('hidden'); }

    function healthCard(h) {
        var cls = h.status === 'incident' ? 'bg-error-container text-on-error-container' : h.status === 'slow' ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-surface-container text-on-surface';
        var icon = h.status === 'incident' ? 'warning' : h.status === 'slow' ? 'timer' : 'check_circle';
        return '<div class="rounded-xl p-3 flex items-start gap-2 ' + cls + '">' + ic(icon, '', true) +
            '<div><div class="font-label-md text-sm">Santé de l\'API — ' + esc(h.label) + '</div>' +
            '<div class="text-xs opacity-80">Erreurs serveur : ' + (h.serverErrors + h.unhandled) + ' · réponses lentes : ' + h.slowRequests +
            (h.maxMs ? ' · plus lente : ' + h.maxMs + ' ms' : '') + ' · d\'après le journal technique (' + h.windowMinutes + ' dernières minutes)</div></div></div>';
    }

    function statTile(label, value, icon) {
        return '<div class="bg-surface-container-lowest rounded-xl p-3 shadow-[0_2px_10px_rgba(62,36,21,0.05)]">' +
            '<div class="flex items-center gap-1 text-xs text-on-surface-variant font-label-md">' + ic(icon) + ' ' + label + '</div>' +
            '<div class="font-headline-sm text-headline-sm text-primary">' + value + '</div></div>';
    }

    function sessionRow(p) {
        var m = p.metrics;
        var incidents = [];
        if (m.serverErrors || m.http5xx) incidents.push((m.serverErrors + m.http5xx) + ' erreur(s) 5xx');
        if (m.slowRequests || m.serverSlow) incidents.push((m.slowRequests + m.serverSlow) + ' lente(s)');
        if (m.netFailures) incidents.push(m.netFailures + ' échec(s) réseau');
        return '<button onclick="return openPresenceDetail(' + p.id + ')" class="w-full text-left bg-surface-container-lowest rounded-xl p-3 shadow-[0_2px_10px_rgba(62,36,21,0.05)] hover:bg-surface-container-low transition-colors">' +
            '<div class="flex flex-col sm:flex-row sm:items-center gap-2">' +
            '<div class="flex-1 min-w-0"><div class="font-label-md text-sm text-on-surface truncate">' + esc(p.name) + ' <span class="text-on-surface-variant font-normal">· Table ' + esc(p.tableNumber) + ' · ' + p.partySize + ' pers.</span></div>' +
            '<div class="text-xs text-on-surface-variant">Connexion ' + hhmm(p.startedAt) + ' · ' + (p.status === 'ended' ? 'durée ' : 'depuis ') + dur(p.durationSeconds) +
            (p.lastHeartbeatAgeSeconds !== null && p.status !== 'ended' ? ' · dernier signal il y a ' + dur(p.lastHeartbeatAgeSeconds) : '') +
            (p.device ? ' · ' + (p.device === 'mobile' ? 'mobile' : 'ordinateur') : '') + (p.page ? ' · ' + esc(p.page) : '') + '</div>' +
            (p.statusHint ? '<div class="text-xs text-outline">' + esc(p.statusHint) + '</div>' : '') + '</div>' +
            '<div class="flex flex-wrap gap-1 sm:justify-end">' + chip(p) +
            (incidents.length ? '<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant whitespace-nowrap">' + ic('info') + ' ' + incidents.join(' · ') + '</span>' : '') +
            '</div></div></button>';
    }

    function settingsForm(s) {
        var manage = Auth.can('presence.manage');
        function field(id, label, value, help) {
            return '<label class="flex flex-col gap-1 text-xs text-on-surface-variant font-label-md">' + label +
                '<input id="' + id + '" value="' + esc(value) + '"' + (manage ? '' : ' disabled') + ' class="bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none"/>' +
                '<span class="text-[11px] text-outline font-normal">' + help + '</span></label>';
        }
        return '<details class="bg-surface-container-lowest rounded-xl p-3 shadow-[0_2px_10px_rgba(62,36,21,0.05)]">' +
            '<summary class="cursor-pointer font-label-md text-sm text-primary inline-flex items-center gap-2">' + ic('tune') + ' Réglages de la surveillance</summary>' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">' +
            field('ps-log', 'Événement enregistré après (min)', s.logMinutes.join(', '), 'Présence active ; liste possible, ex. 3') +
            field('ps-alert', 'Alerte admin après (min)', s.alertMinutes.join(', '), 'Une alerte par seuil et par session ; ex. 5, 15') +
            field('ps-idle-after', 'Inactif après (min sans interaction)', s.idleAfterMinutes, 'Distingue présence active et simple connexion') +
            field('ps-idle-alert', 'Alerte d\'inactivité prolongée (min)', s.idleAlertMinutes, '0 = désactivée') +
            field('ps-beat', 'Intervalle du signal (s)', s.heartbeatSeconds, '15 à 300 ; plus court = plus réactif, plus de requêtes') +
            field('ps-slow', 'Réponse lente à partir de (ms)', s.slowMs, '500 à 30000') +
            field('ps-retention', 'Conservation (jours)', s.retentionDays, 'Sessions terminées supprimées ensuite') +
            '<label class="flex items-center gap-2 text-sm text-on-surface"><input id="ps-enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + (manage ? '' : ' disabled') + '/> Surveillance activée</label>' +
            '</div>' +
            (manage ? '<div class="mt-3 flex items-center gap-3"><button onclick="return savePresenceSettings()" class="h-10 px-4 rounded-lg bg-primary-container text-on-primary font-label-md text-sm hover:bg-primary">Enregistrer</button><span id="ps-msg" class="text-xs"></span></div>' : '') +
            '</details>';
    }

    function renderView() {
        var el = document.getElementById('presence-content');
        if (!el || !overview) return;
        var c = overview.counts;
        var open = overview.sessions.filter(function (p) { return p.status !== 'ended'; });
        var ended = overview.sessions.filter(function (p) { return p.status === 'ended'; });
        var detailsOpen = el.querySelector('details') && el.querySelector('details').open;
        el.innerHTML =
            healthCard(overview.health) +
            '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
            statTile('Actifs', c.active, 'check_circle') + statTile('Inactifs', c.idle, 'hourglass_top') +
            statTile('Connexion interrompue', c.interrupted, 'warning') + statTile('Terminées (2 h)', c.ended, 'logout') +
            '</div>' +
            '<div><h3 class="font-title-lg text-base text-primary mb-2">Sessions en cours (' + open.length + ')</h3>' +
            '<div class="flex flex-col gap-2">' + (open.length ? open.map(sessionRow).join('') : '<div class="text-sm text-on-surface-variant">Aucun client connecté pour le moment.</div>') + '</div></div>' +
            (ended.length ? '<div><h3 class="font-title-lg text-base text-primary mb-2">Terminées récemment</h3><div class="flex flex-col gap-2">' + ended.map(sessionRow).join('') + '</div></div>' : '') +
            settingsForm(overview.settings);
        if (detailsOpen) el.querySelector('details').open = true;
        if (window.renderIcons) window.renderIcons();
    }

    window.refreshPresenceView = function () {
        if (!allowed()) return false;
        // Formulaire en cours de saisie : on ne le réécrit pas.
        var el = document.getElementById('presence-content');
        if (el && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return false;
        Auth.api('/admin/presence').then(function (r) { overview = r; renderView(); }).catch(function (e) {
            if (el && !overview) el.innerHTML = '<div class="text-sm text-error">Chargement impossible : ' + esc(errText(e)) + '</div>';
        });
        return false;
    };

    window.savePresenceSettings = function () {
        function v(id) { return document.getElementById(id).value.trim(); }
        var msg = document.getElementById('ps-msg');
        var body = {
            enabled: document.getElementById('ps-enabled').checked,
            logMinutes: v('ps-log'), alertMinutes: v('ps-alert'),
            idleAfterMinutes: v('ps-idle-after'), idleAlertMinutes: v('ps-idle-alert'),
            heartbeatSeconds: v('ps-beat'), slowMs: v('ps-slow'), retentionDays: v('ps-retention')
        };
        Auth.api('/admin/presence-settings', Auth.json('PUT', body)).then(function (s) {
            if (overview) overview.settings = s;
            msg.className = 'text-xs text-tertiary';
            msg.textContent = 'Réglages enregistrés';
            document.activeElement && document.activeElement.blur && document.activeElement.blur();
        }).catch(function (e) {
            msg.className = 'text-xs text-error';
            msg.textContent = errText(e);
        });
        return false;
    };

    // ------------------------------------------------------------------
    // Détail d'une session (fiche client)
    // ------------------------------------------------------------------
    function detailModal() {
        var m = document.getElementById('presence-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'presence-modal';
            m.className = 'hidden fixed inset-0 z-[60] items-end md:items-center justify-center p-0 md:p-4 bg-black/40';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-modal', 'true');
            m.addEventListener('click', function (e) { if (e.target === m) closeDetail(); });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
            document.body.appendChild(m);
        }
        return m;
    }
    function closeDetail() { var m = document.getElementById('presence-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } }
    window.closePresenceDetail = function () { closeDetail(); return false; };

    function line(label, value) {
        return '<div class="flex justify-between gap-3 py-1 border-b border-outline-variant text-sm"><span class="text-on-surface-variant">' + label + '</span><span class="text-on-surface text-right">' + value + '</span></div>';
    }

    window.openPresenceDetail = function (presenceId, notifId) {
        var m = detailModal();
        m.innerHTML = '<div class="bg-surface-container-lowest w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-5 shadow-xl text-sm text-on-surface-variant">Chargement…</div>';
        m.classList.remove('hidden');
        m.classList.add('flex');
        if (panelOpen) setPanel(false);
        if (notifId) {
            var n = notifs.filter(function (x) { return x.id === notifId; })[0];
            if (n && !n.read) window.notifAction(notifId, 'read');
        }
        Auth.api('/admin/presence/' + presenceId).then(function (p) {
            var mt = p.metrics;
            var orders = p.orders.length ? p.orders.map(function (o) {
                return '<div class="flex justify-between gap-2 text-sm py-1"><span>#' + o.id + ' · ' + hhmm(o.createdAt) + ' · ' + esc(o.cancelled ? 'Annulée' : o.status) + '</span><span>' + o.total.toFixed(2).replace('.', ',') + ' €' + (o.paid ? ' · payée' : '') + '</span></div>';
            }).join('') : '<div class="text-sm text-on-surface-variant">Aucune commande pendant cette session.</div>';
            var events = p.events.length ? p.events.map(function (e) {
                return '<div class="text-sm py-0.5">' + dayHhmm(e.createdAt) + ' — ' + esc(e.title) + (e.level === 'alert' ? '' : ' <span class="text-xs text-outline">(enregistré)</span>') + '</div>';
            }).join('') : '<div class="text-sm text-on-surface-variant">Aucun événement.</div>';
            m.innerHTML = '<div class="bg-surface-container-lowest w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-5 shadow-xl max-h-[92vh] overflow-y-auto">' +
                '<div class="flex items-start justify-between gap-3 mb-3"><div><h3 class="font-title-lg text-title-lg text-primary">' + esc(p.name) + '</h3>' +
                '<div class="text-sm text-on-surface-variant">Table ' + esc(p.tableNumber) + ' · ' + p.partySize + ' pers.</div></div>' +
                '<button onclick="return closePresenceDetail()" aria-label="Fermer" class="w-9 h-9 rounded-lg inline-flex items-center justify-center text-on-surface-variant hover:bg-surface-variant">' + ic('close') + '</button></div>' +
                '<div class="flex flex-wrap gap-1 mb-3">' + chip(p) + '</div>' +
                (p.statusHint ? '<div class="text-xs text-outline mb-3">' + esc(p.statusHint) + '</div>' : '') +
                line('Connexion', dayHhmm(p.startedAt)) +
                line(p.status === 'ended' ? 'Durée' : 'Connecté depuis', dur(p.durationSeconds)) +
                line('Dernier signal', p.lastHeartbeatAt ? dayHhmm(p.lastHeartbeatAt) + (p.status === 'ended' ? '' : ' (il y a ' + dur(p.lastHeartbeatAgeSeconds) + ')') : 'aucun') +
                line('Sans interaction depuis', p.status === 'ended' ? '—' : dur(p.idleSeconds)) +
                (p.endedAt ? line('Fin de session', dayHhmm(p.endedAt) + ' · ' + (END_REASON[p.endReason] || '—')) : '') +
                line('Appareil · page', (p.device === 'mobile' ? 'Mobile' : p.device === 'desktop' ? 'Ordinateur' : '—') + ' · ' + esc(p.page || '—')) +
                '<h4 class="font-label-md text-sm text-primary mt-4 mb-1">Qualité de service pendant la session</h4>' +
                line('Erreurs serveur (mesurées par l\'API)', mt.serverErrors) +
                line('Réponses 5xx reçues par l\'appareil', mt.http5xx) +
                line('Réponses lentes (API · appareil)', mt.serverSlow + ' · ' + mt.slowRequests) +
                line('Réponse la plus lente (appareil)', mt.maxResponseMs ? mt.maxResponseMs + ' ms' : '—') +
                line('Échecs réseau (appareil)', mt.netFailures) +
                line('Signaux reçus', mt.heartbeats) +
                '<h4 class="font-label-md text-sm text-primary mt-4 mb-1">Commandes de la session</h4>' + orders +
                '<h4 class="font-label-md text-sm text-primary mt-4 mb-1">Événements</h4>' + events +
                '</div>';
            if (window.renderIcons) window.renderIcons();
        }).catch(function (e) {
            m.innerHTML = '<div class="bg-surface-container-lowest w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-5 shadow-xl"><div class="text-sm text-error mb-3">Chargement impossible : ' + esc(errText(e)) + '</div><button onclick="return closePresenceDetail()" class="h-9 px-4 rounded-lg bg-surface-container text-sm">Fermer</button></div>';
        });
        return false;
    };

    // ------------------------------------------------------------------
    // Démarrage : visible seulement avec la permission, polling suspendu en arrière-plan
    // ------------------------------------------------------------------
    function applyPermission() {
        var ok = allowed();
        var nav = document.getElementById('nav-presence');
        if (nav) nav.classList.toggle('hidden', !ok);
        document.querySelectorAll('[data-notif-bell]').forEach(function (b) { b.classList.toggle('hidden', !ok); });
        if (ok && !timer) { tick(); timer = setInterval(tick, POLL_MS); }
    }
    function tick() {
        if (document.hidden || !allowed()) return;
        syncNotifications();
        if (viewVisible()) window.refreshPresenceView();
    }
    document.addEventListener('DOMContentLoaded', applyPermission);
    document.addEventListener('soucoffe:permissions', applyPermission);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && timer) tick(); });
})();
