<?php
/**
 * Accès SQL brut : clients identifiés et demandes de changement de table —
 * aucune logique métier ici (requêtes préparées uniquement).
 */
class ClientRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    public function insertClient(string $first, string $last, ?string $phone, string $table, int $party): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO clients (first_name, last_name, phone, table_number, party_size) VALUES (:f, :l, :p, :t, :n)'
        );
        $stmt->execute(['f' => $first, 'l' => $last, 'p' => $phone, 't' => $table, 'n' => $party]);
        return (int) $this->pdo->lastInsertId();
    }

    public function findById(int $id, bool $forUpdate = false): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM clients WHERE id = :id' . ($forUpdate ? ' FOR UPDATE' : ''));
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateParty(int $id, int $party): void
    {
        $this->pdo->prepare('UPDATE clients SET party_size = :n WHERE id = :id')->execute(['n' => $party, 'id' => $id]);
    }

    public function updateTable(int $id, string $table): void
    {
        $this->pdo->prepare('UPDATE clients SET table_number = :t WHERE id = :id')->execute(['t' => $table, 'id' => $id]);
    }

    /** Montant restant à régler par ce client (commandes non annulées et non payées). */
    public function unpaidTotal(int $clientId): float
    {
        $stmt = $this->pdo->prepare("SELECT COALESCE(SUM(total), 0) FROM orders WHERE client_id = :c AND cancelled_at IS NULL AND payment_status = 'pending'");
        $stmt->execute(['c' => $clientId]);
        return (float) $stmt->fetchColumn();
    }

    /** Une commande en cours / un appel en attente suivent le client à sa nouvelle table. */
    public function moveActiveRecords(int $clientId, string $table): void
    {
        $this->pdo->prepare(
            "UPDATE orders SET table_number = :t WHERE client_id = :c AND status <> 'Servie' AND cancelled_at IS NULL"
        )->execute(['t' => $table, 'c' => $clientId]);
        $this->pdo->prepare("UPDATE waiter_calls SET table_number = :t WHERE client_id = :c AND status = 'pending'")
            ->execute(['t' => $table, 'c' => $clientId]);
    }

    // ---- Demandes de changement de table ----

    public function insertRequest(int $clientId, string $fromTable, ?string $requested, ?string $reason): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO table_change_requests (client_id, from_table, requested_table, reason) VALUES (:c, :f, :r, :w)'
        );
        $stmt->execute(['c' => $clientId, 'f' => $fromTable, 'r' => $requested, 'w' => $reason]);
        return (int) $this->pdo->lastInsertId();
    }

    public function findRequestById(int $id, bool $forUpdate = false): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM table_change_requests WHERE id = :id' . ($forUpdate ? ' FOR UPDATE' : ''));
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findLatestRequestOf(int $clientId, ?string $status = null): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM table_change_requests WHERE client_id = :c' . ($status !== null ? ' AND status = :s' : '') . ' ORDER BY id DESC LIMIT 1'
        );
        $params = ['c' => $clientId];
        if ($status !== null) {
            $params['s'] = $status;
        }
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Liste pour l'admin, avec l'identité et la table actuelle du client. */
    public function listRequests(?string $status, int $limit): array
    {
        $sql = 'SELECT r.*, c.first_name, c.last_name, c.party_size, c.table_number AS current_table
                FROM table_change_requests r JOIN clients c ON c.id = r.client_id'
             . ($status !== null ? ' WHERE r.status = :s' : '') . ' ORDER BY r.id DESC LIMIT :l';
        $stmt = $this->pdo->prepare($sql);
        if ($status !== null) {
            $stmt->bindValue(':s', $status);
        }
        $stmt->bindValue(':l', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function respond(int $id, string $status, ?string $approvedTable, ?string $message, int $staffId): void
    {
        $this->pdo->prepare(
            'UPDATE table_change_requests SET status = :s, approved_table = :t, admin_message = :m,
                    responded_by = :b, responded_at = NOW() WHERE id = :id'
        )->execute(['s' => $status, 't' => $approvedTable, 'm' => $message, 'b' => $staffId, 'id' => $id]);
    }

    public function setRequestStatus(int $id, string $status): void
    {
        $extra = $status === 'applied' ? ', applied_at = NOW()' : '';
        $this->pdo->prepare("UPDATE table_change_requests SET status = :s$extra WHERE id = :id")
            ->execute(['s' => $status, 'id' => $id]);
    }

    /**
     * Tables actuellement occupées : clients avec une session ouverte + commandes
     * non servies, avec le serveur qui la sert (aide de l'admin pour répondre).
     */
    public function occupiedTables(): array
    {
        $rows = $this->pdo->query(
            "SELECT t.table_number, SUM(t.clients) AS clients, SUM(t.orders) AS orders FROM (
                SELECT c.table_number, COUNT(DISTINCT c.id) AS clients, 0 AS orders
                FROM clients c JOIN auth_sessions s ON s.client_id = c.id AND s.expires_at > NOW()
                GROUP BY c.table_number
                UNION ALL
                SELECT table_number, 0, COUNT(*) FROM orders WHERE status <> 'Servie' AND cancelled_at IS NULL GROUP BY table_number
             ) t GROUP BY t.table_number ORDER BY t.table_number"
        )->fetchAll();
        $owners = $this->pdo->query(
            'SELECT t.table_number, s.display_name FROM server_tables t JOIN staff s ON s.id = t.staff_id'
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        foreach ($rows as &$r) {
            $r['clients'] = (int) $r['clients'];
            $r['orders'] = (int) $r['orders'];
            $r['server'] = $owners[$r['table_number']] ?? null;
        }
        unset($r);
        return $rows;
    }
}
