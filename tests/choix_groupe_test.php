<?php
/**
 * SOUCOFFE — tests des groupes de choix (admin), des photos multiples, du choix
 * des options d'un produit et de la commande de groupe à table (migration 024).
 *
 * Usage : php tests/choix_groupe_test.php [http://127.0.0.1:8000/api]
 * Données préfixées « ZZTEST » / « zz-test » (tables 35 et 36), supprimées au début et à la fin.
 * Les produits, options et commandes réels ne sont jamais modifiés.
 * Code de sortie : 0 si tout passe, 1 sinon.
 */
require __DIR__ . '/../api/config/database.php';

$API = $argv[1] ?? 'http://127.0.0.1:8000/api';
$pdo = get_pdo_connection();
$pass = 0;
$fail = 0;
$section = '';

function req(string $m, string $path, $body = null, ?string $tok = null): array
{
    global $API;
    $h = "Content-Type: application/json\r\n" . ($tok ? "X-Auth-Token: $tok\r\n" : '');
    $ctx = stream_context_create(['http' => ['method' => $m, 'header' => $h, 'ignore_errors' => true, 'timeout' => 30,
        'content' => $body === null ? '' : (is_string($body) ? $body : json_encode($body))]]);
    $raw = @file_get_contents($API . $path, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $line, $mm)) {
            $status = (int) $mm[1];
        }
    }
    return [$status, json_decode((string) $raw, true)];
}
function ok(bool $c, string $msg): void
{
    global $pass, $fail, $section;
    if ($c) {
        $pass++;
        echo "  PASS $msg\n";
    } else {
        $fail++;
        echo "  FAIL [$section] $msg\n";
    }
}
function section(string $s): void
{
    global $section;
    $section = $s;
    echo "\n== $s\n";
}
function tinyPng(): string
{
    $chunk = fn(string $t, string $d) => pack('N', strlen($d)) . $t . $d . pack('N', crc32($t . $d));
    $raw = str_repeat("\0" . str_repeat("\x8B\x5A\x2B", 16), 16);
    return "\x89PNG\r\n\x1a\n" . $chunk('IHDR', pack('NNCCCCC', 16, 16, 8, 2, 0, 0, 0)) . $chunk('IDAT', gzcompress($raw)) . $chunk('IEND', '');
}
function cleanup(PDO $pdo): void
{
    foreach (glob(dirname(__DIR__) . '/images/products/zztest-*') ?: [] as $f) {
        @unlink($f);
    }
    $p = $pdo->query("SELECT GROUP_CONCAT(id) FROM products WHERE name LIKE 'ZZTEST%'")->fetchColumn() ?: '0';
    $c = $pdo->query("SELECT GROUP_CONCAT(id) FROM clients WHERE first_name = 'ZZTEST'")->fetchColumn() ?: '0';
    $o = $pdo->query("SELECT GROUP_CONCAT(id) FROM orders WHERE client_id IN ($c)")->fetchColumn() ?: '0';
    $g = $pdo->query("SELECT GROUP_CONCAT(id) FROM option_groups WHERE name LIKE 'ZZTEST%'")->fetchColumn() ?: '0';
    foreach ([
        "DELETE FROM order_item_options WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN ($o))",
        "DELETE FROM order_items WHERE order_id IN ($o)", "DELETE FROM order_status_history WHERE order_id IN ($o)",
        "DELETE FROM loyalty_transactions WHERE order_id IN ($o)", "DELETE FROM orders WHERE id IN ($o)",
        "DELETE FROM table_groups WHERE table_number IN ('35', '36')",
        "DELETE FROM product_images WHERE product_id IN ($p)",
        "DELETE FROM product_option_groups WHERE product_id IN ($p) OR option_group_id IN ($g)", "DELETE FROM products WHERE id IN ($p)",
        "DELETE FROM options WHERE option_group_id IN ($g)", "DELETE FROM option_groups WHERE id IN ($g)",
        "DELETE FROM client_presence WHERE client_id IN ($c)",
        "DELETE FROM auth_sessions WHERE client_id IN ($c) OR staff_id IN (SELECT id FROM staff WHERE username LIKE 'zz-test-%')",
        "DELETE FROM clients WHERE id IN ($c)", "DELETE FROM staff WHERE username LIKE 'zz-test-%'",
    ] as $sql) {
        $pdo->exec($sql);
    }
}

