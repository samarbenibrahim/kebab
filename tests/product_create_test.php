<?php
/**
 * SOUCOFFE — tests de l'ajout de produit (POST /api/products).
 *
 * Usage : php tests/product_create_test.php [http://127.0.0.1:8000/api] [http://127.0.0.1:8080]
 * Prérequis : API, site et base démarrés (scripts/start-lan.vbs).
 *
 * Données préfixées « ZZTEST » / « zz-test », supprimées au début et à la fin
 * (produits, commandes, photos écrites dans images/products/). Aucun produit
 * réel n'est modifié.
 * Code de sortie : 0 si tout passe, 1 sinon.
 */
require __DIR__ . '/../api/config/database.php';

$API = $argv[1] ?? 'http://127.0.0.1:8000/api';
$SITE = $argv[2] ?? 'http://127.0.0.1:8080';
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
    $root = dirname(__DIR__);
    foreach ($pdo->query("SELECT image_url FROM products WHERE name LIKE 'ZZTEST%' AND image_url LIKE '../images/products/zztest%'")->fetchAll(PDO::FETCH_COLUMN) as $url) {
        @unlink($root . substr($url, 2));
    }
    $p = $pdo->query("SELECT GROUP_CONCAT(id) FROM products WHERE name LIKE 'ZZTEST%'")->fetchColumn() ?: '0';
    $c = $pdo->query("SELECT GROUP_CONCAT(id) FROM clients WHERE first_name = 'ZZTEST'")->fetchColumn() ?: '0';
    $o = $pdo->query("SELECT GROUP_CONCAT(id) FROM orders WHERE client_id IN ($c)")->fetchColumn() ?: '0';
    foreach ([
        "DELETE FROM order_item_options WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN ($o))",
        "DELETE FROM order_items WHERE order_id IN ($o)",
        "DELETE FROM order_status_history WHERE order_id IN ($o)",
        "DELETE FROM loyalty_transactions WHERE order_id IN ($o)",
        "DELETE FROM orders WHERE id IN ($o)",
        "DELETE FROM product_option_groups WHERE product_id IN ($p)",
        "DELETE FROM products WHERE id IN ($p)",
        "DELETE FROM client_presence WHERE client_id IN ($c)",
        "DELETE FROM auth_sessions WHERE client_id IN ($c) OR staff_id IN (SELECT id FROM staff WHERE username LIKE 'zz-test-%')",
        "DELETE FROM clients WHERE id IN ($c)",
        "DELETE FROM staff WHERE username LIKE 'zz-test-%'",
    ] as $sql) {
        $pdo->exec($sql);
    }
}
/** PNG valide minimal (16×16, une couleur) fabriqué sans GD. */
function tinyPng(): string
{
    $chunk = fn(string $t, string $d) => pack('N', strlen($d)) . $t . $d . pack('N', crc32($t . $d));
    $raw = str_repeat("\0" . str_repeat("\x8B\x5A\x2B", 16), 16);
    return "\x89PNG\r\n\x1a\n" . $chunk('IHDR', pack('NNCCCCC', 16, 16, 8, 2, 0, 0, 0)) . $chunk('IDAT', gzcompress($raw)) . $chunk('IEND', '');
}

[$st] = req('GET', '/categories');
if ($st !== 200) {
    fwrite(STDERR, "API injoignable sur $API (lancez scripts/start-lan.vbs)\n");
    exit(1);
}
cleanup($pdo);
$snapshot = fn() => $pdo->query("SELECT COUNT(*) n, SUM(base_price) s, SUM(available) a, GROUP_CONCAT(slug ORDER BY id) sl FROM products WHERE name NOT LIKE 'ZZTEST%'")->fetch();
$before = $snapshot();

