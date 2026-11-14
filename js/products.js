// SOUCOFFE - Shared product catalog, card rendering, and product detail modal.
// Depends on Cart / Favorites from js/cart.js (load order: icons.js, cart.js, products.js).
(function () {
    var PRODUCTS = [
        // Cafés
        { id: 'espresso', img: '../images/products/espresso.jpg', name: 'Espresso', category: 'Cafés', price: 4.500, desc: "Un shot pur et intense, à la crema dorée.", icon: 'coffee' },
        { id: 'double-espresso', img: '../images/products/double-espresso.jpg', name: 'Double Espresso', category: 'Cafés', price: 6.500, desc: "Deux shots pour un réveil garanti.", icon: 'coffee' },
        { id: 'cafe-direct', img: '../images/products/cafe-direct.jpg', name: 'Café Direct', category: 'Cafés', price: 4.000, desc: "Café filtre classique, doux et équilibré.", icon: 'coffee' },
        { id: 'cafe-creme', img: '../images/products/cafe-creme.jpg', name: 'Café Crème', category: 'Cafés', price: 5.500, desc: "Espresso et lait chaud, onctueux.", icon: 'coffee' },
        { id: 'cafe-latte-art', img: '../images/products/cafe-latte-art.jpg', name: 'Café Latte Art', category: 'Cafés', price: 4.500, desc: "Espresso double, lait velouté et art latte signature.", icon: 'coffee', tags: ['popular'] },
        { id: 'cappuccino', img: '../images/products/cappuccino.jpg', name: 'Cappuccino', category: 'Cafés', price: 5.000, desc: "Espresso, lait moussé et une pointe de cacao.", icon: 'coffee', tags: ['popular'] },
        { id: 'cafe-glace-caramel', img: '../images/products/cafe-glace-caramel.jpg', name: 'Café Glacé Caramel', category: 'Cafés', price: 6.000, desc: "Espresso froid, caramel et glaçons.", icon: 'ac_unit', tags: ['new'] },

        // Croissants
        { id: 'croissant-beurre', img: '../images/products/croissant-beurre.jpg', name: 'Croissant Pur Beurre', category: 'Croissants', price: 2.200, desc: "Cuit sur place ce matin, croustillant à l'extérieur, moelleux à l'intérieur.", icon: 'bakery_dining', tags: ['popular'] },
        { id: 'pain-chocolat', img: '../images/products/pain-chocolat.jpg', name: 'Pain au Chocolat', category: 'Croissants', price: 2.500, desc: "Pâte feuilletée et cœur de chocolat noir.", icon: 'bakery_dining' },
        { id: 'croissant-amande', img: '../images/products/croissant-amande.jpg', name: 'Croissant Amande', category: 'Croissants', price: 3.200, desc: "Fourré à la crème d'amande, effeuillé.", icon: 'bakery_dining', tags: ['new'] },
        { id: 'chausson-pommes', img: '../images/products/chausson-pommes.jpg', name: 'Chausson aux Pommes', category: 'Croissants', price: 2.800, desc: "Pommes fondantes en pâte feuilletée.", icon: 'bakery_dining' },

        // Sodas
        { id: 'coca-cola', img: '../images/products/coca-cola.jpg', name: 'Coca-Cola', category: 'Sodas', price: 3.000, desc: "Servi bien frais avec des glaçons.", icon: 'local_drink' },
        { id: 'sprite', img: '../images/products/sprite.jpg', name: 'Sprite', category: 'Sodas', price: 3.000, desc: "Fraîcheur citron-lime pétillante.", icon: 'local_drink' },
        { id: 'schweppes-agrumes', img: '../images/products/schweppes-agrumes.jpg', name: 'Schweppes Agrumes', category: 'Sodas', price: 3.200, desc: "Notes d'agrumes, légèrement amer.", icon: 'local_drink' },
        { id: 'ice-tea-peche', img: '../images/products/ice-tea-peche.jpg', name: 'Ice Tea Pêche', category: 'Sodas', price: 3.200, desc: "Thé glacé infusé à la pêche.", icon: 'local_drink', tags: ['new'] },

        // Mojitos
        { id: 'mojito-classique', img: '../images/products/mojito-classique.jpg', name: 'Virgin Mojito Classique', category: 'Mojitos', price: 5.000, desc: "Citron vert frais, menthe pilée, sucre de canne et eau gazeuse.", icon: 'local_bar', tags: ['popular'] },
        { id: 'mojito-fraise', img: '../images/products/mojito-fraise.jpg', name: 'Virgin Mojito Fraise', category: 'Mojitos', price: 5.500, desc: "Fraises fraîches et menthe pilée.", icon: 'local_bar' },
        { id: 'mojito-framboise', img: '../images/products/mojito-framboise.jpg', name: 'Virgin Mojito Framboise', category: 'Mojitos', price: 5.500, desc: "Framboises fraîches et éclats de menthe.", icon: 'local_bar', tags: ['new'] },
        { id: 'mojito-passion', img: '../images/products/mojito-passion.jpg', name: 'Virgin Mojito Passion', category: 'Mojitos', price: 6.000, desc: "Fruit de la passion et menthe fraîche.", icon: 'local_bar' },

        // Jus
        { id: 'jus-orange', img: '../images/products/jus-orange.jpg', name: "Jus d'Orange Pressé", category: 'Jus', price: 5.000, desc: "Oranges pressées minute, sans sucre ajouté.", icon: 'nutrition' },
        { id: 'jus-citron', img: '../images/products/jus-citron.jpg', name: 'Jus de Citron', category: 'Jus', price: 4.500, desc: "Citrons frais pressés, acidulé et vivifiant.", icon: 'nutrition' },
        { id: 'jus-fraise', img: '../images/products/jus-fraise.jpg', name: 'Jus de Fraise', category: 'Jus', price: 5.500, desc: "Fraises mixées fraîches.", icon: 'nutrition', tags: ['new'] },
        { id: 'jus-mangue', img: '../images/products/jus-mangue.jpg', name: 'Jus de Mangue', category: 'Jus', price: 5.800, desc: "Mangue mûre à point, onctueux.", icon: 'nutrition' },

        // Smoothies
        { id: 'smoothie-banane-fraise', img: '../images/products/smoothie-banane-fraise.jpg', name: 'Smoothie Banane Fraise', category: 'Smoothies', price: 6.000, desc: "Banane, fraises et lait, texture veloutée.", icon: 'blender', tags: ['popular'] },
        { id: 'smoothie-mangue-passion', img: '../images/products/smoothie-mangue-passion.jpg', name: 'Smoothie Mangue Passion', category: 'Smoothies', price: 6.500, desc: "Mangue, fruit de la passion et yaourt.", icon: 'blender' },
        { id: 'smoothie-vert-detox', img: '../images/products/smoothie-vert-detox.jpg', name: 'Smoothie Vert Détox', category: 'Smoothies', price: 6.800, desc: "Épinard, pomme, citron et gingembre.", icon: 'blender', tags: ['new'] },
        { id: 'smoothie-fruits-rouges', img: '../images/products/smoothie-fruits-rouges.jpg', name: 'Smoothie Fruits Rouges', category: 'Smoothies', price: 6.500, desc: "Fraise, framboise, myrtille et yaourt.", icon: 'blender' },

        // Sandwichs
        { id: 'avocado-toast', img: '../images/products/avocado-toast.jpg', name: 'Avocado Toast', category: 'Sandwichs', price: 9.500, desc: "Pain au levain, avocat écrasé, tomates cerises et graines torréfiées.", icon: 'brunch_dining', tags: ['new'] },
        { id: 'club-sandwich', img: '../images/products/club-sandwich.jpg', name: 'Club Sandwich', category: 'Sandwichs', price: 10.500, desc: "Poulet grillé, bacon, salade, tomate.", icon: 'lunch_dining', tags: ['popular'] },
        { id: 'sandwich-thon', img: '../images/products/sandwich-thon.jpg', name: 'Sandwich Thon Crudités', category: 'Sandwichs', price: 8.500, desc: "Thon, crudités fraîches, pain complet.", icon: 'lunch_dining' },
        { id: 'panini-poulet-curry', img: '../images/products/panini-poulet-curry.jpg', name: 'Panini Poulet Curry', category: 'Sandwichs', price: 9.000, desc: "Poulet, sauce curry, crudités, pressé et croustillant.", icon: 'lunch_dining' },

        // Desserts
        { id: 'tiramisu', img: '../images/products/tiramisu.jpg', name: 'Tiramisu Maison', category: 'Desserts', price: 6.500, desc: "Recette traditionnelle italienne, mascarpone et café.", icon: 'cake', tags: ['popular'] },
        { id: 'cheesecake', img: '../images/products/cheesecake.jpg', name: 'Cheesecake Fruits Rouges', category: 'Desserts', price: 7.000, desc: "Base biscuitée, coulis de fruits rouges.", icon: 'cake' },
        { id: 'fondant-chocolat', img: '../images/products/fondant-chocolat.jpg', name: 'Fondant au Chocolat', category: 'Desserts', price: 6.800, desc: "Cœur coulant, chocolat noir intense.", icon: 'cake', tags: ['new'] },
        { id: 'cookie', img: '../images/products/cookie.jpg', name: 'Cookie Pépites de Chocolat', category: 'Desserts', price: 3.500, desc: "Cuit maison, croustillant à l'extérieur.", icon: 'cookie' },
        // Offres du moment : vrais produits (aussi en SQL), donc commandables.
        { id: 'formule-petit-dejeuner', img: '../images/hero/hero-1.jpg', name: 'Formule Petit Déjeuner', category: 'Offres', price: 8.500, desc: "Café au choix, croissant pur beurre et jus d'orange pressé.", icon: 'breakfast_dining' },
        { id: 'cafe-turc', img: '../images/products/cafe-turc.jpg', name: 'Café Turc', category: 'Cafés', price: 4.500, desc: "Café finement moulu, préparé au cezve et servi avec sa mousse onctueuse.", icon: 'coffee', tags: ['new'] },
        // Petit-déjeuner (photos ajoutées au projet)
        { id: 'petit-dejeuner-healthy', img: '../images/products/petit-dejeuner-healthy.jpg', name: 'Petit-déjeuner Healthy', category: 'Petit-déjeuner', price: 14.000, desc: "Pain frais, fromages, olives, légumes croquants, œuf au plat, miel et confitures maison.", icon: 'brunch_dining', tags: ['new'] },
        { id: 'petit-dejeuner-sucre', img: '../images/products/petit-dejeuner-sucre.jpg', name: 'Petit-déjeuner Sucré', category: 'Petit-déjeuner', price: 12.000, desc: "Croissants, pancakes aux fruits rouges, granola au yaourt, fruits frais et chocolat chaud.", icon: 'breakfast_dining', tags: ['new'] },
        { id: 'petit-dejeuner-sale', img: '../images/products/petit-dejeuner-sale.jpg', name: 'Petit-déjeuner Salé', category: 'Petit-déjeuner', price: 15.000, desc: "Plateau de fromages, crackers, olives, tomates, concombre, crêpes salées et fruits frais.", icon: 'brunch_dining', tags: ['new'] },
        { id: 'petit-dejeuner-turc', img: '../images/products/petit-dejeuner-turc.jpg', name: 'Petit-déjeuner Turc', category: 'Petit-déjeuner', price: 18.000, desc: "Simit, fromages blancs, olives, miel en rayon, confitures, œuf et thé turc.", icon: 'brunch_dining', tags: ['new'] },
        { id: 'petit-dejeuner-compose', img: '../images/products/petit-dejeuner-compose.jpg', name: 'Petit-déjeuner à composer', category: 'Petit-déjeuner', price: 5.000, desc: "Pain frais et beurre inclus : choisissez votre boisson, puis composez le reste selon vos envies.", icon: 'brunch_dining', tags: ['new'],
          options: { groups: [
            { name: 'Boisson chaude', multiple: false, required: true, min: 1, max: 1, options: [{ label: 'Espresso', price: 0 }, { label: 'Café crème', price: 1 }, { label: 'Cappuccino', price: 1.5 }, { label: 'Café turc', price: 1 }, { label: 'Thé à la menthe', price: 0.5 }, { label: 'Chocolat chaud', price: 1.5 }] },
            { name: 'Jus frais', multiple: false, required: false, min: 0, max: 1, options: [{ label: 'Orange pressée', price: 2.5 }, { label: 'Citron frais', price: 2 }, { label: 'Fraise', price: 3 }, { label: 'Mangue', price: 3.3 }] },
            { name: 'Viennoiseries', multiple: true, required: false, min: 0, max: 2, options: [{ label: 'Croissant pur beurre', price: 2 }, { label: 'Pain au chocolat', price: 2.3 }, { label: 'Pancakes fruits rouges', price: 3.5 }, { label: 'Simit au sésame', price: 1.8 }] },
            { name: 'Œufs', multiple: false, required: false, min: 0, max: 1, options: [{ label: 'Œuf au plat', price: 1.5 }, { label: 'Œufs brouillés', price: 2.5 }, { label: 'Omelette nature', price: 2.5 }, { label: 'Omelette fromage', price: 3.2 }] },
            { name: 'Salé', multiple: true, required: false, min: 0, max: 4, options: [{ label: 'Fromage blanc', price: 1.5 }, { label: 'Fromage kasar', price: 1.8 }, { label: 'Olives noires et vertes', price: 1 }, { label: 'Tomates et concombre', price: 1.2 }, { label: 'Blanc de dinde', price: 2.5 }] },
            { name: 'Douceurs', multiple: true, required: false, min: 0, max: 3, options: [{ label: 'Miel', price: 1 }, { label: 'Confiture maison', price: 0.8 }, { label: 'Pâte à tartiner', price: 1.2 }, { label: 'Fruits frais de saison', price: 2.5 }, { label: 'Granola et yaourt', price: 3 }] }
          ] } },
        { id: 'coffee-break', img: '../images/hero/hero-2.jpg', name: 'Coffee Break', category: 'Offres', price: 6.000, desc: "Boisson glacée & Pâtisserie", icon: 'local_cafe' }
    ];

    // Icône SVG (nom Material Symbols) de repli quand un produit n'a pas de
    // photo : celle du produit local si connue, sinon celle de sa catégorie.
    var CATEGORY_ICON = {
        'Cafés': 'coffee', 'Croissants': 'bakery_dining', 'Sodas': 'local_drink',
        'Mojitos': 'local_bar', 'Jus': 'nutrition', 'Smoothies': 'blender',
        'Sandwichs': 'lunch_dining', 'Desserts': 'cake', 'Offres': 'local_cafe',
        'Petit-déjeuner': 'brunch_dining',
        // Menu Kebab
        'Paninis et piadines': 'kebab_dining', 'Assiettes kebab': 'restaurant', 'Menus kebab': 'fastfood',
        'Alternatives': 'nutrition', 'Accompagnements': 'tapas', 'Sauces et suppléments': 'water_drop'
    };
    var LOCAL_ICON_BY_ID = {};
    PRODUCTS.forEach(function (p) { LOCAL_ICON_BY_ID[p.id] = p.icon; });
    function productIconHtml(product, cls) {
        var name = product.icon || CATEGORY_ICON[product.category] || 'coffee';
        return window.iconHtml ? window.iconHtml(name, cls || '') : '';
    }
    window.productIconHtml = productIconHtml;

    // Infos allergènes / nutritionnelles INDICATIVES (catalogue de démonstration).
    // Miroir exact de database/import_products.php ($dietaryInfo) : le repli
    // local doit montrer les mêmes informations que l'API.
    // slug : [allergènes, kcal, tags]
    var V_ = ['vegetarien', 'sans-gluten'], VV_ = ['vegan', 'vegetarien', 'sans-gluten'];
    var DIETARY_INFO = {
        'espresso': [[], 5, VV_], 'double-espresso': [[], 10, VV_], 'cafe-direct': [[], 5, VV_],
        'cafe-creme': [['Lait'], 90, V_], 'cafe-latte-art': [['Lait'], 120, V_], 'cappuccino': [['Lait'], 110, V_],
        'cafe-glace-caramel': [['Lait'], 160, V_],
        'croissant-beurre': [['Gluten', 'Lait', 'Œufs'], 230, ['vegetarien']],
        'pain-chocolat': [['Gluten', 'Lait', 'Œufs', 'Soja'], 270, ['vegetarien']],
        'croissant-amande': [['Gluten', 'Lait', 'Œufs', 'Fruits à coque'], 340, ['vegetarien']],
        'chausson-pommes': [['Gluten', 'Lait'], 260, ['vegetarien']],
        'coca-cola': [[], 140, VV_], 'sprite': [[], 130, VV_], 'schweppes-agrumes': [[], 120, VV_], 'ice-tea-peche': [[], 90, VV_],
        'mojito-classique': [[], 110, VV_], 'mojito-fraise': [[], 130, VV_], 'mojito-framboise': [[], 130, VV_], 'mojito-passion': [[], 140, VV_],
        'jus-orange': [[], 110, VV_], 'jus-citron': [[], 60, VV_], 'jus-fraise': [[], 100, VV_], 'jus-mangue': [[], 130, VV_],
        'smoothie-banane-fraise': [['Lait'], 220, V_], 'smoothie-mangue-passion': [['Lait'], 210, V_],
        'smoothie-vert-detox': [[], 130, VV_], 'smoothie-fruits-rouges': [['Lait'], 190, V_],
        'avocado-toast': [['Gluten', 'Sésame'], 380, ['vegan', 'vegetarien']],
        'club-sandwich': [['Gluten', 'Œufs', 'Moutarde'], 560, []],
        'sandwich-thon': [['Gluten', 'Poisson', 'Œufs'], 430, []],
        'panini-poulet-curry': [['Gluten', 'Lait', 'Moutarde'], 520, []],
        'tiramisu': [['Gluten', 'Lait', 'Œufs'], 450, ['vegetarien']], 'cheesecake': [['Gluten', 'Lait', 'Œufs'], 420, ['vegetarien']],
        'fondant-chocolat': [['Gluten', 'Lait', 'Œufs'], 400, ['vegetarien']],
        'cookie': [['Gluten', 'Lait', 'Œufs', 'Fruits à coque'], 280, ['vegetarien']],
        'formule-petit-dejeuner': [['Gluten', 'Lait', 'Œufs'], 350, ['vegetarien']],
        'coffee-break': [['Gluten', 'Lait', 'Œufs'], 400, ['vegetarien']]
    };
    PRODUCTS.forEach(function (p) {
        var d = DIETARY_INFO[p.id];
        if (d) { p.allergens = d[0]; p.calories = d[1]; p.dietaryTags = d[2]; }
    });

    var DIET_LABELS = { 'vegetarien': 'Végétarien', 'vegan': 'Végan', 'sans-gluten': 'Sans gluten' };

    // Bloc "infos nutritionnelles" de la fiche produit ('' si rien de connu).
    function dietInfoHtml(p) {
        var hasAllergens = Array.isArray(p.allergens);
        var hasKcal = typeof p.calories === 'number';
        var tags = Array.isArray(p.dietaryTags) ? p.dietaryTags : [];
        if (!hasAllergens && !hasKcal && !tags.length) return '';
        var chip = 'text-xs px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant';
        var html = '<div class="flex flex-wrap items-center gap-1.5 mb-1">';
        if (hasKcal) html += '<span class="' + chip + '">≈ ' + p.calories + ' kcal</span>';
        tags.forEach(function (t) { if (DIET_LABELS[t]) html += '<span class="' + chip + '">' + DIET_LABELS[t] + '</span>'; });
        html += '</div>';
        if (hasAllergens) {
            html += '<p class="text-xs text-on-surface-variant">' + (p.allergens.length
                ? 'Allergènes : ' + p.allergens.map(escapeHtml).join(', ')
                : 'Aucun allergène déclaré') + '</p>';
        }
        return html + '<p class="text-[10px] text-outline mt-0.5">Valeurs indicatives.</p>';
    }

    // Solid fallback tile colors (used only when a product has no photo —
    // rare in practice since every product now has one). Flat, not
    // gradients, for a more minimal look.
    var CATEGORY_STYLE = {
        'Cafés': { gradient: '#3f2415' },
        'Croissants': { gradient: '#c98a5e' },
        'Sodas': { gradient: '#d97b4a' },
        'Mojitos': { gradient: '#4d7a52' },
        'Jus': { gradient: '#dd9f4e' },
        'Smoothies': { gradient: '#a85c86' },
        'Sandwichs': { gradient: '#8a6a3f' },
        'Desserts': { gradient: '#4b2f1f' },
        'Petit-déjeuner': { gradient: '#b98a5e' },
        // Menu Kebab : ambiance grill (lueur de braise montant du bas, teinte propre à chaque catégorie).
        'Paninis et piadines': { gradient: 'radial-gradient(circle at 50% 120%, #fb923c 0%, #c2410c 26%, #4a1d0b 56%, #1c120d 86%)' },
        'Assiettes kebab': { gradient: 'radial-gradient(circle at 50% 120%, #fbbf24 0%, #d97706 24%, #4a260b 56%, #1c140d 86%)' },
        'Menus kebab': { gradient: 'radial-gradient(circle at 50% 120%, #f87171 0%, #dc2626 24%, #4a130e 56%, #1c110e 86%)' },
        'Alternatives': { gradient: 'radial-gradient(circle at 50% 120%, #a3e635 0%, #4d7c0f 26%, #1f2e0d 58%, #121a0c 88%)' },
        'Accompagnements': { gradient: 'radial-gradient(circle at 50% 120%, #fde047 0%, #eab308 22%, #4d3a0b 56%, #1c160d 86%)' },
        'Sauces et suppléments': { gradient: 'radial-gradient(circle at 50% 120%, #fdba74 0%, #ea580c 24%, #4a1f0b 56%, #1c120d 86%)' },
        'default': { gradient: '#4b2f1f' }
    };

    // Service des cafés : tasse en verre (sur place) ou gobelet carton (à emporter).
    // Libellés identiques au groupe SQL « Service » (migration 016).
    var SERVICE_CHOICES = [
        { label: 'Tasse en verre (sur place)', icon: 'sc_glass_cup', hint: 'Sur place' },
        { label: 'Gobelet à emporter', icon: 'sc_takeaway_cup', hint: 'À emporter' }
    ];
    var SERVICE_META = { 'Tasse en verre (sur place)': SERVICE_CHOICES[0], 'Gobelet à emporter': SERVICE_CHOICES[1] };

    var DRINK_EXTRAS = [
        { label: "Lait d'avoine", price: 0.800 },
        { label: 'Extra shot', price: 0.700 },
        { label: 'Sirop vanille', price: 0.500 },
        { label: 'Chantilly', price: 0.600 }
    ];
    var DRINK_SIZES = [
        { label: 'S', delta: -0.500 },
        { label: 'M', delta: 0 },
        { label: 'L', delta: 0.800 }
    ];
    var FOOD_EXTRAS_DEFAULT = [
        { label: 'À emporter', price: 0 },
        { label: 'Portion généreuse', price: 0.600 }
    ];

    // Visual level pickers (Sans/Peu/Normal/Beaucoup) for how much milk, sugar or
    // ice goes in a drink — no reading required, just tap how full the row looks.
    // Free by default: this is about taste preference, not an upsell.
    var STEPS_4 = ['Sans', 'Peu', 'Normal', 'Beaucoup'];
    var LEVEL_MILK = { key: 'milk', label: 'Lait', icon: 'glass_cup', steps: STEPS_4 };
    var LEVEL_SUGAR = { key: 'sugar', label: 'Sucre', icon: 'grain', steps: STEPS_4 };
    var LEVEL_ICE = { key: 'ice', label: 'Glace', icon: 'ac_unit', steps: STEPS_4 };

    var CATEGORY_OPTIONS = {
        'Cafés': { service: SERVICE_CHOICES, sizes: DRINK_SIZES, levels: [LEVEL_MILK, LEVEL_SUGAR], extras: DRINK_EXTRAS },
        'Sodas': { sizes: [{ label: 'M', delta: 0 }, { label: 'L', delta: 1.000 }], levels: [LEVEL_ICE, LEVEL_SUGAR], extras: [] },
        'Mojitos': { sizes: [{ label: 'M', delta: 0 }, { label: 'L', delta: 1.000 }], levels: [LEVEL_ICE, LEVEL_SUGAR], extras: [{ label: 'Menthe fraîche +', price: 0.300 }] },
        'Jus': { sizes: [{ label: 'M', delta: 0 }, { label: 'L', delta: 1.000 }], levels: [LEVEL_SUGAR], extras: [] },
        'Smoothies': { sizes: [{ label: 'M', delta: 0 }, { label: 'L', delta: 1.000 }], levels: [LEVEL_SUGAR], extras: [{ label: 'Graines de chia +', price: 0.500 }] },
        'Croissants': { sizes: null, extras: [{ label: 'Servi chaud', price: 0 }, { label: 'Beurre supplémentaire', price: 0.300 }] },
        'Sandwichs': { sizes: null, extras: [{ label: 'Sans oignon', price: 0 }, { label: 'Pain sans gluten', price: 0.500 }] },
        'Desserts': { sizes: null, extras: [{ label: 'Coulis chocolat', price: 0.400 }].concat(FOOD_EXTRAS_DEFAULT) }
    };

    function getProductById(id) {
        for (var i = 0; i < PRODUCTS.length; i++) {
            if (PRODUCTS[i].id === id) return PRODUCTS[i];
        }
        return null;
    }

    // Admin-side overrides (price / rupture de stock), layered on top of the
    // static catalog above rather than mutating it. Same localStorage pattern
    // as js/cart.js's Cart/Favorites.
    var OVERRIDES_KEY = 'soucoffe_product_overrides';

    function readOverrides() {
        try {
            var raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY));
            return raw && typeof raw === 'object' ? raw : {};
        } catch (e) {
            return {};
        }
    }

    function writeOverrides(map) {
        try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map)); } catch (e) { /* fail silently */ }
    }

    var ProductOverrides = {
        get: function (id) {
            return readOverrides()[id] || {};
        },
        set: function (id, patch) {
            var map = readOverrides();
            map[id] = Object.assign({}, map[id] || {}, patch);
            writeOverrides(map);
            return map[id];
        },
        all: function () {
            return readOverrides();
        }
    };

    // Prix et disponibilité viennent de la BASE (API) : modifiés par le personnel
    // habilité (permissions products.price / products.availability), jamais par
    // une surcharge locale au navigateur. Seuls l image et la mise en avant
    // restent des réglages d affichage locaux (ProductOverrides).
    function getEffectivePrice(product) {
        return product.price;
    }

    function isProductAvailable(product) {
        return product.available !== false;
    }

    function getEffectiveImage(product) {
        var override = ProductOverrides.get(product.id);
        return (override.img && String(override.img).trim()) ? override.img : product.img;
    }

    function getEffectiveTags(product) {
        var override = ProductOverrides.get(product.id);
        var tags = Array.isArray(override.tags) ? override.tags : (product.tags || []);
        // Best-seller réel (js/recommendations.js, calculé depuis l'historique
        // de commandes) vient s'ajouter au tag "popular" existant. Gardé par
        // l'existence de window.SoucoffeSalesSignal : sans ce script chargé,
        // ou avec 0 commande, comportement strictement identique à avant.
        if (window.SoucoffeSalesSignal && window.SoucoffeSalesSignal[product.id] && tags.indexOf('popular') === -1) {
            tags = tags.concat('popular');
        }
        return tags;
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function badgeHtml(tags) {
        if (tags && tags.indexOf('popular') !== -1) {
            return '<span class="sc-badge sc-badge-popular absolute top-4 left-4">' + window.iconHtml('local_fire_department') + ' Populaire</span>';
        }
        if (tags && tags.indexOf('new') !== -1) {
            return '<span class="sc-badge sc-badge-new absolute top-4 left-4">' + window.iconHtml('auto_awesome') + ' Nouveau</span>';
        }
        return '';
    }

    function renderProductCard(product, index) {
        var style = CATEGORY_STYLE[product.category] || CATEGORY_STYLE['default'];
        var favActive = window.Favorites ? Favorites.has(product.id) : false;
        var delay = Math.min(index || 0, 10) * 40;
        var price = getEffectivePrice(product);
        var img = getEffectiveImage(product);
        var tileInner = img
            ? '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(product.name) + '" class="w-full h-full object-cover"/>'
            : '<span class="sc-tile-emoji text-5xl">' + productIconHtml(product) + '</span>';
        var tileStyle = img ? '' : ' style="background:' + style.gradient + '"';
        var priceParts = price.toFixed(2).split('.');
        var open = 'openProductModal(\'' + product.id + '\')';
        // Carte produit (style : .sc-pcard dans css/soucoffe.css). Contrats
        // conservés : .menu-card, data-category/data-name, .fav-btn[data-fav-name],
        // bouton d'ajout [data-icon-only] lu par addToCartFromButton().
        return '' +
            '<article data-category="' + escapeHtml(product.category) + '" data-name="' + escapeHtml(product.name) + '" data-product-id="' + escapeHtml(product.id) + '" style="animation-delay:' + delay + 'ms" class="menu-card sc-pcard sc-card-enter bg-surface-container-lowest flex flex-col group">' +
            '<div class="sc-pcard-media relative">' +
            '<div onclick="' + open + '" role="button" tabindex="0" aria-label="Voir ' + escapeHtml(product.name) + '" onkeydown="if(event.key===\'Enter\')' + open + '" class="sc-tile-shine w-full h-full flex items-center justify-center cursor-pointer select-none"' + tileStyle + '>' + tileInner + '</div>' +
            '<button type="button" onclick="toggleFavorite(this)" data-fav-name="' + product.id + '" aria-label="' + (favActive ? 'Retirer des favoris' : 'Ajouter aux favoris') + '" class="fav-btn absolute text-on-surface-variant hover:text-error rounded-full' + (favActive ? ' is-fav' : '') + '">' +
            '<span class="material-symbols-outlined" data-icon="favorite" style="font-variation-settings: \'FILL\' ' + (favActive ? 1 : 0) + ';">favorite</span></button>' +
            badgeHtml(getEffectiveTags(product)) +
            '<span class="sc-pcard-incart" data-incart hidden></span>' +
            '</div>' +
            '<div class="sc-pcard-body flex-grow flex flex-col">' +
            '<div onclick="' + open + '" class="cursor-pointer">' +
            '<p class="sc-pcard-cat">' + escapeHtml(product.category || '') + '</p>' +
            '<h3 class="sc-pcard-title">' + escapeHtml(product.name) + '</h3>' +
            '<p class="sc-pcard-desc line-clamp-2">' + escapeHtml(product.desc) + '</p>' +
            '</div>' +
            '<div class="sc-pcard-foot mt-auto">' +
            '<span class="sc-pcard-price">' + (optionsFor(product).groups ? '<small class="sc-from">dès</small>' : '') + '<b>' + priceParts[0] + '</b><i>,' + priceParts[1] + '</i><small>€</small></span>' +
            '<button type="button" onclick="addToCartFromButton(this)" data-icon-only="" aria-label="Ajouter ' + escapeHtml(product.name) + ' au panier" data-id="' + product.id + '"' + (typeof product.apiId === 'number' ? ' data-api-id="' + product.apiId + '"' : '') + ' data-name="' + escapeHtml(product.name) + '" data-price="' + price + '" class="sc-pcard-add">' +
            '<span class="material-symbols-outlined">add</span><span class="sc-pcard-add-label">Ajouter</span></button>' +
            '</div></div></article>';
    }

    // Pastille « × N au panier » sur les cartes produit : relue à chaque
    // changement du panier (Cart.updateBadges) et après chaque rendu de grille.
    function refreshInCartMarks() {
        // Grilles pré-remplies de cartes squelette (HTML des pages) : plus
        // « occupées » dès que le vrai rendu les a remplacées.
        document.querySelectorAll('[aria-busy="true"]').forEach(function (g) {
            if (!g.querySelector('.sc-skel')) g.removeAttribute('aria-busy');
        });
        if (!window.Cart || !Cart.get) return;
        var qtyById = {};
        Cart.get().forEach(function (item) {
            var pid = String(item.id || '').split('|')[0];
            qtyById[pid] = (qtyById[pid] || 0) + (item.qty || 0);
        });
        document.querySelectorAll('.sc-pcard[data-product-id]').forEach(function (card) {
            var mark = card.querySelector('[data-incart]');
            if (!mark) return;
            var q = qtyById[card.getAttribute('data-product-id')] || 0;
            var label = q ? '× ' + q + ' au panier' : '';
            // N'écrit que si ça change : l'observateur ci-dessous ne doit pas
            // se redéclencher lui-même en boucle.
            if (mark.textContent !== label) mark.textContent = label;
            if (mark.hidden !== (q === 0)) mark.hidden = q === 0;
            card.classList.toggle('is-in-cart', q > 0);
        });
    }
    window.refreshInCartMarks = refreshInCartMarks;
    if (window.MutationObserver) {
        document.addEventListener('DOMContentLoaded', function () {
            var pending = false;
            new MutationObserver(function () {
                if (pending) return;
                pending = true;
                requestAnimationFrame(function () { pending = false; refreshInCartMarks(); });
            }).observe(document.body, { childList: true, subtree: true });
        });
    }

    // ---- Product detail modal (shared markup id contract: #product-modal, #modal-emoji-tile,
    // #modal-name, #modal-desc, #modal-sizes, #modal-extras, #modal-qty, #modal-total-price) ----
    var modalState = { product: null, size: null, levels: {}, extras: [], qty: 1 };
    var modalHideTimeout = null;

    function renderModalLevels() {
        var levelsEl = document.getElementById('modal-levels');
        if (!levelsEl) return;
        var opts = optionsFor(modalState.product);
        if (!opts.levels || !opts.levels.length) { levelsEl.innerHTML = ''; return; }
        levelsEl.innerHTML = opts.levels.map(function (lvl) {
            var current = modalState.levels[lvl.key] || 0;
            var stepButtons = lvl.steps.map(function (step, i) {
                // Local fallback : step est une simple chaîne. Catalogue API
                // (Phase 4) : step est {label, optionId}. On affiche pareil
                // dans les deux cas ; seul confirmModalAdd() lit optionId.
                var stepLabel = (step && typeof step === 'object') ? step.label : step;
                var dots = '<span class="flex items-center gap-0.5 text-[9px] leading-none">' + window.iconHtml('circle', '', true).repeat(i + 1) + window.iconHtml('circle').repeat(lvl.steps.length - i - 1) + '</span>';
                var active = i === current;
                return '<button type="button" onclick="modalSelectLevel(\'' + lvl.key + '\', ' + i + ')" class="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border transition-colors ' +
                    (active ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant text-on-surface hover:border-primary') +
                    '">' + dots + '<span class="text-[10px] font-label-md">' + stepLabel + '</span></button>';
            }).join('');
            return '<div class="mb-3">' +
                '<div class="font-label-md text-label-md text-on-surface-variant mb-2">' + (window.iconHtml ? window.iconHtml(lvl.icon) : '') + ' ' + lvl.label + '</div>' +
                '<div class="flex gap-2">' + stepButtons + '</div></div>';
        }).join('');
    }

    // Vidéos produit (dossier videos/) : remplacent la photo dans la fiche.
    var PRODUCT_VIDEOS = { 'cafe-glace-caramel': '../videos/iced-coffee.mp4' };
    window.SOUCOFFE_PRODUCT_VIDEOS = PRODUCT_VIDEOS;

    // Choix du service (cafés) : deux grandes cartes illustrées, avant la taille.
    // Le conteneur est créé à la volée : aucune page n'a besoin d'être modifiée.
    function renderModalService() {
        var sizesEl = document.getElementById('modal-sizes');
        if (!sizesEl) return;
        var el = document.getElementById('modal-service');
        if (!el) {
            el = document.createElement('div');
            el.id = 'modal-service';
            sizesEl.parentNode.insertBefore(el, sizesEl);
        }
        var opts = optionsFor(modalState.product);
        if (!opts.service || !opts.service.length) { el.innerHTML = ''; el.className = ''; return; }
        el.className = 'mb-4';
        el.innerHTML = '<div class="font-label-md text-label-md text-on-surface-variant mb-2">Comment souhaitez-vous votre café ?</div>' +
            '<div class="sc-service" role="radiogroup" aria-label="Service du café">' +
            opts.service.map(function (o) {
                var active = o.label === modalState.service;
                var takeaway = o.label === 'Gobelet à emporter';
                return '<button type="button" role="radio" aria-checked="' + active + '" onclick="modalSelectService(\'' + o.label.replace(/'/g, "\\'") + '\')" class="sc-service-opt' + (active ? ' is-active' : '') + '">' +
                    '<span class="sc-service-icon">' + window.iconHtml(o.icon || (takeaway ? 'sc_takeaway_cup' : 'sc_glass_cup')) + '</span>' +
                    '<span class="sc-service-text"><strong>' + (takeaway ? 'Gobelet à emporter' : 'Tasse en verre') + '</strong><small>' + (takeaway ? 'Carton recyclable, à emporter' : 'Servi à votre table') + '</small></span>' +
                    '<span class="sc-service-check" aria-hidden="true"></span></button>';
            }).join('') + '</div>';
    }
    window.modalSelectService = function (label) {
        modalState.service = label;
        renderModalService();
    };

    // ---- Composition par rubriques (petit-déjeuner à composer) ----
    function fmtDelta(p) { return p ? '+' + p.toFixed(2).replace('.', ',') + ' €' : 'Inclus'; }
    function groupRule(g) {
        if (g.required && !g.multiple) return 'Obligatoire · 1 choix';
        if (!g.multiple) return 'Facultatif · 1 choix';
        return g.max ? 'Au choix · jusqu’à ' + g.max : 'Au choix';
    }
    function missingGroups() {
        var opts = optionsFor(modalState.product);
        return (opts.groups || []).filter(function (g, gi) {
            var n = (modalState.groups[gi] || []).length;
            return (g.required && n < Math.max(1, g.min || 0)) || n < (g.min || 0);
        }).map(function (g) { return g.name; });
    }
    function renderModalGroups() {
        var anchor = document.getElementById('modal-extras');
        if (!anchor) return;
        var el = document.getElementById('modal-groups');
        if (!el) {
            el = document.createElement('div');
            el.id = 'modal-groups';
            anchor.parentNode.insertBefore(el, anchor);
        }
        var opts = optionsFor(modalState.product);
        if (!opts.groups || !opts.groups.length) { el.innerHTML = ''; el.className = ''; return; }
        el.className = 'sc-builder';
        var picked = [];
        var html = opts.groups.map(function (g, gi) {
            var sel = modalState.groups[gi] || [];
            sel.forEach(function (oi) { picked.push(g.options[oi].label); });
            var full = g.multiple && g.max && sel.length >= g.max;
            return '<section class="sc-bgroup' + (g.required && !sel.length ? ' is-missing' : '') + '" aria-label="' + escapeHtml(g.name) + '">' +
                '<div class="sc-bgroup-head"><strong>' + escapeHtml(g.name) + '</strong><span class="sc-bgroup-rule">' + groupRule(g) + '</span>' +
                (g.multiple && g.max ? '<span class="sc-bgroup-count">' + sel.length + '/' + g.max + '</span>' : '') + '</div>' +
                '<div class="sc-bchoices" role="' + (g.multiple ? 'group' : 'radiogroup') + '">' +
                g.options.map(function (o, oi) {
                    var on = sel.indexOf(oi) !== -1;
                    var disabled = !on && full;
                    return '<button type="button" role="' + (g.multiple ? 'checkbox' : 'radio') + '" aria-checked="' + on + '"' + (disabled ? ' aria-disabled="true"' : '') +
                        ' onclick="modalPickGroupOption(' + gi + ',' + oi + ')" class="sc-bchoice' + (on ? ' is-on' : '') + (disabled ? ' is-full' : '') + (g.multiple ? ' is-multi' : '') + '">' +
                        '<span class="sc-bchoice-mark" aria-hidden="true"></span><span class="sc-bchoice-label">' + escapeHtml(o.label) + '</span>' +
                        '<span class="sc-bchoice-price">' + fmtDelta(o.price) + '</span></button>';
                }).join('') + '</div></section>';
        }).join('');
        // « Pain frais et beurre » : inclus uniquement dans le petit-déjeuner à composer.
        var builder = modalState.product && modalState.product.id === 'petit-dejeuner-compose';
        html += '<div class="sc-bsummary" aria-live="polite"><strong>' + (builder ? 'Votre composition' : 'Votre choix') + '</strong><span>' +
            (builder ? 'Pain frais et beurre' + (picked.length ? ' · ' : '') : '') + (picked.length ? picked.map(escapeHtml).join(' · ') : (builder ? '' : 'À vous de choisir')) + '</span></div>';
        el.innerHTML = html;
    }
    window.modalPickGroupOption = function (gi, oi) {
        var g = (optionsFor(modalState.product).groups || [])[gi];
        if (!g) return;
        var sel = (modalState.groups[gi] || []).slice();
        var at = sel.indexOf(oi);
        if (!g.multiple) {
            sel = (at !== -1 && !g.required) ? [] : [oi]; // radio : un obligatoire ne se vide pas
        } else if (at !== -1) {
            sel.splice(at, 1);
        } else if (g.max && sel.length >= g.max) {
            if (window.showToast) window.showToast(g.name + ' : ' + g.max + ' choix maximum');
            return;
        } else {
            sel.push(oi);
        }
        modalState.groups[gi] = sel;
        renderModalGroups();
        updateModalPrice();
    };

    function renderModalSizes() {
        var sizesEl = document.getElementById('modal-sizes');
        if (!sizesEl) return;
        var opts = optionsFor(modalState.product);
        if (!opts.sizes) { sizesEl.innerHTML = ''; return; }
        sizesEl.innerHTML = '<div class="font-label-md text-label-md text-on-surface-variant mb-2">Taille</div><div class="flex gap-2">' +
            opts.sizes.map(function (s) {
                var active = s.label === modalState.size;
                return '<button type="button" onclick="modalSelectSize(\'' + s.label + '\')" class="flex-1 py-2 rounded-lg border text-sm font-label-md transition-colors ' +
                    (active ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant text-on-surface hover:border-primary') +
                    '">' + s.label + '</button>';
            }).join('') + '</div>';
    }

    function renderModalExtras() {
        var extrasEl = document.getElementById('modal-extras');
        if (!extrasEl) return;
        var opts = optionsFor(modalState.product);
        if (!opts.extras || !opts.extras.length) { extrasEl.innerHTML = ''; return; }
        extrasEl.innerHTML = '<div class="font-label-md text-label-md text-on-surface-variant mb-2">Extras</div><div class="flex flex-col gap-2">' +
            opts.extras.map(function (e, i) {
                var checked = modalState.extras.indexOf(i) !== -1;
                return '<label class="flex items-center justify-between p-2 rounded-lg border border-outline-variant cursor-pointer">' +
                    '<span class="flex items-center gap-2 font-body-md text-sm text-on-surface"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="modalToggleExtra(' + i + ')" class="accent-primary w-4 h-4"/>' + escapeHtml(e.label) + '</span>' +
                    '<span class="text-xs text-on-surface-variant">' + (e.price ? '+' + e.price.toFixed(2).replace('.', ',') + ' €' : '') + '</span></label>';
            }).join('') + '</div>';
    }

    function updateModalPrice() {
        var p = modalState.product;
        var opts = optionsFor(p);
        var unit = getEffectivePrice(p);
        if (opts.sizes) {
            var sizeObj = opts.sizes.filter(function (s) { return s.label === modalState.size; })[0];
            if (sizeObj) unit += sizeObj.delta;
        }
        if (opts.extras) {
            modalState.extras.forEach(function (i) { unit += opts.extras[i].price || 0; });
        }
        (opts.groups || []).forEach(function (g, gi) {
            (modalState.groups && modalState.groups[gi] || []).forEach(function (oi) { unit += g.options[oi].price || 0; });
        });
        var total = unit * modalState.qty;
        var totalEl = document.getElementById('modal-total-price');
        if (totalEl) totalEl.textContent = total.toFixed(2).replace('.', ',') + ' €';
        var addBtn = document.getElementById('modal-add-btn');
        if (addBtn) {
            var missing = opts.groups ? missingGroups() : [];
            addBtn.disabled = missing.length > 0;
            addBtn.title = missing.length ? 'À choisir : ' + missing.join(', ') : '';
        }
        return { unit: unit, total: total };
    }

    // Shared favorite-heart toggle: any page using renderProductCard() gets this
    // for free (the card markup wires onclick="toggleFavorite(this)"). Pages that
    // need to react (e.g. re-render a "favorites only" view when one is removed)
    // can set window.onFavoriteToggled = function (id, active) { ... }.
    window.toggleFavorite = function (btn) {
        var id = btn.getAttribute('data-fav-name');
        if (!id) return;
        var active = Favorites.toggle(id);
        btn.classList.toggle('is-fav', active);
        btn.setAttribute('aria-label', active ? 'Retirer des favoris' : 'Ajouter aux favoris');
        var icon = btn.querySelector('.material-symbols-outlined, svg');
        if (icon) {
            if (icon.tagName === 'SPAN') {
                icon.setAttribute('style', "font-variation-settings: 'FILL' " + (active ? 1 : 0) + ";");
            } else if (!window.setIconFilled || !window.setIconFilled(icon, active)) {
                // Repli si l'icône réelle (js/icons.js) n'est pas disponible.
                icon.setAttribute('fill', active ? 'currentColor' : 'none');
                icon.setAttribute('stroke-width', active ? '1.4' : '1.75');
            }
            if (active) {
                icon.classList.remove('sc-fav-pop');
                void icon.offsetWidth;
                icon.classList.add('sc-fav-pop');
            }
        }
        if (typeof window.onFavoriteToggled === 'function') window.onFavoriteToggled(id, active);
    };

    // ---- Phase 2 : chargement du catalogue depuis l'API PHP/MariaDB, avec
    // repli automatique et robuste sur le tableau PRODUCTS local ci-dessus.
    // PRODUCTS/CATEGORY_OPTIONS restent déclarés en dur : ce sont le
    // fallback. window.loadCatalog(), si l'API répond correctement,
    // remplace leur CONTENU en place (même référence d'objet/tableau, donc
    // aucune autre page/fichier n'a besoin d'être modifié pour en profiter).
    var API_BASE = window.SOUCOFFE_API_BASE || 'http://localhost:8000/api';
    var API_TIMEOUT_MS = 6000;
    var catalogLoadPromise = null;
    window.SOUCOFFE_CATALOG_SOURCE = 'local';

    function fetchWithTimeout(url, timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        return fetch(url, { signal: controller.signal }).finally(function () { clearTimeout(timer); });
    }

    function isValidApiCategoryList(list) {
        if (!Array.isArray(list) || list.length === 0) return false;
        return list.every(function (c) {
            return c && typeof c.id === 'number' && typeof c.name === 'string' && c.name;
        });
    }

    function isValidApiProductList(list) {
        if (!Array.isArray(list) || list.length === 0) return false;
        return list.every(function (p) {
            return p && typeof p.slug === 'string' && p.slug &&
                typeof p.name === 'string' && p.name &&
                typeof p.categoryId === 'number' &&
                typeof p.basePrice === 'number' &&
                Array.isArray(p.optionGroups);
        });
    }

    // Métadonnées purement visuelles (icône/clé) que le schéma SQL Phase 1 ne
    // stocke pas volontairement (voir rapport Phase 1, "problèmes restants").
    var LEVEL_META = {
        'Lait': { key: 'milk', icon: 'glass_cup' },
        'Sucre': { key: 'sugar', icon: 'grain' },
        'Glace': { key: 'ice', icon: 'ac_unit' }
    };

    // Phase 4 (§ suivi optionId) : chaque entrée porte désormais aussi le
    // véritable optionId numérique SQL (en plus du label déjà utilisé pour
    // l'affichage), afin que confirmModalAdd() puisse transmettre à
    // POST /api/orders des optionId réels plutôt qu'un simple libellé. Champ
    // additif uniquement : les consommateurs existants qui ne lisent que
    // .label/.price/.delta continuent de fonctionner à l'identique.
    // Options d'UN produit : les siennes (catalogue API, groupes réellement liés
    // à ce produit en SQL), sinon celles de sa catégorie (catalogue local).
    // Ex. : le Café Turc n'a que Service + Sucre, pas de taille ni de lait.
    function optionsFor(p) {
        return (p && p.options) || (p && CATEGORY_OPTIONS[p.category]) || {};
    }
    window.productOptionsFor = optionsFor;

    function mapApiOptionGroupsToCategoryOptions(apiGroups) {
        var sizes = null, levels = [], extras = [], service = null, groups = [];
        apiGroups.forEach(function (g) {
            if (g.name === 'Service') {
                service = g.options.map(function (o) {
                    var meta = SERVICE_META[o.label] || { icon: 'coffee', hint: '' };
                    return { label: o.label, optionId: o.id, icon: meta.icon, hint: meta.hint };
                });
            } else if (g.name === 'Taille') {
                sizes = g.options.map(function (o) { return { label: o.label, delta: o.priceDelta, optionId: o.id }; });
            } else if (LEVEL_META[g.name]) {
                var meta = LEVEL_META[g.name];
                levels.push({
                    key: meta.key, label: g.name, icon: meta.icon,
                    steps: g.options.map(function (o) { return { label: o.label, optionId: o.id }; })
                });
            } else if (g.name === 'Extras') {
                extras = extras.concat(g.options.map(function (o) {
                    return { label: o.label, price: o.priceDelta, optionId: o.id };
                }));
            } else {
                // Rubrique de composition (ex. petit-déjeuner à composer) : règles SQL conservées.
                groups.push({
                    name: g.name, multiple: g.selectionType === 'MULTIPLE', required: !!g.isRequired,
                    min: g.minSelect || 0, max: g.maxSelect == null ? null : g.maxSelect,
                    options: g.options.map(function (o) { return { label: o.label, price: o.priceDelta, optionId: o.id }; })
                });
            }
        });
        var out = { sizes: sizes, levels: levels, extras: extras };
        if (service) out.service = service;
        if (groups.length) out.groups = groups;
        return out;
    }

    // Ne déclenche qu'un seul appel réseau par page, réutilisé pour tout
    // appel ultérieur (§17 — éviter les appels API répétés).
    window.loadCatalog = function (force) {
        // force = true : ignore le résultat en cache (ex. nouvel essai après
        // un chargement resté en repli local parce que l'API était coupée).
        if (force) catalogLoadPromise = null;
        if (catalogLoadPromise) return catalogLoadPromise;

        catalogLoadPromise = Promise.all([
            fetchWithTimeout(API_BASE + '/categories', API_TIMEOUT_MS),
            fetchWithTimeout(API_BASE + '/products?limit=100', API_TIMEOUT_MS)
        ]).then(function (responses) {
            var catRes = responses[0], prodRes = responses[1];
            if (!catRes.ok || !prodRes.ok) {
                throw new Error('HTTP ' + catRes.status + '/' + prodRes.status);
            }
            return Promise.all([catRes.json(), prodRes.json()]);
        }).then(function (results) {
            // Plus de 100 produits (limite de l'API par page) : pages suivantes chargées aussi.
            var first = results[1];
            var pages = first && first.totalElements > 100 ? Math.ceil(first.totalElements / 100) : 1;
            if (pages <= 1 || !first || !Array.isArray(first.content)) return results;
            var more = [];
            for (var pg = 1; pg < pages; pg++) {
                more.push(fetchWithTimeout(API_BASE + '/products?limit=100&page=' + pg, API_TIMEOUT_MS).then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                }));
            }
            return Promise.all(more).then(function (rest) {
                rest.forEach(function (p) { first.content = first.content.concat(p.content || []); });
                return results;
            });
        }).then(function (results) {
            var categoriesApi = results[0];
            var productsPage = results[1];
            var productsApi = productsPage && productsPage.content;

            if (!isValidApiCategoryList(categoriesApi) || !isValidApiProductList(productsApi)) {
                throw new Error('Structure de catalogue API invalide');
            }

            var categoryNameById = {};
            var menuByCategoryId = {};
            categoriesApi.forEach(function (c) { categoryNameById[c.id] = c.name; menuByCategoryId[c.id] = c.menuSlug || 'cafe'; });
            // Catégories et menus partagés (boutons de catégories, pages de menu, section Kebab de l'accueil).
            window.SOUCOFFE_CATEGORIES = categoriesApi;

            var mappedProducts = [];
            var optionsByCategory = {};
            productsApi.forEach(function (p) {
                var categoryName = categoryNameById[p.categoryId];
                if (!categoryName) return; // produit orphelin : ignoré plutôt que de casser tout le catalogue
                mappedProducts.push({
                    id: p.slug, // même identifiant que celui déjà utilisé partout (panier, favoris, overrides)
                    apiId: p.id, // id numérique SQL réel — nécessaire pour POST /api/orders (Phase 4)
                    img: p.imageUrl || '',
                    // Galerie : photos supplémentaires (admin, migration 024), après la photo principale.
                    images: Array.isArray(p.images) ? p.images : [],
                    name: p.name,
                    category: categoryName,
                    menu: menuByCategoryId[p.categoryId] || 'cafe',
                    price: p.basePrice,
                    desc: p.description || '',
                    icon: LOCAL_ICON_BY_ID[p.slug] || CATEGORY_ICON[categoryName] || (menuByCategoryId[p.categoryId] === 'kebab' ? 'kebab_dining' : (menuByCategoryId[p.categoryId] && menuByCategoryId[p.categoryId] !== 'cafe' ? 'restaurant_menu' : 'coffee')),
                    tags: (p.badge === 'popular' || p.badge === 'new') ? [p.badge] : [], // étiquette choisie dans l'admin (migration 025)
                    available: p.available !== false,
                    allergens: Array.isArray(p.allergens) ? p.allergens : undefined,
                    calories: typeof p.calories === 'number' ? p.calories : undefined,
                    dietaryTags: Array.isArray(p.dietaryTags) ? p.dietaryTags : [],
                    // Groupes d'options SQL bruts de CE produit (required/min/max) :
                    // servent uniquement à la validation UX avant POST /api/orders
                    // (Cart.validateItem) — le serveur reste l'autorité.
                    apiOptionGroups: p.optionGroups,
                    options: mapApiOptionGroupsToCategoryOptions(p.optionGroups || [])
                });
                if (!optionsByCategory[categoryName]) {
                    optionsByCategory[categoryName] = mapApiOptionGroupsToCategoryOptions(p.optionGroups);
                }
            });

            if (!mappedProducts.length) throw new Error('Catalogue API vide après mapping');

            // Remplacement EN PLACE (mêmes références que window.PRODUCTS /
            // window.CATEGORY_OPTIONS déjà partagées avec tout le reste du site).
            PRODUCTS.splice.apply(PRODUCTS, [0, PRODUCTS.length].concat(mappedProducts));
            Object.keys(CATEGORY_OPTIONS).forEach(function (k) { delete CATEGORY_OPTIONS[k]; });
            Object.keys(optionsByCategory).forEach(function (k) { CATEGORY_OPTIONS[k] = optionsByCategory[k]; });

            window.SOUCOFFE_CATALOG_SOURCE = 'api';
            console.info('[SOUCOFFE] Catalogue chargé depuis l\'API (' + mappedProducts.length + ' produits).');
            return 'api';
        }).catch(function (err) {
            window.SOUCOFFE_CATALOG_SOURCE = 'local';
            console.info('[SOUCOFFE] API indisponible, catalogue local conservé (' + err.message + ').');
            return 'local';
        });

        return catalogLoadPromise;
    };

    // ---- Recherche/tri partagés (Menu + Cafés) : logique unique, tolérante
    // aux accents/fautes de frappe. Reprend exactement le comportement
    // existant pour une saisie correcte (indexOf sur le nom, mêmes 4 tris) et
    // n'ajoute que le filtre prix + la tolérance aux fautes en plus.
    function normalizeSearchText(str) {
        return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        var prev = [];
        for (var j = 0; j <= b.length; j++) prev[j] = j;
        for (var i = 1; i <= a.length; i++) {
            var curr = [i];
            for (var k = 1; k <= b.length; k++) {
                var cost = a[i - 1] === b[k - 1] ? 0 : 1;
                curr[k] = Math.min(prev[k] + 1, curr[k - 1] + 1, prev[k - 1] + cost);
            }
            prev = curr;
        }
        return prev[b.length];
    }

    function fuzzyMatch(nameNormalized, termNormalized) {
        if (!termNormalized) return true;
        if (nameNormalized.indexOf(termNormalized) !== -1) return true;
        if (termNormalized.length < 3) return false;
        var maxDistance = termNormalized.length > 6 ? 2 : 1;
        return nameNormalized.split(/\s+/).some(function (word) {
            return levenshtein(word, termNormalized) <= maxDistance;
        });
    }

    function filterAndSortProducts(products, opts) {
        opts = opts || {};
        var termNormalized = normalizeSearchText(opts.searchTerm || '');
        // Menu (carte) : par défaut le menu Café, pour que les pages et suggestions existantes
        // restent inchangées ; menu: 'kebab' (ou autre) pour sa page ; menu: 'all' = tout.
        // Les favoris rassemblent tous les menus.
        var menu = opts.favoritesOnly ? 'all' : (opts.menu || 'cafe');
        var list = products.filter(function (p) {
            if (menu !== 'all' && (p.menu || 'cafe') !== menu) return false;
            var matchesCategory = !opts.category || opts.category === 'All' ||
                (Array.isArray(opts.category) ? opts.category.indexOf(p.category) !== -1 : p.category === opts.category);
            var matchesSearch = fuzzyMatch(normalizeSearchText(p.name), termNormalized);
            var matchesFavorites = !opts.favoritesOnly || (window.Favorites && Favorites.has(p.id));
            var price = getEffectivePrice(p);
            var matchesMin = opts.minPrice == null || price >= opts.minPrice;
            var matchesMax = opts.maxPrice == null || price <= opts.maxPrice;
            var matchesDiet = !opts.dietaryTag || (Array.isArray(p.dietaryTags) && p.dietaryTags.indexOf(opts.dietaryTag) !== -1);
            return matchesCategory && matchesSearch && matchesFavorites && matchesMin && matchesMax && matchesDiet && isProductAvailable(p);
        });
        list = list.slice();
        function hasTag(p, tag) {
            var tags = getEffectiveTags(p);
            return tags && tags.indexOf(tag) !== -1 ? 1 : 0;
        }
        if (opts.sortBy === 'price-asc') {
            list.sort(function (a, b) { return getEffectivePrice(a) - getEffectivePrice(b); });
        } else if (opts.sortBy === 'price-desc') {
            list.sort(function (a, b) { return getEffectivePrice(b) - getEffectivePrice(a); });
        } else if (opts.sortBy === 'new') {
            list.sort(function (a, b) { return hasTag(b, 'new') - hasTag(a, 'new'); });
        } else {
            list.sort(function (a, b) { return hasTag(b, 'popular') - hasTag(a, 'popular'); });
        }
        return list;
    }

    window.filterAndSortProducts = filterAndSortProducts;

    // ---- Menus (cartes : Café, Kebab, …) — migration 023 ----
    // Page d'un menu : le menu Café garde sa page historique ; les autres ont la page commune menu/.
    window.scMenuUrl = function (slug) {
        return !slug || slug === 'cafe' ? '../02-Menu-Principal/code.html' : '../menu/index.html?m=' + encodeURIComponent(slug);
    };

    // Fiche d'un produit sur la page de SON menu (menu café : adresse historique inchangée).
    window.scProductUrl = function (p) {
        var base = window.scMenuUrl(p && p.menu);
        return base + (base.indexOf('?') === -1 ? '?' : '&') + 'open=' + encodeURIComponent(p.id);
    };

    // Menus connus du catalogue chargé (ordre de l'API), avec leurs catégories.
    window.scMenus = function () {
        var seen = {}, list = [];
        (window.SOUCOFFE_CATEGORIES || []).forEach(function (c) {
            var slug = c.menuSlug || 'cafe';
            if (!seen[slug]) { seen[slug] = { slug: slug, name: c.menuName || 'Café', categories: [] }; list.push(seen[slug]); }
            seen[slug].categories.push(c.name);
        });
        return list;
    };

    var TAB_BASE = 'inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded-full font-label-md text-label-md transition-colors ';
    // Onglets « Menu Café | Menu Kebab | … » (affichés seulement s'il y a plusieurs menus).
    window.scRenderMenuTabs = function (el, current) {
        if (!el) return;
        var menus = window.scMenus();
        // Un menu sans aucun produit disponible n'est pas proposé aux clients (il revient
        // tout seul dès qu'un produit y est ajouté) ; le menu affiché reste toujours visible.
        if (window.SOUCOFFE_CATEGORIES && window.PRODUCTS && window.PRODUCTS.length) {
            var withProducts = {}, menuHas = {};
            window.PRODUCTS.forEach(function (p) { if (isProductAvailable(p)) withProducts[p.category] = true; });
            window.SOUCOFFE_CATEGORIES.forEach(function (c) { if (withProducts[c.name]) menuHas[c.menuSlug || 'cafe'] = true; });
            menus = menus.filter(function (m) { return m.slug === current || menuHas[m.slug]; });
        }
        if (menus.length < 2) { el.innerHTML = ''; el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.innerHTML = menus.map(function (m) {
            var on = m.slug === current;
            return '<a href="' + window.scMenuUrl(m.slug) + '"' + (on ? ' aria-current="page"' : '') + ' class="' + TAB_BASE +
                (on ? 'bg-primary text-on-primary shadow-sm' : 'bg-surface-container-high text-on-surface hover:bg-surface-variant border border-outline-variant') + '">' +
                (window.iconHtml ? window.iconHtml(m.slug === 'cafe' ? 'local_cafe' : (m.slug === 'kebab' ? 'kebab_dining' : 'restaurant_menu')) : '') +
                '<span>' + (/^menu\b/i.test(m.name) ? '' : 'Menu ') + escapeHtml(m.name) + '</span></a>';
        }).join('');
    };

    // Boutons de catégories d'un menu, régénérés depuis la base (même style que les boutons
    // historiques) : une catégorie ajoutée ou renommée dans l'admin apparaît d'elle-même.
    // Seules les catégories qui ont au moins un produit disponible sont proposées.
    window.scRenderCategoryPills = function (el, menuSlug, hidden) {
        if (!el || !window.SOUCOFFE_CATEGORIES) return;
        var model = el.querySelector('button:not([data-category="All"])');
        var cls = model ? model.className : 'whitespace-nowrap px-6 py-2 rounded-full bg-surface-container-high text-on-surface font-label-md text-label-md hover:bg-surface-variant transition-colors border border-transparent hover:border-outline-variant';
        var withProducts = {};
        (window.PRODUCTS || []).forEach(function (p) { if (isProductAvailable(p)) withProducts[p.category] = true; });
        var names = window.SOUCOFFE_CATEGORIES.filter(function (c) {
            return (c.menuSlug || 'cafe') === menuSlug && withProducts[c.name] && (hidden || []).indexOf(c.name) === -1;
        }).map(function (c) { return c.name; });
        el.querySelectorAll('button:not([data-category="All"])').forEach(function (b) { b.remove(); });
        names.forEach(function (name) {
            var b = document.createElement('button');
            b.setAttribute('onclick', 'filterByCategory(this)');
            b.setAttribute('data-category', name);
            b.className = cls;
            b.textContent = name;
            el.appendChild(b);
        });
        return names;
    };
    window.getProductById = getProductById;
    window.PRODUCTS = PRODUCTS;
    window.CATEGORY_STYLE = CATEGORY_STYLE;
    window.CATEGORY_OPTIONS = CATEGORY_OPTIONS;
    window.renderProductCard = renderProductCard;
    window.ProductOverrides = ProductOverrides;
    window.getEffectivePrice = getEffectivePrice;
    window.isProductAvailable = isProductAvailable;
    window.getEffectiveImage = getEffectiveImage;
    window.getEffectiveTags = getEffectiveTags;

    // Vrai si le produit a des groupes d'options OBLIGATOIRES (taille, lait,
    // sucre, glace) : il ne peut alors être commandé qu'après passage par la
    // fiche de personnalisation, jamais via un ajout rapide sans options.
    window.productNeedsCustomization = function (id) {
        var p = getProductById(id);
        if (!p) return false;
        var opts = optionsFor(p);
        return !!(opts.sizes || (opts.levels && opts.levels.length) || (opts.groups && opts.groups.some(function (g) { return g.required; })));
    };

    // Choix obligatoire pré-sélectionné intelligemment : celui que le nom du produit
    // annonce déjà (« Piadina kebab » → Piadina), sinon le premier (souvent inclus).
    function smartDefaultIndex(g, p) {
        var name = ' ' + String(p.name || '').toLowerCase() + ' ';
        for (var i = 0; i < g.options.length; i++) {
            var label = String(g.options[i].label || '').toLowerCase();
            if (label.length > 3 && name.indexOf(label) !== -1) return i;
        }
        return 0;
    }
    window.scSmartDefaultIndex = smartDefaultIndex;

    // Visuel de la fiche : photo principale + galerie (balayage, points, flèches).
    function galleryHtml(p, effImg) {
        var list = [effImg].concat(p.images || []).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
        if (list.length < 2) return null;
        return '<div class="sc-gal" data-count="' + list.length + '">' +
            '<div class="sc-gal-track" onscroll="scGalleryScroll(this)">' + list.map(function (src, i) {
                return '<div class="sc-gal-slide"><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(p.name) + ' — photo ' + (i + 1) + '" class="w-full h-full object-cover"' + (i ? ' loading="lazy"' : '') + '/></div>';
            }).join('') + '</div>' +
            '<button type="button" class="sc-gal-nav is-prev" aria-label="Photo précédente" onclick="scGalleryGo(this,-1)">' + window.iconHtml('arrow_back') + '</button>' +
            '<button type="button" class="sc-gal-nav is-next" aria-label="Photo suivante" onclick="scGalleryGo(this,1)">' + window.iconHtml('arrow_forward') + '</button>' +
            '<div class="sc-gal-dots" aria-hidden="true">' + list.map(function (x, i) { return '<i' + (i ? '' : ' class="is-on"') + '></i>'; }).join('') + '</div>' +
            '<span class="sc-gal-count">1/' + list.length + '</span></div>';
    }
    window.scGalleryScroll = function (track) {
        var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        var gal = track.parentNode;
        Array.prototype.forEach.call(gal.querySelectorAll('.sc-gal-dots i'), function (d, j) { d.classList.toggle('is-on', i === j); });
        var c = gal.querySelector('.sc-gal-count');
        if (c) c.textContent = (i + 1) + '/' + gal.getAttribute('data-count');
    };
    window.scGalleryGo = function (btn, d) {
        var track = btn.parentNode.querySelector('.sc-gal-track');
        var n = +btn.parentNode.getAttribute('data-count');
        var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) + d;
        if (i < 0) i = n - 1;
        if (i >= n) i = 0;
        track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
    };

    window.openProductModal = function (id) {
        var p = getProductById(id);
        var modal = document.getElementById('product-modal');
        if (!p) return;
        if (!modal) {
            // Page sans fiche produit (accueil, panier) : on ouvre la fiche
            // sur le Menu, qui lit ?open=<id> au chargement.
            window.location.href = window.scProductUrl(p);
            return;
        }
        if (modalHideTimeout) { clearTimeout(modalHideTimeout); modalHideTimeout = null; }
        var opts = optionsFor(p);
        var defaultSizeIndex = 0;
        if (opts.sizes) {
            var mIdx = opts.sizes.map(function (s) { return s.label; }).indexOf('M');
            defaultSizeIndex = mIdx !== -1 ? mIdx : 0;
        }
        var defaultLevels = {};
        if (opts.levels) {
            opts.levels.forEach(function (lvl) { defaultLevels[lvl.key] = 2; }); // "Normal"
        }
        modalState = { product: p, size: opts.sizes ? opts.sizes[defaultSizeIndex].label : null, levels: defaultLevels, extras: [], qty: 1,
            service: opts.service && opts.service.length ? opts.service[0].label : null,
            groups: (opts.groups || []).map(function (g) { return g.required && !g.multiple ? [smartDefaultIndex(g, p)] : []; }) };
        var panel = modal.querySelector('.sc-modal-panel');
        if (panel) { panel.classList.toggle('is-builder', !!opts.groups); panel.scrollTop = 0; }

        var style = CATEGORY_STYLE[p.category] || CATEGORY_STYLE['default'];
        var tile = document.getElementById('modal-emoji-tile');
        if (tile) {
            var effImg = getEffectiveImage(p);
            if (PRODUCT_VIDEOS[p.id]) {
                // Vidéo produit (muette, en boucle), l'image sert d'affiche le temps du chargement.
                tile.style.background = '';
                tile.innerHTML = '<video class="w-full h-full object-cover" src="' + PRODUCT_VIDEOS[p.id] + '"' + (effImg ? ' poster="' + effImg + '"' : '') +
                    ' autoplay muted loop playsinline preload="metadata" aria-label="' + escapeHtml(p.name) + ' en vidéo"></video>';
            } else if (effImg && galleryHtml(p, effImg)) {
                tile.style.background = '';
                tile.innerHTML = galleryHtml(p, effImg);
            } else if (effImg) {
                tile.style.background = '';
                tile.innerHTML = '<img src="' + effImg + '" alt="' + p.name + '" class="w-full h-full object-cover"/>';
            } else {
                tile.style.background = style.gradient;
                tile.innerHTML = '<span class="sc-tile-emoji text-6xl">' + productIconHtml(p) + '</span>';
            }
        }
        var nameEl = document.getElementById('modal-name');
        if (nameEl) nameEl.textContent = p.name;
        var descEl = document.getElementById('modal-desc');
        if (descEl) descEl.textContent = p.desc;
        var dietEl = document.getElementById('modal-diet');
        if (dietEl) dietEl.innerHTML = dietInfoHtml(p);
        var qtyEl = document.getElementById('modal-qty');
        if (qtyEl) qtyEl.textContent = '1';

        rememberViewed(p.id);
        var editParam = new URLSearchParams(window.location.search).get('edit');
        if (editParam && editParam.split('|')[0] === p.id && window.Cart) {
            var editItem = Cart.get().filter(function (i) { return i.id === editParam; })[0];
            if (editItem) prefillFromCartItem(opts, editItem);
        }
        // « Passez en menu » depuis le panier (?upgrade=<ligne>) : la formule reprend les choix
        // compatibles (pain, sauce…) et la quantité, puis remplace la ligne d'origine.
        var upgradeParam = new URLSearchParams(window.location.search).get('upgrade');
        if (upgradeParam && !modalState.editId && window.Cart) {
            var upItem = Cart.get().filter(function (i) { return i.id === upgradeParam; })[0];
            if (upItem) prefillFromCartItem(opts, upItem);
        }
        var qtyElPrefill = document.getElementById('modal-qty');
        if (qtyElPrefill) qtyElPrefill.textContent = String(modalState.qty);
        var addLabel = document.getElementById('modal-add-btn');
        if (addLabel && addLabel.firstChild && addLabel.firstChild.nodeType === 3) {
            addLabel.firstChild.textContent = modalState.editId ? 'Mettre à jour — ' : 'Ajouter — ';
        }
        renderModalService();
        renderModalGroups();
        renderModalSizes();
        renderModalLevels();
        renderModalExtras();
        updateModalPrice();
        var recEl = document.getElementById('modal-recommendations');
        if (recEl && window.SoucoffeRecommendations) {
            var recLabel = window.SoucoffeRecommendations.hasCoOccurrenceData(p.id)
                ? window.iconHtml('local_fire_department') + ' Souvent commandé avec' : window.iconHtml('auto_awesome') + ' Vous pourriez aussi aimer';
            window.SoucoffeRecommendations.renderRail(recEl, window.SoucoffeRecommendations.getForProduct(p.id, 4), recLabel);
        }
        // Fonctions intelligentes de la fiche (allergies, « passez en menu ») : js/smart-client.js.
        if (window.scSmartModal) { try { window.scSmartModal(p); } catch (e) { /* jamais bloquant */ } }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        // Double rAF so the browser paints the pre-transition state (opacity/scale
        // set by the base #product-modal CSS rules) before the "visible" class
        // flips it, otherwise the transition has nothing to animate from.
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                modal.classList.add('sc-modal-visible');
            });
        });
    };

    window.closeProductModal = function () {
        var modal = document.getElementById('product-modal');
        if (!modal) return;
        modal.classList.remove('sc-modal-visible');
        document.body.style.overflow = '';
        var vid = modal.querySelector('#modal-emoji-tile video');
        if (vid) { try { vid.pause(); } catch (e) { /* rien */ } }
        modalHideTimeout = setTimeout(function () {
            modal.classList.add('hidden');
            modalHideTimeout = null;
        }, 250);
    };

    window.modalSelectSize = function (label) {
        modalState.size = label;
        renderModalSizes();
        updateModalPrice();
    };

    window.modalSelectLevel = function (key, index) {
        modalState.levels[key] = index;
        renderModalLevels();
        updateModalPrice();
    };

    window.modalToggleExtra = function (i) {
        var idx = modalState.extras.indexOf(i);
        if (idx === -1) modalState.extras.push(i); else modalState.extras.splice(idx, 1);
        updateModalPrice();
    };

    window.modalChangeQty = function (delta) {
        modalState.qty = Math.max(1, modalState.qty + delta);
        var qtyEl = document.getElementById('modal-qty');
        if (qtyEl) qtyEl.textContent = modalState.qty;
        updateModalPrice();
    };

    window.confirmModalAdd = function () {
        var p = modalState.product;
        if (!p) return;
        var opts = optionsFor(p);
        var priceInfo = updateModalPrice();
        var labelParts = [];
        // Phase 4 : en plus du libellé (affichage, inchangé), on collecte les
        // vrais optionId numériques quand ils existent (catalogue chargé
        // depuis l'API). En repli local, les entrées n'ont pas d'optionId :
        // ce tableau reste vide, ce qui signale honnêtement à confirmOrder()
        // qu'une commande serveur précise n'est pas descriptible ici.
        var selectedOptionIds = [];
        if (modalState.service && opts.service) {
            var svc = opts.service.filter(function (o) { return o.label === modalState.service; })[0];
            labelParts.push(modalState.service);
            if (svc && typeof svc.optionId === 'number') selectedOptionIds.push(svc.optionId);
        }
        if (modalState.size) {
            labelParts.push(modalState.size);
            if (opts.sizes) {
                var sizeObj = opts.sizes.filter(function (s) { return s.label === modalState.size; })[0];
                if (sizeObj && typeof sizeObj.optionId === 'number') selectedOptionIds.push(sizeObj.optionId);
            }
        }
        if (opts.levels) {
            opts.levels.forEach(function (lvl) {
                var stepIndex = modalState.levels[lvl.key] || 0;
                var step = lvl.steps[stepIndex];
                var stepLabel = (step && typeof step === 'object') ? step.label : step;
                labelParts.push(lvl.label + ': ' + stepLabel);
                if (step && typeof step === 'object' && typeof step.optionId === 'number') {
                    selectedOptionIds.push(step.optionId);
                }
            });
        }
        if (opts.groups) {
            var missingNow = missingGroups();
            if (missingNow.length) {
                if (window.showToast) window.showToast('À choisir : ' + missingNow.join(', '));
                return;
            }
            opts.groups.forEach(function (g, gi) {
                var sel = (modalState.groups[gi] || []).slice().sort(function (a, b) { return a - b; });
                if (!sel.length) return;
                labelParts.push(g.name + ': ' + sel.map(function (oi) { return g.options[oi].label; }).join(', '));
                sel.forEach(function (oi) { if (typeof g.options[oi].optionId === 'number') selectedOptionIds.push(g.options[oi].optionId); });
            });
        }
        if (opts.extras) {
            modalState.extras.forEach(function (i) {
                labelParts.push(opts.extras[i].label);
                if (typeof opts.extras[i].optionId === 'number') selectedOptionIds.push(opts.extras[i].optionId);
            });
        }
        var displayName = p.name + (labelParts.length ? ' (' + labelParts.join(', ') + ')' : '');
        var cartId = p.id + (labelParts.length ? '|' + labelParts.join('|') : '');
        var editing = modalState.editId;
        // Modification depuis le panier : l'ancienne ligne est retirée avant
        // l'ajout (pas de doublon), puis retour au panier.
        if (editing) Cart.remove(editing);
        Cart.add({
            id: cartId, name: displayName, price: priceInfo.unit, qty: modalState.qty,
            img: getEffectiveImage(p) || '',
            productId: (typeof p.apiId === 'number' ? p.apiId : null),
            optionIds: selectedOptionIds
        });
        closeProductModal();
        if (editing) {
            if (window.showToast) window.showToast('Article mis à jour');
            setTimeout(function () { window.location.href = '../04-Panier/code.html'; }, 450);
        }
    };

    // ---- Modifier une ligne du panier : la fiche se rouvre pré-remplie ----
    // (?open=<slug>&edit=<id de ligne>, lien « Modifier » du panier). Les choix
    // sont retrouvés par leurs optionId SQL, la quantité est reprise.
    function prefillFromCartItem(opts, item) {
        var ids = (item.optionIds || []).map(Number);
        function has(o) { return o && typeof o.optionId === 'number' && ids.indexOf(o.optionId) !== -1; }
        if (opts.service) opts.service.forEach(function (o) { if (has(o)) modalState.service = o.label; });
        if (opts.sizes) opts.sizes.forEach(function (o) { if (has(o)) modalState.size = o.label; });
        (opts.levels || []).forEach(function (lvl) {
            lvl.steps.forEach(function (st, i) { if (has(st)) modalState.levels[lvl.key] = i; });
        });
        modalState.extras = [];
        (opts.extras || []).forEach(function (o, i) { if (has(o)) modalState.extras.push(i); });
        (opts.groups || []).forEach(function (g, gi) {
            var sel = [];
            g.options.forEach(function (o, oi) { if (has(o)) sel.push(oi); });
            if (sel.length || !g.required) modalState.groups[gi] = sel;
        });
        modalState.qty = Math.max(1, parseInt(item.qty, 10) || 1);
        modalState.editId = item.id;
    }

    // ---- Vus récemment (accueil) : derniers produits ouverts, sur cet appareil ----
    var RECENT_KEY = 'soucoffe_recent';
    function rememberViewed(id) {
        try {
            var list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(function (x) { return x !== id; });
            list.unshift(id);
            localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
        } catch (e) { /* stockage indisponible */ }
    }
    window.getRecentlyViewed = function (limit) {
        try {
            return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').map(getProductById)
                .filter(function (p) { return p && isProductAvailable(p); }).slice(0, limit || 6);
        } catch (e) { return []; }
    };
})();

