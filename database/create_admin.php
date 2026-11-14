<?php
/**
 * Crée (ou réinitialise le mot de passe de) un compte ADMIN — les comptes
 * admin ne se créent jamais via l'API, uniquement ici, en ligne de commande.
 *
 * Usage : php database/create_admin.php <identifiant> [mot_de_passe]
 *   - sans mot de passe : un mot de passe aléatoire fort est généré et affiché
 *     UNE seule fois (il n'est stocké que sous forme de hash bcrypt) ;
 *   - si l'identifiant existe déjà : son mot de passe est remplacé, le compte
 *     est réactivé, le verrouillage levé et ses sessions révoquées.
 */
require __DIR__ . '/../api/config/database.php';

if ($argc < 2) {
    fwrite(STDERR, "Usage : php database/create_admin.php <identifiant> [mot_de_passe]\n");
    exit(1);
}
$username = strtolower(trim($argv[1]));
if (!preg_match('/^[a-z0-9._-]{3,30}$/', $username)) {
    fwrite(STDERR, "Identifiant invalide : 3 à 30 caractères (lettres minuscules, chiffres, . _ -)\n");
    exit(1);
}

$generated = false;
if (isset($argv[2])) {
    $password = $argv[2];
} else {
    $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $password = '';
    for ($i = 0; $i < 16; $i++) {
        $password .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    $generated = true;
}
if (strlen($password) < 8 || strlen($password) > 72) {
    fwrite(STDERR, "Le mot de passe doit faire de 8 à 72 caractères.\n");
    exit(1);
}

$pdo = get_pdo_connection();
$hash = password_hash($password, PASSWORD_DEFAULT);

$stmt = $pdo->prepare('SELECT id, role FROM staff WHERE username = :u');
$stmt->execute(['u' => $username]);
$existing = $stmt->fetch();

if ($existing) {
    if ($existing['role'] !== 'admin') {
        fwrite(STDERR, "« $username » existe déjà comme compte serveur : choisissez un autre identifiant.\n");
        exit(1);
    }
    $pdo->prepare('UPDATE staff SET password_hash = :p, active = 1, failed_attempts = 0, locked_until = NULL WHERE id = :id')
        ->execute(['p' => $hash, 'id' => $existing['id']]);
    $pdo->prepare('DELETE FROM auth_sessions WHERE staff_id = :id')->execute(['id' => $existing['id']]);
    echo "Mot de passe de l'admin « $username » réinitialisé (sessions révoquées).\n";
} else {
    $pdo->prepare("INSERT INTO staff (role, username, display_name, password_hash) VALUES ('admin', :u, :d, :p)")
        ->execute(['u' => $username, 'd' => 'Administrateur', 'p' => $hash]);
    echo "Admin « $username » créé.\n";
}

if ($generated) {
    echo "Mot de passe (à noter maintenant, il ne sera plus affiché) : $password\n";
}