$PWD = 'ZzTest-' . bin2hex(random_bytes(6)) . '!';
$tok = [];
foreach (['admin', 'manager', 'server', 'cashier', 'kitchen'] as $role) {
    $pdo->prepare('INSERT INTO staff (role, username, display_name, password_hash) VALUES (:r, :u, :d, :p)')
        ->execute(['r' => $role, 'u' => "zz-test-$role", 'd' => "ZZTEST $role", 'p' => password_hash($PWD, PASSWORD_DEFAULT)]);
    $tok[$role] = req('POST', '/auth/login', ['username' => "zz-test-$role", 'password' => $PWD])[1]['token'] ?? null;
}
$tok['client'] = req('POST', '/clients', ['firstName' => 'ZZTEST', 'lastName' => 'Client', 'tableNumber' => '31', 'partySize' => 1])[1]['token'] ?? null;
$cats = [];
foreach (req('GET', '/categories')[1] as $c) {
    $cats[$c['name']] = $c['id'];
}
$valid = ['name' => 'ZZTEST Café glacé noisette', 'categoryId' => $cats['Cafés'], 'basePrice' => 7.5, 'description' => 'Test', 'emoji' => '🧊',
    'allergens' => ['Lait', 'Fruits à coque'], 'dietaryTags' => ['vegetarien'], 'calories' => 180];

// ================= ACCÈS =================
section('Contrôle d\'accès');
ok(count(array_filter($tok)) === 6, 'comptes de test créés');
foreach (['server', 'cashier', 'kitchen', 'client'] as $who) {
    ok(req('POST', '/products', $valid, $tok[$who])[0] === 403, "$who : ajout refusé (403)");
}
ok(req('POST', '/products', $valid)[0] === 401, 'sans jeton : 401');
ok((int) $pdo->query("SELECT COUNT(*) FROM products WHERE name LIKE 'ZZTEST%'")->fetchColumn() === 0, 'aucun produit créé par les refus');

// ================= CRÉATION =================
section('Création par l\'admin');
[$s, $p] = req('POST', '/products', $valid, $tok['admin']);
ok($s === 201 && ($p['slug'] ?? '') === 'zztest-cafe-glace-noisette', 'admin : 201, slug généré sans accents (' . ($p['slug'] ?? '?') . ')');
ok(($p['basePrice'] ?? 0) === 7.5 && ($p['available'] ?? null) === true && ($p['emoji'] ?? '') === '🧊' && ($p['calories'] ?? 0) === 180, 'prix, disponibilité, emoji, calories enregistrés');
ok(($p['allergens'] ?? null) === ['Lait', 'Fruits à coque'] && ($p['dietaryTags'] ?? null) === ['vegetarien'], 'allergènes et régime enregistrés');
$groupNames = array_column($p['optionGroups'] ?? [], 'name');
ok($groupNames === ['Service', 'Taille', 'Lait', 'Sucre', 'Extras'], 'options habituelles des cafés reprises : ' . implode(', ', $groupNames));
$newId = $p['id'] ?? 0;
$list = req('GET', '/products?limit=100')[1]['content'] ?? [];
ok(in_array($newId, array_column($list, 'id'), true), 'visible dans le catalogue public (Menu / Cafés)');
$audit = $pdo->query("SELECT actor_name, details FROM audit_log WHERE action = 'product.create' AND entity_id = '$newId'")->fetch();
ok($audit && $audit['actor_name'] === 'ZZTEST admin', 'inscrit dans l\'historique d\'audit');

section('Commande du nouveau produit');
$opts = [];
foreach ($p['optionGroups'] as $g) {
    if ($g['isRequired']) {
        $opts[] = ['optionId' => $g['options'][0]['id']];
        $delta = ($delta ?? 0) + $g['options'][0]['priceDelta'];
    }
}
[$s, $o] = req('POST', '/orders', ['items' => [['productId' => $newId, 'quantity' => 2, 'options' => $opts]]], $tok['client']);
ok($s === 201 && abs(($o['total'] ?? 0) - 2 * (7.5 + ($delta ?? 0))) < 0.0005, 'un client commande le nouveau produit : total calculé par le serveur (' . ($o['total'] ?? '?') . ' DT)');
ok(req('POST', '/orders', ['items' => [['productId' => $newId, 'quantity' => 1, 'options' => []]]], $tok['client'])[0] === 400, 'options obligatoires de la catégorie bien exigées');

