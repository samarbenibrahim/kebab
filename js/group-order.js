// SOUCOFFE - Commande de groupe à table (page 04-Panier, API /group, migration 024).
//
// Les clients identifiés à la même table partagent un panier commun : chacun y
// ajoute son panier depuis son téléphone, tout le monde voit qui a pris quoi
// (mis à jour toutes les 5 s), puis l'un d'eux envoie UNE seule commande en
// cuisine (système de commande existant, idempotent). Ensuite : statut de la
// commande de la table et partage de l'addition (chacun ses articles, ou parts égales).
// Les prix sont toujours calculés par le serveur.
(function () {
    var POLL_MS = 5000;
    var state = null, timer = null, busy = false, armed = false, collapsed = false;

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n, f) { return window.iconHtml ? window.iconHtml(n, '', f) : ''; }
    function euro(v) { return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function api(path, opts) {
        var base = window.SOUCOFFE_API_BASE;
        return fetch(base + path, opts).then(function (r) {
            return r.json().catch(function () { return null; }).then(function (b) {
                if (!r.ok) { var e = new Error((b && b.error) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
                return b;
            });
        });
    }
    function isClient() {
        try { return !!JSON.parse(localStorage.getItem('soucoffe_client_session') || 'null'); } catch (e) { return false; }
    }

    function mount() {
        var el = $('sc-group');
        if (el) return el;
        // En haut de la liste du panier : visible même quand le panier personnel est vide.
        var items = $('cart-items');
        var anchor = items && items.parentNode;
        if (!anchor || !anchor.parentNode) return null;
        el = document.createElement('section');
        el.id = 'sc-group';
        el.className = 'sc-group';
        el.setAttribute('aria-label', 'Commande de la table');
        anchor.parentNode.insertBefore(el, anchor);
        return el;
    }

    function myCartShareable() {
        return (window.Cart ? Cart.get() : []).filter(function (i) { return typeof i.productId === 'number' && i.productId > 0; });
    }

    var STATUS_ICON = { 'Nouvelle': 'receipt_long', 'En préparation': 'skillet', 'Prête': 'notifications_active', 'Servie': 'check_circle' };

    function render() {
        var el = mount();
        if (!el || !state) return;
        var mine = myCartShareable();
        var items = state.items || [];
        var byAuthor = {};
        var authors = [];
        items.forEach(function (i) {
            if (!byAuthor[i.author]) { byAuthor[i.author] = []; authors.push(i.author); }
            byAuthor[i.author].push(i);
        });
        var count = items.reduce(function (s, i) { return s + i.quantity; }, 0);
        var html = '<button type="button" class="sc-group-head" aria-expanded="' + !collapsed + '" onclick="scGroupToggle()">' +
            '<span class="sc-group-icon">' + ic('groups', true) + '</span>' +
            '<span class="sc-group-titles"><strong>Commande de la table ' + esc(state.table) + '</strong>' +
            '<small>' + (items.length ? authors.length + ' personne(s) · ' + count + ' article(s) · ' + euro(state.total) : 'Commandez à plusieurs, une seule commande part en cuisine') + '</small></span>' +
            '<span class="sc-group-chev">' + ic(collapsed ? 'expand_more' : 'expand_less') + '</span></button>';
        if (!collapsed) {
            html += '<div class="sc-group-body">';
            if (items.length) {
                html += authors.map(function (a) {
                    var sub = byAuthor[a].reduce(function (s, i) { return s + i.lineTotal; }, 0);
                    var isMe = byAuthor[a].some(function (i) { return i.mine; });
                    return '<div class="sc-group-person"><p class="sc-group-name"><span class="sc-group-avatar">' + esc(a.charAt(0)) + '</span>' + esc(a) +
                        (isMe ? ' <em>moi</em>' : '') + '<b>' + euro(sub) + '</b></p><ul>' +
                        byAuthor[a].map(function (i) {
                            return '<li><span>' + i.quantity + '× ' + esc(i.label) + '</span><span class="sc-group-line">' + euro(i.lineTotal) +
                                (i.mine ? '<button type="button" aria-label="Retirer" onclick="scGroupRemove(' + i.id + ')">' + ic('close') + '</button>' : '') + '</span></li>';
                        }).join('') + '</ul></div>';
                }).join('');
            } else {
                html += '<ol class="sc-group-how"><li>' + ic('shopping_cart') + ' Chacun remplit son panier</li><li>' + ic('group_add') + ' et l\'ajoute à la table</li><li>' + ic('send') + ' Une personne envoie tout en cuisine</li></ol>';
            }
            html += '<div class="sc-group-actions">';
            if (mine.length) {
                html += '<button type="button" class="sc-btn-ghost sc-group-share" onclick="scGroupShare()"' + (busy ? ' disabled' : '') + '>' + ic('group_add') +
                    ' Ajouter mon panier à la table (' + mine.reduce(function (s, i) { return s + (i.qty || 1); }, 0) + ')</button>';
            }
            if (items.length) {
                html += '<button type="button" class="sc-btn-main sc-group-send' + (armed ? ' is-armed' : '') + '" onclick="scGroupSend()"' + (busy ? ' disabled' : '') + '>' + ic('send') +
                    (armed ? ' Confirmer l\'envoi · ' + euro(state.total) : ' Envoyer la commande de la table') + '</button>';
            }
            html += '</div>';
            var ls = state.lastSent;
            if (ls) {
                html += '<div class="sc-group-sent"><p class="sc-group-status">' + ic(STATUS_ICON[ls.status] || 'receipt_long') +
                    '<span><strong>Commande de la table : ' + esc(ls.status) + '</strong><small>N° ' + ls.orderId + ' · total ' + euro(ls.total) + '</small></span></p>' +
                    '<p class="sc-group-split-title">' + ic('call_split') + ' Partager l\'addition</p><ul class="sc-group-split">' +
                    ls.split.map(function (s) { return '<li><span>' + esc(s.name) + '</span><b>' + euro(s.share) + '</b></li>'; }).join('') +
                    '<li class="is-equal"><span>Ou à parts égales (' + ls.people + ')</span><b>' + euro(ls.equalShare) + ' chacun</b></li></ul></div>';
            }
            html += '</div>';
        }
        if (el.__html !== html) { el.__html = html; el.innerHTML = html; if (window.renderIcons) window.renderIcons(); }
        el.hidden = false;
    }

    function load() {
        if (document.hidden) return;
        api('/group').then(function (g) { state = g; render(); }).catch(function (e) {
            var el = $('sc-group');
            if (el && (e.status === 401 || e.status === 403)) el.hidden = true;
        });
    }

    window.scGroupToggle = function () { collapsed = !collapsed; render(); };

    window.scGroupShare = function () {
        var mine = myCartShareable();
        if (!mine.length || busy) return;
        busy = true; render();
        var body = { items: mine.map(function (i) {
            return { productId: i.productId, quantity: Math.max(1, parseInt(i.qty, 10) || 1), options: (i.optionIds || []).map(function (id) { return { optionId: id }; }) };
        }) };
        api('/group/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (g) {
            // Les articles sont passés dans le panier de la table : retirés du panier personnel.
            mine.forEach(function (i) { Cart.remove(i.id); });
            state = g;
            if (window.showToast) window.showToast('Ajouté au panier de la table');
            if (window.cartRerender) window.cartRerender();
        }).catch(function (e) {
            if (window.showToast) window.showToast('Non ajouté : ' + e.message);
        }).then(function () { busy = false; render(); });
    };

    window.scGroupRemove = function (id) {
        api('/group/items/' + id, { method: 'DELETE' }).then(function (g) { state = g; render(); })
            .catch(function (e) { if (window.showToast) window.showToast(e.message); });
    };

    window.scGroupSend = function () {
        if (busy) return;
        if (!armed) { armed = true; render(); setTimeout(function () { armed = false; render(); }, 5000); return; }
        armed = false; busy = true; render();
        api('/group/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function (g) {
            state = g;
            if (window.showToast) window.showToast('Commande de la table envoyée en cuisine');
            // La commande appartient à l'expéditeur : elle apparaît dans son suivi.
            if (window.Orders && Orders.fetchServerOrders) {
                Orders.fetchServerOrders().then(function (list) { if (Orders.importServerOrders) Orders.importServerOrders(list); }).catch(function () { /* suivi mis à jour plus tard */ });
            }
        }).catch(function (e) {
            if (window.showToast) window.showToast('Non envoyée : ' + e.message);
        }).then(function () { busy = false; render(); });
    };

    function start() {
        if (!isClient() || !window.SOUCOFFE_API_BASE || !$('cart-items')) return;
        load();
        timer = setInterval(load, POLL_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
        // Le panier personnel change (ajout, suppression) : le bouton « Ajouter mon panier » suit.
        var prev = window.cartRerender;
        if (typeof prev === 'function') window.cartRerender = function () { prev.apply(this, arguments); render(); };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
})();
