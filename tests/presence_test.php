<?php
/**
 * SOUCOFFE — tests de la surveillance des sessions clients (migration 022).
 *
 * Usage : php tests/presence_test.php [http://127.0.0.1:8000/api]
 * Prérequis : API et base démarrées (scripts/start-lan.vbs).
 *
 * Comme tests/api_test.php : données préfixées « zz-test » / « ZZTEST »,
 * supprimées au début et à la fin ; les réglages de surveillance sont
 * sauvegardés puis restaurés. Le temps est simulé en reculant les
 * horodatages en base (aucune attente réelle de 3 ou 5 minutes).
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
    return [$status, json_decode((string) $raw, true), (string) $raw];
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
    $s = $pdo->query("SELECT GROUP_CONCAT(id) FROM staff WHERE username LIKE 'zz-test-%'")->fetchColumn() ?: '0';
    $pdo->exec("DELETE FROM client_presence WHERE client_id IN ($c)"); // notifications : ON DELETE CASCADE
    $pdo->exec("DELETE FROM auth_sessions WHERE client_id IN ($c) OR staff_id IN ($s)");
    $pdo->exec("DELETE FROM clients WHERE id IN ($c)");
    $pdo->exec("DELETE FROM staff WHERE id IN ($s) AND username LIKE 'zz-test-%'");
}

// ---- Outils de simulation (base) ----
$h = fn(string $tok): string => hash('sha256', $tok);
$forceEval = fn() => $pdo->exec("UPDATE presence_settings SET setting_value = '0' WHERE setting_key IN ('last_eval_at')");
$age = function (string $tok, int $minutes) use ($pdo, $h): void {
    $pdo->prepare('UPDATE client_presence p JOIN auth_sessions s ON s.id = p.session_id SET p.started_at = NOW() - INTERVAL :m MINUTE WHERE s.token_hash = :h')
        ->execute(['m' => $minutes, 'h' => $h($tok)]);
};
// Recule le dernier signal (lève la limite de fréquence ou simule une coupure).
$rewindBeat = function (string $tok, int $seconds) use ($pdo, $h): void {
    $pdo->prepare('UPDATE client_presence p JOIN auth_sessions s ON s.id = p.session_id SET p.last_heartbeat_at = p.last_heartbeat_at - INTERVAL :x SECOND WHERE s.token_hash = :h')
        ->execute(['x' => $seconds, 'h' => $h($tok)]);
};
$presenceId = function (string $tok) use ($pdo, $h): int {
    $st = $pdo->prepare('SELECT p.id FROM client_presence p JOIN auth_sessions s ON s.id = p.session_id WHERE s.token_hash = :h');
    $st->execute(['h' => $h($tok)]);
    return (int) $st->fetchColumn();
};
$notifsOf = function (int $pid) use ($pdo): array {
    $st = $pdo->prepare('SELECT type, level, threshold_minutes FROM admin_notifications WHERE presence_id = :p ORDER BY id');
    $st->execute(['p' => $pid]);
    return $st->fetchAll();
};
$beat = fn(string $tok, array $extra = []) => req('POST', '/presence/heartbeat', $extra + ['page' => '03-Cafes', 'device' => 'mobile', 'visible' => true, 'active' => true], $tok);

[$st] = req('GET', '/categories');
if ($st !== 200) {
    fwrite(STDERR, "API injoignable sur $API (lancez scripts/start-lan.vbs)\n");
    exit(1);
}
cleanup($pdo);
$savedSettings = $pdo->query("SELECT setting_key, setting_value FROM presence_settings WHERE setting_key NOT LIKE 'last_%'")->fetchAll(PDO::FETCH_KEY_PAIR);
// Réglages de référence du test (3 min enregistré, 5 min alerte, inactif après 2 min, alerte d'inactivité à 10 min).
foreach (['enabled' => '1', 'log_minutes' => '3', 'alert_minutes' => '5', 'idle_after_minutes' => '2', 'idle_alert_minutes' => '10', 'heartbeat_seconds' => '30'] as $k => $v) {
    $pdo->prepare('UPDATE presence_settings SET setting_value = :v WHERE setting_key = :k')->execute(['v' => $v, 'k' => $k]);
}

$PWD = 'ZzTest-' . bin2hex(random_bytes(6)) . '!';
$tok = [];
foreach (['admin', 'manager', 'server', 'cashier', 'kitchen'] as $role) {
    $pdo->prepare('INSERT INTO staff (role, username, display_name, password_hash) VALUES (:r, :u, :d, :p)')
        ->execute(['r' => $role, 'u' => "zz-test-$role", 'd' => "ZZTEST $role", 'p' => password_hash($PWD, PASSWORD_DEFAULT)]);
    $tok[$role] = req('POST', '/auth/login', ['username' => "zz-test-$role", 'password' => $PWD])[1]['token'] ?? null;
}
$n = 0;
$newClient = function () use (&$n): ?string {
    $n++;
    return req('POST', '/clients', ['firstName' => 'ZZTEST', 'lastName' => "Client$n", 'tableNumber' => (string) (20 + $n), 'partySize' => 2])[1]['token'] ?? null;
};

// ================= ACCÈS =================
section('Contrôle d\'accès');
$c1 = $newClient();
ok(count(array_filter($tok)) === 5 && $c1, 'comptes de test et client créés');
foreach (['GET /admin/presence', 'GET /admin/notifications', 'GET /admin/presence-settings', 'GET /admin/presence/1'] as $route) {
    [$m, $p] = explode(' ', $route);
    $codes = [];
    foreach (['client' => $c1, 'server' => $tok['server'], 'cashier' => $tok['cashier'], 'kitchen' => $tok['kitchen']] as $who => $t) {
        $codes[$who] = req($m, $p, null, $t)[0];
    }
    ok(!array_diff($codes, [403]), "$route : 403 pour client, serveur, caissier, cuisine");
    ok(req($m, $p)[0] === 401, "$route : 401 sans jeton");
}
ok(req('PATCH', '/admin/notifications/1', ['action' => 'read'], $c1)[0] === 403, 'un client ne peut pas agir sur une notification');
ok(req('PATCH', '/admin/notifications/read-all', null, $tok['server'])[0] === 403, 'un serveur ne peut pas tout marquer lu');
ok(req('PUT', '/admin/presence-settings', ['slowMs' => 2000], $tok['cashier'])[0] === 403, 'un caissier ne peut pas modifier les réglages');
ok(req('GET', '/admin/presence', null, $tok['admin'])[0] === 200, 'admin : accès autorisé');
ok(req('GET', '/admin/presence', null, $tok['manager'])[0] === 200, 'manager : accès autorisé');
ok(req('POST', '/presence/heartbeat', ['page' => 'x'], $tok['admin'])[0] === 403, 'le signal client est refusé au personnel');
ok(req('POST', '/presence/heartbeat', ['page' => 'x'])[0] === 401, 'signal sans jeton → 401');

// ================= SIGNAL =================
section('Signal (heartbeat)');
[$s, $r] = $beat($c1);
ok($s === 200 && ($r['enabled'] ?? null) === true && ($r['intervalSeconds'] ?? 0) === 30, 'premier signal accepté, intervalle renvoyé');
ok($beat($c1)[0] === 429, 'signal répété immédiatement → 429 (anti-abus)');
$rewindBeat($c1, 2);
ok($beat($c1, ['visible' => false])[0] === 200, 'passage en arrière-plan accepté 2 s après un signal (limite 1/s pour ce cas)');
ok($beat($c1, ['visible' => false])[0] === 429, 'mais pas un 2e signal identique');
$rewindBeat($c1, 10);
ok($beat($c1)[0] === 200, 'signal accepté après le délai minimal');
ok(req('POST', '/presence/heartbeat', '{cassé', $c1)[0] === 400, 'JSON invalide → 400');
$cClamp = $newClient();
$beat($cClamp, ['metrics' => ['http5xx' => 99999, 'netFailures' => -5, 'maxMs' => 'abc', 'slow' => 3]]);
$row = $pdo->query('SELECT http_5xx, net_failures, max_response_ms, slow_requests, page FROM client_presence WHERE id = ' . $presenceId($cClamp))->fetch();
ok((int) $row['http_5xx'] === 50 && (int) $row['net_failures'] === 0 && (int) $row['max_response_ms'] === 0 && (int) $row['slow_requests'] === 3, 'compteurs plafonnés et valeurs invalides ignorées');
$rewindBeat($cClamp, 10);
$beat($cClamp, ['page' => '../../etc/passwd']);
ok($pdo->query('SELECT page FROM client_presence WHERE id = ' . $presenceId($cClamp))->fetchColumn() === '03-Cafes', 'nom de page invalide ignoré');

// ================= SEUILS 3 / 5 MIN =================
section('Seuils de présence active');
$pid1 = $presenceId($c1);
$age($c1, 2);
$forceEval();
// Référence du badge prise APRÈS cette évaluation (elle compte déjà l'alerte serveur du client « plafonné » ci-dessus).
$unread0 = req('GET', '/admin/notifications?status=open', null, $tok['admin'])[1]['unreadCount'];
ok(count($notifsOf($pid1)) === 0, 'à 2 min : aucune notification');
$age($c1, 3);
$rewindBeat($c1, 10);
$beat($c1);
$forceEval();
[$s, $r] = req('GET', '/admin/notifications?status=open', null, $tok['admin']);
$list = $notifsOf($pid1);
ok(count($list) === 1 && $list[0]['type'] === 'presence' && $list[0]['level'] === 'info' && (int) $list[0]['threshold_minutes'] === 3, 'à 3 min : événement enregistré (niveau info)');
ok($r['unreadCount'] === $unread0, 'un événement enregistré ne compte pas dans le badge d\'alertes');
$age($c1, 5);
$forceEval();
[$s, $r] = req('GET', '/admin/notifications?status=open', null, $tok['admin']);
$list = $notifsOf($pid1);
ok(count($list) === 2 && $list[1]['level'] === 'alert' && (int) $list[1]['threshold_minutes'] === 5, 'à 5 min : alerte créée');
ok($r['unreadCount'] === $unread0 + 1, 'badge : +1 alerte non lue');
$mine = array_values(array_filter($r['content'], fn($x) => $x['session']['id'] === $pid1 && $x['level'] === 'alert'));
ok($mine && $mine[0]['session']['name'] === 'ZZTEST Client1' && $mine[0]['session']['tableNumber'] === '21'
    && $mine[0]['session']['status'] === 'active' && isset($mine[0]['session']['startedAt'], $mine[0]['session']['durationSeconds'], $mine[0]['createdAt']),
    'notification : nom, table, heure de connexion, durée, statut, horodatage');
ok(!preg_match('/token|password|phone|token_hash/i', json_encode($r)), 'aucun jeton, mot de passe ni téléphone dans les notifications');

section('Absence de doublons');
for ($i = 0; $i < 4; $i++) {
    $forceEval();
    req('GET', '/admin/notifications', null, $tok['admin']);
    req('GET', '/admin/presence', null, $tok['manager']);
}
$age($c1, 9);
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
ok(count($notifsOf($pid1)) === 2, '5 évaluations de plus (2 écrans admin) : toujours 1 notification par seuil');

section('Seuil configurable');
[$s, $r] = req('PUT', '/admin/presence-settings', ['alertMinutes' => '5, 8'], $tok['manager']);
ok($s === 200 && $r['alertMinutes'] === [5, 8], 'manager : seuils d\'alerte 5 et 8 min enregistrés');
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
ok(count($notifsOf($pid1)) === 3, 'nouveau seuil à 8 min : une seule alerte supplémentaire');
req('PUT', '/admin/presence-settings', ['alertMinutes' => '5'], $tok['admin']);
ok(req('PUT', '/admin/presence-settings', ['alertMinutes' => 'abc'], $tok['admin'])[0] === 400, 'seuil invalide → 400');
ok(req('PUT', '/admin/presence-settings', ['heartbeatSeconds' => 5], $tok['admin'])[0] === 400, 'intervalle hors bornes → 400');
ok(req('PUT', '/admin/presence-settings', [], $tok['admin'])[0] === 400, 'aucun réglage → 400');

// ================= DÉCONNEXION AVANT LE SEUIL =================
section('Déconnexion avant le seuil');
$c2 = $newClient();
$beat($c2);
$pid2 = $presenceId($c2);
$age($c2, 2);
ok(req('POST', '/auth/logout', null, $c2)[0] === 200, 'client déconnecté à 2 min');
$pdo->exec("UPDATE client_presence SET started_at = NOW() - INTERVAL 30 MINUTE WHERE id = $pid2");
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
$d = req('GET', "/admin/presence/$pid2", null, $tok['admin'])[1];
ok(count($notifsOf($pid2)) === 0, 'aucune alerte de présence prolongée après déconnexion');
ok(($d['status'] ?? '') === 'ended' && ($d['endReason'] ?? '') === 'logout', 'statut : session terminée (déconnexion)');

// ================= INACTIF / ARRIÈRE-PLAN / INTERRUPTION =================
section('Connecté mais inactif');
$c3 = $newClient();
$beat($c3, ['active' => false]);
$pid3 = $presenceId($c3);
$age($c3, 6);
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
$d = req('GET', "/admin/presence/$pid3", null, $tok['admin'])[1];
ok(($d['status'] ?? '') === 'idle', 'session valide sans interaction : « connecté mais inactif »');
ok(count(array_filter($notifsOf($pid3), fn($x) => $x['type'] === 'presence')) === 0, 'pas d\'alerte de présence active pour un client inactif');
$age($c3, 11);
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
$inact = array_values(array_filter($notifsOf($pid3), fn($x) => $x['type'] === 'inactivity'));
ok(count($inact) === 1 && (int) $inact[0]['threshold_minutes'] === 10, 'à 11 min sans interaction : alerte d\'inactivité (seuil distinct de 10 min)');
$rewindBeat($c3, 10);
$beat($c3, ['active' => true]);
$d = req('GET', "/admin/presence/$pid3", null, $tok['admin'])[1];
ok(($d['status'] ?? '') === 'active', 'interaction reprise : redevient « connecté et actif »');

$c4 = $newClient();
$beat($c4, ['visible' => false]);
$pid4 = $presenceId($c4);
$rewindBeat($c4, 600);
$d = req('GET', "/admin/presence/$pid4", null, $tok['admin'])[1];
ok(($d['status'] ?? '') === 'idle' && strpos($d['statusHint'] ?? '', 'arrière-plan') !== false, 'application en arrière-plan : inactif, pas « interrompu »');

section('Interruption réseau et reprise');
$c5 = $newClient();
$beat($c5);
$pid5 = $presenceId($c5);
$rewindBeat($c5, 180);
$pdo->exec("UPDATE client_presence SET net_failures = 2 WHERE id = $pid5");
$d = req('GET', "/admin/presence/$pid5", null, $tok['admin'])[1];
ok(($d['status'] ?? '') === 'interrupted' && strpos($d['statusHint'] ?? '', 'réseau') !== false, 'plus de signal depuis 3 min : « connexion interrompue », réseau suspecté');
ok(($d['serverIssue'] ?? null) === false, 'une coupure réseau n\'est PAS présentée comme un problème serveur');
$age($c5, 7);
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
ok(count(array_filter($notifsOf($pid5), fn($x) => $x['type'] === 'presence')) === 0, 'pas d\'alerte de présence pendant l\'interruption');
$beat($c5);
$d = req('GET', "/admin/presence/$pid5", null, $tok['admin'])[1];
ok(($d['status'] ?? '') === 'active', 'signal revenu : session de nouveau active');
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
ok(count(array_filter($notifsOf($pid5), fn($x) => $x['type'] === 'presence' && $x['level'] === 'alert')) === 1, 'après reprise : alerte de présence (une seule)');

$c6 = $newClient(); // jamais de signal (JavaScript bloqué, appareil coupé aussitôt)
$forceEval();
[$s, $ov] = req('GET', '/admin/presence', null, $tok['admin']);
$pid6 = $presenceId($c6);
$d = req('GET', "/admin/presence/$pid6", null, $tok['admin'])[1];
ok($pid6 > 0 && ($d['status'] ?? '') === 'interrupted' && strpos($d['statusHint'] ?? '', 'Aucun signal') !== false, 'session sans aucun signal : visible comme « connexion interrompue »');

// ================= FIN DE SESSION SUBIE =================
section('Expiration et révocation');
$pdo->prepare('UPDATE auth_sessions SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE token_hash = :h')->execute(['h' => $h($c4)]);
$pdo->prepare('DELETE FROM auth_sessions WHERE token_hash = :h')->execute(['h' => $h($c6)]);
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
$d4 = req('GET', "/admin/presence/$pid4", null, $tok['admin'])[1];
$d6 = req('GET', "/admin/presence/$pid6", null, $tok['admin'])[1];
ok(($d4['status'] ?? '') === 'ended' && ($d4['endReason'] ?? '') === 'expired', 'session expirée : terminée (expiration)');
ok(($d6['status'] ?? '') === 'ended' && ($d6['endReason'] ?? '') === 'revoked', 'session supprimée (table libérée) : terminée (révoquée)');

// ================= PROBLÈME SERVEUR =================
section('Problème serveur confirmé');
$c7 = $newClient();
$beat($c7, ['metrics' => ['http5xx' => 1]]);
$pid7 = $presenceId($c7);
$forceEval();
req('GET', '/admin/presence', null, $tok['admin']);
$d = req('GET', "/admin/presence/$pid7", null, $tok['admin'])[1];
ok(($d['serverIssue'] ?? null) === true && count(array_filter($notifsOf($pid7), fn($x) => $x['type'] === 'server_issue')) === 1, 'erreur 5xx mesurée : « problème serveur confirmé » + une alerte');
ok(($d1 = req('GET', "/admin/presence/$pid1", null, $tok['admin'])[1]) && $d1['serverIssue'] === false, 'session longue sans erreur : jamais « problème serveur »');
[$s, $ov] = req('GET', '/admin/presence', null, $tok['admin']);
ok(in_array($ov['health']['status'] ?? '', ['ok', 'slow', 'incident'], true) && isset($ov['health']['label']), 'santé de l\'API calculée depuis le journal technique');

// ================= PLUSIEURS CLIENTS =================
section('Plusieurs clients simultanés');
$many = [];
for ($i = 0; $i < 6; $i++) {
    $t = $newClient();
    $beat($t);
    $age($t, 6);
    $many[] = $t;
}
$forceEval();
[$s, $ov] = req('GET', '/admin/presence', null, $tok['admin']);
$okEach = true;
foreach ($many as $t) {
    $alerts = array_filter($notifsOf($presenceId($t)), fn($x) => $x['type'] === 'presence' && $x['level'] === 'alert');
    $okEach = $okEach && count($alerts) === 1;
}
ok($okEach, '6 clients à 6 min : exactement une alerte chacun');
ok(($ov['counts']['active'] ?? 0) >= 6, 'compteur « actifs » : ' . ($ov['counts']['active'] ?? 0));
ok(count(array_filter($ov['sessions'], fn($p) => strpos($p['name'], 'ZZTEST') === 0)) >= 10, 'toutes les sessions de test listées');

// ================= ACTIONS SUR LES NOTIFICATIONS =================
section('Actions sur les notifications');
[$s, $r] = req('GET', '/admin/notifications?status=unread', null, $tok['admin']);
$target = array_values(array_filter($r['content'], fn($x) => $x['session']['id'] === $pid1 && $x['level'] === 'alert'))[0]['id'] ?? 0;
$u = $r['unreadCount'];
ok(req('PATCH', "/admin/notifications/$target", ['action' => 'read'], $tok['admin'])[0] === 200, 'marquer lu → 200');
ok(req('GET', '/admin/notifications', null, $tok['admin'])[1]['unreadCount'] === $u - 1, 'badge décrémenté');
ok(req('PATCH', "/admin/notifications/$target", ['action' => 'close'], $tok['manager'])[0] === 200, 'clôturer → 200');
$openIds = array_column(req('GET', '/admin/notifications?status=open', null, $tok['admin'])[1]['content'], 'id');
ok(!in_array($target, $openIds, true), 'notification clôturée absente de la liste ouverte');
ok(in_array($target, array_column(req('GET', '/admin/notifications?status=all', null, $tok['admin'])[1]['content'], 'id'), true), 'toujours visible dans l\'historique (status=all)');
ok(req('PATCH', '/admin/notifications/999999999', ['action' => 'read'], $tok['admin'])[0] === 404, 'notification inconnue → 404');
ok(req('PATCH', "/admin/notifications/$target", ['action' => 'supprimer'], $tok['admin'])[0] === 400, 'action invalide → 400');
ok(req('GET', '/admin/notifications?status=nimporte', null, $tok['admin'])[0] === 400, 'filtre invalide → 400');
req('PATCH', '/admin/notifications/read-all', null, $tok['admin']);
ok(req('GET', '/admin/notifications', null, $tok['admin'])[1]['unreadCount'] === 0, 'tout marquer lu → badge à 0');

// ================= DÉSACTIVATION =================
section('Désactivation');
req('PUT', '/admin/presence-settings', ['enabled' => false], $tok['admin']);
$rewindBeat($c1, 10);
[$s, $r] = $beat($c1);
ok($s === 200 && ($r['enabled'] ?? null) === false, 'module désactivé : le client est invité à arrêter ses signaux');
req('PUT', '/admin/presence-settings', ['enabled' => true], $tok['admin']);

// ================= NETTOYAGE =================
section('Nettoyage');
$pdo->exec("UPDATE client_presence SET ended_at = NOW() - INTERVAL 8 DAY WHERE id = $pid2");
$pdo->exec("UPDATE presence_settings SET setting_value = '0' WHERE setting_key IN ('last_eval_at', 'last_cleanup_at')");
req('GET', '/admin/presence', null, $tok['admin']);
ok((int) $pdo->query("SELECT COUNT(*) FROM client_presence WHERE id = $pid2")->fetchColumn() === 0, 'présence terminée depuis 8 jours supprimée (conservation 7 jours)');
ok((int) $pdo->query("SELECT COUNT(*) FROM client_presence WHERE id = $pid1")->fetchColumn() === 1, 'session en cours conservée');

// ================= COÛT =================
section('Coût serveur');
$N = 40;
$tBeat = 0.0;
for ($i = 0; $i < $N; $i++) {
    $rewindBeat($c1, 10);
    $t0 = microtime(true);
    $beat($c1);
    $tBeat += microtime(true) - $t0;
}
$tAdmin = 0.0;
for ($i = 0; $i < 20; $i++) {
    $forceEval();
    $t0 = microtime(true);
    req('GET', '/admin/notifications', null, $tok['admin']);
    $tAdmin += microtime(true) - $t0;
}
$tCat = 0.0;
for ($i = 0; $i < 20; $i++) {
    $t0 = microtime(true);
    req('GET', '/categories');
    $tCat += microtime(true) - $t0;
}
$avgBeat = round($tBeat / $N * 1000, 1);
$avgAdmin = round($tAdmin / 20 * 1000, 1);
$avgCat = round($tCat / 20 * 1000, 1);
echo "  INFO signal moyen : {$avgBeat} ms · notifications admin avec évaluation forcée : {$avgAdmin} ms · référence GET /categories : {$avgCat} ms\n";
ok($avgBeat < 100, "signal client léger (< 100 ms en moyenne, mesuré : {$avgBeat} ms)");
ok($avgAdmin < 250, "évaluation + liste admin (< 250 ms, mesuré : {$avgAdmin} ms)");

// ---------- Fin ----------
cleanup($pdo);
foreach ($savedSettings as $k => $v) {
    $pdo->prepare('UPDATE presence_settings SET setting_value = :v WHERE setting_key = :k')->execute(['v' => $v, 'k' => $k]);
}
section('Intégrité');
ok((int) $pdo->query("SELECT COUNT(*) FROM clients WHERE first_name = 'ZZTEST'")->fetchColumn() === 0, 'données de test supprimées');
ok($pdo->query("SELECT setting_key, setting_value FROM presence_settings WHERE setting_key NOT LIKE 'last_%'")->fetchAll(PDO::FETCH_KEY_PAIR) == $savedSettings, 'réglages restaurés');

echo "\nRÉSULTAT : $pass réussis, $fail échoués\n";
exit($fail === 0 ? 0 : 1);
