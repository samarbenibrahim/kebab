<?php
/**
 * Accès SQL des demandes « à emporter » (table takeaway_requests, migration 016).
 * Requêtes préparées uniquement.
 */
class TakeawayRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    public function insert(int $clientId, int $orderId, ?string $message): int
    {
        $this->pdo->prepare(
            'INSERT INTO takeaway_requests (client_id, order_id, message) VALUES (:c, :o, :m)'
        )->execute(['c' => $clientId, 'o' => $orderId, 'm' => $message]);
        return (int) $this->pdo->lastInsertId();
    }

    public function findById(int $id, bool $forUpdate = false): ?array
    {
        $stmt = $this->pdo->prepare(self::SELECT . ' WHERE r.id = :id' . ($forUpdate ? ' FOR UPDATE' : ''));
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findPendingForOrder(int $orderId): ?array
    {
        $stmt = $this->pdo->prepare(self::SELECT . " WHERE r.order_id = :o AND r.status = 'pending' LIMIT 1");
        $stmt->execute(['o' => $orderId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Demandes d'un client (les plus récentes d'abord). */
    public function listForClient(int $clientId, int $limit = 10): array
    {
        $stmt = $this->pdo->prepare(self::SELECT . ' WHERE r.client_id = :c ORDER BY r.id DESC LIMIT ' . max(1, $limit));
        $stmt->execute(['c' => $clientId]);
        return $stmt->fetchAll();
    }

    public function listByStatus(?string $status, int $limit = 50): array
    {
        $sql = self::SELECT . ($status !== null ? ' WHERE r.status = :s' : '') . ' ORDER BY r.id ' . ($status === 'pending' ? 'ASC' : 'DESC') . ' LIMIT ' . max(1, $limit);
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($status !== null ? ['s' => $status] : []);
        return $stmt->fetchAll();
    }

    public function respond(int $id, string $status, ?string $adminMessage, int $staffId): void
    {
        $this->pdo->prepare(
            'UPDATE takeaway_requests SET status = :s, admin_message = :m, responded_by = :b, responded_at = NOW() WHERE id = :id'
        )->execute(['s' => $status, 'm' => $adminMessage, 'b' => $staffId, 'id' => $id]);
    }

    public function cancel(int $id): void
    {
        $this->pdo->prepare("UPDATE takeaway_requests SET status = 'cancelled' WHERE id = :id")->execute(['id' => $id]);
    }

    /** Articles « Gobelet à emporter » d'une commande (nom du produit et quantité). */
    public function takeawayItems(int $orderId): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT i.product_name, i.quantity
             FROM order_items i
             JOIN order_item_options o ON o.order_item_id = i.id
             WHERE i.order_id = :o AND o.option_name = 'Gobelet à emporter'
             ORDER BY i.id"
        );
        $stmt->execute(['o' => $orderId]);
        return $stmt->fetchAll();
    }

    public function findOrder(int $orderId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, client_id, guest_name, table_number, status, cancelled_at FROM orders WHERE id = :id');
        $stmt->execute(['id' => $orderId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private const SELECT =
        'SELECT r.*, o.table_number, o.guest_name, o.status AS order_status, s.display_name AS responder_name
         FROM takeaway_requests r
         JOIN orders o ON o.id = r.order_id
         LEFT JOIN staff s ON s.id = r.responded_by';
}