section('Création par le manager');
[$s, $p2] = req('POST', '/products', ['name' => 'ZZTEST Offre duo', 'categoryId' => $cats['Petit-déjeuner'], 'basePrice' => 12], $tok['manager']);
ok($s === 201 && ($p2['optionGroups'] ?? null) === [] && array_key_exists('allergens', $p2) && $p2['allergens'] === null && ($p2['dietaryTags'] ?? null) === [], 'manager : 201 ; catégorie hétérogène = sans option ; allergènes non renseignés');
[$s, $p3] = req('POST', '/products', ['name' => 'ZZTEST Café glacé noisette', 'categoryId' => $cats['Desserts'], 'basePrice' => 5, 'allergens' => []], $tok['manager']);
ok($s === 201 && ($p3['slug'] ?? '') === 'zztest-cafe-glace-noisette-2' && ($p3['allergens'] ?? null) === [], 'même nom dans une autre catégorie : slug -2 ; « aucun allergène » enregistré');
[$s, $p4] = req('POST', '/products', ['name' => 'ZZTEST Indispo', 'categoryId' => $cats['Jus'], 'basePrice' => 4, 'available' => false], $tok['manager']);
ok($s === 201 && ($p4['available'] ?? null) === false, 'produit créé en rupture si demandé');

// ================= VALIDATION =================
section('Validation');
$bad = [
    'nom manquant' => ['name' => ''] + $valid,
    'nom avec <script>' => ['name' => 'ZZTEST <b>x</b>'] + $valid,
    'catégorie inconnue' => ['categoryId' => 999999] + $valid,
    'catégorie absente' => array_diff_key($valid, ['categoryId' => 1]),
    'prix nul' => ['basePrice' => 0] + $valid,
    'prix texte' => ['basePrice' => '7'] + $valid,
    'prix > 1000' => ['basePrice' => 1001] + $valid,
    'allergène inconnu' => ['allergens' => ['Plutonium']] + $valid,
    'régime inconnu' => ['dietaryTags' => ['carnivore']] + $valid,
    'calories négatives' => ['calories' => -1] + $valid,
    'emoji = texte' => ['emoji' => 'abc'] + $valid,
    'lien javascript:' => ['imageUrl' => 'javascript:alert(1)'] + $valid,
    'chemin hors images' => ['imageUrl' => '../api/index.php'] + $valid,
    'remontée de dossier' => ['imageUrl' => '../images/../.env.jpg'] + $valid,
    'photo = faux contenu' => ['imageData' => 'data:image/jpeg;base64,' . base64_encode('<?php echo 1; ?>')] + $valid,
    'photo SVG' => ['imageData' => 'data:image/svg+xml;base64,' . base64_encode('<svg/>')] + $valid,
    'lien ET photo' => ['imageUrl' => 'https://exemple.com/a.jpg', 'imageData' => 'data:image/png;base64,' . base64_encode(tinyPng())] + $valid,
];
foreach ($bad as $label => $body) {
    $body['name'] = $body['name'] ?? 'ZZTEST v';
    ok(req('POST', '/products', $body, $tok['admin'])[0] === 400, "$label → 400");
}
ok(req('POST', '/products', '{cassé', $tok['admin'])[0] === 400, 'JSON invalide → 400');
ok(req('POST', '/products', $valid, $tok['admin'])[0] === 409, 'même nom dans la même catégorie → 409');
ok((int) $pdo->query("SELECT COUNT(*) FROM products WHERE name LIKE 'ZZTEST%'")->fetchColumn() === 4, 'aucun produit créé par les requêtes invalides');

// ================= IMAGES =================
section('Images');
[$s, $pi] = req('POST', '/products', ['name' => 'ZZTEST Photo', 'categoryId' => $cats['Desserts'], 'basePrice' => 3,
    'imageData' => 'data:image/png;base64,' . base64_encode(tinyPng())], $tok['admin']);
