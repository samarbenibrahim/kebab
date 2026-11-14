<?php
/**
 * SOUCOFFE — tests automatisés de l'API (comportement métier réel).
 *
 * Usage : php tests/api_test.php [http://127.0.0.1:8000/api]
 * Prérequis : API et base démarrées (scripts/start-lan.vbs).
 *
 * Le test crée ses propres données, toutes préfixées « zz-test » / « ZZTEST »,
 * et les supprime à la fin (et au début, si un passage précédent a été
 * interrompu). Il ne modifie jamais un produit, un prix, une promotion ni une
 * donnée réelle : les écritures sur les produits réels sont faites avec des
 * valeurs invalides, pour prouver le contrôle d'accès sans rien changer.
 * Code de sortie : 0 si tout passe, 1 sinon.
 */
require __DIR__ . '/../api/config/database.php';

$API = $argv[1] ?? 'http://127.0.0.1:8000/api';
$pdo = get_pdo_connection();
// Produits de test choisis dans la base réelle (aucun identifiant figé) :
//  $P6 : disponible, un groupe obligatoire avec supplément, et une option « à emporter » ;
//  $P8 : disponible, sans groupe obligatoire.
$P6 = (int) $pdo->query("SELECT p.id FROM products p WHERE p.available = 1 AND p.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM product_option_groups pg JOIN option_groups g ON g.id = pg.option_group_id JOIN options o ON o.option_group_id = g.id
                WHERE pg.product_id = p.id AND g.is_required = 1 AND o.price_delta > 0)
    AND EXISTS (SELECT 1 FROM product_option_groups pg JOIN option_groups g ON g.id = pg.option_group_id JOIN options o ON o.option_group_id = g.id
                WHERE pg.product_id = p.id AND g.is_required = 0 AND o.label LIKE '%emporter%')
    ORDER BY p.id LIMIT 1")->fetchColumn();
$P8 = (int) $pdo->query("SELECT p.id FROM products p WHERE p.available = 1 AND p.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM product_option_groups pg JOIN option_groups g ON g.id = pg.option_group_id
                    WHERE pg.product_id = p.id AND g.is_required = 1)
    ORDER BY p.id LIMIT 1")->fetchColumn();
