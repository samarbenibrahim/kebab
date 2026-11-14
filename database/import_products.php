<?php
/**
 * Import contrôlé du catalogue réel (35 produits) vers MySQL/MariaDB.
 *
 * Source de vérité : js/products.js (PRODUCTS + CATEGORY_OPTIONS), transcrit
 * ici à l'identique — ce script NE LIT PAS le fichier JS (PHP ne l'exécute
 * pas), il reproduit fidèlement les mêmes valeurs. js/products.js n'est ni
 * lu ni modifié par ce script.
 *
 * Réexécutable sans créer de doublons :
 *   - categories : INSERT ... ON DUPLICATE KEY UPDATE (clé unique = name)
 *   - option_groups : recherchés par nom avant insertion (pas de clé unique
 *     sur le nom seul car "Taille" existe en 2 variantes différentes)
 *   - options : INSERT ... ON DUPLICATE KEY UPDATE (clé unique = group+label)
 *   - products : INSERT ... ON DUPLICATE KEY UPDATE (clé unique = slug)
 *   - product_option_groups : INSERT IGNORE (clé primaire composite)
 *
 * Usage : php database/import_products.php
 */
require __DIR__ . '/../api/config/database.php';

$pdo = get_pdo_connection();

// ---- 1. Catégories (ordre = ordre d'apparition dans products.js) ----
$categoryNames = ['Cafés', 'Croissants', 'Sodas', 'Mojitos', 'Jus', 'Smoothies', 'Sandwichs', 'Desserts', 'Offres', 'Petit-déjeuner'];
$categoryIds = [];
foreach ($categoryNames as $i => $name) {
    $stmt = $pdo->prepare(
        'INSERT INTO categories (name, sort_order) VALUES (:name, :sort)
         ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)'
    );
    $stmt->execute(['name' => $name, 'sort' => $i]);
    $categoryIds[$name] = (int) $pdo->query(
        'SELECT id FROM categories WHERE name = ' . $pdo->quote($name)
    )->fetchColumn();
}

// ---- 2. Groupes d'options (dérivés de CATEGORY_OPTIONS, valeurs réelles) ----
// Chaque groupe : nom interne => [nom affiché, selection_type, is_required, min, max, options[label => price_delta]]
$steps4 = ['Sans' => 0, 'Peu' => 0, 'Normal' => 0, 'Beaucoup' => 0];
$optionGroupDefs = [
    'taille_cafes'      => ['Taille', 'SINGLE', 1, 1, 1, ['S' => -0.500, 'M' => 0, 'L' => 0.800]],
    'taille_boissons'   => ['Taille', 'SINGLE', 1, 1, 1, ['M' => 0, 'L' => 1.000]],
    'lait'              => ['Lait', 'SINGLE', 1, 1, 1, $steps4],
    'sucre'             => ['Sucre', 'SINGLE', 1, 1, 1, $steps4],
    'glace'             => ['Glace', 'SINGLE', 1, 1, 1, $steps4],
    'extras_cafes'      => ['Extras', 'MULTIPLE', 0, 0, 4, [
        "Lait d'avoine" => 0.800, 'Extra shot' => 0.700, 'Sirop vanille' => 0.500, 'Chantilly' => 0.600,
    ]],
    'extras_mojitos'    => ['Extras', 'MULTIPLE', 0, 0, 1, ['Menthe fraîche +' => 0.300]],
    'extras_smoothies'  => ['Extras', 'MULTIPLE', 0, 0, 1, ['Graines de chia +' => 0.500]],
    'extras_croissants' => ['Extras', 'MULTIPLE', 0, 0, 2, ['Servi chaud' => 0, 'Beurre supplémentaire' => 0.300]],
    'extras_sandwichs'  => ['Extras', 'MULTIPLE', 0, 0, 2, ['Sans oignon' => 0, 'Pain sans gluten' => 0.500]],
    // Service des cafés (migration 016) : non obligatoire, les anciennes commandes restent valides.
    'service'           => ['Service', 'SINGLE', 0, 0, 1, ['Tasse en verre (sur place)' => 0, 'Gobelet à emporter' => 0]],
    'extras_desserts'   => ['Extras', 'MULTIPLE', 0, 0, 3, [
        'Coulis chocolat' => 0.400, 'À emporter' => 0, 'Portion généreuse' => 0.600,
    ]],
];

