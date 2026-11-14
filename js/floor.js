// SOUCOFFE - Plan de salle (gestion intelligente des tables), partagé par
// l'admin (vue « Tables »), la caisse et la page serveur.
//
//   Libre · Occupée · Commande en préparation · Addition demandée · À nettoyer
//
// Le statut est calculé par l'API (jamais saisi ici). Chaque bouton n'apparaît
// que si le rôle connecté a la permission correspondante ; l'API refuse de
// toute façon une action non permise.
//
// Présentation : les tables qui demandent une action (tout sauf Libre) sont
// mises en avant en premier, avec le détail complet ; les tables libres sont
// regroupées ensuite dans une grille compacte, pour que l'œil aille droit à
// ce qui compte plutôt que de scanner une rangée de cartes identiques.
(function () {
    var META = {
        free: { label: 'Libre' },
        occupied: { label: 'Occupée' },
        preparing: { label: 'Commande en préparation' },
        bill: { label: 'Addition demandée' },
        cleaning: { label: 'À nettoyer' }
    };
    // Ordre d'affichage ET de priorité (une addition demandée passe avant une simple table occupée).
    var ORDER = ['bill', 'preparing', 'occupied', 'cleaning', 'free'];
    var LEGEND_ORDER = ['free', 'occupied', 'preparing', 'bill', 'cleaning'];

    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name, cls, filled) { return window.iconHtml ? window.iconHtml(name, cls, filled) : ''; }
    function money(v) { return (parseFloat(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function can(p) { return window.Auth && Auth.can(p); }
    function attr(v) { return esc(v); }

    function toast(msg) {
        if (window.showToast) { window.showToast(msg); return; }
        var host = document.getElementById('floor-toast');
        if (!host) {
            host = document.createElement('div');
            host.id = 'floor-toast';
            host.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-2 items-center pointer-events-none';
            document.body.appendChild(host);
        }
        var t = document.createElement('div');
        t.className = 'bg-inverse-surface text-inverse-on-surface font-label-md text-sm px-4 py-2 rounded-lg shadow-lg';
        t.textContent = msg;
        host.appendChild(t);
        setTimeout(function () { t.remove(); }, 3500);
    }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }

    // Durées lisibles même longues (une démo ou un oubli peut laisser une table
    // occupée depuis des jours) : minutes, puis heures, puis jours + heures.
    function since(iso) {
        var t = Date.parse(String(iso || '').replace(' ', 'T'));
        if (isNaN(t)) return '';
        var m = Math.max(0, Math.round((Date.now() - t) / 60000));
        if (m < 1) return 'à l’instant';
        if (m < 60) return m + ' min';
        var h = Math.floor(m / 60);
        if (h < 48) return h + ' h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
        return Math.floor(h / 24) + ' j ' + (h % 24) + ' h';
    }
    // « il y a 5 min » / « à l'instant » (jamais « il y a à l'instant »).
    function ago(iso) {
        var d = since(iso);
        return d === '' ? '' : (d.indexOf('à') === 0 ? d : 'il y a ' + d);
    }
    function sinceLabel(iso) {
        var d = since(iso);
        return d === '' ? '' : (d.indexOf('à') === 0 ? d : 'depuis ' + d);
    }

    function legendHtml(tables) {
        var counts = {};
        (tables || []).forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });
        return '<div class="flex flex-wrap gap-2">' + LEGEND_ORDER.map(function (s) {
            return '<span class="sc-tstatus-' + s + ' inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-on-surface font-label-md text-xs">' +
                ic('circle', 'sc-tdot text-[10px]', true) + esc(META[s].label) + ' <b>' + (counts[s] || 0) + '</b></span>';
        }).join('') + '</div>';
    }

    function actionsHtml(t) {
        var n = attr(t.tableNumber);
        var b = '';
        var btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-label-md text-xs transition-colors ';
        if (t.unpaidOrders > 0 && can('payments.collect')) {
            b += '<button data-floor-pay="cash" data-table="' + n + '" class="' + btn + 'bg-primary-container text-on-primary hover:bg-primary">' + ic('payments') + ' Espèces</button>';
            b += '<button data-floor-pay="card" data-table="' + n + '" class="' + btn + 'bg-primary-container text-on-primary hover:bg-primary">' + ic('credit_card') + ' Carte</button>';
        }
        if ((t.status === 'occupied' || t.status === 'preparing') && t.unpaidOrders > 0 && can('bill.request')) {
            b += '<button data-floor-act="bill" data-table="' + n + '" class="' + btn + 'bg-surface-container text-on-surface hover:bg-surface-variant">' + ic('receipt_long') + ' Addition demandée</button>';
        }
        if ((t.status === 'occupied' || t.status === 'bill') && t.unpaidOrders === 0 && t.activeOrders === 0 && can('tables.release')) {
            b += '<button data-floor-act="release" data-table="' + n + '" class="' + btn + 'bg-surface-container text-on-surface hover:bg-surface-variant">' + ic('logout') + ' Libérer la table</button>';
        }
        if (t.status === 'cleaning' && can('tables.clean')) {
            b += '<button data-floor-act="clean" data-table="' + n + '" class="' + btn + 'bg-primary-container text-on-primary hover:bg-primary">' + ic('cleaning_services') + ' Marquer nettoyée</button>';
        }
        return b ? '<div class="flex flex-wrap gap-2 pt-3">' + b + '</div>' : '';
    }

    // Retirer une table du plan : action rare et destructive, réservée aux
    // tables libres/à nettoyer — un simple icône discret, jamais un bouton
    // plein rouge qui alarmerait sur une table qui va pourtant bien.
    function removeAffordance(t) {
        if (!(t.status === 'free' || t.status === 'cleaning') || !can('tables.manage')) return '';
        return '<button data-floor-act="remove" data-table="' + attr(t.tableNumber) + '" title="Retirer cette table du plan" ' +
            'aria-label="Retirer la table ' + attr(t.tableNumber) + ' du plan" ' +
            'class="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-on-surface-variant/60 hover:text-error hover:bg-error-container transition-colors">' + ic('delete', 'text-[16px]') + '</button>';
    }

    // Carte détaillée : toute table qui n'est pas simplement libre.
    function cardHtml(t) {
        var lines = [];
        if (t.seats) lines.push(ic('event_seat', 'text-[14px] align-middle') + ' ' + t.seats);
        if (t.clients) lines.push(ic('groups', 'text-[14px] align-middle') + ' ' + t.clients);
        if (t.activeOrders) lines.push(ic('receipt_long', 'text-[14px] align-middle') + ' ' + t.activeOrders + ' en cours');
        if (t.server) lines.push(ic('badge', 'text-[14px] align-middle') + ' ' + esc(t.server));
        // Titre et badge sur deux lignes tant qu'il n'y a pas la place (colonne
        // par défaut, rangée seulement à partir de sm:) — plus sûr qu'un
        // flex-wrap dont le point de bascule dépend de la largeur exacte du
        // contenu, et qui laissait le badge se faire couper sur les petits
        // écrans (le sien étant collé au bord droit via justify-between).
        return '<div class="sc-tcard sc-tstatus-' + t.status + ' bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)]" data-table="' + attr(t.tableNumber) + '">' +
            '<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">' +
            '<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">' +
            '<span class="font-title-lg text-title-lg text-on-surface whitespace-nowrap">' + esc(t.name) + '</span>' +
            (lines.length ? '<span class="text-xs text-on-surface-variant whitespace-nowrap">' + lines.join('<span class="mx-1 opacity-50">·</span>') + '</span>' : '') +
            '</div>' +
            '<span class="sc-tbadge inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-md text-xs text-on-surface whitespace-nowrap self-start sm:self-auto shrink-0">' + ic('circle', 'sc-tdot text-[9px]', true) + esc(t.statusLabel) + '</span>' +
            '</div>' +
            (t.unpaidOrders > 0 ? '<div class="mt-2.5 flex items-baseline gap-2 flex-wrap">' +
                '<span class="text-xs text-on-surface-variant uppercase tracking-wide">À encaisser</span>' +
                '<span class="font-title-lg text-title-lg text-on-surface">' + esc(money(t.unpaidTotal)) + '</span>' +
                (t.occupiedSince ? '<span class="text-xs text-on-surface-variant">' + esc(sinceLabel(t.occupiedSince)) + '</span>' : '') + '</div>' : '') +
            (t.billRequestedAt ? '<div class="mt-1.5 text-xs text-on-surface flex items-center gap-1">' + ic('receipt_long', 'text-[14px]') + ' Addition demandée ' + esc(ago(t.billRequestedAt)) + '</div>' : '') +
            actionsHtml(t) + '</div>';
    }

    // Tuile compacte : tables libres, groupées à part (aucune information ne
    // s'y perd — juste beaucoup moins de poids visuel que pour les tables
    // qui demandent réellement une action).
    function freeTileHtml(t) {
        return '<div class="sc-tcard sc-tstatus-free bg-surface-container-lowest rounded-lg px-3 py-2.5 flex items-center justify-between gap-2" data-table="' + attr(t.tableNumber) + '">' +
            '<span class="flex items-center gap-2 min-w-0">' +
            '<span class="font-label-md text-sm text-on-surface truncate">' + esc(t.name) + '</span>' +
            (t.seats ? '<span class="text-xs text-on-surface-variant whitespace-nowrap">' + ic('event_seat', 'text-[13px] align-middle') + ' ' + t.seats + '</span>' : '') +
            '</span>' +
            removeAffordance(t) +
            '</div>';
    }

    var listeners = [];
    function changed() { listeners.forEach(function (f) { f(); }); }

    var Floor = {
        META: META,
        legendHtml: legendHtml,
        cardHtml: cardHtml,
        since: since,
        onChange: function (f) { listeners.push(f); },
        // Écrit dans le conteneur seulement si le HTML a changé (pas de clignotement).
        // Les tables à traiter d'abord (triées par urgence), les libres ensuite
        // dans une grille compacte à part.
        render: function (container, tables) {
            if (!container) return;
            if (!tables.length) {
                var empty = '<p class="sc-admin-empty text-on-surface-variant">Aucune table à afficher.</p>';
                if (container.__html !== empty) { container.__html = empty; container.innerHTML = empty; }
                return;
            }
            var busy = [], free = [];
            tables.slice()
                .sort(function (a, b) { return ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || strcmp(a.tableNumber, b.tableNumber); })
                .forEach(function (t) { (t.status === 'free' ? free : busy).push(t); });

            var html = '';
            if (busy.length) {
                html += '<div class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">' + busy.map(cardHtml).join('') + '</div>';
            }
            if (free.length) {
                html += '<div class="mt-4' + (busy.length ? '' : '') + '">' +
                    '<p class="font-label-md text-xs text-on-surface-variant uppercase tracking-wider mb-2">Tables libres (' + free.length + ')</p>' +
                    '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">' + free.map(freeTileHtml).join('') + '</div></div>';
            }
            if (container.__html === html) return;
            container.__html = html;
            container.innerHTML = html;
            if (window.renderIcons) window.renderIcons();
        },
        toast: toast
    };
    function strcmp(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }
    window.Floor = Floor;

    // ---- Actions ----
    function call(path, method, body, okMsg) {
        return Auth.api(path, Auth.json(method, body)).then(function (r) { if (okMsg) toast(okMsg); changed(); return r; })
            .catch(function (e) { toast('Impossible : ' + errText(e)); changed(); });
    }

    window.floorAct = function (table, act) {
        var p = '/tables/' + encodeURIComponent(table);
        if (act === 'bill') return call(p + '/bill', 'POST', undefined, 'Addition demandée');
        if (act === 'release') return call(p + '/release', 'POST', undefined, 'Table libérée : à nettoyer');
        if (act === 'clean') return call(p + '/clean', 'POST', undefined, 'Table nettoyée : de nouveau libre');
        if (act === 'remove') {
            if (!window.confirm('Retirer la table ' + table + ' du plan de salle ?')) return;
            return call(p, 'DELETE', undefined, 'Table retirée');
        }
    };

    var dlg = null;
    function buildDialog() {
        dlg = document.createElement('div');
        dlg.className = 'hidden fixed inset-0 z-[80] items-center justify-center p-4 bg-black/50';
        dlg.setAttribute('role', 'dialog');
        dlg.setAttribute('aria-modal', 'true');
        document.body.appendChild(dlg);
        dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(); });
    }
    function closeDialog() { if (dlg) { dlg.classList.add('hidden'); dlg.classList.remove('flex'); } }

    // Encaissement de toutes les commandes à régler d'une table : espèces (avec calcul du rendu) ou carte.
    window.floorPay = function (table, method) {
        Auth.api('/tables').then(function (r) {
            var t = (r.content || []).filter(function (x) { return x.tableNumber === table; })[0];
            if (!t || !t.unpaidOrders) { toast('Rien à encaisser sur cette table'); changed(); return; }
            if (!dlg) buildDialog();
            var due = t.unpaidTotal;
            dlg.innerHTML =
                '<div class="bg-surface-container-lowest text-on-surface rounded-2xl w-full max-w-sm p-6 shadow-xl space-y-4">' +
                '<h3 class="font-title-lg text-title-lg text-primary">' + esc(t.name) + ' — ' + (method === 'cash' ? 'Espèces' : 'Carte') + '</h3>' +
                '<div class="flex justify-between font-label-md"><span>' + t.unpaidOrders + ' commande(s)</span><span class="font-title-lg">' + esc(money(due)) + '</span></div>' +
                (method === 'cash'
                    ? '<label class="block font-label-md text-xs text-on-surface-variant" for="floor-received">Montant reçu (€)</label>' +
                      '<input id="floor-received" type="number" step="0.01" min="0" value="' + due.toFixed(2) + '" class="w-full bg-surface-container-high rounded-lg px-3 py-2 text-on-surface border border-transparent focus:border-primary focus:ring-0 focus:outline-none"/>' +
                      '<div class="flex justify-between font-label-md"><span>Rendu</span><span id="floor-change" class="font-title-lg text-primary">0,00 €</span></div>'
                    : '<p class="text-sm text-on-surface-variant">Validez après le passage de la carte sur le terminal.</p>') +
                '<p id="floor-pay-error" role="alert" class="hidden text-error text-sm"></p>' +
                '<div class="flex gap-2"><button id="floor-pay-cancel" class="flex-1 py-3 rounded-lg border-[1.5px] border-outline-variant font-label-md text-label-md hover:bg-surface-container">Annuler</button>' +
                '<button id="floor-pay-ok" class="flex-1 py-3 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary disabled:opacity-60">Encaisser ' + esc(money(due)) + '</button></div></div>';
            dlg.classList.remove('hidden');
            dlg.classList.add('flex');
            var rec = document.getElementById('floor-received');
            var chg = document.getElementById('floor-change');
            var ok = document.getElementById('floor-pay-ok');
            var err = document.getElementById('floor-pay-error');
            function upd() {
                if (!rec) return;
                var v = parseFloat(rec.value) || 0;
                chg.textContent = Math.max(0, v - due).toFixed(2).replace('.', ',') + ' €';
                ok.disabled = v + 1e-9 < due;
            }
            if (rec) { rec.addEventListener('input', upd); upd(); rec.focus(); rec.select(); }
            document.getElementById('floor-pay-cancel').onclick = closeDialog;
            ok.onclick = function () {
                ok.disabled = true;
                Auth.api('/tables/' + encodeURIComponent(table) + '/payment', Auth.json('PATCH', { method: method })).then(function (res) {
                    closeDialog();
                    toast(res.paidOrders + ' commande(s) encaissée(s) — ' + (method === 'cash' ? 'espèces' : 'carte'));
                    changed();
                }).catch(function (e) {
                    err.textContent = errText(e);
                    err.classList.remove('hidden');
                    ok.disabled = false;
                });
            };
        }).catch(function (e) { toast('Impossible : ' + errText(e)); });
    };
    // Clics sur les boutons du plan : la table est lue dans data-table (échappé), jamais interprétée comme du code.
    document.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-floor-act],[data-floor-pay]') : null;
        if (!b) return;
        var table = b.getAttribute('data-table');
        if (b.hasAttribute('data-floor-pay')) window.floorPay(table, b.getAttribute('data-floor-pay'));
        else window.floorAct(table, b.getAttribute('data-floor-act'));
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDialog(); });
})();
