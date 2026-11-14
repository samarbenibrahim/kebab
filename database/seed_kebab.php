<?php
/**
 * Carte Kebab (menu « kebab », migration 023) : produits, options, ordre des menus.
 *
 * PRIX INDICATIFS (prix courants en Italie) à vérifier et corriger dans
 * l'admin (Produits → Modifier). Noms et descriptions en français (langue
 * source du site) ; l'affichage italien vient des dictionnaires (scripts/i18n).
 *
 * Réexécutable sans doublon : produits par slug, groupes d'options par nom
 * (« Sauce kebab », « Suppléments kebab », « Boisson du menu »), options par
 * (groupe, libellé). Un produit déjà présent n'est PAS modifié (les prix
 * corrigés dans l'admin sont conservés). Transaction : tout ou rien.
 *
 * Usage : php database/seed_kebab.php
 */
require __DIR__ . '/../api/config/database.php';

$pdo = get_pdo_connection();
$cat = $pdo->query("SELECT c.name, c.id FROM categories c JOIN menus m ON m.id = c.menu_id WHERE m.slug = 'kebab'")->fetchAll(PDO::FETCH_KEY_PAIR);
foreach (['Paninis et piadines', 'Assiettes kebab', 'Menus kebab', 'Alternatives', 'Accompagnements', 'Sauces et suppléments'] as $needed) {
    if (!isset($cat[$needed])) {
        fwrite(STDERR, "Catégorie « $needed » absente : appliquez d'abord la migration 023.\n");
        exit(1);
    }
}

// ---- Groupes d'options : [nom, type, obligatoire, min, max, [[libellé, supplément]…]] ----
$groupsDef = [
    'sauce' => ['Sauce kebab', 'MULTIPLE', 0, 0, 2, [['Sauce yaourt', 0], ['Sauce piquante', 0], ['Sauce barbecue', 0], ['Ketchup', 0], ['Mayonnaise', 0]]],
    'extra' => ['Suppléments kebab', 'MULTIPLE', 0, 0, 3, [['Supplément viande', 2.0], ['Supplément fromage', 1.0], ['Sans oignon', 0]]],
    'drink' => ['Boisson du menu', 'SINGLE', 1, 1, 1, [['Coca-Cola', 0], ['Sprite', 0], ['Ice Tea Pêche', 0], ['Eau minérale', 0]]],
];

// ---- Produits : [slug, catégorie, nom, description, prix, emoji, allergènes (null = non renseigné), régime, groupes] ----
$P = 'Paninis et piadines';
$A = 'Assiettes kebab';
$M = 'Menus kebab';
$L = 'Alternatives';
$C = 'Accompagnements';
$S = 'Sauces et suppléments';
$products = [
    ['panino-kebab', $P, 'Sandwich kebab', 'Pain moelleux, viande kebab grillée, crudités fraîches et sauce au choix.', 6.00, '🥙', ['Gluten', 'Lait'], [], ['sauce', 'extra']],
    ['piadina-kebab', $P, 'Piadina kebab', 'Piadina chaude garnie de viande kebab, salade, tomate, oignon et sauce.', 6.50, '🌯', ['Gluten', 'Lait'], [], ['sauce', 'extra']],
    ['durum-kebab', $P, 'Durum kebab', 'Galette roulée et grillée, viande kebab, crudités et sauce au choix.', 7.00, '🌯', ['Gluten', 'Lait'], [], ['sauce', 'extra']],
    ['doner-kebab', $P, 'Döner kebab', 'Le classique : pain turc, viande à la broche, crudités et sauce yaourt.', 6.50, '🥙', ['Gluten', 'Lait'], [], ['sauce', 'extra']],
    ['piatto-kebab', $A, 'Assiette kebab', 'Viande kebab, crudités, pain et sauce au choix.', 9.50, '🍽️', ['Gluten', 'Lait'], [], ['sauce', 'extra']],
    ['piatto-kebab-patatine', $A, 'Assiette kebab et frites', 'Viande kebab, frites croustillantes, crudités et sauce au choix.', 10.50, '🍽️', ['Gluten', 'Lait'], [], ['sauce', 'extra']],
    ['piatto-kebab-riso', $A, 'Assiette kebab et riz', 'Viande kebab, riz épicé, crudités et sauce au choix.', 10.50, '🍽️', ['Lait'], [], ['sauce', 'extra']],
    ['piatto-kebab-insalata', $A, 'Assiette kebab et salade', 'Viande kebab sur une salade fraîche de saison, sauce au choix.', 9.50, '🥗', ['Lait'], [], ['sauce', 'extra']],
    ['piatto-solo-carne', $A, 'Assiette viande seule', 'Une généreuse portion de viande kebab grillée, sauce au choix.', 9.00, '🥩', ['Lait'], [], ['sauce', 'extra']],
    ['menu-panino-kebab', $M, 'Menu sandwich kebab', 'Sandwich kebab, frites et boisson au choix.', 9.50, '🥙', ['Gluten', 'Lait'], [], ['drink', 'sauce', 'extra']],
    ['menu-piadina-kebab', $M, 'Menu piadina kebab', 'Piadina kebab, frites et boisson au choix.', 10.00, '🌯', ['Gluten', 'Lait'], [], ['drink', 'sauce', 'extra']],
    ['menu-durum-kebab', $M, 'Menu durum kebab', 'Durum kebab, frites et boisson au choix.', 10.50, '🌯', ['Gluten', 'Lait'], [], ['drink', 'sauce', 'extra']],
    ['menu-piatto-kebab', $M, 'Menu assiette kebab', 'Assiette kebab, frites et boisson au choix.', 13.00, '🍽️', ['Gluten', 'Lait'], [], ['drink', 'sauce', 'extra']],
    ['falafel-panino', $L, 'Sandwich falafel', 'Pain moelleux, falafels croustillants, crudités et sauce au choix.', 5.50, '🧆', ['Gluten', 'Sésame'], ['vegetarien'], ['sauce']],
    ['falafel-piadina', $L, 'Piadina falafel', 'Piadina chaude, falafels, salade, tomate et sauce au choix.', 6.00, '🧆', ['Gluten', 'Sésame'], ['vegetarien'], ['sauce']],
    ['patatine-fritte', $C, 'Frites', 'Frites dorées et croustillantes.', 3.00, '🍟', [], ['vegan', 'vegetarien'], ['sauce']],
    ['onion-rings', $C, 'Onion rings', 'Rondelles d’oignon panées et frites.', 3.50, '🧅', ['Gluten'], ['vegetarien'], []],
    ['salsa-yogurt', $S, 'Sauce yaourt', 'Sauce au yaourt et aux herbes, en portion.', 0.50, '🥣', ['Lait'], ['vegetarien'], []],
    ['salsa-piccante', $S, 'Sauce piquante', 'Sauce pimentée maison, en portion.', 0.50, '🌶️', [], ['vegan', 'vegetarien'], []],
    ['salsa-barbecue', $S, 'Sauce barbecue', 'Sauce barbecue fumée, en portion.', 0.50, '🥫', ['Moutarde'], ['vegan', 'vegetarien'], []],
    ['ketchup', $S, 'Ketchup', 'Portion de ketchup.', 0.50, '🍅', [], ['vegan', 'vegetarien'], []],
    ['maionese', $S, 'Mayonnaise', 'Portion de mayonnaise.', 0.50, '🥚', ['Œufs', 'Moutarde'], ['vegetarien'], []],
    ['extra-carne', $S, 'Supplément viande', 'Portion supplémentaire de viande kebab.', 2.00, '🥩', [], [], []],
    ['extra-formaggio', $S, 'Supplément fromage', 'Portion de fromage fondu.', 1.00, '🧀', ['Lait'], ['vegetarien'], []],
];

