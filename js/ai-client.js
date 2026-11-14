// SOUCOFFE Intelligent — côté client (accueil), ADDITIF.
// 1. « Suggérez-moi » : l'analyse du serveur (/ai/suggest) est utilisée en
//    priorité ; si le module est désactivé, lent (> 3 s) ou injoignable,
//    l'assistant d'origine (règles dans le navigateur) répond comme avant.
//    Rien n'est jamais ajouté au panier automatiquement : le client choisit.
// 2. « Selon vos habitudes » : affiché seulement quand le client a un vrai
//    historique (niveau 2 ou 3) ; sinon les suggestions existantes suffisent.
(function () {
    var TIMEOUT_MS = 3000;
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n) { return window.iconHtml ? window.iconHtml(n) : ''; }
    function withTimeout(p) {
        return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, TIMEOUT_MS); })]);
    }
    function local(slug) { return window.getProductById ? window.getProductById(slug) : null; }
    function cardFor(item) {
        var p = local(item.slug);
        if (!p || !window.renderProductCard) return '';
        return '<div class="w-40 shrink-0 sc-ai-sug">' + window.renderProductCard(p) +
            (item.reason ? '<p class="sc-ai-why">' + esc(item.reason) + '</p>' : '') + '</div>';
    }

    function renderServer(r, resultsEl, reasonEl, productsEl) {
        var cards = (r.products || []).map(cardFor).filter(Boolean);
        var combos = (r.combos || []).map(function (c) {
            var parts = c.items.map(function (it) { return local(it.slug) ? esc(it.name) : null; });
            if (parts.indexOf(null) !== -1) return '';
            return '<li><span>' + parts.join(' + ') + '</span><b>' + Number(c.total).toFixed(2).replace('.', ',') + ' €</b>' +
                c.items.map(function (it) { return '<button type="button" class="sc-ai-open" data-open="' + esc(it.slug) + '">Voir ' + esc(it.name) + '</button>'; }).join('') + '</li>';
        }).filter(Boolean);
        if (!cards.length && !combos.length) return false;
        reasonEl.innerHTML =
            (r.understood && r.understood.length ? '<span class="sc-ai-understood">' + r.understood.map(function (u) { return '<i>' + esc(u) + '</i>'; }).join('') + '</span>' : '') +
            (r.notes || []).map(function (n) { return '<span class="sc-ai-note-c">' + esc(n) + '</span>'; }).join('') +
            (r.personalized ? '<span class="sc-ai-note-c">' + ic('auto_awesome') + ' Tient compte de vos commandes précédentes.</span>' : '');
        productsEl.innerHTML =
            (combos.length ? '<p class="sc-ai-combo-title">Associations proposées</p><ul class="sc-ai-combos">' + combos.join('') + '</ul>' : '') +
            (cards.length ? '<div class="flex gap-4 overflow-x-auto hide-scrollbar pb-2">' + cards.join('') + '</div>' : '') +
            '<p class="sc-ai-control">Rien n’est ajouté automatiquement : touchez « + » ou ouvrez un produit pour le choisir.</p>';
        productsEl.querySelectorAll('[data-open]').forEach(function (b) {
            b.addEventListener('click', function () {
                var slug = b.getAttribute('data-open');
                if (window.openProductModal && document.getElementById('product-modal')) window.openProductModal(slug);
                else location.href = '../02-Menu-Principal/code.html?open=' + encodeURIComponent(slug);
            });
        });
        resultsEl.classList.remove('hidden');
        if (window.renderIcons) window.renderIcons();
        return true;
    }

    function wrapAssistant() {
        var original = window.runAssistant;
        if (typeof original !== 'function' || original.__ai) return;
        var wrapped = function (value, event) {
            if (event && event.key && event.key !== 'Enter') return;
            var q = (value || '').trim();
            var resultsEl = $('assistant-results'), reasonEl = $('assistant-reason'), productsEl = $('assistant-products');
            if (!q || !resultsEl || !window.Auth || !Auth.api) { return original(value); }
            reasonEl.textContent = 'Je cherche…';
            productsEl.innerHTML = '';
            resultsEl.classList.remove('hidden');
            Promise.resolve(window.loadCatalog ? window.loadCatalog() : null).then(function () {
                return withTimeout(Auth.api('/ai/suggest', Auth.json('POST', { query: q })));
            }).then(function (r) {
                if (!renderServer(r, resultsEl, reasonEl, productsEl)) original(value);
            }).catch(function () { original(value); }); // repli : assistant d'origine
        };
        wrapped.__ai = true;
        window.runAssistant = wrapped;
    }

    function habitsRail() {
        var anchor = $('time-suggestions');
        if (!anchor || !window.Auth || !Auth.api || !(Auth.client && Auth.client())) return;
        Promise.resolve(window.loadCatalog ? window.loadCatalog() : null).then(function () {
            return withTimeout(Auth.api('/ai/recommendations?limit=4'));
        }).then(function (r) {
            if (!r || r.level < 2) return; // pas d'historique réel : on n'affiche rien de plus
            var cards = (r.items || []).map(cardFor).filter(Boolean);
            if (!cards.length) return;
            var box = $('ai-habits') || document.createElement('div');
            box.id = 'ai-habits';
            box.className = 'sc-panel sc-ai-habits';
            box.style.gridColumn = '1 / -1';
            box.innerHTML = '<p class="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-3">' + ic('auto_awesome') + ' ' + esc(r.basis) + '</p>' +
                '<div class="flex gap-3 overflow-x-auto hide-scrollbar pb-1">' + cards.join('') + '</div>';
            if (!box.parentNode) anchor.parentNode.appendChild(box);
            if (window.renderIcons) window.renderIcons();
        }).catch(function () { /* module indisponible : rien ne change */ });
    }

    document.addEventListener('DOMContentLoaded', function () {
        wrapAssistant();
        habitsRail();
    });
})();
