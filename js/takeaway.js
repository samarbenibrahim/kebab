// SOUCOFFE - « À emporter » côté client.
//
// Panier : bandeau informatif dès qu'un café est en « Gobelet à emporter ».
// Suivi de commande : carte pour prévenir l'équipe (message facultatif), puis
// statut de la demande et réponse de l'équipe, rafraîchis automatiquement.
// API : POST /takeaway-requests · GET /takeaway-requests/mine ·
//       PATCH /takeaway-requests/{id}/cancel (voir api/controllers/TakeawayController.php).
(function () {
    var TAKEAWAY_LABEL = 'Gobelet à emporter';
    var POLL_MS = 6000;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name) { return window.iconHtml ? window.iconHtml(name) : ''; }
    function isTakeawayItem(item) { return String((item && item.name) || '').indexOf(TAKEAWAY_LABEL) !== -1; }
    function shortName(item) { return String(item.name || '').replace(/\s*\(.*\)\s*$/, ''); }
    function errText(e) { return e && e.status ? e.message : 'Serveur injoignable : réessayez dans un instant.'; }

    // ---------------------------------------------------------------- Panier
    function cartBanner() {
        var list = document.getElementById('cart-items');
        if (!list || !window.Cart) return;
        var items = Cart.get().filter(isTakeawayItem);
        var box = document.getElementById('takeaway-cart-banner');
        if (!items.length) { if (box) box.remove(); return; }
        if (!box) {
            box = document.createElement('div');
            box.id = 'takeaway-cart-banner';
            list.parentNode.insertBefore(box, list.nextSibling);
        }
        var count = items.reduce(function (s, i) { return s + (i.qty || 1); }, 0);
        var html = '<div class="sc-takeaway">' +
            '<span class="sc-takeaway-icon">' + ic('sc_takeaway_cup') + '</span>' +
            '<div class="sc-takeaway-body"><h3>' + count + ' café' + (count > 1 ? 's' : '') + ' à emporter</h3>' +
            '<p>Servi' + (count > 1 ? 's' : '') + ' en gobelet carton. Après la commande, vous pourrez prévenir l’équipe de votre départ depuis le suivi.</p></div></div>';
        if (box.__html !== html) { box.__html = html; box.innerHTML = html; }
    }

    // ---------------------------------------------------------------- Suivi
    var state = { requests: [], loaded: false, showForm: false, sending: false, error: '', message: '', lastSig: null };
    var pollTimer = null;

    function currentOrder() {
        var o = window.Orders && Orders.getLast();
        if (!o || typeof o.serverId !== 'number' || o.cancelledAt) return null;
        if (!(o.items || []).some(isTakeawayItem)) return null;
        return o;
    }
    function requestForOrder(order) {
        return state.requests.filter(function (r) { return r.orderId === order.serverId; })[0] || null; // plus récente d'abord
    }

    function statusHtml(r) {
        if (r.status === 'pending') {
            return '<div class="sc-takeaway-status is-pending">' + ic('schedule') + '<span><b>Demande envoyée à l’équipe</b>' +
                (r.message ? '« ' + esc(r.message) + ' » · ' : '') + 'Réponse en attente… <button type="button" class="underline" onclick="takeawayCancel(' + r.id + ')">Annuler</button></span></div>';
        }
        if (r.status === 'accepted') {
            return '<div class="sc-takeaway-status is-accepted">' + ic('check_circle') + '<span><b>L’équipe a accepté' + (r.responderName ? ' (' + esc(r.responderName) + ')' : '') + '</b>' +
                esc(r.adminMessage || 'C’est noté, votre commande vous attend.') + '</span></div>';
        }
        if (r.status === 'declined') {
            return '<div class="sc-takeaway-status is-declined">' + ic('cancel') + '<span><b>L’équipe ne peut pas pour le moment</b>' +
                esc(r.adminMessage || 'Rapprochez-vous du comptoir.') + '</span></div>';
        }
        return '';
    }

    function formHtml() {
        var chips = ['J’arrive dans 5 min', 'Je passe dans 10 min', 'Je patiente au comptoir'];
        return '<div class="sc-takeaway-form">' +
            '<div class="sc-takeaway-chips">' + chips.map(function (c) {
                return '<button type="button" class="' + (state.message === c ? 'is-active' : '') + '" onclick="takeawayChip(this)">' + esc(c) + '</button>';
            }).join('') + '</div>' +
            '<input id="takeaway-message" type="text" maxlength="255" value="' + esc(state.message) + '" oninput="takeawayTyping(this.value)" placeholder="Un mot pour l’équipe (facultatif)" aria-label="Message pour l’équipe"/>' +
            (state.error ? '<p class="sc-takeaway-err" role="alert">' + esc(state.error) + '</p>' : '') +
            '<button type="button" class="sc-takeaway-send" onclick="takeawaySend()"' + (state.sending ? ' disabled' : '') + '>' +
            ic('notifications') + (state.sending ? 'Envoi…' : 'Prévenir l’équipe') + '</button></div>';
    }

    function renderTrack() {
        var block = document.getElementById('takeaway-block');
        if (!block) return;
        var order = currentOrder();
        if (!order) { block.classList.add('hidden'); block.innerHTML = ''; block.__html = ''; return; }
        var req = requestForOrder(order);
        var names = (order.items || []).filter(isTakeawayItem).map(function (i) { return (i.qty > 1 ? i.qty + '× ' : '') + shortName(i); });
        var canSend = !req || req.status === 'cancelled' || req.status === 'declined';
        var html = '<div class="sc-takeaway">' +
            '<span class="sc-takeaway-icon">' + ic('sc_takeaway_cup') + '</span>' +
            '<div class="sc-takeaway-body"><h3>À emporter ? Prévenez l’équipe</h3>' +
            '<p>Votre commande contient des cafés en gobelet à emporter. Dites-nous quand vous partez : on les prépare pour vous.</p>' +
            '<div class="sc-takeaway-items">' + names.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') + '</div>' +
            (req ? statusHtml(req) : '') +
            (canSend && (!req || state.showForm || req.status === 'cancelled') ? formHtml()
                : (canSend ? '<div class="sc-takeaway-form"><button type="button" class="sc-takeaway-send" onclick="takeawayShowForm()">' + ic('notifications') + 'Envoyer une nouvelle demande</button></div>' : '')) +
            '</div></div>';
        block.classList.remove('hidden');
        if (block.__html === html) return;
        // Ne pas écraser une saisie en cours (le champ garde le focus).
        var typing = document.activeElement && document.activeElement.id === 'takeaway-message';
        if (typing && block.__html && block.__html.indexOf('takeaway-message') !== -1 && html.indexOf('takeaway-message') !== -1) return;
        block.__html = html;
        block.innerHTML = html;
    }

    function load() {
        if (!window.Auth || !Auth.client()) return Promise.resolve();
        return Auth.api('/takeaway-requests/mine').then(function (r) {
            var before = state.requests;
            state.requests = r.content || [];
            state.loaded = true;
            notifyChanges(before, state.requests);
            renderTrack();
        }).catch(function () { /* réseau coupé : bandeau de connexion, on garde l'affichage */ });
    }

    // Réponse de l'équipe : vibration + notification, comme un changement de statut.
    function notifyChanges(before, after) {
        if (state.lastSig === null) { state.lastSig = sig(after); return; }
        after.forEach(function (r) {
            var old = before.filter(function (b) { return b.id === r.id; })[0];
            if (old && old.status === 'pending' && r.status !== 'pending' && r.status !== 'cancelled') {
                if (window.showToast) window.showToast(r.status === 'accepted' ? 'À emporter : l’équipe a accepté' : 'À emporter : réponse de l’équipe');
                if (navigator.vibrate) { try { navigator.vibrate([160, 90, 160]); } catch (e) { /* non pris en charge */ } }
            }
        });
        state.lastSig = sig(after);
    }
    function sig(list) { return list.map(function (r) { return r.id + ':' + r.status; }).join(','); }

    window.takeawayChip = function (btn) {
        state.message = btn.textContent;
        state.error = '';
        var input = document.getElementById('takeaway-message');
        if (input) input.value = state.message;
        document.querySelectorAll('.sc-takeaway-chips button').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
    };
    window.takeawayTyping = function (v) { state.message = v; };
    window.takeawayShowForm = function () { state.showForm = true; renderTrack(); };

    window.takeawaySend = function () {
        var order = currentOrder();
        if (!order || state.sending) return;
        var input = document.getElementById('takeaway-message');
        var message = (input ? input.value : state.message).trim().slice(0, 255);
        state.sending = true;
        state.error = '';
        renderTrack();
        var body = { orderId: order.serverId };
        if (message) body.message = message;
        Auth.api('/takeaway-requests', Auth.json('POST', body)).then(function () {
            state.sending = false;
            state.showForm = false;
            state.message = '';
            if (window.showToast) window.showToast('Demande envoyée à l’équipe');
            return load();
        }).catch(function (e) {
            state.sending = false;
            state.error = errText(e);
            if (e && e.status === 409) load();
            renderTrack();
        });
    };

    window.takeawayCancel = function (id) {
        Auth.api('/takeaway-requests/' + id + '/cancel', Auth.json('PATCH')).then(load).catch(function (e) {
            state.error = errText(e);
            load();
        });
    };

    document.addEventListener('DOMContentLoaded', function () {
        // Panier
        var list = document.getElementById('cart-items');
        if (list) {
            cartBanner();
            if (window.MutationObserver) new MutationObserver(cartBanner).observe(list, { childList: true });
        }
        // Suivi
        if (document.getElementById('takeaway-block')) {
            renderTrack();
            load();
            pollTimer = setInterval(function () {
                if (document.hidden || !currentOrder()) { renderTrack(); return; }
                load();
            }, POLL_MS);
            // La commande suivie peut changer (synchronisation serveur) : on réaffiche.
            window.addEventListener('storage', renderTrack);
        }
    });
})();