$optionGroupIds = [];
foreach ($optionGroupDefs as $key => [$name, $type, $required, $min, $max, $options]) {
    // Pas de clé unique sur "name" seul (deux groupes "Taille" distincts) :
    // on cherche par nom + selection_type + nombre d'options pour rester idempotent.
    $existing = $pdo->prepare(
        'SELECT id FROM option_groups WHERE name = :name AND selection_type = :type LIMIT 1'
    );
    // Pour distinguer les 2 groupes "Taille", on mémorise l'id par clé interne ($key),
    // donc on ne réutilise un groupe existant que si on l'a déjà créé dans CETTE table
    // de correspondance (sécurisé par un marqueur en commentaire SQL n'est pas fiable :
    // on utilise donc une table de correspondance locale persistée via le label des options).
    // Plusieurs groupes partagent le même (name, selection_type) — ex. deux
    // groupes "Taille", et surtout plusieurs groupes "Extras" avec le MÊME
    // nombre d'options (Mojitos et Smoothies ont chacun 1 seul extra ;
    // Croissants et Sandwichs en ont chacun 2). Comparer uniquement le nombre
    // d'options est donc ambigu et peut faire "matcher" le mauvais groupe.
    // On compare ici l'ensemble exact des libellés, seul identifiant fiable.
    $groupId = null;
    $newLabels = array_keys($options);
    sort($newLabels);
    $candidatesStmt = $pdo->prepare('SELECT id FROM option_groups WHERE name = :name AND selection_type = :type');
    $candidatesStmt->execute(['name' => $name, 'type' => $type]);
    foreach ($candidatesStmt->fetchAll(PDO::FETCH_COLUMN) as $candidateId) {
        $labelsStmt = $pdo->prepare('SELECT label FROM options WHERE option_group_id = :id');
        $labelsStmt->execute(['id' => $candidateId]);
        $existingLabels = $labelsStmt->fetchAll(PDO::FETCH_COLUMN);
        sort($existingLabels);
        if ($existingLabels === $newLabels) {
            $groupId = (int) $candidateId;
            break;
        }
    }

    if ($groupId === null) {
        $insert = $pdo->prepare(
            'INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
             VALUES (:name, :type, :required, :min, :max)'
        );
        $insert->execute([
            'name' => $name, 'type' => $type, 'required' => $required, 'min' => $min, 'max' => $max,
        ]);
        $groupId = (int) $pdo->lastInsertId();
    }
    $optionGroupIds[$key] = $groupId;

    $sort = 0;
    foreach ($options as $label => $delta) {
        $optStmt = $pdo->prepare(
            'INSERT INTO options (option_group_id, label, price_delta, sort_order)
             VALUES (:gid, :label, :delta, :sort)
             ON DUPLICATE KEY UPDATE price_delta = VALUES(price_delta), sort_order = VALUES(sort_order)'
        );
        $optStmt->execute(['gid' => $groupId, 'label' => $label, 'delta' => $delta, 'sort' => $sort]);
        $sort++;
    }
}

// ---- 3. Association catégorie -> groupes d'options (reflète CATEGORY_OPTIONS) ----
$categoryOptionGroups = [
    'Cafés'      => ['service', 'taille_cafes', 'lait', 'sucre', 'extras_cafes'],
    'Sodas'      => ['taille_boissons', 'glace', 'sucre'],
    'Mojitos'    => ['taille_boissons', 'glace', 'sucre', 'extras_mojitos'],
    'Jus'        => ['taille_boissons', 'sucre'],
    'Smoothies'  => ['taille_boissons', 'sucre', 'extras_smoothies'],
    'Croissants' => ['extras_croissants'],
    'Sandwichs'  => ['extras_sandwichs'],
    'Desserts'   => ['extras_desserts'],
];

