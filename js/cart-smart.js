// SOUCOFFE - Panier intelligent (page 04-Panier).
//
// Panneau « Pour vous » au-dessus du résumé ; chaque bloc n'apparaît que s'il
// est utile :
//   0. Passez en menu : un sandwich / une piadina / une assiette qui existe en formule →
//      la formule reprend ses choix et remplace la ligne (?upgrade=, js/products.js) ;
//   1. Compléter : une boisson sans rien à manger → une viennoiserie en 1 geste,
//      à manger sans boisson → un café (ouvre sa fiche), ou une boisson fraîche pour le Kebab ;
//   2. Promotion à portée : « Plus que X DT pour profiter de … » (promotions
//      actives de type commande dont le minimum n'est pas encore atteint) ;
//   3. Service des cafés : « Tout sur place » / « Tout à emporter » d'un geste ;
//   4. Addition partagée : montant par personne ;
//   5. Repères nutritionnels : calories estimées et allergènes du panier.
// Appelé par render() du panier : window.renderCartSmart(items).
(function () {
    var DRINK_CATS = ['Cafés', 'Sodas', 'Mojitos', 'Jus', 'Smoothies', 'Menus kebab'];
    var FOOD_CATS = ['Croissants', 'Sandwichs', 'Desserts', 'Petit-déjeuner', 'Offres',
        'Paninis et piadines', 'Assiettes kebab', 'Menus kebab', 'Alternatives', 'Accompagnements'];
    var KEBAB_DRINK_PICKS = ['coca-cola', 'sprite', 'ice-tea-peche'];
    var PASTRY_PICKS = ['croissant-beurre', 'pain-chocolat', 'croissant-amande', 'cookie'];
    var DRINK_PICKS = ['cappuccino', 'cafe-latte-art', 'jus-orange'];
    var SERVICE_TAKEAWAY = 'Gobelet à emporter';
    var SERVICE_GLASS = 'Tasse en verre (sur place)';
    var promos = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n) { return window.iconHtml ? window.iconHtml(n) : ''; }
    function fmt(v) { return (parseFloat(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function product(i) { return window.Cart && Cart.productFor ? Cart.productFor(i) : null; }
    function optsOf(p) { return window.productOptionsFor ? window.productOptionsFor(p) : {}; }
    function partySize() {
        try { var n = parseInt(localStorage.getItem('soucoffe_party_size'), 10); return n >= 1 ? n : 1; } catch (e) { return 1; }
    }

    // ---- 1. Compléter la commande ----
    function complementBlock(items) {
        var cats = items.map(function (i) { var p = product(i); return p ? p.category : ''; });
        var inCart = items.map(function (i) { return String(i.id).split('|')[0]; });
        var hasDrink = cats.some(function (c) { return DRINK_CATS.indexOf(c) !== -1; });
        var hasFood = cats.some(function (c) { return FOOD_CATS.indexOf(c) !== -1; });
        var picks, title, hint;
        if (hasDrink && !hasFood) { picks = PASTRY_PICKS; title = 'Un petit quelque chose avec votre boisson ?'; hint = 'Souvent pris ensemble'; }
        else if (hasFood && !hasDrink) {
            var kebab = items.some(function (i) { var p = product(i); return p && p.menu === 'kebab'; });
            picks = kebab ? KEBAB_DRINK_PICKS : DRINK_PICKS; title = 'Et pour accompagner ?'; hint = 'Une boisson avec votre commande';
        }
        else return '';
        var p = picks.map(window.getProductById || function () { return null; }).filter(function (x) {
            return x && inCart.indexOf(x.id) === -1 && (!window.isProductAvailable || window.isProductAvailable(x));
        })[0];
        if (!p) return '';
        var img = window.getEffectiveImage ? window.getEffectiveImage(p) : p.img;
        var needs = window.productNeedsCustomization && window.productNeedsCustomization(p.id);
        return '<div class="sc-smart-block sc-smart-complement">' +
            '<p class="sc-smart-kicker">' + ic('auto_awesome') + ' ' + esc(hint) + '</p>' +
            '<p class="sc-smart-title">' + esc(title) + '</p>' +
            '<div class="sc-smart-product">' +
            (img ? '<img src="' + esc(img) + '" alt="" loading="lazy"/>' : '<span class="sc-smart-noimg">' + ic('coffee') + '</span>') +
            '<span class="sc-smart-product-text"><strong>' + esc(p.name) + '</strong><small>' + fmt(window.getEffectivePrice ? window.getEffectivePrice(p) : p.price) + '</small></span>' +
            '<button type="button" class="sc-smart-add" onclick="smartCartAdd(\'' + esc(p.id) + '\')">' + ic(needs ? 'tune' : 'add') + (needs ? 'Choisir' : 'Ajouter') + '</button>' +
            '</div></div>';
    }
    // ---- 0. Passez en menu ----
    function upgradeBlock(items) {
        if (!window.scMenuVersion) return '';
        for (var i = 0; i < items.length; i++) {
            var p = product(items[i]);
            var m = p && window.scMenuVersion(p);
            if (!m || (window.isProductAvailable && !window.isProductAvailable(m))) continue;
            var price = function (x) { return window.getEffectivePrice ? window.getEffectivePrice(x) : x.price; };
            var diff = price(m) - price(p);
            var url = window.scProductUrl(m) + '&upgrade=' + encodeURIComponent(items[i].id);
            return '<div class="sc-smart-block sc-smart-complement">' +
                '<p class="sc-smart-kicker">' + ic('upgrade') + ' Plus avantageux</p>' +
                '<p class="sc-smart-title">Passez votre ' + esc(p.name) + ' en menu' + (diff > 0 ? ' pour +' + fmt(diff) : '') + '</p>' +
                '<p class="sc-smart-note"><span>' + esc(m.desc || m.name) + '</span> <span>Vos choix sont conservés.</span></p>' +
                '<a class="sc-smart-add sc-smart-upgrade" href="' + esc(url) + '">' + ic('upgrade') + ' Passer en menu</a></div>';
        }
        return '';
    }

    window.smartCartAdd = function (id) {
        var p = window.getProductById && window.getProductById(id);
        if (!p) return;
        if (window.productNeedsCustomization && window.productNeedsCustomization(id)) {
            window.location.href = '../02-Menu-Principal/code.html?open=' + encodeURIComponent(id);
            return;
        }
        Cart.add({
            id: p.id, name: p.name, price: window.getEffectivePrice ? window.getEffectivePrice(p) : p.price,
            img: (window.getEffectiveImage ? window.getEffectiveImage(p) : p.img) || '', qty: 1,
            productId: typeof p.apiId === 'number' ? p.apiId : null, optionIds: []
        });
        if (window.cartRerender) window.cartRerender();
    };

    // ---- 2. Promotion à portée ----
    function promoBlock(subtotal) {
        if (!promos || !promos.length) return '';
        var near = promos.filter(function (p) { return p.scope === 'order' && p.minOrder > subtotal; })
            .sort(function (a, b) { return a.minOrder - b.minOrder; })[0];
        if (!near) return '';
        var left = near.minOrder - subtotal;
        var pct = Math.max(4, Math.min(100, Math.round(subtotal / near.minOrder * 100)));
        return '<div class="sc-smart-block">' +
            '<p class="sc-smart-kicker">' + ic('local_offer') + ' Promotion à portée</p>' +
            '<p class="sc-smart-title">Plus que <b>' + fmt(left) + '</b> pour profiter de « ' + esc(near.name) + ' »</p>' +
            (near.summary ? '<p class="sc-smart-note">' + esc(near.summary) + '</p>' : '') +
            '<div class="sc-smart-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div></div>';
    }

    // ---- 3. Service des cafés ----
    function serviceOf(item) {
        var parts = String(item.id).split('|');
        if (parts.indexOf(SERVICE_TAKEAWAY) !== -1) return 'takeaway';
        if (parts.indexOf(SERVICE_GLASS) !== -1) return 'glass';
        return null;
    }
    function serviceBlock(items) {
        var lines = items.filter(function (i) { var p = product(i); return p && optsOf(p).service; });
        if (!lines.length) return '';
        var take = 0, glass = 0;
        lines.forEach(function (i) { if (serviceOf(i) === 'takeaway') take += i.qty; else glass += i.qty; });
        var allTake = glass === 0, allGlass = take === 0;
        return '<div class="sc-smart-block">' +
            '<p class="sc-smart-kicker">' + ic('local_cafe') + ' Service de vos cafés</p>' +
            '<p class="sc-smart-title">' + (glass ? glass + ' en tasse' : '') + (glass && take ? ' · ' : '') + (take ? take + ' à emporter' : '') + '</p>' +
            '<div class="sc-smart-seg" role="group" aria-label="Service de tous les cafés">' +
            '<button type="button" class="' + (allGlass ? 'is-on' : '') + '" aria-pressed="' + allGlass + '" onclick="smartCartService(\'glass\')">' + ic('sc_glass_cup') + 'Tout sur place</button>' +
            '<button type="button" class="' + (allTake ? 'is-on' : '') + '" aria-pressed="' + allTake + '" onclick="smartCartService(\'takeaway\')">' + ic('sc_takeaway_cup') + 'Tout à emporter</button>' +
            '</div></div>';
    }
    // Change l'option « Service » de chaque café : identifiant, nom et optionId
    // SQL recalculés (le serveur recevra la bonne option).
    window.smartCartService = function (mode) {
        var target = mode === 'takeaway' ? SERVICE_TAKEAWAY : SERVICE_GLASS;
        var changed = false;
        var items = Cart.get().map(function (i) {
            var p = product(i);
            var service = p && optsOf(p).service;
            if (!service) return i;
            var targetOpt = service.filter(function (o) { return o.label === target; })[0];
            if (!targetOpt) return i;
            var serviceLabels = service.map(function (o) { return o.label; });
            var serviceIds = service.map(function (o) { return o.optionId; }).filter(function (x) { return typeof x === 'number'; });
            var parts = String(i.id).split('|');
            var opts = parts.slice(1).filter(function (x) { return serviceLabels.indexOf(x) === -1; });
            opts.unshift(target);
            var ids = (i.optionIds || []).filter(function (x) { return serviceIds.indexOf(x) === -1; });
            if (typeof targetOpt.optionId === 'number') ids.unshift(targetOpt.optionId);
            var newId = parts[0] + '|' + opts.join('|');
            if (newId === i.id) return i;
            changed = true;
            var copy = {};
            Object.keys(i).forEach(function (k) { copy[k] = i[k]; });
            copy.id = newId;
            copy.name = p.name + ' (' + opts.join(', ') + ')';
            copy.optionIds = ids;
            return copy;
        });
        if (!changed) return;
        Cart.replaceAll(items);
        if (window.showToast) window.showToast(mode === 'takeaway' ? 'Tous vos cafés sont à emporter' : 'Tous vos cafés sont servis en tasse');
        if (window.cartRerender) window.cartRerender();
    };

    // ---- 4. Addition partagée ----
    function splitBlock(total) {
        var n = partySize();
        if (n < 2 || total <= 0) return '';
        return '<div class="sc-smart-block sc-smart-inline">' +
            '<p class="sc-smart-kicker">' + ic('groups') + ' Addition partagée</p>' +
            '<p class="sc-smart-title">≈ <b>' + fmt(total / n) + '</b> par personne <small>(' + n + ' pers.)</small></p></div>';
    }

    // ---- 5. Repères nutritionnels ----
    function nutritionBlock(items) {
        var kcal = 0, known = 0, allergens = [];
        items.forEach(function (i) {
            var p = product(i);
            if (!p) return;
            if (typeof p.calories === 'number') { kcal += p.calories * (i.qty || 1); known++; }
            (p.allergens || []).forEach(function (a) { if (a && allergens.indexOf(a) === -1) allergens.push(a); });
        });
        if (!known && !allergens.length) return '';
        return '<div class="sc-smart-block sc-smart-inline">' +
            '<p class="sc-smart-kicker">' + ic('nutrition') + ' Repères</p>' +
            '<p class="sc-smart-title">' + (known ? '≈ <b>' + Math.round(kcal) + ' kcal</b>' : '') +
            (allergens.length ? (known ? ' · ' : '') + 'Contient : ' + esc(allergens.join(', ')) : ' · Sans allergène majeur déclaré') + '</p>' +
            '<p class="sc-smart-note">Valeurs indicatives, hors options et suppléments.</p></div>';
    }

    window.renderCartSmart = function (items, total) {
        var el = document.getElementById('cart-smart');
        if (!el) return;
        if (!items || !items.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
        var subtotal = window.Cart ? Cart.total() : 0;
        var html = upgradeBlock(items) + complementBlock(items) + promoBlock(subtotal) + serviceBlock(items) +
            splitBlock(typeof total === 'number' ? total : subtotal) + nutritionBlock(items);
        if (!html) { el.innerHTML = ''; el.classList.add('hidden'); return; }
        html = '<p class="sc-smart-head">' + ic('auto_awesome') + ' Pour vous</p>' + html;
        if (el.__html !== html) { el.__html = html; el.innerHTML = html; }
        el.classList.remove('hidden');
    };

    // Promotions actives (une seule fois) : le panneau se réaffiche ensuite.
    document.addEventListener('DOMContentLoaded', function () {
        if (!window.SOUCOFFE_API_BASE) return;
        fetch(window.SOUCOFFE_API_BASE + '/promotions/active').then(function (r) { return r.ok ? r.json() : null; }).then(function (r) {
            promos = (r && r.content) || [];
            if (window.cartRerender) window.cartRerender();
        }).catch(function () { promos = []; });
    });
})();
