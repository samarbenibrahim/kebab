<?php
/**
 * Exécute les migrations SQL de database/migrations dans l'ordre alphabétique,
 * en sautant celles déjà appliquées (suivies dans la table schema_migrations).
 * Usage : php database/migrate.php
 */
require __DIR__ . '/../api/config/database.php';

$pdo = get_pdo_connection();

// La toute première migration crée schema_migrations elle-même : on l'applique
// sans vérifier son propre suivi (elle ne peut pas encore exister).
$migrationsDir = __DIR__ . '/migrations';
$files = glob($migrationsDir . '/*.sql');
sort($files);

$alreadyRun = [];
try {
    $stmt = $pdo->query('SELECT version FROM schema_migrations');
    $alreadyRun = $stmt->fetchAll(PDO::FETCH_COLUMN);
} catch (PDOException $e) {
    // La table n'existe pas encore : normal au tout premier lancement.
    $alreadyRun = [];
}

$applied = [];
foreach ($files as $file) {
    $version = basename($file);
    if (in_array($version, $alreadyRun, true)) {
        echo "SKIP  $version (déjà appliquée)\n";
        continue;
    }

    $sql = file_get_contents($file);
    try {
        $pdo->exec($sql);
        $pdo->prepare('INSERT INTO schema_migrations (version) VALUES (:v)')
            ->execute(['v' => $version]);
        echo "OK    $version\n";
        $applied[] = $version;
    } catch (PDOException $e) {
        echo "ERROR $version : " . $e->getMessage() . "\n";
        exit(1);
    }
}

echo "\n" . count($applied) . " migration(s) appliquée(s) sur cette exécution.\n";
