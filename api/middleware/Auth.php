<?php
/**
 * Authentification par jeton opaque : le client envoie l'en-tête X-Auth-Token
 * (64 caractères hexadécimaux) ; seul son hash SHA-256 est stocké en base
 * (table auth_sessions), donc une fuite de la base ne donne aucun jeton
 * utilisable. Trois rôles : admin, server (serveur), client.
 */
class Auth
{
    public const SESSION_HOURS = 12;

    public static function token(): ?string
    {
        $t = trim($_SERVER['HTTP_X_AUTH_TOKEN'] ?? '');
        return preg_match('/^[a-f0-9]{64}$/', $t) ? $t : null;
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function newToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    /**
     * Exige une session valide dont le rôle est dans $roles.
     *
     * @param string[] $roles
     * @return array{role:string, staff:?array, client:?array, sessionId:int}
     * @throws UnauthorizedException 401
     * @throws ForbiddenException 403
     */
    public static function require(PDO $pdo, array $roles): array
    {
        $token = self::token();
        if ($token === null) {
            throw new UnauthorizedException("Connexion requise");
        }
        $stmt = $pdo->prepare(
            'SELECT id, role, staff_id, client_id FROM auth_sessions WHERE token_hash = :h AND expires_at > NOW()'
        );
        $stmt->execute(['h' => self::hash($token)]);
        $session = $stmt->fetch();
        if (!$session) {
            throw new UnauthorizedException("Session expirée ou invalide : reconnectez-vous");
        }

        $staff = null;
        $client = null;
        if ($session['staff_id'] !== null) {
            $st = $pdo->prepare('SELECT id, role, username, display_name, active FROM staff WHERE id = :id');
            $st->execute(['id' => $session['staff_id']]);
            $staff = $st->fetch() ?: null;
            if (!$staff || !(int) $staff['active']) {
                throw new UnauthorizedException("Compte désactivé ou supprimé");
            }
        } else {
            $cl = $pdo->prepare('SELECT * FROM clients WHERE id = :id');
            $cl->execute(['id' => $session['client_id']]);
            $client = $cl->fetch() ?: null;
            if (!$client) {
                throw new UnauthorizedException("Session client introuvable : identifiez-vous à nouveau");
            }
        }

        if (!in_array($session['role'], $roles, true)) {
            throw new ForbiddenException("Accès refusé pour votre rôle");
        }
        return ['role' => $session['role'], 'staff' => $staff, 'client' => $client, 'sessionId' => (int) $session['id']];
    }

    /** Session client valide (sans lever d'exception) ou null : sert à repérer un client déjà installé. */
    public static function optionalClient(PDO $pdo): ?array
    {
        try {
            $session = self::require($pdo, ['client']);
            return $session['client'];
        } catch (UnauthorizedException | ForbiddenException $e) {
            return null;
        }
    }

    /** La session possède-t-elle cette permission ? (les clients n'en ont aucune) */
    public static function can(array $session, string $permission): bool
    {
        return $session['role'] !== 'client' && Permissions::has($session['role'], $permission);
    }

    /**
     * Exige une session valide POSSÉDANT l'une de ces permissions (403 sinon).
     *
     * @param string|string[] $permissions
     * @throws UnauthorizedException 401
     * @throws ForbiddenException 403
     */
    public static function requirePermission(PDO $pdo, $permissions): array
    {
        $session = self::require($pdo, array_merge(Permissions::STAFF_ROLES, ['client']));
        foreach ((array) $permissions as $p) {
            if (self::can($session, $p)) {
                return $session;
            }
        }
        throw new ForbiddenException("Permission refusée pour votre rôle");
    }

    /** Tables servies par un serveur (liste de numéros de table). */
    public static function serverTables(PDO $pdo, int $staffId): array
    {
        $stmt = $pdo->prepare('SELECT table_number FROM server_tables WHERE staff_id = :s ORDER BY table_number');
        $stmt->execute(['s' => $staffId]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    /**
     * Le personnel peut-il agir sur cette table ? Le rôle SERVEUR seulement sur
     * les tables qu'il a déclarées ; les autres rôles du personnel sur toutes
     * (leur permission, elle, est vérifiée séparément).
     */
    public static function staffCanAccessTable(PDO $pdo, array $session, string $table): bool
    {
        if ($session['role'] === 'client') {
            return false;
        }
        if ($session['role'] === 'server') {
            return in_array($table, self::serverTables($pdo, (int) $session['staff']['id']), true);
        }
        return true;
    }

    /**
     * Accès à une commande : client propriétaire ; serveur pour SES tables ;
     * autres rôles seulement s'ils peuvent voir toutes les commandes.
     */
    public static function canAccessOrder(PDO $pdo, array $session, array $order): bool
    {
        if ($session['role'] === 'client') {
            return $order['client_id'] !== null && (int) $order['client_id'] === (int) $session['client']['id'];
        }
        if ($session['role'] === 'server') {
            return self::staffCanAccessTable($pdo, $session, (string) $order['table_number']);
        }
        return self::can($session, 'orders.view.all');
    }
}
