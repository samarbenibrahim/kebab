<?php
/**
 * Connexion PDO centralisée (MySQL/MariaDB), requêtes préparées uniquement.
 * Les identifiants viennent de l'environnement ou du fichier .env (voir
 * .env.example) : aucun mot de passe dans le code source.
 */
require_once __DIR__ . '/env.php';

function get_pdo_connection(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $host = soucoffe_env('DB_HOST', '127.0.0.1');
    $port = (int) soucoffe_env('DB_PORT', '3306');
    $dbName = soucoffe_env('DB_NAME', 'soucoffe');
    $user = soucoffe_env('DB_USER');
    $pass = soucoffe_env('DB_PASSWORD');
    if ($user === null || $pass === null) {
        // Configuration absente : erreur claire dans le journal, message générique au client.
        throw new RuntimeException('Configuration de base de données manquante : définir DB_USER et DB_PASSWORD (fichier .env ou variables d\'environnement).');
    }

    $dsn = "mysql:host=$host;port=$port;dbname=$dbName;charset=utf8mb4";

    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $pdo;
}
