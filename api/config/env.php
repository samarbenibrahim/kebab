<?php
/**
 * Lecture de la configuration : variables d'environnement du serveur, sinon
 * fichier .env à la racine du projet (jamais servi : le routeur du site refuse
 * les fichiers cachés, et l'API ne sert aucun fichier statique).
 * Format .env : une ligne CLE=valeur, # pour les commentaires.
 */
function soucoffe_env(string $key, ?string $default = null): ?string
{
    static $file = null;
    $v = getenv($key);
    if ($v !== false && $v !== '') {
        return $v;
    }
    if ($file === null) {
        $file = [];
        $path = dirname(__DIR__, 2) . '/.env';
        if (is_readable($path)) {
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) {
                    continue;
                }
                [$k, $val] = array_map('trim', explode('=', $line, 2));
                if (strlen($val) >= 2 && ($val[0] === '"' || $val[0] === "'") && substr($val, -1) === $val[0]) {
                    $val = substr($val, 1, -1);
                }
                $file[$k] = $val;
            }
        }
    }
    return array_key_exists($key, $file) && $file[$key] !== '' ? $file[$key] : $default;
}
