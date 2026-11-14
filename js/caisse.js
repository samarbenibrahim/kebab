// SOUCOFFE - Caisse : encaissement par table (espèces avec calcul du rendu,
// carte), additions demandées, libération et nettoyage des tables.
// Le caissier n'a aucun droit sur la préparation ni sur les produits (API).
(function () {
    var POLL_MS = 5000;
    var PRIORITY = { bill: 0, preparing: 1, occupied: 2, cleaning: 3, free: 4 };
    var METHOD_LABEL = { cash: 'Espèces', card: 'Carte', online: 'En ligne' };

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name, cls) { return window.iconHtml ? window.iconHtml(name, cls) : ''; }
    function money(v) { return (parseFloat(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }

    window.staffLogout = function () { Auth.logoutStaff(); };

    var tables = [];

    function paintTables() {
        var sorted = tables.slice().sort(function (a, b) {
            return (PRIORITY[a.status] - PRIORITY[b.status]) || String(a.tableNumber).localeCompare(String(b.tableNumber), undefined, { numeric: true });
        });
        var html = Floor.legendHtml(tables);
        if ($('floor-legend').__html !== html) { $('floor-legend').__html = html; $('floor-legend').innerHTML = html; if (window.renderIcons) window.renderIcons(); }
        Floor.render($('tables-list'), sorted);
        var due = 0, bills = 0, cleaning = 0;
        tables.forEach(function (t) {
            due += t.unpaidTotal || 0;
            if (t.status === 'bill') bills++;
            if (t.status === 'cleaning' || ((t.status === 'occupied') && t.unpaidOrders === 0 && t.activeOrders === 0)) cleaning++;
        });
        $('kpi-due').textContent = money(due);
        $('kpi-bills').textContent = bills;
        $('kpi-cleaning').textContent = cleaning;
    }

    function paintPaid(orders) {
        var today = new Date().toISOString().slice(0, 10);
        var todayTotal = 0;
        var paid = orders.filter(function (o) { return o.payment_status === 'paid' && !o.cancelled_at; });
        paid.forEach(function (o) { if (String(o.paid_at || '').slice(0, 10) === today || String(o.created_at || '').slice(0, 10) === today) todayTotal += parseFloat(o.total) || 0; });
        $('kpi-today').textContent = money(todayTotal);
        paid.sort(function (a, b) { return String(b.paid_at || '').localeCompare(String(a.paid_at || '')); });
        var html = paid.slice(0, 12).map(function (o) {
            return '<div class="flex items-center justify-between gap-3 px-4 py-2.5"><span>' + esc('SOU-' + String(o.id).padStart(6, '0')) + ' · Table ' + esc(o.table_number) + ' · ' + esc(o.guest_name) + '</span>' +
                '<span class="flex items-center gap-2 text-on-surface-variant">' + ic(o.payment_method === 'card' ? 'credit_card' : 'payments') + esc(METHOD_LABEL[o.payment_method] || '') + ' <b class="text-on-surface">' + esc(money(o.total)) + '</b></span></div>';
        }).join('') || '<p class="px-4 py-3 text-on-surface-variant">Aucun encaissement pour l’instant.</p>';
        if ($('paid-list').__html !== html) { $('paid-list').__html = html; $('paid-list').innerHTML = html; if (window.renderIcons) window.renderIcons(); }
    }

    function sync() {
        Promise.all([Auth.api('/tables'), Auth.api('/orders?limit=100')]).then(function (r) {
            tables = r[0].content || [];
            paintTables();
            paintPaid(r[1].content || []);
        }).catch(function (e) {
            if (!tables.length) $('tables-list').innerHTML = '<p class="text-error">Impossible de charger : ' + esc(errText(e)) + '</p>';
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var s = Auth.staff();
        document.querySelectorAll('[data-user-name]').forEach(function (n) { n.textContent = s ? s.user.displayName : ''; });
        document.querySelectorAll('[data-user-role]').forEach(function (n) { n.textContent = s ? (s.user.roleLabel || s.user.role) : ''; });
        if (s && (s.user.role === 'admin' || s.user.role === 'manager')) { var b = $('back-admin'); if (b) { b.classList.remove('hidden'); b.classList.add('inline-flex'); } }
        Floor.onChange(sync);
        sync();
        setInterval(sync, POLL_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    });
})();
