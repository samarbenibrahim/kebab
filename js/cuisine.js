// SOUCOFFE - Cuisine : file de préparation (à lancer / en préparation / prêtes)
// avec chronomètre, et déclaration des ruptures de stock.
// La cuisine prépare (orders.prepare) et gère la disponibilité des produits
// (products.availability) ; elle ne peut ni servir, ni encaisser, ni modifier un prix.
(function () {
    var POLL_MS = 4000;
    var orders = [];
    var knownIds = null;
    var avgPrep = 8;
    var products = [];

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
    function setHtml(el, html) { if (el.__html === html) return; el.__html = html; el.innerHTML = html; if (window.renderIcons) window.renderIcons(); }

    window.staffLogout = function () { Auth.logoutStaff(); };

    function minutesSince(iso) {
        var t = Date.parse(String(iso || '').replace(' ', 'T'));
        return isNaN(t) ? 0 : Math.max(0, Math.round((Date.now() - t) / 60000));
    }

    // Durée lisible même pour une commande oubliée : 12 min, 3 h 05, 7 j 4 h
    // (même règle que Floor.since dans js/floor.js, non chargé ici).
    function durationLabel(m) {
        if (m < 60) return m + ' min';
        var h = Math.floor(m / 60);
        if (h < 48) return h + ' h ' + String(m % 60).padStart(2, '0');
        return Math.floor(h / 24) + ' j ' + (h % 24) + ' h';
    }

    function itemHtml(it) {
        var opts = (it.options || []).map(function (o) { return o.option_name; }).join(', ');
        // Café en gobelet : badge bien visible (à ne pas servir en tasse).
        var takeaway = (it.options || []).some(function (o) { return o.option_name === 'Gobelet à emporter'; });
        return '<li><b>' + esc(it.quantity) + '×</b> ' + esc(it.product_name) +
            (takeaway ? ' <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-secondary-container text-on-surface align-middle">' + ic('sc_takeaway_cup') + ' À emporter</span>' : '') +
            (opts ? '<span class="text-on-surface-variant"> (' + esc(opts) + ')</span>' : '') +
            (it.note ? '<br><span class="text-xs text-tertiary">' + ic('chat_bubble') + ' ' + esc(it.note) + '</span>' : '') + '</li>';
    }

    function card(o) {
        var mins = minutesSince(o.created_at);
        var late = mins > avgPrep * 1.5;
        var action = '';
        if (o.status === 'Nouvelle' && Auth.can('orders.prepare')) action = '<button onclick="cookStatus(' + o.id + ', \'En préparation\')" class="w-full bg-primary-container text-on-primary font-label-md text-xs py-2.5 rounded-lg hover:bg-primary transition-colors">Commencer la préparation</button>';
        if (o.status === 'En préparation' && Auth.can('orders.prepare')) action = '<button onclick="cookStatus(' + o.id + ', \'Prête\')" class="w-full bg-primary-container text-on-primary font-label-md text-xs py-2.5 rounded-lg hover:bg-primary transition-colors">' + ic('check') + ' Marquer prête</button>';
        return '<div class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] space-y-2' + (late && o.status !== 'Prête' ? ' ring-2 ring-error' : '') + '">' +
            '<div class="flex items-start justify-between gap-2"><div><div class="font-title-lg text-title-lg text-primary">Table ' + esc(o.table_number) + '</div>' +
            '<div class="text-xs text-on-surface-variant">SOU-' + esc(String(o.id).padStart(6, '0')) + ' · ' + esc(o.guest_name) + '</div></div>' +
            '<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ' + (late && o.status !== 'Prête' ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface-variant') + '">' + ic('timer') + durationLabel(mins) + '</span></div>' +
            '<ul class="text-sm text-on-surface space-y-1">' + (o.items || []).map(itemHtml).join('') + '</ul>' +
            (o.note ? '<div class="text-xs bg-surface-container rounded px-2 py-1 text-tertiary">' + ic('chat_bubble') + ' ' + esc(o.note) + '</div>' : '') +
            action + '<p data-err="' + o.id + '" role="alert" class="hidden text-error text-xs"></p></div>';
    }

    function render() {
        var active = orders.filter(function (o) { return !o.cancelled_at; });
        var by = function (st) { return active.filter(function (o) { return o.status === st; }).sort(function (a, b) { return a.id - b.id; }); };
        var n = by('Nouvelle'), p = by('En préparation'), r = by('Prête');
        $('kpi-new').textContent = n.length; $('kpi-prep').textContent = p.length; $('kpi-ready').textContent = r.length;
        var empty = function (t) { return '<p class="text-on-surface-variant text-sm">' + t + '</p>'; };
        setHtml($('col-new'), n.map(card).join('') || empty('Rien à lancer.'));
        setHtml($('col-prep'), p.map(card).join('') || empty('Rien en préparation.'));
        setHtml($('col-ready'), r.map(card).join('') || empty('Aucune commande prête.'));
    }

    window.cookStatus = function (id, status) {
        Auth.api('/orders/' + id + '/status', Auth.json('PATCH', { status: status })).then(sync).catch(function (e) {
            var el = document.querySelector('[data-err="' + id + '"]');
            if (el) { el.textContent = errText(e); el.classList.remove('hidden'); }
        });
    };

    // ---- Ruptures de stock ----
    window.renderStock = function () {
        var q = ($('stock-search').value || '').toLowerCase();
        var canToggle = Auth.can('products.availability');
        var html = products.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1; }).map(function (p) {
            return '<label class="flex items-center justify-between gap-3 bg-surface-container-lowest rounded-lg px-3 py-2 text-sm ' + (p.available ? '' : 'ring-1 ring-error') + '">' +
                '<span class="truncate">' + esc(p.name) + (p.available ? '' : ' <span class="text-error text-xs">— rupture</span>') + '</span>' +
                '<input type="checkbox" ' + (p.available ? 'checked ' : '') + (canToggle ? '' : 'disabled ') + 'onchange="toggleStock(' + p.id + ', this.checked)" class="accent-primary w-5 h-5 shrink-0" aria-label="Disponible : ' + esc(p.name) + '"/></label>';
        }).join('');
        setHtml($('stock-list'), html || '<p class="sc-admin-empty text-on-surface-variant">Aucun produit.</p>');
    };
    window.toggleStock = function (id, available) {
        Auth.api('/products/' + id, Auth.json('PATCH', { available: available })).then(function () {
            toast(available ? 'Produit de nouveau disponible' : 'Produit déclaré en rupture');
            loadProducts();
        }).catch(function (e) { toast('Impossible : ' + errText(e)); loadProducts(); });
    };
    function loadProducts() {
        Auth.api('/products?limit=100').then(function (r) { products = r.content || []; window.renderStock(); }).catch(function () { /* réessai au prochain tour */ });
    }

    function sync() {
        Promise.all([Auth.api('/orders?limit=100'), Auth.api('/waiting-time?items=1')]).then(function (r) {
            orders = r[0].content || [];
            avgPrep = r[1].avgPrepMinutes || 8;
            $('kpi-avg').textContent = avgPrep + ' min';
            $('kpi-avg-sub').textContent = r[1].basis + ' (' + r[1].samples + ' commandes)';
            var firstPass = knownIds === null;
            if (firstPass) knownIds = {};
            orders.forEach(function (o) {
                if (!knownIds[o.id] && !firstPass && o.status === 'Nouvelle') toast('Nouvelle commande — table ' + o.table_number);
                knownIds[o.id] = true;
            });
            render();
        }).catch(function () { /* API injoignable : affichage conservé */ });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var s = Auth.staff();
        document.querySelectorAll('[data-user-name]').forEach(function (n) { n.textContent = s ? s.user.displayName : ''; });
        document.querySelectorAll('[data-user-role]').forEach(function (n) { n.textContent = s ? (s.user.roleLabel || s.user.role) : ''; });
        if (s && (s.user.role === 'admin' || s.user.role === 'manager')) { var b = $('back-admin'); if (b) { b.classList.remove('hidden'); b.classList.add('inline-flex'); } }
        sync();
        loadProducts();
        setInterval(sync, POLL_MS);
        setInterval(loadProducts, 20000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
    });
})();