// ---- 4. Produits (35, transcrits fidèlement depuis js/products.js) ----
$products = [
    // Cafés
    ['espresso', 'Espresso', 'Cafés', 4.500, "Un shot pur et intense, à la crema dorée.", '☕'],
    ['double-espresso', 'Double Espresso', 'Cafés', 6.500, "Deux shots pour un réveil garanti.", '☕'],
    ['cafe-direct', 'Café Direct', 'Cafés', 4.000, "Café filtre classique, doux et équilibré.", '☕'],
    ['cafe-creme', 'Café Crème', 'Cafés', 5.500, "Espresso et lait chaud, onctueux.", '☕'],
    ['cafe-latte-art', 'Café Latte Art', 'Cafés', 4.500, "Espresso double, lait velouté et art latte signature.", '☕'],
    ['cappuccino', 'Cappuccino', 'Cafés', 5.000, "Espresso, lait moussé et une pointe de cacao.", '☕'],
    ['cafe-glace-caramel', 'Café Glacé Caramel', 'Cafés', 6.000, "Espresso froid, caramel et glaçons.", '🧊'],
    ['cafe-turc', 'Café Turc', 'Cafés', 4.500, "Café finement moulu, préparé au cezve et servi avec sa mousse onctueuse.", '☕'],
    // Croissants
    ['croissant-beurre', 'Croissant Pur Beurre', 'Croissants', 2.200, "Cuit sur place ce matin, croustillant à l'extérieur, moelleux à l'intérieur.", '🥐'],
    ['pain-chocolat', 'Pain au Chocolat', 'Croissants', 2.500, "Pâte feuilletée et cœur de chocolat noir.", '🥐'],
    ['croissant-amande', 'Croissant Amande', 'Croissants', 3.200, "Fourré à la crème d'amande, effeuillé.", '🥐'],
    ['chausson-pommes', 'Chausson aux Pommes', 'Croissants', 2.800, "Pommes fondantes en pâte feuilletée.", '🥐'],
    // Sodas
    ['coca-cola', 'Coca-Cola', 'Sodas', 3.000, "Servi bien frais avec des glaçons.", '🥤'],
    ['sprite', 'Sprite', 'Sodas', 3.000, "Fraîcheur citron-lime pétillante.", '🥤'],
    ['schweppes-agrumes', 'Schweppes Agrumes', 'Sodas', 3.200, "Notes d'agrumes, légèrement amer.", '🥤'],
    ['ice-tea-peche', 'Ice Tea Pêche', 'Sodas', 3.200, "Thé glacé infusé à la pêche.", '🥤'],
    // Mojitos
    ['mojito-classique', 'Virgin Mojito Classique', 'Mojitos', 5.000, "Citron vert frais, menthe pilée, sucre de canne et eau gazeuse.", '🍹'],
    ['mojito-fraise', 'Virgin Mojito Fraise', 'Mojitos', 5.500, "Fraises fraîches et menthe pilée.", '🍹'],
    ['mojito-framboise', 'Virgin Mojito Framboise', 'Mojitos', 5.500, "Framboises fraîches et éclats de menthe.", '🍹'],
    ['mojito-passion', 'Virgin Mojito Passion', 'Mojitos', 6.000, "Fruit de la passion et menthe fraîche.", '🍹'],
    // Jus
    ['jus-orange', "Jus d'Orange Pressé", 'Jus', 5.000, "Oranges pressées minute, sans sucre ajouté.", '🍊'],
    ['jus-citron', 'Jus de Citron', 'Jus', 4.500, "Citrons frais pressés, acidulé et vivifiant.", '🍋'],
    ['jus-fraise', 'Jus de Fraise', 'Jus', 5.500, "Fraises mixées fraîches.", '🍓'],
    ['jus-mangue', 'Jus de Mangue', 'Jus', 5.800, "Mangue mûre à point, onctueux.", '🥭'],
    // Smoothies
    ['smoothie-banane-fraise', 'Smoothie Banane Fraise', 'Smoothies', 6.000, "Banane, fraises et lait, texture veloutée.", '🍓'],
    ['smoothie-mangue-passion', 'Smoothie Mangue Passion', 'Smoothies', 6.500, "Mangue, fruit de la passion et yaourt.", '🥭'],
    ['smoothie-vert-detox', 'Smoothie Vert Détox', 'Smoothies', 6.800, "Épinard, pomme, citron et gingembre.", '🥝'],
    ['smoothie-fruits-rouges', 'Smoothie Fruits Rouges', 'Smoothies', 6.500, "Fraise, framboise, myrtille et yaourt.", '🍇'],
    // Sandwichs
    ['avocado-toast', 'Avocado Toast', 'Sandwichs', 9.500, "Pain au levain, avocat écrasé, tomates cerises et graines torréfiées.", '🥑'],
    ['club-sandwich', 'Club Sandwich', 'Sandwichs', 10.500, "Poulet grillé, bacon, salade, tomate.", '🥪'],
    ['sandwich-thon', 'Sandwich Thon Crudités', 'Sandwichs', 8.500, "Thon, crudités fraîches, pain complet.", '🥪'],
    ['panini-poulet-curry', 'Panini Poulet Curry', 'Sandwichs', 9.000, "Poulet, sauce curry, crudités, pressé et croustillant.", '🌯'],
    // Desserts
    ['tiramisu', 'Tiramisu Maison', 'Desserts', 6.500, "Recette traditionnelle italienne, mascarpone et café.", '🍰'],
    ['cheesecake', 'Cheesecake Fruits Rouges', 'Desserts', 7.000, "Base biscuitée, coulis de fruits rouges.", '🍰'],
    ['fondant-chocolat', 'Fondant au Chocolat', 'Desserts', 6.800, "Cœur coulant, chocolat noir intense.", '🍫'],
    ['cookie', 'Cookie Pépites de Chocolat', 'Desserts', 3.500, "Cuit maison, croustillant à l'extérieur.", '🍪'],
    // Offres du moment (auparavant des boutons statiques sans produit SQL, donc
    // impossibles à commander) : sans options, photos des visuels d'accueil (7e champ).
    ['formule-petit-dejeuner', 'Formule Petit Déjeuner', 'Offres', 8.500, "Café au choix, croissant pur beurre et jus d'orange pressé.", '🥐', '../images/hero/hero-1.jpg'],
    ['coffee-break', 'Coffee Break', 'Offres', 6.000, "Boisson glacée & Pâtisserie", '🧁', '../images/hero/hero-2.jpg'],
    // Petit-déjeuner (migration 017, photos ajoutées au projet)
    ['petit-dejeuner-healthy', 'Petit-déjeuner Healthy', 'Petit-déjeuner', 14.000, "Pain frais, fromages, olives, légumes croquants, œuf au plat, miel et confitures maison.", '🥗'],
    ['petit-dejeuner-sucre', 'Petit-déjeuner Sucré', 'Petit-déjeuner', 12.000, "Croissants, pancakes aux fruits rouges, granola au yaourt, fruits frais et chocolat chaud.", '🥐'],
    ['petit-dejeuner-sale', 'Petit-déjeuner Salé', 'Petit-déjeuner', 15.000, "Plateau de fromages, crackers, olives, tomates, concombre, crêpes salées et fruits frais.", '🧀'],
    ['petit-dejeuner-turc', 'Petit-déjeuner Turc', 'Petit-déjeuner', 18.000, "Simit, fromages blancs, olives, miel en rayon, confitures, œuf et thé turc.", '🫖'],
];