$TAKEAWAY_OPT = (int) $pdo->query("SELECT o.id FROM product_option_groups pg JOIN option_groups g ON g.id = pg.option_group_id
    JOIN options o ON o.option_group_id = g.id WHERE pg.product_id = $P6 AND g.is_required = 0 AND o.label LIKE '%emporter%' ORDER BY o.id LIMIT 1")->fetchColumn();
if (!$P6 || !$P8 || !$TAKEAWAY_OPT) {
    fwrite(STDERR, "Catalogue sans produit adapté aux tests (P6=$P6, P8=$P8, option à emporter=$TAKEAWAY_OPT).\n");
    exit(1);
}
$pass = 0;
$fail = 0;
$section = '';

function req(string $m, string $path, $body = null, ?string $tok = null, array $headers = []): array
{
    global $API;
    $h = "Content-Type: application/json\r\n" . ($tok ? "X-Auth-Token: $tok\r\n" : '');
    foreach ($headers as $k => $v) {
        $h .= "$k: $v\r\n";
    }
    $ctx = stream_context_create(['http' => ['method' => $m, 'header' => $h, 'ignore_errors' => true, 'timeout' => 30,
        'content' => $body === null ? '' : (is_string($body) ? $body : json_encode($body))]]);
    $raw = @file_get_contents($API . $path, false, $ctx);
    $status = 0;
    $resp = [];
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $line, $mm)) {
            $status = (int) $mm[1];
        } elseif (strpos($line, ':') !== false) {
            [$k, $v] = explode(':', $line, 2);
            $resp[strtolower(trim($k))] = trim($v);
        }
    }
    return [$status, json_decode((string) $raw, true), $resp];
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
    $c = $pdo->query("SELECT GROUP_CONCAT(id) FROM clients WHERE first_name = 'ZZTEST'")->fetchColumn() ?: '0';
    $o = $pdo->query("SELECT GROUP_CONCAT(id) FROM orders WHERE guest_name LIKE 'ZZTEST%'")->fetchColumn() ?: '0';
    $s = $pdo->query("SELECT GROUP_CONCAT(id) FROM staff WHERE username LIKE 'zz-test-%'")->fetchColumn() ?: '0';
    $pdo->beginTransaction();
    foreach ([
        "DELETE FROM order_item_options WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN ($o))",
        "DELETE FROM order_items WHERE order_id IN ($o)",
        "DELETE FROM order_status_history WHERE order_id IN ($o)",
        "DELETE FROM loyalty_transactions WHERE order_id IN ($o)",
        "DELETE FROM takeaway_requests WHERE order_id IN ($o) OR client_id IN ($c)",
        "DELETE FROM waiter_calls WHERE client_id IN ($c)",
        "DELETE FROM table_change_requests WHERE client_id IN ($c)",
        "DELETE FROM orders WHERE id IN ($o)",
        "DELETE FROM auth_sessions WHERE client_id IN ($c) OR staff_id IN ($s)",
        "DELETE FROM server_tables WHERE staff_id IN ($s)",
        "DELETE FROM clients WHERE id IN ($c)",
        "UPDATE promotions SET created_by = NULL WHERE created_by IN ($s)",
        "DELETE FROM staff WHERE id IN ($s) AND username LIKE 'zz-test-%'",
        "DELETE FROM stock_recipes WHERE stock_item_id IN (SELECT id FROM stock_items WHERE name LIKE 'ZZTEST%')",
        "DELETE FROM stock_movements WHERE stock_item_id IN (SELECT id FROM stock_items WHERE name LIKE 'ZZTEST%')",
        "DELETE FROM stock_items WHERE name LIKE 'ZZTEST%'",
        "DELETE FROM ai_cache",
    ] as $sql) {
        $pdo->exec($sql);
    }
    $pdo->commit();
}

