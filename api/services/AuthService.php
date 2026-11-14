<?php
/**
 * Authentification et gestion des comptes : connexion du personnel (admin /
 * serveurs), identification des clients, gestion des serveurs par l'admin et
 * tables servies par chaque serveur.
 */
class AuthService
{
    // Hash factice : password_verify() est toujours exécuté, même pour un
    // identifiant inconnu, afin de ne pas révéler par le temps de réponse
    // quels comptes existent.
    private const DUMMY_HASH = '$2y$10$NZ803NG51KHjyE2g3AIxfOYrPKJk1CP0ffQRFymK1MwQ8yl/DSpKy';

    private const MAX_TABLES_PER_SERVER = 30;

    public function __construct(
        private PDO $pdo,
        private AuthRepository $repo,
        private ClientRepository $clients,
        private ?LoyaltyService $loyalty = null,
        private ?TableService $tables = null
    ) {
    }

    // ---- Connexion / déconnexion ----

    /**
     * @throws InvalidArgumentException 400
     * @throws UnauthorizedException 401
     * @throws TooManyRequestsException 429
     */
    public function loginStaff(array $payload): array
    {
        $username = $payload['username'] ?? null;
        $password = $payload['password'] ?? null;
        if (!is_string($username) || !is_string($password) || trim($username) === '' || $password === '') {
            throw new InvalidArgumentException("username et password sont requis");
        }
        $username = strtolower(trim($username));
        if (strlen($username) > 50 || strlen($password) > 200) {
            throw new UnauthorizedException("Identifiants invalides");
        }

        $user = $this->repo->findStaffByUsername($username);
        $who = ['type' => 'staff', 'id' => $user ? (int) $user['id'] : null, 'name' => $user['display_name'] ?? $username, 'role' => $user['role'] ?? null];
        if ($user && (int) $user['is_locked']) {
            Audit::log($this->pdo, null, 'auth.login_blocked', 'staff', $user['id'], ['reason' => 'compte verrouillé'], $who);
            $minutes = max(1, (int) ceil(((int) $user['lock_seconds']) / 60));
            throw new TooManyRequestsException("Trop de tentatives échouées. Réessayez dans $minutes minute(s).");
        }

        $passwordOk = password_verify($password, $user ? $user['password_hash'] : self::DUMMY_HASH);
        if (!$user || !$passwordOk || !(int) $user['active']) {
            if ($user) {
                $this->repo->recordFailedLogin((int) $user['id']);
            }
            Audit::log($this->pdo, null, 'auth.login_failed', 'staff', $user['id'] ?? null, ['username' => $username], $who);
            throw new UnauthorizedException("Identifiants invalides");
        }

        $this->repo->resetFailedLogin((int) $user['id']);
        $this->repo->deleteExpiredSessions();
        $token = Auth::newToken();
        $this->repo->createSession($user['role'], (int) $user['id'], null, Auth::hash($token));
        Audit::log($this->pdo, null, 'auth.login', 'staff', $user['id'], [], $who);

        return [
            'token' => $token,
            'expiresInHours' => Auth::SESSION_HOURS,
            'user' => $this->publicStaff($user, $user['role'] === 'server' ? $this->repo->tablesOf((int) $user['id']) : []),
        ];
    }

    public function logout(array $session): void
    {
        if ($session['role'] === 'client') {
            $due = $this->clients->unpaidTotal((int) $session['client']['id']);
            if ($due > 0) {
                throw new ConflictException("Il reste " . number_format($due, 2, ',', '') . " € à régler : demandez l'addition avant de terminer votre session.");
            }
        }
        $isClient = $session['role'] === 'client';
        Audit::log($this->pdo, $session, 'auth.logout', $isClient ? 'client' : 'staff', $isClient ? $session['client']['id'] : $session['staff']['id']);
        if ($isClient && class_exists('PresenceService')) {
            (new PresenceService($this->pdo))->endSession($session['sessionId'], 'logout');
        }
        $this->repo->deleteSessionById($session['sessionId']);
    }