$url = $pi['imageUrl'] ?? '';
ok($s === 201 && $url === '../images/products/zztest-photo.png', 'photo importée enregistrée sous un nom choisi par le serveur (' . $url . ')');
$file = dirname(__DIR__) . '/images/products/zztest-photo.png';
ok(is_file($file) && file_get_contents($file) === tinyPng(), 'fichier écrit à l\'identique dans images/products/');
$served = @file_get_contents($SITE . '/images/products/zztest-photo.png', false, stream_context_create(['http' => ['ignore_errors' => true]]));
ok($served === tinyPng(), 'photo servie par le site (visible sur les téléphones des clients)');
[$s, $pu] = req('POST', '/products', ['name' => 'ZZTEST Lien', 'categoryId' => $cats['Desserts'], 'basePrice' => 3, 'imageUrl' => 'https://exemple.com/photo.jpg'], $tok['admin']);
ok($s === 201 && ($pu['imageUrl'] ?? '') === 'https://exemple.com/photo.jpg', 'lien https accepté');
[$s, $pl] = req('POST', '/products', ['name' => 'ZZTEST Local', 'categoryId' => $cats['Desserts'], 'basePrice' => 3, 'imageUrl' => '../images/products/espresso.jpg'], $tok['admin']);
ok($s === 201 && ($pl['imageUrl'] ?? '') === '../images/products/espresso.jpg', 'image déjà présente sur le site acceptée');

section('Photo d\'un produit existant (bouton Modifier)');
$pid = $pu['id'] ?? 0;
[$s, $pp] = req('PATCH', "/products/$pid", ['imageData' => 'data:image/png;base64,' . base64_encode(tinyPng())], $tok['manager']);
$patched = $pp['imageUrl'] ?? '';
$pfile = dirname(__DIR__) . '/' . substr($patched, 3);
ok($s === 200 && preg_match('#^\.\./images/products/zztest-lien-[0-9a-f]{6}\.png$#', $patched) && is_file($pfile) && file_get_contents($pfile) === tinyPng(),
    'manager : photo importée enregistrée en base et dans images/products/ (' . $patched . ')');
ok(($pp['basePrice'] ?? null) == 3 && ($pp['name'] ?? '') === 'ZZTEST Lien', 'prix et nom inchangés par la photo');
[$s, $pp2] = req('PATCH', "/products/$pid", ['imageUrl' => '../images/products/espresso.jpg'], $tok['admin']);
ok($s === 200 && ($pp2['imageUrl'] ?? '') === '../images/products/espresso.jpg', 'admin : lien vers une image du site accepté');
[$s, $pp3] = req('PATCH', "/products/$pid", ['imageUrl' => null], $tok['admin']);
ok($s === 200 && is_array($pp3) && array_key_exists('imageUrl', $pp3) && $pp3['imageUrl'] === null, 'photo retirée : retour au visuel par défaut');
foreach (['server', 'cashier', 'kitchen', 'client'] as $who) {
    ok(req('PATCH', "/products/$pid", ['imageUrl' => '../images/products/espresso.jpg'], $tok[$who])[0] === 403, "$who : photo refusée (403)");
}
ok(req('PATCH', "/products/$pid", ['imageUrl' => 'javascript:alert(1)'], $tok['admin'])[0] === 400, 'lien javascript: refusé');
ok(req('PATCH', "/products/$pid", ['imageData' => 'data:image/jpeg;base64,' . base64_encode('<?php echo 1; ?>')], $tok['admin'])[0] === 400, 'faux contenu refusé');
ok(req('PATCH', "/products/$pid", ['imageData' => 'data:image/png;base64,' . base64_encode(tinyPng()), 'imageUrl' => 'https://exemple.com/a.jpg'], $tok['admin'])[0] === 400, 'lien ET photo à la fois refusés');
if (is_file($pfile)) {
    @unlink($pfile);
}

// ---------- Fin ----------
cleanup($pdo);
section('Intégrité');
ok($snapshot() == $before, 'produits réels intacts (nombre, prix, disponibilités, slugs)');
ok((int) $pdo->query("SELECT COUNT(*) FROM products WHERE name LIKE 'ZZTEST%'")->fetchColumn() === 0 && !is_file($file), 'produits et photos de test supprimés');

echo "\nRÉSULTAT : $pass réussis, $fail échoués\n";
exit($fail === 0 ? 0 : 1);
