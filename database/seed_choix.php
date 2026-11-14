<?php
/**
 * Choix supplémentaires pour les clients (« tout a un choix ») — réexécutable.
 *
 *  - « Pain » (1 choix, obligatoire) : Pain turc, Piadina, Pain complet (+0,50 €),
 *    Pain sans gluten (+1,00 €) — sandwichs, piadines et leurs menus Kebab.
 *  - Choix GRATUITS pour les produits qui n'en avaient aucun (aucun prix inventé) :
 *    cuisson de l'œuf, préférences, glace, sauce des onion rings, service des sauces.
 *  - « Formule Petit Déjeuner » (« café au choix ») reçoit le groupe existant « Boisson chaude ».
 *
 * Ajouts uniquement : aucun prix de produit, aucune option existante, aucun lien
 * existant n'est modifié ou supprimé. Les prix des choix se changent ensuite dans
 * l'admin (Menus et catégories > Groupes de choix).
 *
 * Usage : php database/seed_choix.php
 */
require __DIR__ . '/../api/config/database.php';
$pdo = get_pdo_connection();

/** Crée le groupe s'il n'existe pas (par son nom) ; renvoie son id. */
function group(PDO $pdo, string $name, bool $multiple, bool $required, ?int $max, array $options): int
{
    $s = $pdo->prepare('SELECT id FROM option_groups WHERE name = :n ORDER BY id LIMIT 1');
    $s->execute(['n' => $name]);
    $id = $s->fetchColumn();
    if ($id) {
        return (int) $id;
    }
    $pdo->prepare('INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select) VALUES (:n, :t, :r, :mi, :ma)')
        ->execute(['n' => $name, 't' => $multiple ? 'MULTIPLE' : 'SINGLE', 'r' => $required ? 1 : 0, 'mi' => $required ? 1 : 0, 'ma' => $multiple ? $max : 1]);
    $id = (int) $pdo->lastInsertId();
    $ins = $pdo->prepare('INSERT INTO options (option_group_id, label, price_delta, sort_order) VALUES (:g, :l, :p, :s)');
    foreach ($options as $i => [$label, $price]) {
        $ins->execute(['g' => $id, 'l' => $label, 'p' => $price, 's' => ($i + 1) * 10]);
    }
    echo "Groupe créé : $name\n";
    return $id;
}

/** Attache le groupe aux produits (par slug) qui ne l'ont pas encore. */
function attach(PDO $pdo, int $groupId, array $slugs, int $sort): int
{
    $n = 0;
    $find = $pdo->prepare('SELECT id FROM products WHERE slug = :s AND deleted_at IS NULL');
    $ins = $pdo->prepare('INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order) VALUES (:p, :g, :o)');
    foreach ($slugs as $slug) {
        $find->execute(['s' => $slug]);
        $pid = $find->fetchColumn();
        if (!$pid) {
            echo "  (produit absent : $slug)\n";
            continue;
        }
        $ins->execute(['p' => $pid, 'g' => $groupId, 'o' => $sort]);
        $n += $ins->rowCount();
    }
    return $n;
}

$pdo->beginTransaction();
try {
    $pain = group($pdo, 'Pain', false, true, null, [['Pain turc', 0], ['Piadina', 0], ['Pain complet', 0.5], ['Pain sans gluten', 1.0]]);
    $oeuf = group($pdo, "Cuisson de l'œuf", false, true, null, [['Au plat', 0], ['Brouillés', 0], ['Omelette', 0], ['Dur', 0]]);
    $pref = group($pdo, 'Préférences', true, false, null, [['Sans gluten si possible', 0], ['Sans lactose si possible', 0], ['Sans sucre ajouté', 0]]);
    $servi = group($pdo, 'Servi', false, true, null, [['À part', 0], ['Dans le plat', 0]]);

    $boissonChaude = (int) $pdo->query("SELECT id FROM option_groups WHERE name = 'Boisson chaude' ORDER BY id LIMIT 1")->fetchColumn();
    $glace = (int) $pdo->query("SELECT id FROM option_groups WHERE name = 'Glace' ORDER BY id LIMIT 1")->fetchColumn();
    $sauce = (int) $pdo->query("SELECT id FROM option_groups WHERE name = 'Sauce kebab' ORDER BY id LIMIT 1")->fetchColumn();

    $links = 0;
    // Pain en premier (ordre -1, avant tout autre choix) : sandwichs, piadines, falafels et leurs menus (le durum garde sa galette).
    $links += attach($pdo, $pain, ['panino-kebab', 'doner-kebab', 'piadina-kebab', 'menu-panino-kebab', 'menu-piadina-kebab', 'falafel-panino', 'falafel-piadina'], -1);
    $links += attach($pdo, $oeuf, ['petit-dejeuner-healthy', 'petit-dejeuner-turc'], 10);
    $links += attach($pdo, $pref, ['petit-dejeuner-healthy', 'petit-dejeuner-turc', 'petit-dejeuner-sale', 'petit-dejeuner-sucre', 'coffee-break', 'formule-petit-dejeuner'], 90);
    if ($boissonChaude) {
        $links += attach($pdo, $boissonChaude, ['formule-petit-dejeuner'], 10);
    }
    if ($glace) {
        $links += attach($pdo, $glace, ['coffee-break'], 10);
    }
    if ($sauce) {
        $links += attach($pdo, $sauce, ['onion-rings'], 10);
    }
    $links += attach($pdo, $servi, ['ketchup', 'maionese', 'salsa-barbecue', 'salsa-piccante', 'salsa-yogurt', 'extra-formaggio', 'extra-carne'], 10);
    $pdo->commit();
    echo "Liens ajoutés : $links\n";
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'ÉCHEC, rien n\'a été modifié : ' . $e->getMessage() . "\n");
    exit(1);
}