// ---- Recherche instantanée (en-têtes avec headerSearch) ----
// En tapant : jusqu'à 6 produits (photo, nom, catégorie, prix), tolérant
// aux fautes (même moteur que le menu). Clavier ↑ ↓ Entrée Échap ; clic =
// fiche du produit ; « Voir tous les résultats » = recherche du menu.
(function () {
    var box = null, input = null, results = [], active = -1, term = '';
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ensureBox() {
        if (box) return box;
        box = document.createElement('div');
        box.className = 'sc-search-pop';
        box.id = 'sc-search-pop';
        box.setAttribute('role', 'listbox');
        box.setAttribute('aria-label', 'Suggestions de recherche');
        document.body.appendChild(box);
        box.addEventListener('mousedown', function (e) { e.preventDefault(); }); // garde le focus du champ
        box.addEventListener('click', function (e) {
            var a = e.target.closest('[data-i]');
            if (a) { e.preventDefault(); choose(parseInt(a.getAttribute('data-i'), 10)); return; }
            var all = e.target.closest('[data-all]');
            if (all) { e.preventDefault(); hide(); window.headerSearch && window.headerSearch(term); }
        });
        return box;
    }
    function place() {
        if (!box || !input) return;
        var r = input.getBoundingClientRect(), vw = window.innerWidth;
        box.style.top = Math.round(r.bottom + 8) + 'px';
        if (vw < 768) { box.style.left = '12px'; box.style.right = '12px'; box.style.width = 'auto'; }
        else {
            var w = Math.max(r.width, 400);
            box.style.width = w + 'px';
            box.style.right = 'auto';
            box.style.left = Math.max(12, Math.min(r.left, vw - w - 12)) + 'px';
        }
        box.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 24) + 'px';
    }
    function hide() { if (box) box.classList.remove('is-open'); active = -1; if (input) input.setAttribute('aria-expanded', 'false'); }
    function render() {
        ensureBox();
        if (!results.length) {
            box.innerHTML = '<p class="sc-search-empty">Aucun produit pour « ' + esc(term) + ' »</p>';
        } else {
            box.innerHTML = results.map(function (p, i) {
                var img = window.getEffectiveImage ? window.getEffectiveImage(p) : p.img;
                var price = (window.getEffectivePrice ? window.getEffectivePrice(p) : p.price).toFixed(2).replace('.', ',');
                return '<a href="' + window.scProductUrl(p) + '" role="option" id="sc-sr-' + i + '" data-i="' + i + '" aria-selected="' + (i === active) + '" class="sc-search-item' + (i === active ? ' is-active' : '') + '">' +
                    (img ? '<img src="' + esc(img) + '" alt="" loading="lazy"/>' : '<span class="sc-search-noimg"></span>') +
                    '<span class="sc-search-text"><strong>' + esc(p.name) + '</strong><small>' + esc(p.category) + '</small></span>' +
                    '<span class="sc-search-price">' + price + ' €</span></a>';
            }).join('') + '<button type="button" data-all class="sc-search-all">Voir tous les résultats pour « ' + esc(term) + ' »</button>';
        }
        box.classList.add('is-open');
        input.setAttribute('aria-expanded', 'true');
        if (active >= 0) input.setAttribute('aria-activedescendant', 'sc-sr-' + active); else input.removeAttribute('aria-activedescendant');
        place();
    }
    function search(value) {
        term = String(value || '').trim();
        if (term.length < 2 || !window.filterAndSortProducts || !window.PRODUCTS) { hide(); return; }
        results = window.filterAndSortProducts(window.PRODUCTS, {
            category: 'All', searchTerm: term.toLowerCase(), favoritesOnly: false,
            minPrice: null, maxPrice: null, dietaryTag: '', sortBy: 'popular'
        }).slice(0, 6);
        active = -1;
        render();
    }
    function choose(i) {
        var p = results[i];
        if (!p) return;
        hide();
        if (document.getElementById('product-modal') && window.openProductModal) window.openProductModal(p.id);
        else window.location.href = window.scProductUrl(p);
    }
    function attach(el) {
        if (el.__scSearch) return;
        el.__scSearch = true;
        el.setAttribute('role', 'combobox');
        el.setAttribute('aria-autocomplete', 'list');
        el.setAttribute('aria-controls', 'sc-search-pop');
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute('autocomplete', 'off');
        el.addEventListener('input', function () { input = el; search(el.value); });
        el.addEventListener('focus', function () { input = el; if (el.value.trim().length >= 2) search(el.value); });
        el.addEventListener('blur', function () { setTimeout(hide, 150); });
    }
    // Clavier en phase de capture : passe avant le onkeydown="headerSearch(...)" du champ.
    document.addEventListener('keydown', function (e) {
        if (!box || !box.classList.contains('is-open') || e.target !== input) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!results.length) return;
            active = e.key === 'ArrowDown' ? (active + 1) % results.length : (active <= 0 ? results.length - 1 : active - 1);
            render();
        } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            e.stopPropagation();
            choose(active);
        } else if (e.key === 'Escape') {
            hide();
        }
    }, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', function () { if (box && box.classList.contains('is-open')) place(); }, { passive: true });
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('input[onkeydown*="headerSearch"]').forEach(attach);
    });
})();