    /**
     * Identification d'un client (nom, prénom, table, nombre de personnes,
     * téléphone facultatif) : crée le client et ouvre sa session.
     *
     * @throws InvalidArgumentException 400
     */
    public function registerClient(array $payload): array
    {
        $first = RequestValidator::requiredText($payload['firstName'] ?? null, 'firstName', 70);
        $last = RequestValidator::requiredText($payload['lastName'] ?? null, 'lastName', 70);
        $table = RequestValidator::tableNumber($payload['tableNumber'] ?? null);
        $party = RequestValidator::partySize($payload['partySize'] ?? null);
        $phone = RequestValidator::optionalText($payload['phone'] ?? null, 'phone', 30);
        if ($phone !== null && !preg_match('/^[0-9+()\s.\-]{6,30}$/', $phone)) {
            throw new InvalidArgumentException("phone invalide (chiffres, espaces, + ( ) . - ; 6 à 30 caractères)");
        }

        // Changer de table = demander l'accord de l'administration (icône de profil). On ne peut donc pas
        // contourner cette règle en se ré-identifiant ailleurs tant qu'une session a des commandes à régler.
        $current = Auth::optionalClient($this->pdo);
        if ($current !== null && $this->clients->unpaidTotal((int) $current['id']) > 0) {
            throw new ConflictException("Vous avez une session en cours avec des commandes à régler. Pour changer de table, demandez l'accord de l'administration depuis votre profil.");
        }
        $this->repo->deleteExpiredSessions();
        $clientId = $this->clients->insertClient($first, $last, $phone, $table, $party);
        if ($phone !== null && $this->loyalty) {
            $this->loyalty->linkClient($clientId, $phone, $first . ' ' . $last);
        }
        if ($this->tables) {
            $this->tables->ensureExists($table);
        }
        Audit::log($this->pdo, null, 'client.register', 'client', $clientId, ['table' => $table, 'personnes' => $party, 'fidelite' => $phone !== null], ['type' => 'client', 'id' => $clientId, 'name' => $first . ' ' . $last, 'role' => 'client']);
        $token = Auth::newToken();
        $this->repo->createSession('client', null, $clientId, Auth::hash($token));

        return ['token' => $token, 'expiresInHours' => Auth::SESSION_HOURS, 'client' => ClientService::publicClient($this->clients->findById($clientId))];
    }

    /** Identité de la session courante (GET /auth/me). */
    public function me(array $session): array
    {
        if ($session['role'] === 'client') {
            return ['role' => 'client', 'client' => ClientService::publicClient($session['client'])];
        }
        $staff = $session['staff'];
        $tables = $session['role'] === 'server' ? $this->repo->tablesOf((int) $staff['id']) : [];
        return ['role' => $session['role'], 'user' => $this->publicStaff($staff, $tables)];
    }

    // ---- Gestion des comptes (permission staff.manage : admin, manager) ----

    /** Rôles créables depuis le site (admin : uniquement en ligne de commande). */
    private const CREATABLE_ROLES = ['manager', 'server', 'cashier', 'kitchen'];
    /** Rôles qu'un MANAGER a le droit de gérer (il ne touche ni à l'admin ni aux autres managers). */
    private const MANAGER_MANAGES = ['server', 'cashier', 'kitchen'];

    public function listStaff(): array
    {
        return ['content' => array_map(function (array $s) {
            return $this->publicStaff($s, $s['tables'], (int) $s['sessions']);
        }, $this->repo->listStaff())];
    }

    /** @throws ForbiddenException 403 */
    private function assertCanManage(array $session, string $targetRole): void
    {
        if ($session['role'] === 'admin') {
            return;
        }
        if (!in_array($targetRole, self::MANAGER_MANAGES, true)) {
            throw new ForbiddenException("Seul l'administrateur peut gérer ce type de compte");
        }
    }

