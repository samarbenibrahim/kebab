<?php
/**
 * Accès SQL brut pour les appels serveur — aucune logique métier ici.
 */
class WaiterCallRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM waiter_calls WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findPendingByTable(string $table): ?array
    {
        $stmt = $this->pdo->prepare(
            "SELECT * FROM waiter_calls WHERE table_number = :t AND status = 'pending' ORDER BY id DESC LIMIT 1"
        );
        $stmt->execute(['t' => $table]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function insert(string $table, ?string $guestName, ?int $clientId = null): int
    {
        $stmt = $this->pdo->prepare('INSERT INTO waiter_calls (client_id, table_number, guest_name) VALUES (:c, :t, :g)');
        $stmt->execute(['c' => $clientId, 't' => $table, 'g' => $guestName]);
        return (int) $this->pdo->lastInsertId();
    }

    /** $tables : null = toutes (admin) ; liste = uniquement ces tables (serveur). */
    public function findAll(?string $status, int $limit, ?array $tables = null): array
    {
        $where = [];
        if ($status !== null) {
            $where[] = 'status = :s';
        }
        if ($tables !== null) {
            if (!$tables) {
                return [];
            }
            $ph = [];
            foreach (array_values($tables) as $i => $_) {
                $ph[] = ':tb' . $i;
            }
            $where[] = 'table_number IN (' . implode(',', $ph) . ')';
        }
        $sql = 'SELECT * FROM waiter_calls' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY id DESC LIMIT :l';
        $stmt = $this->pdo->prepare($sql);
        if ($status !== null) {
            $stmt->bindValue(':s', $status);
        }
        foreach (array_values($tables ?? []) as $i => $t) {
            $stmt->bindValue(':tb' . $i, $t);
        }
        $stmt->bindValue(':l', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function acknowledge(int $id, ?int $staffId = null): void
    {
        $stmt = $this->pdo->prepare(
            "UPDATE waiter_calls SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = :b WHERE id = :id AND status = 'pending'"
        );
        $stmt->execute(['id' => $id, 'b' => $staffId]);
    }
}
