<?php
/**
 * Statistiques calculées par le SERVEUR (permission stats.view : admin, manager)
 * et journal d'audit (permission audit.view).
 */
class StatsService
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @throws InvalidArgumentException 400 */
    public function summary(array $query): array
    {
        $days = 30;
        if (isset($query['days'])) {
            if (!ctype_digit((string) $query['days']) || (int) $query['days'] < 1 || (int) $query['days'] > 365) {
                throw new InvalidArgumentException("days doit être compris entre 1 et 365");
            }
            $days = (int) $query['days'];
        }
        $since = "created_at >= DATE_SUB(CURDATE(), INTERVAL " . ($days - 1) . " DAY)";

        $tot = $this->pdo->query(
            "SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS gross, COALESCE(SUM(discount_total + loyalty_discount), 0) AS discounts,
                    COALESCE(SUM(payment_status = 'paid'), 0) AS paid_orders,
                    COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total END), 0) AS revenue,
                    COALESCE(SUM(cancelled_at IS NOT NULL), 0) AS cancelled
             FROM orders WHERE $since"
        )->fetch();
        $active = $this->pdo->query("SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS gross FROM orders WHERE cancelled_at IS NULL AND $since")->fetch();

        $byMethod = [];
        foreach ($this->pdo->query(
            "SELECT payment_method AS m, COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount FROM orders
             WHERE payment_status = 'paid' AND cancelled_at IS NULL AND $since GROUP BY payment_method"
        )->fetchAll() as $r) {
            $byMethod[$r['m']] = ['orders' => (int) $r['n'], 'amount' => round((float) $r['amount'], 3)];
        }
        foreach (['cash', 'card', 'online'] as $m) {
            $byMethod[$m] = $byMethod[$m] ?? ['orders' => 0, 'amount' => 0.0];
        }

        $top = $this->pdo->query(
            "SELECT oi.product_id, oi.product_name AS name, SUM(oi.quantity) AS qty, SUM(oi.line_total) AS amount
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE o.cancelled_at IS NULL AND o.$since GROUP BY oi.product_id, oi.product_name ORDER BY qty DESC LIMIT 5"
        )->fetchAll();

        $byStatus = [];
        foreach ($this->pdo->query("SELECT status, COUNT(*) AS n FROM orders WHERE cancelled_at IS NULL AND $since GROUP BY status")->fetchAll() as $r) {
            $byStatus[$r['status']] = (int) $r['n'];
        }

        $loyalty = $this->pdo->query(
            "SELECT COALESCE(SUM(CASE WHEN type = 'earn' THEN points END), 0) AS earned,
                    COALESCE(-SUM(CASE WHEN type = 'redeem' THEN points END), 0) AS redeemed
             FROM loyalty_transactions WHERE $since"
        )->fetch();

        $waiting = (new WaitingTimeService($this->pdo))->kitchenStats();

        return [
            'days' => $days,
            'orders' => (int) $active['orders'],
            'cancelledOrders' => (int) $tot['cancelled'],
            'grossSales' => round((float) $active['gross'], 3),
            'revenue' => round((float) $tot['revenue'], 3), // encaissé
            'paidOrders' => (int) $tot['paid_orders'],
            'averageBasket' => (int) $active['orders'] > 0 ? round((float) $active['gross'] / (int) $active['orders'], 3) : 0.0,
            'discountsGiven' => round((float) $tot['discounts'], 3),
            'byPaymentMethod' => $byMethod,
            'topProducts' => array_map(fn($r) => ['productId' => (int) $r['product_id'], 'name' => $r['name'], 'quantity' => (int) $r['qty'], 'amount' => round((float) $r['amount'], 3)], $top),
            'byStatus' => $byStatus,
            'loyalty' => ['pointsEarned' => (int) $loyalty['earned'], 'pointsRedeemed' => (int) $loyalty['redeemed']],
            'kitchen' => $waiting,
        ];
    }

    // ---- Journal d'audit ----

    /**
     * @throws InvalidArgumentException 400
     */
    public function audit(array $q): array
    {
        $where = [];
        $params = [];
        if (isset($q['action']) && $q['action'] !== '') {
            if (!preg_match('/^[a-z_.]{1,60}$/', (string) $q['action'])) {
                throw new InvalidArgumentException("action invalide");
            }
            // « order » = toutes les actions order.*
            $where[] = '(action = :action OR action LIKE :actionLike)';
            $params['action'] = $q['action'];
            $params['actionLike'] = $q['action'] . '.%';
        }
        if (isset($q['actorType']) && $q['actorType'] !== '') {
            if (!in_array($q['actorType'], ['staff', 'client', 'system'], true)) {
                throw new InvalidArgumentException("actorType invalide");
            }
            $where[] = 'actor_type = :actorType';
            $params['actorType'] = $q['actorType'];
        }
        if (isset($q['actor']) && trim((string) $q['actor']) !== '') {
            $where[] = 'actor_name LIKE :actor';
            $params['actor'] = '%' . trim((string) $q['actor']) . '%';
        }
        if (isset($q['entity']) && $q['entity'] !== '') {
            if (!preg_match('/^[a-z_]{1,40}$/', (string) $q['entity'])) {
                throw new InvalidArgumentException("entity invalide");
            }
            $where[] = 'entity = :entity';
            $params['entity'] = $q['entity'];
        }
        if (isset($q['entityId']) && $q['entityId'] !== '') {
            $where[] = 'entity_id = :entityId';
            $params['entityId'] = (string) $q['entityId'];
        }
        foreach (['from' => '>=', 'to' => '<='] as $key => $op) {
            if (isset($q[$key]) && $q[$key] !== '') {
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $q[$key])) {
                    throw new InvalidArgumentException("$key invalide (AAAA-MM-JJ)");
                }
                $where[] = $key === 'from' ? 'created_at >= :from' : 'created_at < DATE_ADD(:to, INTERVAL 1 DAY)';
                $params[$key] = $q[$key];
            }
        }
        $limit = 50;
        if (isset($q['limit'])) {
            if (!ctype_digit((string) $q['limit']) || (int) $q['limit'] < 1 || (int) $q['limit'] > 200) {
                throw new InvalidArgumentException("limit doit être compris entre 1 et 200");
            }
            $limit = (int) $q['limit'];
        }
        $page = 0;
        if (isset($q['page'])) {
            if (!ctype_digit((string) $q['page'])) {
                throw new InvalidArgumentException("page invalide");
            }
            $page = (int) $q['page'];
        }
        $w = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $count = $this->pdo->prepare("SELECT COUNT(*) FROM audit_log$w");
        $count->execute($params);
        $stmt = $this->pdo->prepare("SELECT * FROM audit_log$w ORDER BY id DESC LIMIT :l OFFSET :o");
        foreach ($params as $k => $v) {
            $stmt->bindValue(':' . $k, $v);
        }
        $stmt->bindValue(':l', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':o', $page * $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = array_map(function ($r) {
            return [
                'id' => (int) $r['id'],
                'at' => $r['created_at'],
                'actorType' => $r['actor_type'],
                'actorId' => $r['actor_id'] === null ? null : (int) $r['actor_id'],
                'actorName' => $r['actor_name'],
                'actorRole' => $r['actor_role'],
                'action' => $r['action'],
                'entity' => $r['entity'],
                'entityId' => $r['entity_id'],
                'details' => $r['details'] === null ? null : json_decode($r['details'], true),
                'ip' => $r['ip'],
            ];
        }, $stmt->fetchAll());
        return ['content' => $rows, 'page' => $page, 'size' => $limit, 'totalElements' => (int) $count->fetchColumn()];
    }
}