    /**
     * @throws InvalidArgumentException 400
     * @throws ForbiddenException 403
     * @throws ConflictException 409
     */
    public function createStaff(array $payload, array $session): array
    {
        $role = $payload['role'] ?? 'server';
        if (!is_string($role) || !in_array($role, self::CREATABLE_ROLES, true)) {
            throw new InvalidArgumentException("role invalide : " . implode(', ', self::CREATABLE_ROLES));
        }
        $this->assertCanManage($session, $role);
        $username = $this->validateUsername($payload['username'] ?? null);
        $displayName = RequestValidator::requiredText($payload['displayName'] ?? null, 'displayName', 100);
        $password = $this->validatePassword($payload['password'] ?? null);

        try {
            $id = $this->repo->insertStaff($role, $username, $displayName, password_hash($password, PASSWORD_DEFAULT));
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new ConflictException("Ce nom d'utilisateur est déjà pris");
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'staff.create', 'staff', $id, ['username' => $username, 'role' => $role, 'displayName' => $displayName]);
        return $this->staffById($id);
    }

    /**
     * @throws InvalidArgumentException 400
     * @throws ForbiddenException 403
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function updateStaff(int $id, array $payload, array $session): array
    {
        $target = $this->repo->findStaffById($id);
        if (!$target) {
            throw new NotFoundException("Compte introuvable");
        }
        $isSelf = (int) $target['id'] === (int) $session['staff']['id'];
        // Un manager ne modifie que serveurs / caissiers / cuisine (et lui-même).
        if (!$isSelf) {
            $this->assertCanManage($session, $target['role']);
        }

        $changes = [];
        $displayName = null;
        if (array_key_exists('displayName', $payload)) {
            $displayName = RequestValidator::requiredText($payload['displayName'], 'displayName', 100);
            $changes['displayName'] = $displayName;
        }
        $passwordHash = null;
        $passwordChanged = false;
        if (array_key_exists('password', $payload) && $payload['password'] !== null && $payload['password'] !== '') {
            $passwordHash = password_hash($this->validatePassword($payload['password']), PASSWORD_DEFAULT);
            $passwordChanged = true;
            $changes['password'] = 'modifié';
        }
        $active = null;
        if (array_key_exists('active', $payload)) {
            if (!is_bool($payload['active'])) {
                throw new InvalidArgumentException("active doit être true ou false");
            }
            $active = $payload['active'];
            $changes['active'] = $active;
        }
        $newRole = null;
        if (array_key_exists('role', $payload) && $payload['role'] !== $target['role']) {
            $newRole = $payload['role'];
            if (!is_string($newRole) || !in_array($newRole, self::CREATABLE_ROLES, true)) {
                throw new InvalidArgumentException("role invalide : " . implode(', ', self::CREATABLE_ROLES));
            }
            if ($target['role'] === 'admin' || $isSelf) {
                throw new ConflictException("Le rôle de ce compte ne peut pas être changé");
            }
            $this->assertCanManage($session, $newRole);
            $changes['role'] = ['de' => $target['role'], 'vers' => $newRole];
        }
        if ($active === false && ($target['role'] === 'admin' || $isSelf)) {
            throw new ConflictException("Ce compte ne peut pas être désactivé");
        }

        $this->pdo->beginTransaction();
        try {
            $this->repo->updateStaff($id, $displayName, $passwordHash, $active);
            if ($newRole !== null) {
                $this->repo->setRole($id, $newRole);
                if ($newRole !== 'server') {
                    $this->repo->clearTablesOf($id); // seul un SERVEUR a des tables
                }
            }
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        // Mot de passe changé, compte désactivé ou rôle changé : toutes ses sessions sont révoquées.
        if ($passwordChanged || $active === false || $newRole !== null) {
            $this->repo->deleteSessionsForStaff($id);
        }
        Audit::log($this->pdo, $session, 'staff.update', 'staff', $id, ['username' => $target['username']] + $changes);
        return $this->staffById($id);
    }

    /**
     * @throws ForbiddenException 403
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function deleteStaff(int $id, array $session): void
    {
        $target = $this->repo->findStaffById($id);
        if (!$target) {
            throw new NotFoundException("Compte introuvable");
        }
        if ($target['role'] === 'admin') {
            throw new ConflictException("Un compte administrateur ne peut pas être supprimé");
        }
        $this->assertCanManage($session, $target['role']);
        // Sessions et tables servies partent avec le compte (ON DELETE CASCADE).
        $this->repo->deleteStaff($id);
        Audit::log($this->pdo, $session, 'staff.delete', 'staff', $id, ['username' => $target['username'], 'role' => $target['role']]);
    }

    // ---- Tables servies par un serveur ----

    /**
     * Remplace l'ensemble des tables servies par ce serveur. Une table n'a
     * qu'un serveur : si elle est déjà prise par un autre, 409 avec son nom.
     *
     * @param mixed $rawTables
     * @throws InvalidArgumentException 400
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function setServerTables(int $staffId, $rawTables, bool $requireAtLeastOne, ?array $session = null): array
    {
        $target = $this->repo->findStaffById($staffId);
        if (!$target) {
            throw new NotFoundException("Compte introuvable");
        }
        if ($target['role'] !== 'server') {
            throw new ConflictException("Seuls les serveurs ont des tables à servir");
        }
        if (!is_array($rawTables) || !array_is_list($rawTables)) {
            throw new InvalidArgumentException("tables doit être un tableau de numéros de table");
        }
        $tables = [];
        foreach ($rawTables as $raw) {
            $t = RequestValidator::tableNumber($raw, 'table');
            $tables[$t] = $t;
        }
        $tables = array_values($tables);
        if ($requireAtLeastOne && count($tables) === 0) {
            throw new InvalidArgumentException("Indiquez au moins une table que vous servez");
        }
        if (count($tables) > self::MAX_TABLES_PER_SERVER) {
            throw new InvalidArgumentException("Trop de tables (" . self::MAX_TABLES_PER_SERVER . " maximum par serveur)");
        }

        $this->pdo->beginTransaction();
        try {
            foreach ($this->repo->ownersOf($tables) as $table => $owner) {
                if ((int) $owner['staff_id'] !== $staffId) {
                    throw new ConflictException("La table $table est déjà servie par " . $owner['display_name']);
                }
            }
            $this->repo->clearTablesOf($staffId);
            foreach ($tables as $t) {
                $this->repo->assignTable($staffId, $t);
            }
            $this->pdo->commit();
        } catch (PDOException $e) {
            $this->pdo->rollBack();
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new ConflictException("Une de ces tables vient d'être prise par un autre serveur");
            }
            throw $e;
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'staff.tables', 'staff', $staffId, ['tables' => $tables]);
        return ['tables' => $this->repo->tablesOf($staffId)];
    }

    public function getServerTables(int $staffId): array
    {
        return ['tables' => $this->repo->tablesOf($staffId)];
    }

    // ---- Outils ----

    private function staffById(int $id): array
    {
        $row = $this->repo->findStaffById($id);
        return $this->publicStaff($row, $row['role'] === 'server' ? $this->repo->tablesOf($id) : []);
    }

    /** Jamais de password_hash ni de compteurs internes dans les réponses. */
    private function publicStaff(array $s, array $tables, int $sessions = 0): array
    {
        return [
            'id' => (int) $s['id'],
            'role' => $s['role'],
            'roleLabel' => Permissions::ROLE_LABELS[$s['role']] ?? $s['role'],
            'permissions' => Permissions::forRole($s['role']),
            'username' => $s['username'],
            'displayName' => $s['display_name'],
            'active' => (bool) (int) $s['active'],
            'tables' => $tables,
            'sessions' => $sessions,
        ];
    }

    private function validateUsername($value): string
    {
        if (!is_string($value)) {
            throw new InvalidArgumentException("username est requis");
        }
        $u = strtolower(trim($value));
        if (!preg_match('/^[a-z0-9._-]{3,30}$/', $u)) {
            throw new InvalidArgumentException("username invalide : 3 à 30 caractères (lettres minuscules, chiffres, . _ -)");
        }
        return $u;
    }

    private function validatePassword($value): string
    {
        // bcrypt ignore tout au-delà de 72 octets : on borne explicitement.
        if (!is_string($value) || strlen($value) < 8 || strlen($value) > 72) {
            throw new InvalidArgumentException("Le mot de passe doit faire de 8 à 72 caractères");
        }
        return $value;
    }
}
