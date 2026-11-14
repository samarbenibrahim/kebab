// SOUCOFFE Intelligent — assistant de l'écran Cuisine (additif).
// Ajoute un bandeau « ordre suggéré » sous les compteurs. Ne touche ni aux
// cartes existantes ni aux boutons : l'équipe garde la main sur chaque commande.
// Module désactivé ou injoignable : le bandeau disparaît, la cuisine fonctionne comme avant.
(function () {
    var POLL_MS = 8000;
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n) { return window.iconHtml ? window.iconHtml(n) : ''; }
    function dur(m) {
        if (m < 60) return m + ' min';
        var h = Math.floor(m / 60);
        if (h < 48) return h + ' h ' + String(m % 60).padStart(2, '0');
        return Math.floor(h / 24) + ' j ' + (h % 24) + ' h';
    }
    function host() {
        var el = $('ai-kitchen');
        if (el) return el;
        var kpi = $('kpi-new');
        var grid = kpi && kpi.closest('.grid');
        if (!grid) return null;
        el = document.createElement('section');
        el.id = 'ai-kitchen';
        el.className = 'sc-ai-kitchen';
        el.hidden = true;
        el.setAttribute('aria-live', 'polite');
        grid.insertAdjacentElement('afterend', el);
        return el;
    }
    function paint(k) {
        var el = host();
        if (!el) return;
        var byId = {};
        k.orders.forEach(function (o) { byId[o.orderId] = o; });
        var next = k.suggestedOrder.map(function (id) { return byId[id]; }).filter(Boolean);
        var prep = k.orders.filter(function (o) { return o.status === 'En préparation'; });
        var html = '<div class="sc-ai-k-head"><b>' + ic('auto_awesome') + ' Assistant cuisine</b>' +
            '<span class="sc-ai-k-load load-' + esc(k.load) + '">Charge ' + esc(k.load) + '</span>' +
            '<span>≈ ' + k.estimatedClearMinutes + ' min pour tout préparer · ' + k.parallel + ' poste(s)</span>' +
            (k.lateCount ? '<span class="sc-ai-k-late">' + k.lateCount + ' en retard</span>' : '') +
            '<small>Préparation moyenne ' + k.avgPrepMinutes + ' min · ' + esc(k.basis) + '</small></div>';
        if (next.length) {
            html += '<p class="sc-ai-k-title">Ordre suggéré pour lancer — vous gardez la main</p><ol class="sc-ai-k-list">' + next.slice(0, 6).map(function (o) {
                return '<li class="' + (o.late ? 'is-late' : '') + '"><span class="sc-ai-k-rank">' + o.suggestedRank + '</span>' +
                    '<div><b>Table ' + esc(o.table) + '</b> · ' + esc(o.number) + '<br><small>attente ' + dur(o.waitMinutes) + ' · préparation estimée ' + Math.round(o.estimatedPrepMinutes) + ' min · ' + o.items + ' article(s)</small>' +
                    (o.reasons.length ? '<span class="sc-ai-k-tags">' + o.reasons.map(function (r) { return '<i>' + esc(r) + '</i>'; }).join('') + '</span>' : '') + '</div></li>';
            }).join('') + '</ol>';
        } else {
            html += '<p class="sc-ai-k-title">Aucune commande à lancer.</p>';
        }
        if (prep.length) {
            html += '<p class="sc-ai-k-sub">En préparation : ' + prep.map(function (o) {
                return 'Table ' + esc(o.table) + ' — encore ≈ ' + Math.round(o.remainingMinutes) + ' min' + (o.late ? ' (en retard)' : '');
            }).join(' · ') + '</p>';
        }
        el.innerHTML = html;
        el.hidden = false;
        if (window.renderIcons) window.renderIcons();
    }
    function sync() {
        if (!window.Auth || !Auth.staff || !Auth.staff()) return;
        Auth.api('/ai/kitchen').then(paint).catch(function () {
            var el = $('ai-kitchen');
            if (el) el.hidden = true; // module désactivé / injoignable : l'écran reste celui d'avant
        });
    }
    document.addEventListener('DOMContentLoaded', function () {
        sync();
        setInterval(function () { if (!document.hidden) sync(); }, POLL_MS);
    });
})();
