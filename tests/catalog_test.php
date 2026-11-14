<?php
/**
 * SOUCOFFE — tests des menus (cartes), catégories, offre Kebab et passage à l'euro (migration 023).
 *
 * Usage : php tests/catalog_test.php [http://127.0.0.1:8000/api]
 * Données préfixées « ZZTEST » / « zz-test », supprimées au début et à la fin.
 * Les menus Café / Kebab et leurs catégories réelles ne sont jamais modifiés.
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
function cleanup(PDO $pdo): void
{
    $p = $pdo->query("SELECT GROUP_CONCAT(id) FROM products WHERE name LIKE 'ZZTEST%'")->fetchColumn() ?: '0';
    $c = $pdo->query("SELECT GROUP_CONCAT(id) FROM clients WHERE first_name = 'ZZTEST'")->fetchColumn() ?: '0';
    $o = $pdo->query("SELECT GROUP_CONCAT(id) FROM orders WHERE client_id IN ($c)")->fetchColumn() ?: '0';
    foreach ([
        "DELETE FROM order_item_options WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN ($o))",
        "DELETE FROM order_items WHERE order_id IN ($o)", "DELETE FROM order_status_history WHERE order_id IN ($o)",
        "DELETE FROM loyalty_transactions WHERE order_id IN ($o)", "DELETE FROM orders WHERE id IN ($o)",
        "DELETE FROM product_option_groups WHERE product_id IN ($p)", "DELETE FROM products WHERE id IN ($p)",
        "DELETE FROM categories WHERE name LIKE 'ZZTEST%'", "DELETE FROM menus WHERE name LIKE 'ZZTEST%'",
        "DELETE FROM promotions WHERE name LIKE 'ZZTEST%'",
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
$snapshot = fn() => $pdo->query("SELECT (SELECT GROUP_CONCAT(CONCAT(id,':',name,':',menu_id,':',sort_order) ORDER BY id) FROM categories) c,
    (SELECT GROUP_CONCAT(CONCAT(id,':',slug,':',name,':',active) ORDER BY id) FROM menus) m,
    (SELECT SUM(base_price) FROM products WHERE name NOT LIKE 'ZZTEST%') p")->fetch();
$before = $snapshot();

$PWD = 'ZzTest-' . bin2hex(random_bytes(6)) . '!';
$tok = [];
foreach (['admin', 'manager', 'server', 'cashier', 'kitchen'] as $role) {
    $pdo->prepare('INSERT INTO staff (role, username, display_name, password_hash) VALUES (:r, :u, :d, :p)')
        ->execute(['r' => $role, 'u' => "zz-test-$role", 'd' => "ZZTEST $role", 'p' => password_hash($PWD, PASSWORD_DEFAULT)]);
    $tok[$role] = req('POST', '/auth/login', ['username' => "zz-test-$role", 'password' => $PWD])[1]['token'] ?? null;
}
$tok['client'] = req('POST', '/clients', ['firstName' => 'ZZTEST', 'lastName' => 'Kebab', 'tableNumber' => '33', 'partySize' => 1])[1]['token'] ?? null;

// ================= LECTURE PUBLIQUE =================
section('Menus publics');
[$s, $r] = req('GET', '/menus');
$slugs = array_column($r['content'] ?? [], 'slug');
ok($s === 200 && array_slice($slugs, 0, 2) === ['kebab', 'cafe'], 'GET /menus : Kebab puis Café (restaurant avant tout)');
$kebab = array_values(array_filter($r['content'], fn($m) => $m['slug'] === 'kebab'))[0];
ok(array_column($kebab['categories'], 'name') === ['Paninis et piadines', 'Assiettes kebab', 'Menus kebab', 'Alternatives', 'Accompagnements', 'Sauces et suppléments'], '6 catégories Kebab dans l\'ordre prévu');
[$s, $cats] = req('GET', '/categories');
$cafeCats = array_filter($cats, fn($c) => $c['menuSlug'] === 'cafe');
ok(count($cafeCats) === 10 && count(array_filter($cats, fn($c) => $c['menuSlug'] === 'kebab')) === 6, '/categories : 10 catégories Café (inchangées) + 6 Kebab, menu indiqué');
ok(!array_diff(['id', 'name', 'sortOrder'], array_keys($cats[0])), '/categories garde ses champs historiques (compatibilité)');

// ================= ACCÈS =================
section('Contrôle d\'accès');
ok(count(array_filter($tok)) === 6, 'comptes de test créés');
foreach (['server', 'cashier', 'kitchen', 'client'] as $who) {
    $codes = [req('GET', '/admin/menus', null, $tok[$who])[0], req('POST', '/menus', ['name' => 'ZZTEST x'], $tok[$who])[0],
        req('POST', '/categories', ['name' => 'ZZTEST x', 'menuId' => 1], $tok[$who])[0], req('PATCH', '/categories/2', ['name' => 'x'], $tok[$who])[0],
        req('DELETE', '/menus/2', null, $tok[$who])[0]];
    ok(!array_diff($codes, [403]), "$who : gestion des menus refusée (403)");
}
ok(req('POST', '/menus', ['name' => 'ZZTEST x'])[0] === 401, 'sans jeton : 401');
ok(req('GET', '/admin/menus', null, $tok['manager'])[0] === 200, 'manager : accès autorisé');

// ================= MENUS =================
section('Menus');
[$s, $m] = req('POST', '/menus', ['name' => 'ZZTEST Pizza', 'tagline' => 'Au feu de bois'], $tok['admin']);
ok($s === 201 && $m['slug'] === 'zztest-pizza' && $m['active'] === true && $m['categories'] === [], 'admin : menu créé (slug généré, actif, vide)');
$mid = $m['id'] ?? 0;
ok(req('POST', '/menus', ['name' => 'zztest pizza'], $tok['admin'])[0] === 409, 'nom en double (casse ignorée) → 409');
ok(req('POST', '/menus', ['name' => ''], $tok['admin'])[0] === 400, 'nom vide → 400');
ok(req('POST', '/menus', ['name' => 'ZZTEST <b>'], $tok['admin'])[0] === 400, 'nom avec < > → 400');
[$s, $m2] = req('PATCH', "/menus/$mid", ['name' => 'ZZTEST Pizzeria', 'active' => false], $tok['manager']);
ok($s === 200 && $m2['name'] === 'ZZTEST Pizzeria' && $m2['active'] === false && $m2['slug'] === 'zztest-pizza', 'manager : renommé et masqué (adresse inchangée)');
ok(!in_array('zztest-pizza', array_column(req('GET', '/menus')[1]['content'], 'slug'), true), 'menu masqué absent du public');
ok(in_array('zztest-pizza', array_column(req('GET', '/admin/menus', null, $tok['admin'])[1]['content'], 'slug'), true), '…mais visible dans l\'admin');
ok(req('PATCH', '/menus/1', ['active' => false], $tok['admin'])[0] === 409, 'menu Café : désactivation refusée (409)');
ok(req('DELETE', '/menus/1', null, $tok['admin'])[0] === 409, 'menu Café : suppression refusée (409)');
ok(req('PATCH', "/menus/$mid", [], $tok['admin'])[0] === 400, 'aucun champ → 400');
ok(req('PATCH', '/menus/999999', ['name' => 'ZZTEST y'], $tok['admin'])[0] === 404, 'menu inconnu → 404');

// ================= CATÉGORIES =================
section('Catégories');
[$s, $c] = req('POST', '/categories', ['name' => 'ZZTEST Bowls', 'menuId' => $mid], $tok['admin']);
ok($s === 201 && $c['menuId'] === $mid, 'catégorie créée dans le nouveau menu');
$cid = $c['id'] ?? 0;
ok(req('POST', '/categories', ['name' => 'Cafés', 'menuId' => 1], $tok['admin'])[0] === 409, 'nom d\'une catégorie existante → 409');
ok(req('POST', '/categories', ['name' => 'ZZTEST z', 'menuId' => 999999], $tok['admin'])[0] === 400, 'menu inconnu → 400');
ok(req('POST', '/categories', ['name' => 'ZZTEST z'], $tok['admin'])[0] === 400, 'menu manquant → 400');
ok(req('DELETE', "/menus/$mid", null, $tok['admin'])[0] === 409, 'menu non vide : suppression refusée (409)');
[$s, $c2] = req('PATCH', "/categories/$cid", ['name' => 'ZZTEST Bowls & co', 'menuId' => 2, 'sortOrder' => 150], $tok['manager']);
ok($s === 200 && $c2['menuId'] === 2 && $c2['sortOrder'] === 150, 'catégorie renommée, déplacée vers Kebab, réordonnée');
$cats = req('GET', '/categories')[1];
$moved = array_values(array_filter($cats, fn($x) => $x['id'] === $cid))[0] ?? null;
ok($moved && $moved['menuSlug'] === 'kebab' && $moved['name'] === 'ZZTEST Bowls & co', 'catalogue public à jour');
ok(req('DELETE', "/menus/$mid", null, $tok['admin'])[0] === 200, 'menu redevenu vide : supprimé');
ok(req('DELETE', '/categories/2', null, $tok['admin'])[0] === 409, 'catégorie avec produits (Cafés) : suppression refusée (409)');

// ================= PRODUIT KEBAB =================
section('Produit Kebab et commande');
[$s, $p] = req('POST', '/products', ['name' => 'ZZTEST Panino Kebab', 'categoryId' => 12, 'basePrice' => 6.5, 'description' => 'Test'], $tok['admin']);
ok($s === 201 && $p['categoryId'] === 12 && array_column($p['optionGroups'], 'name') === ['Sauce kebab', 'Suppléments kebab'], 'produit ajouté dans « Paninis et piadines » : reçoit les options de la catégorie (sauce, suppléments)');
[$s, $o] = req('POST', '/orders', ['items' => [['productId' => $p['id'], 'quantity' => 2, 'options' => []]]], $tok['client']);
ok($s === 201 && abs($o['total'] - 13.0) < 0.0005, 'commande Kebab avec le panier existant : total 13,00');
ok(req('DELETE', "/categories/12", null, $tok['admin'])[0] === 409, 'catégorie Kebab utilisée : suppression refusée');
[$s, $p2] = req('POST', '/products', ['name' => 'ZZTEST Bowl', 'categoryId' => $cid, 'basePrice' => 7], $tok['admin']);
ok($s === 201, 'produit ajouté dans une catégorie créée depuis l\'admin');

// ================= EURO =================
section('Euro');
$pdo->exec("INSERT INTO promotions (name, kind, value, scope, days_mask, min_order, active) VALUES ('ZZTEST Promo', 'fixed', 1.5, 'order', 127, 12, 1)");
$promo = array_values(array_filter(req('GET', '/promotions/active')[1]['content'] ?? [], fn($x) => $x['name'] === 'ZZTEST Promo'))[0] ?? null;
ok($promo && strpos($promo['summary'], '1,50 €') !== false && strpos($promo['summary'], 'dès 12,00 €') !== false && strpos($promo['summary'], 'DT') === false,
    'libellé de promotion en euros : « ' . ($promo['summary'] ?? '?') . ' »');
$tbl = '33';
[$s, $r] = req('POST', '/auth/logout', null, $tok['client']);
ok($s === 409 && strpos($r['error'] ?? '', '€') !== false && strpos($r['error'] ?? '', 'DT') === false, 'message « reste à régler » en euros : « ' . ($r['error'] ?? '') . ' »');

// ---------- Fin ----------
cleanup($pdo);
section('Intégrité');
ok($snapshot() == $before, 'menus, catégories et prix réels intacts');

echo "\nRÉSULTAT : $pass réussis, $fail échoués\n";
exit($fail === 0 ? 0 : 1);
