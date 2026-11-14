<?php
/**
 * Accès SQL brut pour les commandes. Aucune règle métier ici (validation,
 * calcul de prix, transitions de statut) — tout ça vit dans OrderService.
 * Toutes les requêtes utilisent des paramètres préparés.
 */
class OrderRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    public function insertOrder(
        string $guestName, string $tableNumber, int $partySize, float $subtotal, float $total,
        ?string $idempotencyKey = null, ?string $idempotencyHash = null, ?string $note = null,
        ?int $clientId = null
    ): int {
        $stmt = $this->pdo->prepare(
            "INSERT INTO orders (client_id, guest_name, table_number, party_size, note, status, subtotal, total, idempotency_key, idempotency_hash)
             VALUES (:clientId, :guestName, :tableNumber, :partySize, :note, 'Nouvelle', :subtotal, :total, :ikey, :ihash)"
        );
        $stmt->execute([
            'guestName' => $guestName, 'tableNumber' => $tableNumber,
            'partySize' => $partySize, 'note' => $note, 'subtotal' => $subtotal, 'total' => $total,
            'ikey' => $idempotencyKey, 'ihash' => $idempotencyHash, 'clientId' => $clientId,
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    public function findByIdempotencyKey(string $key): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, idempotency_hash FROM orders WHERE idempotency_key = :k');
        $stmt->execute(['k' => $key]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function insertOrderItem(int $orderId, int $productId, string $productName, float $unitPrice, int $quantity, float $lineTotal, ?string $note): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total, note)
             VALUES (:orderId, :productId, :productName, :unitPrice, :quantity, :lineTotal, :note)'
        );
        $stmt->execute([
            'orderId' => $orderId, 'productId' => $productId, 'productName' => $productName,
            'unitPrice' => $unitPrice, 'quantity' => $quantity, 'lineTotal' => $lineTotal, 'note' => $note,
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    public function insertOrderItemOption(int $orderItemId, int $optionId, string $optionName, float $priceDelta): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO order_item_options (order_item_id, option_id, option_name, price_delta)
             VALUES (:orderItemId, :optionId, :optionName, :priceDelta)'
        );
        $stmt->execute([
            'orderItemId' => $orderItemId, 'optionId' => $optionId,
            'optionName' => $optionName, 'priceDelta' => $priceDelta,
        ]);
    }

    public function insertStatusHistory(int $orderId, ?string $oldStatus, string $newStatus, ?string $changedBy = null): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO order_status_history (order_id, old_status, new_status, changed_by) VALUES (:orderId, :oldStatus, :newStatus, :by)'
        );
        $stmt->execute(['orderId' => $orderId, 'oldStatus' => $oldStatus, 'newStatus' => $newStatus, 'by' => $changedBy]);
    }

    public function updateStatus(int $orderId, string $newStatus): void
    {
        $stmt = $this->pdo->prepare('UPDATE orders SET status = :status WHERE id = :id');
        $stmt->execute(['status' => $newStatus, 'id' => $orderId]);
    }

    /**
     * Annulation atomique : ne réussit que si la commande est toujours
     * "Nouvelle", non payée et non annulée au moment de l'UPDATE (évite la
     * course avec une prise en charge ou un paiement simultanés).
     * Retourne le nombre de lignes modifiées (1 = annulée).
     */
    public function markCancelled(int $orderId): int
    {
        $stmt = $this->pdo->prepare(
            "UPDATE orders SET cancelled_at = NOW()
             WHERE id = :id AND cancelled_at IS NULL AND status = 'Nouvelle' AND payment_status = 'pending'"
        );
        $stmt->execute(['id' => $orderId]);
        return $stmt->rowCount();
    }

    public function markPaid(int $orderId, string $method, ?int $paidBy = null): void
    {
        $stmt = $this->pdo->prepare(
            "UPDATE orders SET payment_method = :method, payment_status = 'paid', paid_at = NOW(), paid_by = :by WHERE id = :id"
        );
        $stmt->execute(['method' => $method, 'by' => $paidBy, 'id' => $orderId]);
    }

    public function setDiscounts(int $orderId, float $discount, ?int $promotionId, ?string $promotionName, int $pointsUsed, float $loyaltyDiscount): void
    {
        $this->pdo->prepare(
            'UPDATE orders SET discount_total = :d, promotion_id = :pid, promotion_name = :pn, loyalty_points_used = :pu, loyalty_discount = :ld WHERE id = :id'
        )->execute(['d' => $discount, 'pid' => $promotionId, 'pn' => $promotionName, 'pu' => $pointsUsed, 'ld' => $loyaltyDiscount, 'id' => $orderId]);
    }

    public function findOrderRow(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM orders WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findById(int $id): ?array
    {
        $order = $this->findOrderRow($id);
        if (!$order) {
            return null;
        }
        unset($order['idempotency_key'], $order['idempotency_hash']);
        $order['items'] = $this->findItemsForOrder($id);
        $order['statusHistory'] = $this->findStatusHistory($id);
        return $order;
    }

    /**
     * @return array{items: array, total: int}
     */
    public function findAll(array $filters): array
    {
        $where = [];
        $params = [];
        if (isset($filters['status'])) {
            $where[] = 'status = :status';
            $params['status'] = $filters['status'];
        }
        if (isset($filters['tableNumber'])) {
            $where[] = 'table_number = :tableNumber';
            $params['tableNumber'] = $filters['tableNumber'];
        }
        if (isset($filters['clientId'])) {
            $where[] = 'client_id = :clientId';
            $params['clientId'] = $filters['clientId'];
        }
        if (isset($filters['tables'])) {
            // Serveur : uniquement les commandes des tables qu'il sert (aucune table => aucune commande).
            if (!$filters['tables']) {
                return ['items' => [], 'total' => 0];
            }
            $ph = [];
            foreach (array_values($filters['tables']) as $i => $t) {
                $ph[] = ':tb' . $i;
                $params['tb' . $i] = $t;
            }
            $where[] = 'table_number IN (' . implode(',', $ph) . ')';
        }
        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $countStmt = $this->pdo->prepare("SELECT COUNT(*) FROM orders $whereSql");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $limit = $filters['limit'];
        $offset = $filters['page'] * $limit;
        $stmt = $this->pdo->prepare(
            "SELECT * FROM orders $whereSql ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
        );
        foreach ($params as $k => $v) {
            $stmt->bindValue(':' . $k, $v);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $orders = $stmt->fetchAll();

        if ($orders) {
            $ids = array_column($orders, 'id');
            $itemsByOrder = $this->findItemsForOrders($ids);
            $historyByOrder = $this->findStatusHistoryForOrders($ids);
            foreach ($orders as &$o) {
                unset($o['idempotency_key'], $o['idempotency_hash']);
                $o['items'] = $itemsByOrder[$o['id']] ?? [];
                $o['statusHistory'] = $historyByOrder[$o['id']] ?? [];
            }
            unset($o);
        }

        return ['items' => $orders, 'total' => $total];
    }

    private function findItemsForOrder(int $orderId): array
    {
        return $this->findItemsForOrders([$orderId])[$orderId] ?? [];
    }

    /**
     * Charge les articles + leurs options pour un lot de commandes en 2
     * requêtes (évite le N+1, §40).
     *
     * @param int[] $orderIds
     */
    private function findItemsForOrders(array $orderIds): array
    {
        if (!$orderIds) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($orderIds), '?'));
        $itemsStmt = $this->pdo->prepare(
            "SELECT * FROM order_items WHERE order_id IN ($placeholders) ORDER BY id ASC"
        );
        $itemsStmt->execute($orderIds);
        $itemRows = $itemsStmt->fetchAll();
        if (!$itemRows) {
            return [];
        }

        $itemIds = array_column($itemRows, 'id');
        $optPlaceholders = implode(',', array_fill(0, count($itemIds), '?'));
        $optionsStmt = $this->pdo->prepare(
            "SELECT * FROM order_item_options WHERE order_item_id IN ($optPlaceholders) ORDER BY id ASC"
        );
        $optionsStmt->execute($itemIds);
        $optionRows = $optionsStmt->fetchAll();

        $optionsByItem = [];
        foreach ($optionRows as $opt) {
            $optionsByItem[$opt['order_item_id']][] = $opt;
        }

        $itemsByOrder = [];
        foreach ($itemRows as $item) {
            $item['options'] = $optionsByItem[$item['id']] ?? [];
            $itemsByOrder[$item['order_id']][] = $item;
        }
        return $itemsByOrder;
    }

    /**
     * Historique de statut d'un lot de commandes en 1 requête (pas de N+1).
     *
     * @param int[] $orderIds
     */
    private function findStatusHistoryForOrders(array $orderIds): array
    {
        if (!$orderIds) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($orderIds), '?'));
        $stmt = $this->pdo->prepare(
            "SELECT * FROM order_status_history WHERE order_id IN ($placeholders) ORDER BY id ASC"
        );
        $stmt->execute($orderIds);
        $byOrder = [];
        foreach ($stmt->fetchAll() as $row) {
            $byOrder[$row['order_id']][] = $row;
        }
        return $byOrder;
    }

    private function findStatusHistory(int $orderId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM order_status_history WHERE order_id = :orderId ORDER BY id ASC'
        );
        $stmt->execute(['orderId' => $orderId]);
        return $stmt->fetchAll();
    }
}