// ---- 4 bis. Infos allergènes / nutritionnelles (INDICATIVES : catalogue de démonstration) ----
// slug => [allergènes (virgules, '' = aucun), kcal, tags (vegetarien,vegan,sans-gluten)]
$V = 'vegetarien,sans-gluten';         // végétarien sans gluten
$VV = 'vegan,vegetarien,sans-gluten';  // végan
$dietaryInfo = [
    'espresso' => ['', 5, $VV], 'double-espresso' => ['', 10, $VV], 'cafe-direct' => ['', 5, $VV],
    'cafe-creme' => ['Lait', 90, $V], 'cafe-latte-art' => ['Lait', 120, $V], 'cappuccino' => ['Lait', 110, $V],
    'cafe-glace-caramel' => ['Lait', 160, $V],
    'croissant-beurre' => ['Gluten,Lait,Œufs', 230, 'vegetarien'],
    'pain-chocolat' => ['Gluten,Lait,Œufs,Soja', 270, 'vegetarien'],
    'croissant-amande' => ['Gluten,Lait,Œufs,Fruits à coque', 340, 'vegetarien'],
    'chausson-pommes' => ['Gluten,Lait', 260, 'vegetarien'],
    'coca-cola' => ['', 140, $VV], 'sprite' => ['', 130, $VV], 'schweppes-agrumes' => ['', 120, $VV], 'ice-tea-peche' => ['', 90, $VV],
    'mojito-classique' => ['', 110, $VV], 'mojito-fraise' => ['', 130, $VV], 'mojito-framboise' => ['', 130, $VV], 'mojito-passion' => ['', 140, $VV],
    'jus-orange' => ['', 110, $VV], 'jus-citron' => ['', 60, $VV], 'jus-fraise' => ['', 100, $VV], 'jus-mangue' => ['', 130, $VV],
    'smoothie-banane-fraise' => ['Lait', 220, $V], 'smoothie-mangue-passion' => ['Lait', 210, $V],
    'smoothie-vert-detox' => ['', 130, $VV], 'smoothie-fruits-rouges' => ['Lait', 190, $V],
    'avocado-toast' => ['Gluten,Sésame', 380, 'vegan,vegetarien'],
    'club-sandwich' => ['Gluten,Œufs,Moutarde', 560, ''],
    'sandwich-thon' => ['Gluten,Poisson,Œufs', 430, ''],
    'panini-poulet-curry' => ['Gluten,Lait,Moutarde', 520, ''],
    'tiramisu' => ['Gluten,Lait,Œufs', 450, 'vegetarien'], 'cheesecake' => ['Gluten,Lait,Œufs', 420, 'vegetarien'],
    'fondant-chocolat' => ['Gluten,Lait,Œufs', 400, 'vegetarien'],
    'cookie' => ['Gluten,Lait,Œufs,Fruits à coque', 280, 'vegetarien'],
    'formule-petit-dejeuner' => ['Gluten,Lait,Œufs', 350, 'vegetarien'],
    'coffee-break' => ['Gluten,Lait,Œufs', 400, 'vegetarien'],
    'cafe-turc' => ['', 5, $VV],
    'petit-dejeuner-healthy' => ['Gluten,Lait,Œufs', 520, 'vegetarien'], 'petit-dejeuner-sucre' => ['Gluten,Lait,Œufs', 680, 'vegetarien'],
    'petit-dejeuner-sale' => ['Gluten,Lait,Œufs', 720, 'vegetarien'], 'petit-dejeuner-turc' => ['Gluten,Lait,Œufs', 750, 'vegetarien'],
];