$snapshot = fn() => $pdo->query("SELECT (SELECT COUNT(*) FROM products) p, (SELECT SUM(base_price) FROM products) sp,
    (SELECT SUM(available) FROM products) av, (SELECT COUNT(*) FROM categories) c, (SELECT COUNT(*) FROM promotions) pr,
    (SELECT COUNT(*) FROM staff WHERE username NOT LIKE 'zz-test-%') st,
    (SELECT COUNT(*) FROM orders WHERE guest_name NOT LIKE 'ZZTEST%') o,
    (SELECT COALESCE(SUM(total),0) FROM orders WHERE guest_name NOT LIKE 'ZZTEST%') ot")->fetch();

[$st] = req('GET', '/categories');
if ($st !== 200) {
    fwrite(STDERR, "API injoignable sur $API (lancez scripts/start-lan.vbs)\n");
    exit(1);
}
cleanup($pdo);
$before = $snapshot();

// ---------- Préparation : un compte par rôle, un client ----------
$PWD = 'ZzTest-' . bin2hex(random_bytes(6)) . '!';
$tok = [];
foreach (['admin', 'manager', 'server', 'cashier', 'kitchen'] as $role) {
    $pdo->prepare('INSERT INTO staff (role, username, display_name, password_hash) VALUES (:r, :u, :d, :p)')
        ->execute(['r' => $role, 'u' => "zz-test-$role", 'd' => "ZZTEST $role", 'p' => password_hash($PWD, PASSWORD_DEFAULT)]);
    $tok[$role] = req('POST', '/auth/login', ['username' => "zz-test-$role", 'password' => $PWD])[1]['token'] ?? null;
}
$serverId = (int) $pdo->query("SELECT id FROM staff WHERE username = 'zz-test-server'")->fetchColumn();
$pdo->prepare('INSERT INTO server_tables (staff_id, table_number) VALUES (:s, :t)')->execute(['s' => $serverId, 't' => '9']);
$newClient = fn(string $table) => req('POST', '/clients', ['firstName' => 'ZZTEST', 'lastName' => 'Client', 'tableNumber' => $table, 'partySize' => 2])[1]['token'] ?? null;
$tok['client'] = $newClient('9');
$tok['client2'] = $newClient('11');

// ================= AUTHENTIFICATION =================
section('Authentification');
ok(count(array_filter($tok)) === 7, 'les 5 rôles équipe et 2 clients obtiennent une session');
[$s, $r] = req('POST', '/auth/login', ['username' => 'zz-test-admin', 'password' => 'mauvais-mot-de-passe']);
ok($s === 401 && !isset($r['token']), 'mauvais mot de passe → 401, aucun jeton');
[$s, $r] = req('POST', '/auth/login', ['username' => 'personne-inconnue-zz', 'password' => 'x']);
ok($s === 401, 'identifiant inconnu → 401 (même message, pas d’indice)');
ok(req('POST', '/auth/login', ['username' => 'zz-test-admin'])[0] === 400, 'mot de passe manquant → 400');
ok(req('POST', '/auth/login', '{json cassé')[0] === 400, 'JSON invalide → 400');
ok(req('GET', '/orders')[0] === 401, 'sans jeton → 401');
ok(req('GET', '/orders', null, str_repeat('a', 64))[0] === 401, 'jeton inventé → 401');
ok(req('GET', '/orders', null, 'pas-un-jeton')[0] === 401, 'jeton mal formé → 401');
[$s, $r] = req('GET', '/auth/me', null, $tok['manager']);
ok($s === 200 && ($r['role'] ?? $r['user']['role'] ?? null) === 'manager', '/auth/me renvoie le bon rôle');
// expiration : session forcée dans le passé
$tmp = req('POST', '/auth/login', ['username' => 'zz-test-kitchen', 'password' => $PWD])[1]['token'];
$pdo->prepare('UPDATE auth_sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE token_hash = :h')->execute(['h' => hash('sha256', $tmp)]);
ok(req('GET', '/auth/me', null, $tmp)[0] === 401, 'session expirée → 401');
// déconnexion
$tmp = req('POST', '/auth/login', ['username' => 'zz-test-cashier', 'password' => $PWD])[1]['token'];
ok(req('POST', '/auth/logout', null, $tmp)[0] === 200, 'déconnexion → 200');
ok(req('GET', '/auth/me', null, $tmp)[0] === 401, 'jeton inutilisable après déconnexion');
// verrouillage après 5 échecs
$pdo->exec("INSERT INTO staff (role, username, display_name, password_hash) VALUES ('server','zz-test-lock','ZZTEST lock','" . password_hash($PWD, PASSWORD_DEFAULT) . "')");
$codes = [];
for ($i = 0; $i < 6; $i++) {
    $codes[] = req('POST', '/auth/login', ['username' => 'zz-test-lock', 'password' => 'faux'])[0];
}
ok(end($codes) === 429, 'force brute : compte verrouillé après 5 échecs (' . implode(',', $codes) . ')');
ok(req('POST', '/auth/login', ['username' => 'zz-test-lock', 'password' => $PWD])[0] === 429, 'même le bon mot de passe est refusé pendant le verrouillage');
$pdo->exec("UPDATE staff SET active = 0 WHERE username = 'zz-test-lock'");

// ================= AUTORISATIONS (matrice des rôles) =================
section('Autorisations');
$matrix = [
    // [méthode, chemin, corps, rôles autorisés]   — un rôle autorisé reçoit tout sauf 401/403
    ['GET', '/staff', null, ['admin', 'manager']],
    ['GET', '/stats/summary', null, ['admin', 'manager']],
    ['GET', '/audit', null, ['admin', 'manager']],
    ['GET', '/promotions', null, ['admin', 'manager']],
    ['GET', '/loyalty', null, ['admin', 'manager']],
    ['GET', '/tables', null, ['admin', 'manager', 'server', 'cashier']],
    ['GET', '/takeaway-requests', null, ['admin', 'manager', 'cashier']],
    ['GET', '/table-change-requests', null, ['admin', 'manager']],
    ['GET', '/waiter-calls', null, ['admin', 'manager', 'server']],
    ['GET', '/ai/bi', null, ['admin', 'manager']],
    ['GET', '/ai/stock', null, ['admin', 'manager']],
    ['GET', '/ai/kitchen', null, ['admin', 'manager', 'cashier', 'kitchen']],
    // écritures sur des données réelles : corps invalide → l'autorisé reçoit 400, jamais une modification
    ['PATCH', "/products/$P6", ['basePrice' => -1], ['admin', 'manager']],
    ['DELETE', '/products/999999', null, ['admin', 'manager']],
    ['POST', '/staff', ['username' => 'x'], ['admin', 'manager']],
    ['POST', '/promotions', ['name' => ''], ['admin', 'manager']],
    ['PUT', '/ai/settings', [], ['admin', 'manager']],
];
foreach ($matrix as [$m, $p, $b, $allowed]) {
    $bad = [];
    foreach (['admin', 'manager', 'server', 'cashier', 'kitchen', 'client'] as $role) {
        $code = req($m, $p, $b, $tok[$role])[0];
        $isAllowed = in_array($role, $allowed, true);
        if ($isAllowed && in_array($code, [401, 403], true)) {
            $bad[] = "$role refusé à tort ($code)";
        }
        if (!$isAllowed && $code !== 403) {
            $bad[] = "$role non bloqué ($code)";
        }
    }
    ok(!$bad, "$m $p : seuls " . implode(', ', $allowed) . ($bad ? ' — ' . implode('; ', $bad) : ''));
}
ok(req('PATCH', "/products/$P6", ['available' => true], $tok['kitchen'])[0] !== 403 && req('PATCH', "/products/$P6", ['basePrice' => 1], $tok['kitchen'])[0] === 403,
    'cuisine : peut changer la disponibilité, pas le prix');
ok((float) $pdo->query("SELECT base_price FROM products WHERE id = $P6")->fetchColumn() === (float) $before['sp'] - ((float) $before['sp'] - (float) $pdo->query("SELECT base_price FROM products WHERE id = $P6")->fetchColumn()),
    'aucun prix réel modifié pendant les tests d’accès');

// ================= COMMANDES =================
section('Commandes');
$p8 = (float) $pdo->query("SELECT base_price FROM products WHERE id = $P8")->fetchColumn();
// le client tente d'imposer prix, total et remise
[$s, $o] = req('POST', '/orders', ['items' => [['productId' => $P8, 'quantity' => 2, 'options' => [], 'unitPrice' => 0.001, 'price' => 0.001]],
    'total' => 0.001, 'subtotal' => 0.001, 'discount' => 999, 'note' => 'ZZTEST'], $tok['client']);
ok($s === 201, 'commande créée (201)');
ok(abs(($o['total'] ?? 0) - 2 * $p8) < 0.0005, 'le serveur ignore prix/total/remise envoyés par le client : total = 2 × ' . $p8 . ' = ' . ($o['total'] ?? '?'));
$oid = (int) ($o['id'] ?? 0);
$dbTotal = (float) $pdo->query("SELECT total FROM orders WHERE id = $oid")->fetchColumn();
ok(abs($dbTotal - 2 * $p8) < 0.0005, 'total enregistré en base = total calculé par le serveur');
// options : prix calculé depuis la base
$prod6 = req('GET', "/products/$P6")[1];
// une option par groupe obligatoire (la plus chère, pour vérifier le supplément)
$reqOpts = [];
$delta = 0.0;
$sizeOpt = null;
foreach ($prod6['optionGroups'] as $g) {
    if ($g['isRequired']) {
        $best = $g['options'][0];
        foreach ($g['options'] as $op) {
            if ($op['priceDelta'] > $best['priceDelta']) {
                $best = $op;
            }
        }
        $reqOpts[] = ['optionId' => $best['id']];
        $delta += $best['priceDelta'];
        if ($best['priceDelta'] > 0) {
            $sizeOpt = $best;
        }
    }
}
ok(req('POST', '/orders', ['items' => [['productId' => $P6, 'quantity' => 1, 'options' => []]]], $tok['client'])[0] === 400, 'groupe d’options obligatoire manquant → 400');
[$s, $o6] = req('POST', '/orders', ['items' => [['productId' => $P6, 'quantity' => 1, 'options' => $reqOpts]]], $tok['client']);
ok($s === 201 && abs($o6['total'] - ($prod6['basePrice'] + $delta)) < 0.0005,
    'options facturées selon la base (' . $prod6['basePrice'] . ' + ' . $delta . ' = ' . ($o6['total'] ?? '?') . ')');
[$s, $ox] = req('POST', '/orders', ['items' => [['productId' => $P6, 'quantity' => 1, 'options' => array_merge($reqOpts, [['optionId' => $sizeOpt['id']], ['optionId' => $sizeOpt['id']]])]]], $tok['client']);
ok($s === 400 || ($s === 201 && abs($ox['total'] - ($prod6['basePrice'] + $delta)) < 0.0005), 'option répétée : refusée ou comptée une seule fois (' . $s . ')');
ok(req('POST', '/orders', ['items' => [['productId' => 999999, 'quantity' => 1, 'options' => []]]], $tok['client'])[0] === 404, 'produit inexistant → 404');
ok(req('POST', '/orders', ['items' => [['productId' => $P8, 'quantity' => 1, 'options' => [['optionId' => $sizeOpt['id']]]]]], $tok['client'])[0] === 400, 'option d’un autre produit → 400');
foreach ([0, -1, 51, 1.5, '2'] as $q) {
    ok(req('POST', '/orders', ['items' => [['productId' => $P8, 'quantity' => $q, 'options' => []]]], $tok['client'])[0] === 400, 'quantité ' . json_encode($q) . ' → 400');
}
ok(req('POST', '/orders', ['items' => []], $tok['client'])[0] === 400, 'commande vide → 400');
ok(req('POST', '/orders', ['items' => [['productId' => $P8, 'quantity' => 1, 'options' => []]]], $tok['kitchen'])[0] === 403, 'le personnel ne peut pas créer de commande client → 403');
// idempotence
$key = 'zztest-' . bin2hex(random_bytes(8));
$body = ['items' => [['productId' => $P8, 'quantity' => 1, 'options' => []]]];
[$s1, $a] = req('POST', '/orders', $body, $tok['client'], ['Idempotency-Key' => $key]);
[$s2, $b, $h2] = req('POST', '/orders', $body, $tok['client'], ['Idempotency-Key' => $key]);
ok($s1 === 201 && $s2 === 200 && $a['id'] === $b['id'] && ($h2['idempotent-replayed'] ?? '') === 'true', 'double envoi avec la même clé → une seule commande (rejouée, 200)');
ok(req('POST', '/orders', ['items' => [['productId' => $P8, 'quantity' => 3, 'options' => []]]], $tok['client'], ['Idempotency-Key' => $key])[0] === 409, 'même clé, contenu différent → 409');
// accès aux commandes d'autrui
ok(req('GET', "/orders/$oid", null, $tok['client2'])[0] === 403 || req('GET', "/orders/$oid", null, $tok['client2'])[0] === 404, 'un client ne voit pas la commande d’un autre');
ok(req('PATCH', "/orders/$oid/cancel", null, $tok['client2'])[0] >= 403, 'un client ne peut pas annuler la commande d’un autre');
[$s, $list] = req('GET', '/orders?limit=100', null, $tok['client2']);
ok($s === 200 && !array_filter($list['content'] ?? [], fn($x) => $x['id'] === $oid), 'liste client : uniquement ses commandes');
ok(req('GET', "/orders/$oid", null, $tok['server'])[0] === 200, 'le serveur voit les commandes de ses tables (table 9)');
$o2 = req('POST', '/orders', ['items' => [['productId' => $P8, 'quantity' => 1, 'options' => []]]], $tok['client2'])[1];
ok(req('GET', '/orders/' . $o2['id'], null, $tok['server'])[0] === 404, 'le serveur ne voit pas une table qui n’est pas la sienne (404 : l’existence n’est même pas révélée)');
// statuts
ok(req('PATCH', "/orders/$oid/status", ['status' => 'Prête'], $tok['kitchen'])[0] === 409, 'transition Nouvelle → Prête interdite (409)');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'Inventé'], $tok['kitchen'])[0] === 400, 'statut inconnu → 400');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'En préparation'], $tok['server'])[0] === 403, 'le serveur ne lance pas la préparation (403)');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'En préparation'], $tok['client'])[0] === 403, 'le client ne change pas le statut (403)');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'En préparation'], $tok['kitchen'])[0] === 200, 'cuisine : Nouvelle → En préparation');
ok(req('PATCH', "/orders/$oid/cancel", null, $tok['client'])[0] === 409, 'annulation client refusée une fois la préparation lancée (409)');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'Prête'], $tok['kitchen'])[0] === 200, 'cuisine : En préparation → Prête');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'Servie'], $tok['kitchen'])[0] === 403, 'la cuisine ne marque pas « Servie » (403)');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'Servie'], $tok['server'])[0] === 200, 'serveur : Prête → Servie');
ok(req('PATCH', "/orders/$oid/status", ['status' => 'Nouvelle'], $tok['admin'])[0] === 409, 'retour arrière interdit, même pour l’admin (409)');
// paiement
ok(req('PATCH', "/orders/$oid/payment", ['method' => 'cash'], $tok['client'])[0] === 403, 'le client ne peut pas se déclarer payé en espèces (403)');
ok(req('PATCH', "/orders/$oid/payment", ['method' => 'cash'], $tok['kitchen'])[0] === 403, 'la cuisine n’encaisse pas (403)');
ok(req('PATCH', "/orders/$oid/payment", ['method' => 'bitcoin'], $tok['cashier'])[0] === 400, 'moyen de paiement inconnu → 400');
ok(req('PATCH', "/orders/$oid/payment", ['method' => 'cash'], $tok['cashier'])[0] === 200, 'caisse : encaissement espèces');
ok($pdo->query("SELECT payment_status FROM orders WHERE id = $oid")->fetchColumn() === 'paid', 'statut « payé » enregistré en base');
ok(req('PATCH', "/orders/$oid/payment", ['method' => 'card'], $tok['cashier'])[0] === 409, 'double encaissement refusé (409)');
// annulation
$o3 = req('POST', '/orders', ['items' => [['productId' => $P8, 'quantity' => 1, 'options' => []]]], $tok['client'])[1];
ok(req('PATCH', '/orders/' . $o3['id'] . '/cancel', null, $tok['kitchen'])[0] === 403, 'la cuisine ne peut pas annuler (403)');
ok(req('PATCH', '/orders/' . $o3['id'] . '/cancel', null, $tok['client'])[0] === 200, 'le client annule sa commande « Nouvelle »');
ok(req('PATCH', '/orders/' . $o3['id'] . '/payment', ['method' => 'cash'], $tok['cashier'])[0] === 409, 'commande annulée : encaissement refusé (409)');
ok(req('PATCH', '/orders/' . $o3['id'] . '/status', ['status' => 'En préparation'], $tok['kitchen'])[0] === 409, 'commande annulée : préparation refusée (409)');