// ---- Fiche produit sur téléphone : glisser vers le bas pour fermer ----
// Uniquement quand la fiche est tout en haut (sinon le geste fait défiler
// les choix, comme d'habitude). Au-delà de 110 px, la fiche se ferme.
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        var modal = document.getElementById('product-modal');
        var panel = modal && modal.querySelector('.sc-modal-panel');
        if (!panel) return;
        var grip = document.createElement('div');
        grip.className = 'sc-sheet-grip';
        grip.setAttribute('aria-hidden', 'true');
        panel.insertBefore(grip, panel.firstChild);
        var startY = null, dy = 0;
        panel.addEventListener('touchstart', function (e) {
            if (window.innerWidth >= 768 || panel.scrollTop > 0 || e.touches.length !== 1) { startY = null; return; }
            startY = e.touches[0].clientY; dy = 0;
        }, { passive: true });
        panel.addEventListener('touchmove', function (e) {
            if (startY === null) return;
            dy = e.touches[0].clientY - startY;
            if (dy <= 0) { panel.style.transform = ''; return; }
            panel.classList.add('is-dragging');
            panel.style.transform = 'translateY(' + Math.round(dy * 0.9) + 'px)';
        }, { passive: true });
        function end() {
            if (startY === null) return;
            panel.classList.remove('is-dragging');
            var close = dy > 110;
            panel.style.transform = '';
            startY = null;
            if (close && window.closeProductModal) window.closeProductModal();
        }
        panel.addEventListener('touchend', end);
        panel.addEventListener('touchcancel', end);
    });
})();