$report = ['categories' => count($categoryNames), 'option_groups' => count($optionGroupDefs), 'options' => 0, 'products' => 0, 'relations' => 0, 'errors' => []];
foreach ($optionGroupDefs as [, , , , , $opts]) {
    $report['options'] += count($opts);
}

foreach ($products as $row) {
    [$slug, $name, $category, $price, $desc, $emoji] = $row;
    if (!isset($categoryIds[$category])) {
        $report['errors'][] = "Catégorie inconnue pour $slug: $category";
        continue;
    }
    // chemin réel utilisé par le frontend, sauf si le 7e champ le surcharge (null = pas d'image)
    $imageUrl = array_key_exists(6, $row) ? $row[6] : '../images/products/' . $slug . '.jpg';

    $stmt = $pdo->prepare(
        'INSERT INTO products (category_id, slug, name, description, base_price, image_url, emoji, available)
         VALUES (:cat, :slug, :name, :desc, :price, :img, :emoji, 1)
         ON DUPLICATE KEY UPDATE
            category_id = VALUES(category_id), name = VALUES(name), description = VALUES(description),
            base_price = VALUES(base_price), image_url = VALUES(image_url), emoji = VALUES(emoji)'
    );
    $stmt->execute([
        'cat' => $categoryIds[$category], 'slug' => $slug, 'name' => $name,
        'desc' => $desc, 'price' => $price, 'img' => $imageUrl, 'emoji' => $emoji,
    ]);
    $productId = (int) $pdo->query('SELECT id FROM products WHERE slug = ' . $pdo->quote($slug))->fetchColumn();
    $report['products']++;

    if (isset($dietaryInfo[$slug])) {
        [$allergens, $kcal, $tags] = $dietaryInfo[$slug];
        $diet = $pdo->prepare('UPDATE products SET allergens = :a, calories = :c, dietary_tags = :t WHERE id = :id');
        $diet->execute(['a' => $allergens, 'c' => $kcal, 't' => $tags, 'id' => $productId]);
    }

    $groupKeys = $categoryOptionGroups[$category] ?? [];
    $sort = 0;
    foreach ($groupKeys as $groupKey) {
        $groupId = $optionGroupIds[$groupKey];
        $relStmt = $pdo->prepare(
            'INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order)
             VALUES (:pid, :gid, :sort)'
        );
        $relStmt->execute(['pid' => $productId, 'gid' => $groupId, 'sort' => $sort]);
        $report['relations']++;
        $sort++;
    }
}

echo "=== Rapport d'import ===\n";
echo "Catégories      : {$report['categories']}\n";
echo "Groupes options : {$report['option_groups']}\n";
echo "Options         : {$report['options']}\n";
echo "Produits        : {$report['products']}\n";
echo "Relations liées : {$report['relations']}\n";
if ($report['errors']) {
    echo "Erreurs :\n - " . implode("\n - ", $report['errors']) . "\n";
} else {
    echo "Erreurs         : aucune\n";
}
