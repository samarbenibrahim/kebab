// SOUCOFFE - Recommandations côté client (rail "souvent commandé avec" +
// signal de popularité réelle). Purement additif : lit Orders.getAll() et
// PRODUCTS (déjà partagés via cart.js/products.js), ne dépend jamais de
// admin.js. Toute page qui ne charge pas ce fichier continue de fonctionner
// exactement comme avant — chaque consommateur (getEffectiveTags, la modale
// produit, le panier) vérifie window.SoucoffeRecommendations avant usage.
(function () {
    var BESTSELLER_LIMIT = 6;

    function baseProductId(cartItemId) {
        return String(cartItemId).split('|')[0];
    }

    // { productIdA: { productIdB: count, ... }, ... } — compté une fois par
    // commande pour chaque paire de produits distincts qu'elle contient.
    function computeCoOccurrenceMap() {
        var map = {};
        var orders = (window.Orders && Orders.getAll()) || [];
        orders.forEach(function (order) {
            var ids = [];
            (order.items || []).forEach(function (item) {
                var id = baseProductId(item.id);
                if (ids.indexOf(id) === -1) ids.push(id);
            });
            for (var i = 0; i < ids.length; i++) {
                for (var j = 0; j < ids.length; j++) {
                    if (i === j) continue;
                    if (!map[ids[i]]) map[ids[i]] = {};
                    map[ids[i]][ids[j]] = (map[ids[i]][ids[j]] || 0) + 1;
                }
            }
        });
        return map;
    }

    // { productId: totalQty } toutes commandes confondues.
    function computeQtyById() {
        var qtyById = {};
        var orders = (window.Orders && Orders.getAll()) || [];
        orders.forEach(function (order) {
            (order.items || []).forEach(function (item) {
                var id = baseProductId(item.id);
                qtyById[id] = (qtyById[id] || 0) + (item.qty || 1);
            });
        });
        return qtyById;
    }

    function computeBestsellerIds(limit) {
        var qtyById = computeQtyById();
        var ids = Object.keys(qtyById).sort(function (a, b) { return qtyById[b] - qtyById[a]; });
        return ids.slice(0, limit || BESTSELLER_LIMIT);
    }

    // window.SoucoffeSalesSignal est un getter live plutôt qu'un instantané
    // figé au chargement : l'historique de commandes change pendant la vie
    // de la page (une nouvelle commande passée, un statut mis à jour), et le
    // badge "Populaire" doit refléter l'état courant sans recharger. Le
    // recalcul (quelques dizaines de commandes/produits max) est négligeable.
    Object.defineProperty(window, 'SoucoffeSalesSignal', {
        configurable: true,
        get: function () {
            var map = {};
            computeBestsellerIds(BESTSELLER_LIMIT).forEach(function (id) { map[id] = true; });
            return map;
        }
    });

    function candidateProducts(excludeIds) {
        return (window.PRODUCTS || []).filter(function (p) {
            return excludeIds.indexOf(p.id) === -1 && window.isProductAvailable(p);
        });
    }

    function byCategoryFallback(referenceProduct, excludeIds, limit) {
        if (!referenceProduct) return [];
        return candidateProducts(excludeIds)
            .filter(function (p) { return p.category === referenceProduct.category; })
            .slice(0, limit);
    }

    // Suggestions pour un produit donné (fiche produit / modale). Priorité à
    // la co-occurrence réelle ; complète par la même catégorie si
    // l'historique est absent ou insuffisant (cas neuf : 0 commande).
    function getForProduct(productId, limit) {
        limit = limit || 4;
        var coOcc = computeCoOccurrenceMap()[productId] || {};
        var excludeIds = [productId];
        var ranked = Object.keys(coOcc)
            .filter(function (id) { return excludeIds.indexOf(id) === -1; })
            .sort(function (a, b) { return coOcc[b] - coOcc[a]; })
            .map(function (id) { return window.getProductById(id); })
            .filter(function (p) { return p && window.isProductAvailable(p); });

        if (ranked.length < limit) {
            var reference = window.getProductById(productId);
            var already = ranked.map(function (p) { return p.id; }).concat(excludeIds);
            ranked = ranked.concat(byCategoryFallback(reference, already, limit - ranked.length));
        }
        return ranked.slice(0, limit);
    }

    // Suggestions pour tout le panier : union des suggestions par article,
    // classées par score de co-occurrence cumulé, sans jamais reproposer un
    // produit déjà dans le panier.
    function getForCart(cartItems, limit) {
        limit = limit || 4;
        var inCartIds = (cartItems || []).map(function (item) { return baseProductId(item.id); });
        if (!inCartIds.length) return [];

        var coOccMap = computeCoOccurrenceMap();
        var scoreById = {};
        inCartIds.forEach(function (id) {
            var partners = coOccMap[id] || {};
            Object.keys(partners).forEach(function (partnerId) {
                if (inCartIds.indexOf(partnerId) !== -1) return;
                scoreById[partnerId] = (scoreById[partnerId] || 0) + partners[partnerId];
            });
        });

        var ranked = Object.keys(scoreById)
            .sort(function (a, b) { return scoreById[b] - scoreById[a]; })
            .map(function (id) { return window.getProductById(id); })
            .filter(function (p) { return p && window.isProductAvailable(p); });

        if (ranked.length < limit) {
            var already = ranked.map(function (p) { return p.id; }).concat(inCartIds);
            var firstInCart = window.getProductById(inCartIds[0]);
            ranked = ranked.concat(byCategoryFallback(firstInCart, already, limit - ranked.length));
        }
        return ranked.slice(0, limit);
    }

    // Signale si une suggestion vient de vraies co-commandes (historique) ou
    // seulement du repli catégorie — sert à choisir un libellé honnête côté
    // appelant plutôt qu'un "Souvent commandé avec" toujours affiché pareil.
    function hasCoOccurrenceData(productId) {
        var partners = computeCoOccurrenceMap()[productId];
        return !!partners && Object.keys(partners).length > 0;
    }

    function hasCoOccurrenceDataForCart(cartItems) {
        var inCartIds = (cartItems || []).map(function (item) { return baseProductId(item.id); });
        var coOccMap = computeCoOccurrenceMap();
        return inCartIds.some(function (id) {
            var partners = coOccMap[id];
            return partners && Object.keys(partners).some(function (p) { return inCartIds.indexOf(p) === -1; });
        });
    }

    // Produit le plus commandé au total (historique complet) — base de la
    // carte "Votre habitude" de l'accueil. null si pas d'historique, ou si le
    // produit le plus commandé n'existe plus / n'est plus disponible.
    function getMostOrderedProduct() {
        var ids = computeBestsellerIds(1);
        if (!ids.length) return null;
        var product = window.getProductById(ids[0]);
        return (product && window.isProductAvailable(product)) ? product : null;
    }

    var TIME_SLOTS = [
        { start: 6, end: 11, icon: 'wb_sunny', label: 'Idéal pour ce matin', categories: ['Cafés', 'Croissants'] },
        { start: 11, end: 15, icon: 'lunch_dining', label: 'Pour votre pause déjeuner', categories: ['Sandwichs', 'Jus'] },
        { start: 15, end: 19, icon: 'cake', label: 'Une pause gourmande ?', categories: ['Desserts', 'Smoothies'] },
        { start: 19, end: 24, icon: 'dark_mode', label: 'Pour votre soirée', categories: ['Mojitos', 'Sodas', 'Desserts'] },
        { start: 0, end: 6, icon: 'dark_mode', label: 'Pour votre soirée', categories: ['Mojitos', 'Sodas', 'Desserts'] }
    ];

    function getTimeBasedSuggestions(limit) {
        limit = limit || 4;
        var hour = new Date().getHours();
        var slot = TIME_SLOTS.filter(function (s) { return hour >= s.start && hour < s.end; })[0] || TIME_SLOTS[0];
        var products = window.filterAndSortProducts(window.PRODUCTS || [], {
            category: slot.categories, sortBy: 'popular'
        }).slice(0, limit);
        var label = (window.iconHtml ? window.iconHtml(slot.icon, 'align-middle') : '') + ' ' + slot.label;
        return { label: label, icon: slot.icon, text: slot.label, products: products };
    }

    // Réutilise le rendu de carte déjà partagé (renderProductCard) dans le
    // même pattern de rangée défilante horizontalement que #category-pills
    // (02-Menu-Principal) — aucune nouvelle classe/visuel introduite. `label`
    // est optionnel : les appels existants (sans le passer) gardent le
    // libellé historique par défaut, inchangés.
    function renderRail(containerEl, products, label) {
        if (!containerEl) return;
        if (!products || !products.length) {
            containerEl.innerHTML = '';
            containerEl.classList.add('hidden');
            return;
        }
        containerEl.classList.remove('hidden');
        containerEl.innerHTML =
            '<div class="font-label-md text-label-md text-on-surface-variant mb-2 uppercase tracking-wider">' +
            (label || 'Souvent commandé avec') + '</div>' +
            '<div class="flex gap-4 overflow-x-auto hide-scrollbar pb-2">' +
            products.map(function (p) {
                return '<div class="w-40 shrink-0">' + window.renderProductCard(p) + '</div>';
            }).join('') +
            '</div>';
        if (window.renderIcons) window.renderIcons();
    }

    window.SoucoffeRecommendations = {
        getForProduct: getForProduct,
        getForCart: getForCart,
        renderRail: renderRail,
        computeBestsellerIds: computeBestsellerIds,
        hasCoOccurrenceData: hasCoOccurrenceData,
        hasCoOccurrenceDataForCart: hasCoOccurrenceDataForCart,
        getMostOrderedProduct: getMostOrderedProduct,
        getTimeBasedSuggestions: getTimeBasedSuggestions
    };
})();