// Pastilles de catégories du menu : vignette photo + libellé français (« Tout »).
// Le filtre reste piloté par data-category (inchangé).
(function () {
    var THUMBS = {
        'All': null,
        'Cafés': 'cappuccino.jpg', 'Croissants': 'croissant-beurre.jpg', 'Sodas': 'coca-cola.jpg',
        'Mojitos': 'mojito-classique.jpg', 'Jus': 'jus-orange.jpg', 'Smoothies': 'smoothie-fruits-rouges.jpg',
        'Sandwichs': 'club-sandwich.jpg', 'Desserts': 'tiramisu.jpg', 'Petit-déjeuner': 'petit-dejeuner-sucre.jpg'
    };
    function decorate() {
        var box = document.getElementById('category-pills');
        if (!box || box.classList.contains('sc-pills')) return;
        box.classList.add('sc-pills');
        box.querySelectorAll('button[data-category]').forEach(function (b) {
            var cat = b.getAttribute('data-category');
            var label = cat === 'All' ? 'Tout' : (b.textContent.trim() || cat);
            b.textContent = '';
            var media = document.createElement('span');
            media.className = 'sc-pill-media';
            media.setAttribute('aria-hidden', 'true');
            if (THUMBS[cat]) {
                var img = document.createElement('img');
                img.src = '../images/products/' + THUMBS[cat];
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                media.appendChild(img);
            } else {
                media.classList.add('is-all');
                media.innerHTML = '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520ZM200-600h160v-160H200v160Zm400 0h160v-160H600v160Zm0 400h160v-160H600v160Zm-400 0h160v-160H200v160Zm400-400Zm0 240Zm-240 0Zm0-240Z"/></svg>';
            }
            var text = document.createElement('span');
            text.className = 'sc-pill-label';
            text.textContent = label;
            b.appendChild(media);
            b.appendChild(text);
            b.setAttribute('aria-label', label);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();
})();
