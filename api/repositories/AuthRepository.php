<?php
/**
 * Accès SQL brut : comptes du personnel, sessions, tables servies — aucune
 * logique métier ici (requêtes préparées uniquement).
 */
class AuthRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    // ---- Comptes ----

    public function findStaffByUsername(string $username): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked,
                    GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), locked_until)) AS lock_seconds
             FROM staff WHERE username = :u'
        );
        $stmt->execute(['u' => $username]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findStaffById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM staff WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Tous les comptes, avec les tables servies (regroupées par compte). */
    public function listStaff(): array
    {
        $staff = $this->pdo->query(
            'SELECT id, role, username, display_name, active, created_at FROM staff ORDER BY role, display_name'
        )->fetchAll();
        $tablesByStaff = [];
        $rows = $this->pdo->query('SELECT staff_id, table_number FROM server_tables ORDER BY table_number')->fetchAll();
        foreach ($rows as $r) {
            $tablesByStaff[$r['staff_id']][] = $r['table_number'];
        }
        // Sessions actives par compte (indication « connecté »).
        $online = [];
        $rows = $this->pdo->query(
            'SELECT staff_id, COUNT(*) AS n FROM auth_sessions WHERE staff_id IS NOT NULL AND expires_at > NOW() GROUP BY staff_id'
        )->fetchAll();
        foreach ($rows as $r) {
            $online[$r['staff_id']] = (int) $r['n'];
        }
        foreach ($staff as &$s) {
            $s['tables'] = $tablesByStaff[$s['id']] ?? [];
            $s['sessions'] = $online[$s['id']] ?? 0;
        }
        unset($s);
        return $staff;
    }

    public function insertStaff(string $role, string $username, string $displayName, string $passwordHash): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO staff (role, username, display_name, password_hash) VALUES (:r, :u, :d, :p)'
        );
        $stmt->execute(['r' => $role, 'u' => $username, 'd' => $displayName, 'p' => $passwordHash]);
        return (int) $this->pdo->lastInsertId();
    }

    public function updateStaff(int $id, ?string $displayName, ?string $passwordHash, ?bool $active): void
    {
        $set = [];
        $params = ['id' => $id];
        if ($displayName !== null) {
            $set[] = 'display_name = :d';
            $params['d'] = $displayName;
        }
        if ($passwordHash !== null) {
            $set[] = 'password_hash = :p';
            $set[] = 'failed_attempts = 0';
            $set[] = 'locked_until = NULL';
            $params['p'] = $passwordHash;
        }
        if ($active !== null) {
            $set[] = 'active = :a';
            $params['a'] = $active ? 1 : 0;
        }
        if (!$set) {
            return;
        }
        $this->pdo->prepare('UPDATE staff SET ' . implode(', ', $set) . ' WHERE id = :id')->execute($params);
    }

    public function setRole(int $id, string $role): void
    {
        $this->pdo->prepare("UPDATE staff SET role = :r WHERE id = :id")->execute(["r" => $role, "id" => $id]);
    }

    public function deleteStaff(int $id): void
    {
        $this->pdo->prepare('DELETE FROM staff WHERE id = :id')->execute(['id' => $id]);
    }

    /** 5 échecs => verrouillage de 5 minutes (l'ordre des SET est significatif en MySQL/MariaDB). */
    public function recordFailedLogin(int $id): void
    {
        $this->pdo->prepare(
            'UPDATE staff SET
                locked_until = IF(failed_attempts + 1 >= 5, DATE_ADD(NOW(), INTERVAL 5 MINUTE), locked_until),
                failed_attempts = IF(failed_attempts + 1 >= 5, 0, failed_attempts + 1)
             WHERE id = :id'
        )->execute(['id' => $id]);
    }

    public function resetFailedLogin(int $id): void
    {
        $this->pdo->prepare('UPDATE staff SET failed_attempts = 0, locked_until = NULL WHERE id = :id')
            ->execute(['id' => $id]);
    }

    // ---- Sessions ----

    public function createSession(string $role, ?int $staffId, ?int $clientId, string $tokenHash): void
    {
        $this->pdo->prepare(
            'INSERT INTO auth_sessions (token_hash, role, staff_id, client_id, expires_at)
             VALUES (:h, :r, :s, :c, DATE_ADD(NOW(), INTERVAL :hours HOUR))'
        )->execute([
            'h' => $tokenHash, 'r' => $role, 's' => $staffId, 'c' => $clientId, 'hours' => Auth::SESSION_HOURS,
        ]);
    }

    public function deleteSessionById(int $id): void
    {
        $this->pdo->prepare('DELETE FROM auth_sessions WHERE id = :id')->execute(['id' => $id]);
    }

    public function deleteSessionsForStaff(int $staffId): void
    {
        $this->pdo->prepare('DELETE FROM auth_sessions WHERE staff_id = :s')->execute(['s' => $staffId]);
    }

    public function deleteExpiredSessions(): void
    {
        $this->pdo->exec('DELETE FROM auth_sessions WHERE expires_at <= NOW()');
    }

    // ---- Tables servies ----

    public function tablesOf(int $staffId): array
    {
        $stmt = $this->pdo->prepare('SELECT table_number FROM server_tables WHERE staff_id = :s ORDER BY table_number');
        $stmt->execute(['s' => $staffId]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    /** @return array<string,array> table => {staff_id, display_name} pour les tables déjà prises. */
    public function ownersOf(array $tables): array
    {
        if (!$tables) {
            return [];
        }
        $ph = implode(',', array_fill(0, count($tables), '?'));
        $stmt = $this->pdo->prepare(
            "SELECT t.table_number, t.staff_id, s.display_name FROM server_tables t JOIN staff s ON s.id = t.staff_id
             WHERE t.table_number IN ($ph)"
        );
        $stmt->execute(array_values($tables));
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[$r['table_number']] = $r;
        }
        return $out;
    }

    public function clearTablesOf(int $staffId): void
    {
        $this->pdo->prepare('DELETE FROM server_tables WHERE staff_id = :s')->execute(['s' => $staffId]);
    }

    public function assignTable(int $staffId, string $table): void
    {
        $this->pdo->prepare('INSERT INTO server_tables (table_number, staff_id) VALUES (:t, :s)')
            ->execute(['t' => $table, 's' => $staffId]);
    }
}