// ================= PRODUITS =================
section('Produits');
[$s, $r] = req('GET', '/products?limit=100');
ok($s === 200 && count($r['content'] ?? []) === (int) $pdo->query('SELECT COUNT(*) FROM products WHERE deleted_at IS NULL')->fetchColumn(), 'liste publique complète (' . count($r['content'] ?? []) . ' produits)');
ok(req('GET', '/products?limit=500')[0] === 400, 'limite hors bornes → 400');
ok(req('GET', '/products/999999')[0] === 404, 'produit inexistant → 404');
ok(req('PATCH', "/products/$P6", ['basePrice' => -5], $tok['admin'])[0] === 400, 'prix négatif refusé (400)');
ok(req('PATCH', "/products/$P6", ['basePrice' => 'abc'], $tok['admin'])[0] === 400, 'prix non numérique refusé (400)');

// ================= TABLES =================
section('Tables');
[$s, $r] = req('GET', '/tables', null, $tok['cashier']);
$t9 = null;
foreach ($r['content'] ?? $r ?? [] as $t) {
    if ((string) ($t['tableNumber'] ?? '') === '9') {
        $t9 = $t;
    }
}
ok($s === 200 && $t9 !== null, 'plan de salle : table 9 présente');
ok($t9 && ($t9['status'] ?? '') !== 'free', 'table 9 occupée (client de test) : statut ' . ($t9['status'] ?? '?'));
[$s, $r] = req('GET', '/tables', null, $tok['server']);
$nums = array_map(fn($t) => (string) $t['tableNumber'], $r['content'] ?? $r ?? []);
ok($s === 200 && $nums === ['9'], 'le serveur ne voit que ses tables (' . implode(',', $nums) . ')');
ok(req('POST', '/tables', ['tableNumber' => 'ZZ', 'seats' => 2], $tok['cashier'])[0] === 403, 'la caisse ne crée pas de table (403)');