$pdo->beginTransaction();
try {
    $groupId = [];
    foreach ($groupsDef as $key => [$name, $type, $req, $min, $max, $opts]) {
        $find = $pdo->prepare('SELECT id FROM option_groups WHERE name = :n');
        $find->execute(['n' => $name]);
        $id = $find->fetchColumn();
        if (!$id) {
            $pdo->prepare('INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select) VALUES (:n, :t, :r, :mi, :ma)')
                ->execute(['n' => $name, 't' => $type, 'r' => $req, 'mi' => $min, 'ma' => $max]);
            $id = $pdo->lastInsertId();
        }
        $groupId[$key] = (int) $id;
        foreach ($opts as $i => [$label, $delta]) {
            $pdo->prepare('INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order) VALUES (:g, :l, :d, :s)')
                ->execute(['g' => $id, 'l' => $label, 'd' => $delta, 's' => $i]);
        }
    }

    $created = 0;
    $kept = 0;
    foreach ($products as $i => [$slug, $catName, $name, $desc, $price, $emoji, $allergens, $tags, $groups]) {
        $exists = $pdo->prepare('SELECT id FROM products WHERE slug = :s');
        $exists->execute(['s' => $slug]);
        if ($exists->fetchColumn()) {
            $kept++;
            continue;
        }
        $pdo->prepare(
            'INSERT INTO products (category_id, slug, name, description, base_price, emoji, available, allergens, dietary_tags)
             VALUES (:c, :s, :n, :d, :p, :e, 1, :a, :t)'
        )->execute([
            'c' => $cat[$catName], 's' => $slug, 'n' => $name, 'd' => $desc, 'p' => $price, 'e' => $emoji,
            'a' => implode(',', $allergens), 't' => implode(',', $tags),
        ]);
        $pid = (int) $pdo->lastInsertId();
        foreach ($groups as $order => $g) {
            $pdo->prepare('INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order) VALUES (:p, :g, :o)')
                ->execute(['p' => $pid, 'g' => $groupId[$g], 'o' => $order]);
        }
        $created++;
    }

    // Restaurant avant tout : le menu Kebab passe en tête (onglets, catalogue).
    $pdo->exec("UPDATE menus SET sort_order = 1 WHERE slug = 'kebab'");
    $pdo->exec("UPDATE menus SET sort_order = 2 WHERE slug = 'cafe'");

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'Échec, rien n\'a été modifié : ' . $e->getMessage() . "\n");
    exit(1);
}
echo "Produits créés : $created · déjà présents (non modifiés) : $kept\n";
echo "Groupes d'options : " . implode(', ', array_map(fn($k, $v) => "$k=#$v", array_keys($groupId), $groupId)) . "\n";
echo "Ordre des menus : Kebab puis Café.\n";
