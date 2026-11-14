<?php
/**
 * Routeur pour l'accès depuis un téléphone sur le même Wi-Fi (scripts/start-lan.vbs) :
 * sert UNIQUEMENT les fichiers statiques du site (HTML/JS/CSS/images/vidéos). Ne sert
 * et n'exécute JAMAIS de fichier PHP, ni les dossiers api/, database/, scripts/
 * (code serveur et identifiants) — sécurité de base pour une exposition réseau.
 *
 * « / » (adresse du QR code) ouvre la page d'accueil QR « All You Need Is Coffee ».
 * Les vidéos sont servies avec prise en charge des requêtes partielles (Range,
 * 206) : Safari sur iPhone refuse de lire une vidéo sans elles.
 */
$path = urldecode((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$path = str_replace('\\', '/', $path);
if ($path === '' || $path === '/') {
    $path = '/00-Bienvenue/index.html';
    $query = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY);
    // Redirection (et non réécriture) : les liens relatifs de la page restent justes.
    header('Location: ' . $path . ($query !== '' ? '?' . $query : ''), true, 302);
    return true;
}

// En-têtes de sécurité sur toutes les réponses du site.
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');

$forbidden = strpos($path, '..') !== false
    || preg_match('#^/(api|database|scripts|tests|_backups)(/|$)#i', $path)
    || preg_match('#(^|/)\.#', $path)      // fichiers/dossiers cachés (.git, .env…)
    || preg_match('#\.(php\d?|phtml|sql|vbs|sh)$#i', $path)
    // Liste blanche : seuls les types de fichiers utilisés par le site sont servis.
    // Tout le reste (CV, archives .zip, rapports .md, documents…) est refusé.
    || (pathinfo($path, PATHINFO_EXTENSION) !== ''
        && !preg_match('#\.(html|css|js|json|png|jpe?g|webp|gif|svg|ico|mp4|webm|mov|woff2?|ttf)$#i', $path));

if ($forbidden) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Accès refusé.";
    return true;
}

$file = __DIR__ . '/..' . $path;
if (is_dir($file) && is_file(rtrim($file, '/') . '/index.html')) {
    header('Location: ' . rtrim($path, '/') . '/index.html', true, 302);
    return true;
}
if (!is_file($file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Introuvable.";
    return true;
}

$mediaTypes = ['mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime'];
$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
if (!isset($mediaTypes[$ext])) {
    return false; // php -S sert le fichier statique lui-même (bon type MIME).
}

// ---- Vidéo : réponse complète ou partielle (Range: bytes=début-fin) ----
$size = filesize($file);
$start = 0;
$end = $size - 1;
header('Content-Type: ' . $mediaTypes[$ext]);
header('Accept-Ranges: bytes');
header('Cache-Control: public, max-age=86400');
if (isset($_SERVER['HTTP_RANGE']) && preg_match('/^bytes=(\d*)-(\d*)$/', trim($_SERVER['HTTP_RANGE']), $m)) {
    if ($m[1] === '' && $m[2] !== '') {          // bytes=-N : les N derniers octets
        $start = max(0, $size - (int) $m[2]);
    } else {
        $start = (int) $m[1];
        if ($m[2] !== '') {
            $end = min((int) $m[2], $size - 1);
        }
    }
    if ($start > $end || $start >= $size) {
        http_response_code(416);
        header("Content-Range: bytes */$size");
        return true;
    }
    http_response_code(206);
    header("Content-Range: bytes $start-$end/$size");
}
$length = $end - $start + 1;
header('Content-Length: ' . $length);
if ($_SERVER['REQUEST_METHOD'] === 'HEAD') {
    return true;
}
$fp = fopen($file, 'rb');
fseek($fp, $start);
$left = $length;
while ($left > 0 && !feof($fp)) {
    $chunk = fread($fp, min(65536, $left));
    if ($chunk === false) {
        break;
    }
    echo $chunk;
    $left -= strlen($chunk);
    flush();
}
fclose($fp);
return true;