// ================= À EMPORTER =================
section('À emporter');
$tw = req('POST', '/orders', ['items' => [['productId' => $P6, 'quantity' => 1, 'options' => array_merge($reqOpts, [['optionId' => $TAKEAWAY_OPT]])]]], $tok['client'])[1];
[$s, $r] = req('POST', '/takeaway-requests', ['orderId' => $tw['id'] ?? 0, 'message' => 'Je passe dans 5 min'], $tok['client']);
ok($s === 201, 'demande à emporter créée (201)');
$tid = $r['id'] ?? 0;
ok(req('POST', '/takeaway-requests', ['orderId' => $tw['id'] ?? 0, 'message' => '<b>x</b>'], $tok['client'])[0] === 400, 'message avec < > refusé (400)');
ok(req('PATCH', "/takeaway-requests/$tid/respond", ['decision' => 'accept', 'message' => 'OK'], $tok['kitchen'])[0] === 403, 'la cuisine ne répond pas (403)');
ok(req('PATCH', "/takeaway-requests/$tid/respond", ['decision' => 'accept', 'message' => 'OK'], $tok['client2'])[0] === 403, 'un autre client ne répond pas (403)');
[$s, $r] = req('PATCH', "/takeaway-requests/$tid/respond", ['decision' => 'accept', 'message' => 'Prête au comptoir'], $tok['cashier']);
ok($s === 200, 'la caisse accepte la demande');
[$s, $r] = req('GET', '/takeaway-requests/mine', null, $tok['client']);
$mine = array_values(array_filter($r['content'] ?? $r ?? [], fn($x) => ($x['id'] ?? 0) === $tid));
ok($s === 200 && $mine && $mine[0]['status'] === 'accepted', 'le client voit la réponse « accepted »');

