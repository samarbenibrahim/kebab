// SOUCOFFE - Profil client (clic sur l'icône client de l'en-tête).
//
// Le client ne change JAMAIS de table seul :
//   1. il prévient l'administration (demande, table souhaitée facultative) ;
//   2. l'administration répond par une table disponible (ou refuse) ;
//   3. le client clique sur son icône, voit la table attribuée et la confirme.
// L'API refuse toute autre table que celle attribuée : ce script ne fait que
// présenter le parcours. Sans session client, l'icône mène à l'identification.
(function () {
    var POLL_MS = 8000;
    var SEEN_KEY = 'soucoffe_tcr_seen';
    var modal = null;
    var profile = null;      // { client, tableRequest }
    var pollTimer = null;
    var lastStatusKey = null; // "id:status" de la dernière demande vue par le polling
    var partyDraft = null;
    var loyalty = null;      // réponse de /loyalty/me

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function icon(name, cls) {
        var s = document.createElement('span');
        s.className = 'material-symbols-outlined' + (cls ? ' ' + cls : '');
        s.textContent = name;
        return s;
    }
    function toast(msg) { if (window.showToast) window.showToast(msg); }

    var INPUT_CLS = 'w-full bg-surface-container-high rounded-lg px-3 py-2 font-body-md text-sm text-on-surface placeholder:text-outline/70 border border-transparent focus:border-primary focus:ring-0 focus:outline-none';
    var BTN_PRIMARY = 'w-full bg-primary-container text-on-primary font-label-md text-label-md py-3 rounded-lg hover:bg-primary transition-colors disabled:opacity-60';
    var BTN_GHOST = 'w-full bg-transparent border-[1.5px] border-outline-variant text-on-surface font-label-md text-label-md py-3 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-60';

    // ---- Pastille "quelque chose à voir" sur l'icône client ----
    function needsAttention() {
        var r = profile && profile.tableRequest;
        if (!r) return false;
        if (r.status === 'approved') return true;
        if (r.status === 'rejected') {
            try { return sessionStorage.getItem(SEEN_KEY) !== String(r.id); } catch (e) { return true; }
        }
        return false;
    }
    function updateBadge() {
        var on = needsAttention();
        document.querySelectorAll('[data-profile-toggle]').forEach(function (b) {
            b.classList.add('relative');
            var dot = b.querySelector('[data-profile-dot]');
            if (on && !dot) {
                dot = el('span', 'absolute top-0 right-0 w-3 h-3 rounded-full bg-error border-2 border-surface');
                dot.setAttribute('data-profile-dot', '');
                b.appendChild(dot);
            } else if (!on && dot) {
                dot.remove();
            }
        });
    }

    // ---- Chargement / polling ----
    function load() {
        return Auth.api('/clients/me').then(function (r) {
            profile = r;
            Auth.syncIdentity(r.client);
            updateBadge();
            return r;
        });
    }

    function poll() {
        if (!Auth.client()) return;
        load().then(function (r) {
            var req = r.tableRequest;
            var key = req ? req.id + ':' + req.status : null;
            if (lastStatusKey !== null && key !== lastStatusKey && req) {
                if (req.status === 'approved') toast('L’administration vous attribue la table ' + req.approvedTable + ' — cliquez sur votre profil pour confirmer');
                else if (req.status === 'rejected') toast('Votre demande de changement de table a été refusée');
            }
            lastStatusKey = key;
            if (modal && !modal.classList.contains('hidden')) render();
        }).catch(function () { /* réseau coupé : on réessaie au prochain tour */ });
    }

    // ---- Fenêtre ----
    function build() {
        modal = el('div', 'fixed inset-0 z-[70] hidden items-center justify-center p-4 bg-black/50');
        modal.id = 'profile-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'profile-title');
        modal.addEventListener('click', function (e) { if (e.target === modal) closeProfile(); });
        document.body.appendChild(modal);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeProfile(); });
    }

    function row(label, value) {
        var r = el('div', 'flex justify-between gap-3 py-1.5 text-sm');
        r.appendChild(el('span', 'text-on-surface-variant', label));
        r.appendChild(el('span', 'font-label-md text-on-surface text-right break-words', value));
        return r;
    }

    function message(kind, text) {
        var box = el('div', 'rounded-lg px-3 py-2 text-sm flex items-start gap-2 ' +
            (kind === 'error' ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface'));
        box.appendChild(icon(kind === 'error' ? 'info' : 'check_circle'));
        box.appendChild(el('span', 'flex-1', text));
        return box;
    }

    function setBusy(btn, busy) { if (btn) btn.disabled = !!busy; }

    function showError(container, err) {
        var old = container.querySelector('[data-inline-error]');
        if (old) old.remove();
        var m = message('error', err.message || 'Une erreur est survenue');
        m.setAttribute('data-inline-error', '');
        m.setAttribute('role', 'alert');
        container.appendChild(m);
    }

    function tableSection() {
        var c = profile.client;
        var req = profile.tableRequest;
        var sec = el('section', 'space-y-3');
        sec.id = 'profile-table-section';
        sec.appendChild(el('h3', 'font-title-lg text-title-lg text-on-surface', 'Changer de table'));

        if (req && req.status === 'pending') {
            sec.appendChild(message('info', 'Demande envoyée à l’administration' +
                (req.requestedTable ? ' (table souhaitée : ' + req.requestedTable + ')' : '') + '. En attente de sa réponse…'));
            var cancel = el('button', BTN_GHOST, 'Annuler ma demande');
            cancel.type = 'button';
            cancel.onclick = function () {
                setBusy(cancel, true);
                Auth.api('/table-change-requests/' + req.id + '/cancel', Auth.json('PATCH')).then(function () { return load(); })
                    .then(function () { render(); }).catch(function (err) { setBusy(cancel, false); showError(sec, err); });
            };
            sec.appendChild(cancel);
            return sec;
        }

        if (req && req.status === 'approved') {
            sec.appendChild(message('info', 'L’administration vous attribue la table ' + req.approvedTable + '.' +
                (req.adminMessage ? ' « ' + req.adminMessage + ' »' : '')));
            var lab = el('label', 'block font-label-md text-label-md text-on-surface-variant', 'Votre nouvelle table');
            lab.setAttribute('for', 'profile-apply-table');
            var input = el('input', INPUT_CLS);
            input.id = 'profile-apply-table';
            input.type = 'text';
            input.maxLength = 20;
            input.value = req.approvedTable;
            var apply = el('button', BTN_PRIMARY, 'Confirmer le changement de table');
            apply.type = 'button';
            apply.onclick = function () {
                var value = input.value.trim();
                if (!value) { showError(sec, new Error('Indiquez la table.')); return; }
                setBusy(apply, true);
                Auth.api('/clients/me/table', Auth.json('PATCH', { tableNumber: value })).then(function () { return load(); })
                    .then(function () { toast('Vous êtes maintenant à la table ' + profile.client.tableNumber); render(); })
                    .catch(function (err) { setBusy(apply, false); showError(sec, err); });
            };
            sec.appendChild(lab); sec.appendChild(input); sec.appendChild(apply);
            return sec;
        }

        if (req && req.status === 'rejected') {
            sec.appendChild(message('error', 'Votre demande a été refusée' + (req.adminMessage ? ' : « ' + req.adminMessage + ' »' : '.')));
            try { sessionStorage.setItem(SEEN_KEY, String(req.id)); } catch (e) { /* stockage indisponible */ }
            updateBadge();
        } else if (req && req.status === 'applied') {
            sec.appendChild(message('info', 'Votre table a bien été changée.'));
        }

        sec.appendChild(el('p', 'text-sm text-on-surface-variant',
            'Vous êtes à la table ' + c.tableNumber + '. Pour en changer, prévenez l’administration : elle vous indiquera une table disponible.'));
        var l1 = el('label', 'block font-label-md text-label-md text-on-surface-variant', 'Table souhaitée (facultatif)');
        l1.setAttribute('for', 'profile-req-table');
        var wanted = el('input', INPUT_CLS);
        wanted.id = 'profile-req-table'; wanted.type = 'text'; wanted.maxLength = 20; wanted.placeholder = 'Ex : 8';
        var l2 = el('label', 'block font-label-md text-label-md text-on-surface-variant', 'Motif (facultatif)');
        l2.setAttribute('for', 'profile-req-reason');
        var reason = el('input', INPUT_CLS);
        reason.id = 'profile-req-reason'; reason.type = 'text'; reason.maxLength = 255; reason.placeholder = 'Ex : trop de bruit, groupe plus nombreux…';
        var send = el('button', BTN_PRIMARY, 'Prévenir l’administration');
        send.type = 'button';
        send.onclick = function () {
            setBusy(send, true);
            var body = {};
            if (wanted.value.trim()) body.requestedTable = wanted.value.trim();
            if (reason.value.trim()) body.reason = reason.value.trim();
            Auth.api('/table-change-requests', Auth.json('POST', body)).then(function () { return load(); })
                .then(function () { lastStatusKey = profile.tableRequest.id + ':' + profile.tableRequest.status; toast('Administration prévenue'); render(); })
                .catch(function (err) { setBusy(send, false); showError(sec, err); });
        };
        [l1, wanted, l2, reason, send].forEach(function (n) { sec.appendChild(n); });
        return sec;
    }

    function partySection() {
        var c = profile.client;
        if (partyDraft === null) partyDraft = c.partySize;
        var sec = el('section', 'space-y-2');
        sec.appendChild(el('h3', 'font-title-lg text-title-lg text-on-surface', 'Nombre de personnes'));
        var line = el('div', 'flex items-center gap-3');
        var minus = el('button', 'w-9 h-9 flex items-center justify-center text-primary bg-surface-container rounded-full hover:bg-surface-variant');
        minus.type = 'button'; minus.setAttribute('aria-label', 'Moins de personnes'); minus.appendChild(icon('remove'));
        var count = el('span', 'font-title-lg text-title-lg text-primary w-8 text-center', String(partyDraft));
        var plus = el('button', 'w-9 h-9 flex items-center justify-center text-primary bg-surface-container rounded-full hover:bg-surface-variant');
        plus.type = 'button'; plus.setAttribute('aria-label', 'Plus de personnes'); plus.appendChild(icon('add'));
        var save = el('button', 'ml-auto px-4 py-2 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary disabled:opacity-40', 'Enregistrer');
        save.type = 'button';
        function refresh() { count.textContent = String(partyDraft); save.disabled = partyDraft === c.partySize; }
        minus.onclick = function () { partyDraft = Math.max(1, partyDraft - 1); refresh(); };
        plus.onclick = function () { partyDraft = Math.min(50, partyDraft + 1); refresh(); };
        save.onclick = function () {
            setBusy(save, true);
            Auth.api('/clients/me', Auth.json('PATCH', { partySize: partyDraft })).then(function (r) {
                profile = r; partyDraft = null; Auth.syncIdentity(r.client); toast('Nombre de personnes mis à jour'); render();
            }).catch(function (err) { setBusy(save, false); showError(sec, err); });
        };
        refresh();
        [minus, count, plus, save].forEach(function (n) { line.appendChild(n); });
        sec.appendChild(line);
        return sec;
    }

    // Fidélité : points, palier, progression et derniers mouvements (compte lié au téléphone).
    var TYPE_LABEL = { earn: 'Gain', redeem: 'Utilisation', refund: 'Restitution', adjust: 'Ajustement' };
    function loyaltySection() {
        var sec = el('section', 'space-y-2');
        sec.appendChild(el('h3', 'font-title-lg text-title-lg text-on-surface', 'Fidélité'));
        if (!loyalty) { sec.appendChild(el('p', 'text-sm text-on-surface-variant', 'Chargement…')); return sec; }
        if (!loyalty.enrolled) {
            sec.appendChild(el('p', 'text-sm text-on-surface-variant', loyalty.message || 'Programme de fidélité indisponible.'));
            return sec;
        }
        var a = loyalty.account;
        var head = el('div', 'flex items-center justify-between gap-3 bg-surface-container rounded-lg px-3 py-2');
        var left = el('div');
        left.appendChild(el('div', 'font-title-lg text-title-lg text-primary', a.points + ' points'));
        left.appendChild(el('div', 'text-xs text-on-surface-variant', '= ' + a.redeemValue.toFixed(2).replace('.', ',') + ' € de remise · palier ' + a.tier + ' (x' + a.tierMultiplier + ')'));
        head.appendChild(left);
        head.appendChild(icon('loyalty', 'text-[28px] text-primary'));
        sec.appendChild(head);
        if (a.nextTier) {
            var span = a.lifetimePoints + a.pointsToNextTier;
            var bar = el('div', 'h-2 rounded-full bg-surface-variant overflow-hidden');
            var fill = el('div', 'h-full bg-primary-container');
            fill.style.width = Math.min(100, Math.round(100 * a.lifetimePoints / span)) + '%';
            bar.appendChild(fill);
            sec.appendChild(bar);
            sec.appendChild(el('div', 'text-xs text-on-surface-variant', 'Encore ' + a.pointsToNextTier + ' points avant le palier ' + a.nextTier));
        }
        sec.appendChild(el('div', 'text-xs text-on-surface-variant', '1 point par € payé · 10 points = 1 € · à utiliser depuis le Panier (minimum ' + a.minRedeem + ' points).'));
        (loyalty.history || []).slice(0, 5).forEach(function (h) {
            var r = el('div', 'flex justify-between text-xs gap-3');
            r.appendChild(el('span', 'text-on-surface-variant', (TYPE_LABEL[h.type] || h.type) + (h.note ? ' — ' + h.note : '')));
            r.appendChild(el('span', 'font-label-md ' + (h.points < 0 ? 'text-error' : 'text-primary'), (h.points > 0 ? '+' : '') + h.points));
            sec.appendChild(r);
        });
        return sec;
    }

    function render() {
        if (!modal || !profile) return;
        var c = profile.client;
        // Ne pas écraser ce que le client est en train de saisir pendant un rafraîchissement automatique.
        var active = document.activeElement;
        if (active && modal.contains(active) && active.tagName === 'INPUT' && modal.dataset.rendered === (profile.tableRequest ? profile.tableRequest.id + ':' + profile.tableRequest.status : 'none')) return;
        modal.dataset.rendered = profile.tableRequest ? profile.tableRequest.id + ':' + profile.tableRequest.status : 'none';

        var card = el('div', 'bg-surface-container-lowest text-on-surface rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 shadow-xl space-y-5');
        var head = el('div', 'flex items-center gap-3');
        var av = el('span', 'w-12 h-12 rounded-full bg-secondary-container text-primary flex items-center justify-center text-[30px] shrink-0');
        av.appendChild(icon('account_circle'));
        var titles = el('div', 'flex-1 min-w-0');
        var h = el('h2', 'font-title-lg text-title-lg text-on-surface truncate', c.firstName + ' ' + c.lastName);
        h.id = 'profile-title';
        titles.appendChild(h);
        titles.appendChild(el('p', 'text-sm text-on-surface-variant', 'Table ' + c.tableNumber));
        var close = el('button', 'text-on-surface-variant hover:text-primary');
        close.type = 'button'; close.setAttribute('aria-label', 'Fermer'); close.appendChild(icon('close'));
        close.onclick = closeProfile;
        head.appendChild(av); head.appendChild(titles); head.appendChild(close);
        card.appendChild(head);

        var info = el('div', 'divide-y divide-outline-variant/40');
        info.appendChild(row('Nom', c.firstName + ' ' + c.lastName));
        info.appendChild(row('Table', c.tableNumber));
        info.appendChild(row('Personnes', String(c.partySize)));
        if (c.phone) info.appendChild(row('Téléphone', c.phone));
        card.appendChild(info);

        card.appendChild(tableSection());
        card.appendChild(partySection());
        card.appendChild(loyaltySection());

        var out = el('button', BTN_GHOST + ' inline-flex items-center justify-center gap-2');
        out.type = 'button';
        out.appendChild(icon('logout'));
        var outLabel = el('span', '', 'Terminer ma session');
        out.appendChild(outLabel);
        var armed = false;
        out.onclick = function () {
            if (!armed) {
                armed = true;
                outLabel.textContent = 'Confirmer (le panier sera vidé)';
                setTimeout(function () { armed = false; outLabel.textContent = 'Terminer ma session'; }, 4000);
                return;
            }
            out.disabled = true;
            Promise.resolve(Auth.logoutClient()).catch(function (err) {
                out.disabled = false;
                armed = false;
                outLabel.textContent = 'Terminer ma session';
                var old = card.querySelector('[data-inline-error]');
                if (old) old.remove();
                var m = message('error', err.message);
                m.setAttribute('data-inline-error', '');
                m.setAttribute('role', 'alert');
                card.appendChild(m);
            });
        };
        card.appendChild(out);

        modal.replaceChildren(card);
        if (window.renderIcons) window.renderIcons();
    }

    function openProfile() {
        if (!Auth.client()) {
            var parts = location.pathname.split('/');
            location.href = '../01-Identification/log.html?next=' + encodeURIComponent('../' + parts[parts.length - 2] + '/' + parts[parts.length - 1] + location.search);
            return;
        }
        if (!modal) build();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.dataset.rendered = '';
        partyDraft = null;
        Auth.api('/loyalty/me').then(function (r) { loyalty = r; if (modal && !modal.classList.contains('hidden')) { modal.dataset.rendered = ''; render(); } }).catch(function () { /* fidélité indisponible : section vide */ });
        load().then(function () { render(); }).catch(function (err) {
            modal.replaceChildren(el('div', 'bg-surface-container-lowest rounded-2xl p-6 text-error', err.message));
        });
    }
    function closeProfile() {
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        updateBadge();
    }
    window.openProfile = openProfile;
    window.closeProfile = closeProfile;

    // Changement de table : ouvre le profil directement sur la rubrique
    // « Changer de table » (pastille « Table N » de l'en-tête, mobile et ordinateur).
    function openTableChange() {
        openProfile();
        if (!modal) return;
        var t0 = Date.now();
        (function find() {
            var heads = modal.querySelectorAll('h3');
            var target = null;
            Array.prototype.forEach.call(heads, function (h) { if (/Changer de table/.test(h.textContent)) target = h; });
            if (target) {
                var sec = target.parentElement || target;
                sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
                sec.classList.remove('sc-flash');
                void sec.offsetWidth;
                sec.classList.add('sc-flash');
                var input = sec.querySelector('input, select, button');
                if (input && input.tagName !== 'BUTTON') { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
                return;
            }
            if (Date.now() - t0 < 4000) setTimeout(find, 120);
        })();
    }
    window.openTableChange = openTableChange;

    // En-têtes : la table devient une pastille cliquable « Table N » (même
    // comportement en mobile et en ordinateur). Construit à partir du balisage
    // existant ([data-table-number] / [data-guest-name]), sans modifier les pages.
    function tableChip(numberEl) {
        var b = el('button', 'sc-table-chip');
        b.type = 'button';
        b.setAttribute('data-table-change', '');
        b.setAttribute('aria-label', 'Votre table — changer de table');
        b.title = 'Changer de table';
        b.appendChild(icon('table_restaurant'));
        b.appendChild(document.createTextNode('Table '));
        numberEl.classList.add('sc-table-num');
        b.appendChild(numberEl);
        b.appendChild(icon('edit'));
        return b;
    }
    function enhanceHeaderTables() {
        // Mobile : ligne « Table 12 • Souad » sous le logo → pastille + prénom.
        document.querySelectorAll('header.md\\:hidden [data-table-number]').forEach(function (num) {
            var line = num.parentElement;
            if (!line || line.closest('.sc-table-line')) return;
            var name = line.querySelector('[data-guest-name]');
            var wrap = el('div', 'sc-table-line');
            wrap.appendChild(tableChip(num));
            if (name) { name.classList.add('sc-table-guest'); wrap.appendChild(name); }
            line.replaceWith(wrap);
        });
        // Ordinateur : « Table 12 » au-dessus du prénom → pastille.
        document.querySelectorAll('header.sticky:not(.md\\:hidden) [data-table-number]').forEach(function (num) {
            var line = num.parentElement;
            if (!line || line.closest('.sc-table-chip')) return;
            line.replaceWith(tableChip(num));
        });
        // Panier : le crayon à côté du numéro de table ouvre la même rubrique.
        var editBtn = document.getElementById('table-edit-btn');
        if (editBtn) editBtn.setAttribute('onclick', 'openTableChange()');
        if (window.renderIcons) window.renderIcons();
    }
    document.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-table-change]') : null;
        if (t) { e.preventDefault(); openTableChange(); }
    });
    document.addEventListener('DOMContentLoaded', enhanceHeaderTables);

    // Clic sur n'importe quelle icône client (y compris ajoutée dynamiquement).
    document.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-profile-toggle]') : null;
        if (t) { e.preventDefault(); openProfile(); }
    });

    document.addEventListener('DOMContentLoaded', function () {
        // Aucune icône client visible dans la page (ex. Suivi, ou en-tête mobile) : bouton flottant.
        var visible = Array.prototype.some.call(document.querySelectorAll('[data-profile-toggle]'), function (b) { return b.offsetParent !== null; });
        if (!visible) {
            var b = el('button', 'sc-fab-profile fixed top-3 right-16 z-50 w-10 h-10 rounded-full bg-surface-container-high border border-outline-variant text-lg text-primary flex items-center justify-center shadow-md');
            b.type = 'button';
            b.setAttribute('data-profile-toggle', '');
            b.setAttribute('aria-label', 'Mon profil');
            b.appendChild(icon('account_circle'));
            document.body.appendChild(b);
        }
        if (!Auth.client()) return;
        poll();
        pollTimer = setInterval(poll, POLL_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    });
})();