[$st] = req('GET', '/categories');
if ($st !== 200) {
    fwrite(STDERR, "API injoignable sur $API (lancez scripts/start-lan.vbs)\n");
    exit(1);
}
cleanup($pdo);
$snapshot = fn() => $pdo->query("SELECT (SELECT COUNT(*) FROM products WHERE name NOT LIKE 'ZZTEST%') n,
    (SELECT SUM(base_price) FROM products WHERE name NOT LIKE 'ZZTEST%') p,
    (SELECT GROUP_CONCAT(CONCAT(id,':',label,':',price_delta) ORDER BY id) FROM options) o,
    (SELECT GROUP_CONCAT(CONCAT(product_id,':',option_group_id) ORDER BY product_id, option_group_id) FROM product_option_groups) pog,
    (SELECT COUNT(*) FROM orders) ord")->fetch();
$before = $snapshot();

$PWD = 'ZzTest-' . bin2hex(random_bytes(6)) . '!';
$tok = [];
foreach (['admin', 'manager', 'server', 'cashier', 'kitchen'] as $role) {
    $pdo->prepare('INSERT INTO staff (role, username, display_name, password_hash) VALUES (:r, :u, :d, :p)')
        ->execute(['r' => $role, 'u' => "zz-test-$role", 'd' => "ZZTEST $role", 'p' => password_hash($PWD, PASSWORD_DEFAULT)]);
    $tok[$role] = req('POST', '/auth/login', ['username' => "zz-test-$role", 'password' => $PWD])[1]['token'] ?? null;
}
foreach ([['a', 'Alice', '35'], ['b', 'Bruno', '35'], ['c', 'Carla', '36']] as [$k, $last, $t]) {
    $tok[$k] = req('POST', '/clients', ['firstName' => 'ZZTEST', 'lastName' => $last, 'tableNumber' => $t, 'partySize' => 2])[1]['token'] ?? null;
}
$png = 'data:image/png;base64,' . base64_encode(tinyPng());

// ================= GROUPES DE CHOIX =================
section('Groupes de choix (admin)');
foreach (['server', 'cashier', 'kitchen', 'a'] as $who) {
    ok(req('GET', '/admin/option-groups', null, $tok[$who])[0] === 403, "$who : liste des groupes refusée (403)");
}
[$s, $list] = req('GET', '/admin/option-groups', null, $tok['admin']);
$sauce = array_values(array_filter($list['content'] ?? [], fn($g) => $g['name'] === 'Sauce kebab'))[0] ?? null;
ok($s === 200 && $sauce && count($sauce['options']) === 5 && in_array('Sandwich kebab', $sauce['products'], true), 'admin : groupes listés avec leurs choix et produits (Sauce kebab)');
[$s, $pain] = req('POST', '/option-groups', ['name' => 'ZZTEST Pain', 'multiple' => false, 'required' => true,
    'options' => [['label' => 'Pain turc', 'priceDelta' => 0], ['label' => 'Pain complet', 'priceDelta' => 0.5]]], $tok['manager']);
ok($s === 201 && $pain['required'] === true && $pain['multiple'] === false && count($pain['options']) === 2, 'manager : groupe « Pain » créé (1 choix, obligatoire)');
[$s, $extra] = req('POST', '/option-groups', ['name' => 'ZZTEST Garnitures', 'multiple' => true, 'required' => false, 'max' => 2,
    'options' => [['label' => 'Salade'], ['label' => 'Tomate'], ['label' => 'Oignon']]], $tok['admin']);
ok($s === 201 && $extra['max'] === 2 && $extra['multiple'] === true, 'admin : groupe à plusieurs choix (2 maximum) créé');
foreach ([
    'sans choix' => ['name' => 'ZZTEST X', 'options' => []],
    'choix en double' => ['name' => 'ZZTEST X', 'options' => [['label' => 'A'], ['label' => 'a']]],
    'supplément négatif' => ['name' => 'ZZTEST X', 'options' => [['label' => 'A', 'priceDelta' => -1]]],
    'maximum 0' => ['name' => 'ZZTEST X', 'multiple' => true, 'max' => 0, 'options' => [['label' => 'A']]],
    'sans nom' => ['options' => [['label' => 'A']]],
] as $label => $body) {
    ok(req('POST', '/option-groups', $body, $tok['admin'])[0] === 400, "$label → 400");
}
$o1 = $pain['options'][0]['id'];
$o2 = $pain['options'][1]['id'];
[$s, $swap] = req('PATCH', "/option-groups/{$pain['id']}", ['options' => [
    ['id' => $o1, 'label' => 'Pain complet', 'priceDelta' => 0.5], ['id' => $o2, 'label' => 'Pain turc', 'priceDelta' => 0],
    ['label' => 'Pain sans gluten', 'priceDelta' => 1]]], $tok['admin']);
ok($s === 200 && array_column($swap['options'], 'label') === ['Pain complet', 'Pain turc', 'Pain sans gluten'], 'échange de libellés + ajout d\'un choix');
[$s, $back] = req('PATCH', "/option-groups/{$pain['id']}", ['options' => [
    ['id' => $o1, 'label' => 'Pain turc', 'priceDelta' => 0], ['id' => $o2, 'label' => 'Pain complet', 'priceDelta' => 0.5]]], $tok['admin']);
ok($s === 200 && count($back['options']) === 2, 'choix jamais commandé retiré');

// ================= PRODUIT : PHOTOS + CHOIX =================
section('Produit : plusieurs photos et choix');
[$s, $p] = req('POST', '/products', ['name' => 'ZZTEST Panino Galerie', 'categoryId' => 12, 'basePrice' => 6,
    'images' => [$png, $png, '../images/products/espresso.jpg'], 'optionGroupIds' => [$pain['id'], $sauce['id']]], $tok['admin']);
ok($s === 201 && preg_match('#^\.\./images/products/zztest-panino-galerie-[0-9a-f]{6}\.png$#', $p['imageUrl'] ?? ''), 'photo principale = 1re photo importée (' . ($p['imageUrl'] ?? '') . ')');
ok(count($p['images'] ?? []) === 2 && ($p['images'][1] ?? '') === '../images/products/espresso.jpg', 'galerie : 2 photos supplémentaires, dans l\'ordre');
ok(is_file(dirname(__DIR__) . '/' . substr($p['images'][0] ?? 'x', 3)), 'photos écrites dans images/products/');
ok(array_column($p['optionGroups'], 'name') === ['ZZTEST Pain', 'Sauce kebab'], 'choix choisis dans l\'admin (et non ceux de la catégorie), dans l\'ordre');
$listed = array_values(array_filter(req('GET', '/products?limit=100&search=ZZTEST')[1]['content'] ?? [], fn($x) => $x['id'] === $p['id']))[0] ?? null;
ok($listed && count($listed['images']) === 2, 'galerie présente dans la liste publique des produits');
foreach ([
    'groupe inconnu' => ['optionGroupIds' => [999999]],
    '7 photos' => ['images' => array_fill(0, 7, '../images/products/espresso.jpg')],
    'lien javascript:' => ['images' => ['javascript:alert(1)']],
    'images + imageUrl' => ['images' => [$png], 'imageUrl' => '../images/products/espresso.jpg'],
] as $label => $extraBody) {
    ok(req('POST', '/products', ['name' => 'ZZTEST Invalide', 'categoryId' => 12, 'basePrice' => 5] + $extraBody, $tok['admin'])[0] === 400, "création : $label → 400");
}
[$s, $p0] = req('POST', '/products', ['name' => 'ZZTEST Sans choix', 'categoryId' => 12, 'basePrice' => 5, 'optionGroupIds' => []], $tok['admin']);
ok($s === 201 && $p0['optionGroups'] === [], 'produit créé sans aucun choix (liste vide)');
foreach (['server', 'cashier', 'kitchen'] as $who) {
    ok(req('PATCH', "/products/{$p['id']}", ['optionGroupIds' => []], $tok[$who])[0] === 403, "$who : modification des choix refusée (403)");
}
[$s, $pp] = req('PATCH', "/products/{$p['id']}", ['images' => ['../images/products/espresso.jpg', $png]], $tok['manager']);
ok($s === 200 && $pp['imageUrl'] === '../images/products/espresso.jpg' && count($pp['images']) === 1, 'manager : photos remplacées (principale + galerie)');
ok(($pp['basePrice'] ?? 0) == 6 && count($pp['optionGroups']) === 2, 'prix et choix inchangés par les photos');

// ================= COMMANDE AVEC CHOIX =================
section('Commande avec le choix du pain');
$painOpts = array_column($back['options'], 'id', 'label');
ok(req('POST', '/orders', ['items' => [['productId' => $p['id'], 'quantity' => 1, 'options' => []]]], $tok['a'])[0] === 400, 'pain obligatoire : commande sans pain refusée');
[$s, $ord] = req('POST', '/orders', ['items' => [['productId' => $p['id'], 'quantity' => 2, 'options' => [['optionId' => $painOpts['Pain complet']]]]]], $tok['a']);
ok($s === 201 && abs($ord['total'] - 13.0) < 0.0005, 'pain complet (+0,50 €) × 2 : total 13,00 €');
ok(req('PATCH', "/option-groups/{$pain['id']}", ['options' => [['id' => $o1, 'label' => 'Pain turc', 'priceDelta' => 0]]], $tok['admin'])[0] === 409, 'choix déjà commandé : retrait refusé (409)');
ok(req('DELETE', "/option-groups/{$pain['id']}", null, $tok['admin'])[0] === 409, 'groupe utilisé : suppression refusée (409)');
ok(req('DELETE', "/option-groups/{$extra['id']}", null, $tok['admin'])[0] === 200, 'groupe inutilisé : supprimé');
[$s, $pp] = req('PATCH', "/products/{$p['id']}", ['optionGroupIds' => [$sauce['id']]], $tok['admin']);
ok($s === 200 && array_column($pp['optionGroups'], 'name') === ['Sauce kebab'], 'admin : choix du produit modifiés (pain retiré)');
ok(req('POST', '/orders', ['items' => [['productId' => $p['id'], 'quantity' => 1, 'options' => []]]], $tok['a'])[0] === 201, 'commande sans pain acceptée une fois le groupe retiré');

// ================= COMMANDE DE GROUPE =================
section('Commande de groupe à table');
[$s, $g] = req('GET', '/group', null, $tok['a']);
ok($s === 200 && $g['table'] === '35' && $g['items'] === [], 'panier de la table vide au départ');
ok(req('GET', '/group', null, $tok['admin'])[0] === 403, 'personnel : pas de panier de table (403)');
// Frites : sauce au choix, aucun choix obligatoire.
$espresso = (int) $pdo->query("SELECT id FROM products WHERE slug = 'patatine-fritte'")->fetchColumn();
$sauceYaourt = array_column($sauce['options'], 'id', 'label')['Sauce yaourt'];
[$s, $g] = req('POST', '/group/items', ['items' => [
    ['productId' => $espresso, 'quantity' => 2, 'options' => [['optionId' => $sauceYaourt]], 'unitPrice' => 0.01],
]], $tok['a']);
$basePanino = (float) $pdo->query("SELECT base_price FROM products WHERE slug = 'patatine-fritte'")->fetchColumn();
ok($s === 200 && count($g['items']) === 1 && abs($g['items'][0]['unitPrice'] - $basePanino) < 0.0005, 'Alice ajoute 2 articles : prix calculé par le serveur (le prix envoyé est ignoré)');
ok(strpos($g['items'][0]['label'], 'Sauce yaourt') !== false && $g['items'][0]['mine'] === true, 'libellé avec les choix, marqué « à moi »');
[$s, $g] = req('POST', '/group/items', ['items' => [['productId' => $p['id'], 'quantity' => 1, 'options' => []]]], $tok['b']);
ok($s === 200 && count($g['items']) === 2 && $g['items'][0]['mine'] === false && $g['items'][0]['author'] === 'ZZTEST A.', 'Bruno (même table) voit l\'article d\'Alice et ajoute le sien');
ok(count($g['members']) === 2, '2 personnes dans le panier de la table');
[$s, $gc] = req('GET', '/group', null, $tok['c']);
ok($s === 200 && $gc['items'] === [], 'Carla (autre table) ne voit rien');
ok(req('POST', '/group/items', ['items' => [['productId' => 999999, 'quantity' => 1]]], $tok['a'])[0] >= 400, 'produit inconnu refusé');
ok(req('POST', '/group/items', ['items' => [['productId' => $espresso, 'quantity' => 0]]], $tok['a'])[0] === 400, 'quantité 0 refusée');
ok(req('DELETE', "/group/items/{$g['items'][0]['id']}", null, $tok['b'])[0] === 403, 'Bruno ne peut pas retirer l\'article d\'Alice (403)');
ok(req('DELETE', "/group/items/{$g['items'][0]['id']}", null, $tok['c'])[0] === 404, 'autre table : article introuvable (404)');
[$s, $g2] = req('POST', '/group/items', ['items' => [['productId' => $p0['id'], 'quantity' => 1]]], $tok['a']);
$tmp = end($g2['items']);
ok(req('DELETE', "/group/items/{$tmp['id']}", null, $tok['a'])[0] === 200, 'Alice retire son propre article');
$expected = round($basePanino * 2 + 6, 3);
[$s, $sent] = req('POST', '/group/send', null, $tok['b']);
ok($s === 201 && $sent['orderId'] > 0 && $sent['items'] === [], 'Bruno envoie : UNE commande créée, panier de la table vidé');
$order = $pdo->query('SELECT * FROM orders WHERE id = ' . (int) $sent['orderId'])->fetch();
ok($order && abs((float) $order['subtotal'] - $expected) < 0.0005, 'montant de la commande = somme des articles (' . number_format($expected, 2, ',', '') . ' €)');
$notes = $pdo->query('SELECT GROUP_CONCAT(note ORDER BY id) FROM order_items WHERE order_id = ' . (int) $sent['orderId'])->fetchColumn();
ok($notes === 'Pour ZZTEST A.,Pour ZZTEST B.', 'chaque plat indique pour qui il est (« Pour ZZTEST A. »)');
$ls = $sent['lastSent'] ?? null;
ok($ls && $ls['orderId'] === $sent['orderId'] && count($ls['split']) === 2 && abs(array_sum(array_column($ls['split'], 'share')) - $ls['total']) < 0.02, 'partage de l\'addition : la somme des parts = total');
ok($ls && abs($ls['equalShare'] * 2 - $ls['total']) < 0.02, 'parts égales = total / 2');
[$s, $ga] = req('GET', '/group', null, $tok['a']);
ok(($ga['lastSent']['orderId'] ?? 0) === $sent['orderId'], 'Alice voit aussi la commande envoyée et le partage');
ok(req('POST', '/group/send', null, $tok['a'])[0] === 400, 'renvoyer un panier vide → 400');

// ---------- Fin ----------
cleanup($pdo);
section('Intégrité');
ok($snapshot() == $before, 'produits, prix, options, liens et commandes réels intacts');
ok(!glob(dirname(__DIR__) . '/images/products/zztest-*'), 'photos de test supprimées');

echo "\nRÉSULTAT : $pass réussis, $fail échoués\n";
exit($fail === 0 ? 0 : 1);