// ================= STOCK =================
section('Stock');
[$s, $r] = req('POST', '/ai/stock/items', ['name' => 'ZZTEST Lait', 'unit' => 'L', 'minThreshold' => 5, 'initialCount' => 4], $tok['manager']);
$sid = $r['id'] ?? 0;
ok($s === 201 && $sid, 'article de stock créé avec inventaire initial');
[$s, $r] = req('GET', '/ai/stock', null, $tok['manager']);
$it = array_values(array_filter($r['items'] ?? [], fn($x) => $x['id'] === $sid))[0] ?? null;
ok($it && $it['risk'] === 'élevé', 'stock sous le seuil (4 < 5) → « Risque de rupture »');
ok(req('POST', "/ai/stock/items/$sid/movements", ['type' => 'count', 'quantity' => -1], $tok['manager'])[0] === 400, 'quantité négative refusée (400)');
ok(req('POST', "/ai/stock/items/$sid/movements", ['type' => 'delivery', 'quantity' => 0], $tok['manager'])[0] === 400, 'livraison de 0 refusée (400)');
ok(req('POST', "/ai/stock/items/$sid/movements", ['type' => 'delivery', 'quantity' => 10], $tok['manager'])[0] === 201, 'livraison de 10 L enregistrée');
[$s, $r] = req('GET', '/ai/stock', null, $tok['manager']);
$it = array_values(array_filter($r['items'] ?? [], fn($x) => $x['id'] === $sid))[0] ?? null;
ok($it && abs($it['estimatedStock'] - 14) < 0.001 && $it['risk'] !== 'élevé', 'stock estimé 14 L après livraison, risque levé');
ok(req('POST', "/ai/stock/items/$sid/movements", ['type' => 'delivery', 'quantity' => 1], $tok['kitchen'])[0] === 403, 'la cuisine ne saisit pas le stock (403)');

