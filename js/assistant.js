// SOUCOFFE - Assistant de commande en langage libre. Pas d'IA/API externe :
// un petit moteur de règles mots-clés, dans le même esprit "fait main" que
// normalizeSearchText/fuzzyMatch déjà écrits dans js/products.js. Lit
// uniquement PRODUCTS/filterAndSortProducts (déjà partagés) — n'importe
// jamais admin.js, n'appelle aucun service externe.
(function () {
    var ASSISTANT_RULES = [
        { keywords: ['frais', 'froid', 'glace', 'glacee', 'fraicheur'], categories: ['Sodas', 'Jus', 'Smoothies', 'Mojitos'], sortBy: null, reason: 'quelque chose de frais' },
        { keywords: ['chaud', 'cafe', 'expresso', 'cappuccino', 'latte'], categories: ['Cafés'], sortBy: null, reason: 'un bon café chaud' },
        { keywords: ['sucre', 'dessert', 'gourmand', 'patisserie', 'douceur'], categories: ['Desserts', 'Croissants'], sortBy: null, reason: 'quelque chose de sucré' },
        { keywords: ['faim', 'repas', 'sale', 'sandwich', 'manger'], categories: ['Sandwichs'], sortBy: null, reason: 'un repas salé' },
        { keywords: ['sante', 'leger', 'vitamine', 'fruit'], categories: ['Jus', 'Smoothies'], sortBy: null, reason: 'quelque chose de sain' },
        { keywords: ['pascher', 'economique', 'petitbudget', 'abordable'], categories: [], sortBy: 'price-asc', reason: 'petit budget' },
        { keywords: ['premium', 'special', 'gourmet', 'luxueux'], categories: [], sortBy: 'price-desc', reason: 'quelque chose de premium' }
    ];

    // Réutilise la même normalisation que la recherche du Menu (accents/case),
    // en retirant en plus les espaces pour matcher "pas cher" écrit en un mot
    // dans les règles ci-dessus contre "pas cher" tapé par le client.
    function normalize(str) {
        return window.filterAndSortProducts ? String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : String(str || '').toLowerCase();
    }

    function interpretQuery(query) {
        var normalized = normalize(query).replace(/\s+/g, '');
        var categories = [];
        var reasons = [];
        var sortBy = null;
        ASSISTANT_RULES.forEach(function (rule) {
            var matched = rule.keywords.some(function (kw) { return normalized.indexOf(kw) !== -1; });
            if (!matched) return;
            rule.categories.forEach(function (c) { if (categories.indexOf(c) === -1) categories.push(c); });
            if (rule.sortBy) sortBy = rule.sortBy;
            reasons.push(rule.reason);
        });
        return { categories: categories, sortBy: sortBy, reasons: reasons };
    }

    // { reason, products } — ne renvoie jamais un résultat vide sur une
    // saisie raisonnable : sans catégorie reconnue, repli sur la recherche
    // floue déjà existante (mêmes garanties que le Menu).
    function matchAssistantQuery(query, limit) {
        limit = limit || 4;
        var trimmed = String(query || '').trim();
        if (!trimmed) return { reason: null, products: [] };

        var interpreted = interpretQuery(trimmed);
        var products;
        var reason;
        if (interpreted.categories.length) {
            products = window.filterAndSortProducts(window.PRODUCTS || [], {
                category: interpreted.categories, sortBy: interpreted.sortBy || 'popular'
            }).slice(0, limit);
            reason = 'Vous cherchez ' + interpreted.reasons.join(' et ') + ' ? Voici notre sélection.';
        } else {
            products = window.filterAndSortProducts(window.PRODUCTS || [], {
                searchTerm: trimmed, sortBy: interpreted.sortBy || 'popular'
            }).slice(0, limit);
            reason = products.length
                ? 'Voici ce qui correspond le mieux à "' + trimmed + '".'
                : 'Rien ne correspond exactement, mais jetez un œil à notre carte complète.';
        }
        return { reason: reason, products: products };
    }

    window.SoucoffeAssistant = { matchAssistantQuery: matchAssistantQuery };
})();
