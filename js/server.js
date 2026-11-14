// SOUCOFFE - Espace serveur.
//
// Chaque serveur a sa propre session (connexion par compte). À la première
// connexion il DOIT déclarer les tables qu'il sert : l'API ne lui renvoie
// ensuite que les commandes et les appels de ces tables (cloisonnement côté
// serveur, pas seulement à l'affichage). Il fait avancer le statut des
// commandes, encaisse en espèces et acquitte les appels.
(function () {
    var POLL_MS = 5000;
    // Chaque étape a sa permission : la cuisine prépare (orders.prepare), le serveur sert (orders.serve).
    var NEXT = {
        'Nouvelle': { status: 'En préparation', label: 'Commencer la préparation', perm: 'orders.prepare' },
        'En préparation': { status: 'Prête', label: 'Marquer prête', perm: 'orders.prepare' },
        'Prête': { status: 'Servie', label: 'Marquer servie', perm: 'orders.serve' }
    };
    var STATUS_CLS = {
        'Nouvelle': 'bg-error-container text-on-error-container',
        'En préparation': 'bg-tertiary-container text-on-tertiary-container',
        'Prête': 'bg-secondary-container text-on-secondary-container',
        'Servie': 'bg-surface-container text-on-surface-variant'
    };

    var myTables = [];
    var editing = false;
    var orders = [];
    var calls = [];
    var knownOrderIds = null;
    var knownCallIds = null;
    var timer = null;
    var floorTables = [];

    function paintFloor() {
        var html = Floor.legendHtml(floorTables);
        if ($('floor-legend').__html !== html) { $('floor-legend').__html = html; $('floor-legend').innerHTML = html; }
        Floor.render($('tables-list'), floorTables);
    }

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name, cls) { return window.iconHtml ? window.iconHtml(name, cls) : ''; }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }

    function toast(msg) {
        var host = $('toast-host');
        var t = document.createElement('div');
        t.className = 'bg-inverse-surface text-inverse-on-surface font-label-md text-sm px-4 py-2 rounded-lg shadow-lg';
        t.textContent = msg;
        host.appendChild(t);
        setTimeout(function () { t.remove(); }, 3500);
    }

    function parseDate(s) {
        var t = Date.parse(String(s).replace(' ', 'T'));
        return isNaN(t) ? null : t;
    }
    function timeAgo(ts) {
        if (ts === null) return '';
        var m = Math.max(0, Math.round((Date.now() - ts) / 60000));
        if (m < 1) return 'à l\'instant';
        if (m < 60) return 'il y a ' + m + ' min';
        var h = Math.floor(m / 60);
        return 'il y a ' + h + ' h' + (m % 60 ? ' ' + (m % 60) : '');
    }
    function orderLabel(o) { return 'SOU-' + String(o.id).padStart(6, '0'); }
    function money(v) { return (parseFloat(v) || 0).toFixed(2).replace('.', ',') + ' €'; }

    window.serverLogout = function () { Auth.logoutStaff(); };

    // ---- Tables servies ----
    function showGate(prefill) {
        $('board').classList.add('hidden');
        $('tables-gate').classList.remove('hidden');
        $('tables-input').value = prefill || '';
        $('tables-cancel').classList.toggle('hidden', myTables.length === 0);
        $('tables-error').classList.add('hidden');
        $('tables-input').focus();
    }
    function showBoard() {
        $('tables-gate').classList.add('hidden');
        $('board').classList.remove('hidden');
        $('my-tables').innerHTML = myTables.map(function (t) {
            return '<span class="inline-block px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-xs">Table ' + esc(t) + '</span>';
        }).join('');
        sync();
    }
    window.editTables = function () { editing = true; showGate(myTables.join(', ')); };
    window.cancelTablesEdit = function () { editing = false; showBoard(); };

    function saveTables(e) {
        e.preventDefault();
        var seen = {}, list = [];
        $('tables-input').value.split(/[,;\s]+/).forEach(function (t) { t = t.trim(); if (t && !seen[t]) { seen[t] = true; list.push(t); } });
        var err = $('tables-error');
        if (!list.length) { err.textContent = 'Indiquez au moins une table que vous servez.'; err.classList.remove('hidden'); return; }
        err.classList.add('hidden');
        var btn = $('tables-save');
        btn.disabled = true;
        Auth.api('/staff/me/tables', Auth.json('PUT', { tables: list })).then(function (r) {
            myTables = r.tables;
            editing = false;
            knownOrderIds = null; knownCallIds = null;
            toast('Tables enregistrées');
            showBoard();
        }).catch(function (e2) {
            err.textContent = errText(e2);
            err.classList.remove('hidden');
        }).then(function () { btn.disabled = false; });
    }

    // ---- Appels ----
    // Réécrit le DOM seulement si le HTML a changé (le rafraîchissement toutes les 5 s ne doit ni clignoter ni faire perdre le focus).
    function setHtml(el, html) {
        if (el.__html === html) return false;
        el.__html = html;
        el.innerHTML = html;
        return true;
    }

    function renderCalls() {
        var section = $('calls-section');
        section.classList.toggle('hidden', calls.length === 0);
        setHtml($('calls-list'), calls.map(function (c) {
            return '<div class="flex items-center justify-between gap-3 bg-error-container rounded-xl px-4 py-3">' +
                '<div class="min-w-0"><div class="font-title-lg text-title-lg text-on-error-container">Table ' + esc(c.table_number) + '</div>' +
                '<div class="text-xs text-on-error-container truncate">' + esc(c.guest_name || 'Client') + ' · ' + esc(timeAgo(parseDate(c.created_at))) + '</div></div>' +
                '<button onclick="ackCall(' + c.id + ')" class="shrink-0 bg-primary text-on-primary font-label-md text-xs px-3 py-2 rounded-lg hover:opacity-90">' + ic('check') + ' Vu</button></div>';
        }).join(''));
    }
    window.ackCall = function (id) {
        Auth.api('/waiter-calls/' + id + '/acknowledge', Auth.json('PATCH')).then(sync)
            .catch(function (e) { toast('Impossible : ' + errText(e)); sync(); });
    };

    // ---- Commandes ----
    function itemHtml(it) {
        var opts = (it.options || []).map(function (o) { return o.option_name; }).join(', ');
        return '<li class="flex justify-between gap-2"><span><b>' + esc(it.quantity) + '×</b> ' + esc(it.product_name) +
            (opts ? '<span class="text-on-surface-variant"> (' + esc(opts) + ')</span>' : '') +
            (it.note ? '<br><span class="text-xs text-tertiary">' + ic('chat_bubble') + ' ' + esc(it.note) + '</span>' : '') + '</span></li>';
    }

    function orderCard(o) {
        var cancelled = !!o.cancelled_at;
        var paid = o.payment_status === 'paid';
        var next = !cancelled ? NEXT[o.status] : null;
        if (next && !Auth.can(next.perm)) next = null;
        var chips = '<span class="inline-flex items-center gap-1 whitespace-nowrap text-xs px-2 py-0.5 rounded-full ' + (cancelled ? 'bg-error-container text-on-error-container' : STATUS_CLS[o.status]) + '">' + esc(cancelled ? 'Annulée' : o.status) + '</span>';
        if (paid) chips += ' <span class="inline-flex items-center gap-1 whitespace-nowrap text-xs px-2 py-0.5 rounded-full bg-surface-container text-tertiary">' + ic('check_circle') + ' Payée' + (o.payment_method === 'cash' ? ' (espèces)' : ' (en ligne)') + '</span>';

        var actions = '';
        if (next) actions += '<button onclick="advanceOrder(' + o.id + ', \'' + next.status + '\')" class="flex-1 bg-primary-container text-on-primary font-label-md text-xs py-2.5 rounded-lg hover:bg-primary transition-colors">' + esc(next.label) + '</button>';
        if (!cancelled && !paid && Auth.can('payments.collect')) actions += '<button onclick="cashOrder(' + o.id + ')" class="flex-1 border-[1.5px] border-outline-variant text-on-surface font-label-md text-xs py-2.5 rounded-lg hover:bg-surface-container inline-flex items-center justify-center gap-1">' + ic('payments') + ' Encaisser (espèces)</button>';

        return '<div class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] space-y-3' + (cancelled ? ' opacity-70' : '') + '">' +
            '<div class="flex items-start justify-between gap-2"><div>' +
            '<div class="font-title-lg text-title-lg text-primary">Table ' + esc(o.table_number) + '</div>' +
            '<div class="text-xs text-on-surface-variant">' + esc(orderLabel(o)) + ' · ' + esc(o.guest_name) + ' · ' + esc(o.party_size) + ' pers. · ' + esc(timeAgo(parseDate(o.created_at))) + '</div></div>' +
            '<div class="flex flex-col items-end gap-1">' + chips + '</div></div>' +
            '<ul class="text-sm text-on-surface space-y-1">' + (o.items || []).map(itemHtml).join('') + '</ul>' +
            (o.note ? '<div class="text-xs bg-surface-container rounded px-2 py-1 text-tertiary">' + ic('chat_bubble') + ' Note de commande : ' + esc(o.note) + '</div>' : '') +
            '<div class="flex items-center justify-between"><span class="font-label-md text-sm text-on-surface-variant">Total</span><span class="font-title-lg text-title-lg text-primary">' + esc(money(o.total)) + '</span></div>' +
            (actions ? '<div class="flex gap-2">' + actions + '</div>' : '') +
            '<p data-err="' + o.id + '" role="alert" class="hidden text-error text-xs"></p></div>';
    }

    function renderOrders() {
        var showServed = $('show-served').checked;
        var list = orders.filter(function (o) { return showServed || (o.status !== 'Servie' && !o.cancelled_at); });
        $('orders-empty').classList.toggle('hidden', list.length > 0);
        setHtml($('orders-list'), list.map(orderCard).join(''));
    }

    function orderError(id, e) {
        var el = document.querySelector('[data-err="' + id + '"]');
        if (el) { el.textContent = errText(e); el.classList.remove('hidden'); }
    }
    window.advanceOrder = function (id, status) {
        Auth.api('/orders/' + id + '/status', Auth.json('PATCH', { status: status })).then(sync)
            .catch(function (e) { orderError(id, e); });
    };
    window.cashOrder = function (id) {
        Auth.api('/orders/' + id + '/payment', Auth.json('PATCH', { method: 'cash' })).then(function () { toast('Encaissement enregistré'); sync(); })
            .catch(function (e) { orderError(id, e); });
    };

    // ---- Synchronisation ----
    function sync() {
        if (!myTables.length || editing) return;
        Promise.all([Auth.api('/orders?limit=100'), Auth.api('/waiter-calls?status=pending'), Auth.api('/tables')]).then(function (res) {
            orders = res[0].content || [];
            calls = res[1].content || [];
            floorTables = res[2].content || [];
            paintFloor();
            var firstPass = knownOrderIds === null;
            if (firstPass) { knownOrderIds = {}; knownCallIds = {}; }
            var newOrders = orders.filter(function (o) { return !knownOrderIds[o.id]; });
            var newCalls = calls.filter(function (c) { return !knownCallIds[c.id]; });
            orders.forEach(function (o) { knownOrderIds[o.id] = true; });
            calls.forEach(function (c) { knownCallIds[c.id] = true; });
            if (!firstPass) {
                newOrders.forEach(function (o) { toast('Nouvelle commande — table ' + o.table_number); });
                newCalls.forEach(function (c) { toast('Appel — table ' + c.table_number); });
            }
            renderCalls();
            renderOrders();
            if (window.renderIcons) window.renderIcons();
        }).catch(function () { /* API injoignable : affichage conservé, nouvelle tentative au prochain tour */ });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var s = Auth.staff();
        document.querySelectorAll('[data-server-name]').forEach(function (n) { n.textContent = s ? s.user.displayName : ''; });
        $('tables-form').addEventListener('submit', saveTables);
        Floor.onChange(sync);
        $('show-served').addEventListener('change', renderOrders);
        Auth.api('/staff/me/tables').then(function (r) {
            myTables = r.tables || [];
            if (myTables.length) showBoard(); else showGate('');
        }).catch(function (e) {
            $('tables-gate').classList.remove('hidden');
            var err = $('tables-error');
            err.textContent = 'Impossible de charger vos tables : ' + errText(e);
            err.classList.remove('hidden');
        });
        timer = setInterval(sync, POLL_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    });
})();