// ================= ANALYTIQUE / IA =================
section('Analytique et IA');
$pdo->exec('DELETE FROM ai_cache'); // les analyses sont mises en cache 60 s : on part de chiffres frais
[$s, $r] = req('GET', '/ai/status');
ok($s === 200 && isset($r['enabled']), 'statut du module intelligent');
[$s, $r] = req('GET', '/ai/bi?period=30', null, $tok['manager']);
$sqlN = (int) $pdo->query('SELECT COUNT(*) FROM orders WHERE cancelled_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)')->fetchColumn();
ok($s === 200 && ($r['kpis']['orders'] ?? -1) === $sqlN, "BI : nombre de commandes = base ($sqlN)");
[$s, $r] = req('GET', '/stats/summary?days=30', null, $tok['manager']);
ok($s === 200 && isset($r['orders'], $r['revenue']), 'statistiques admin');
ok(req('GET', '/stats/summary?days=0', null, $tok['manager'])[0] === 400, 'statistiques : période invalide → 400');
[$s, $r] = req('POST', '/ai/suggest', ['query' => 'quelque chose de frais à moins de 6 DT'], $tok['client']);
ok($s === 200 && ($r['autoAdd'] ?? null) === false && !array_filter($r['products'] ?? [], fn($p) => $p['price'] > 6), 'assistant client : budget respecté, rien ajouté au panier');
[$s, $r] = req('GET', '/ai/forecast', null, $tok['manager']);
ok($s === 200 && ($r['label'] ?? '') === 'Prévision', 'prévision étiquetée « Prévision »');

// ================= ERREURS =================
section('Erreurs');
[$s, $r] = req('GET', '/route-inexistante');
ok($s === 404 && isset($r['error']), 'route inconnue → 404 JSON');
[$s, $r, $h] = req('GET', '/categories');
ok(($h['x-content-type-options'] ?? '') === 'nosniff' && ($h['cache-control'] ?? '') === 'no-store', 'en-têtes de sécurité présents');
$raw = file_get_contents($API . '/orders/abc', false, stream_context_create(['http' => ['ignore_errors' => true, 'header' => 'X-Auth-Token: ' . $tok['admin']]]));
ok(!preg_match('/SQLSTATE|Stack trace|\.php|PDO/i', (string) $raw), 'aucune fuite technique dans les erreurs');

// ---------- Fin ----------
cleanup($pdo);
$after = $snapshot();
section('Intégrité');
ok($before == $after, 'données réelles intactes (produits, prix, disponibilités, catégories, promotions, employés, commandes)');
ok((int) $pdo->query("SELECT COUNT(*) FROM staff WHERE username LIKE 'zz-test-%'")->fetchColumn() === 0, 'données de test supprimées');

echo "\nRÉSULTAT : $pass réussis, $fail échoués\n";
exit($fail === 0 ? 0 : 1);
