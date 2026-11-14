<?php
/**
 * Commande de groupe à table (migration 024).
 *
 * Les clients identifiés à la MÊME table remplissent un panier commun depuis
 * leurs téléphones. Quand l'un d'eux l'envoie, c'est le système de commande
 * existant qui crée UNE commande (OrderService::createOrder : prix, options,
 * promotions et validations inchangés). Chaque article garde son auteur, ce qui
 * permet ensuite de partager l'addition (chacun ses articles, ou à parts égales).
 *
 *  - La table vient de la session du client (jamais du corps de la requête).
 *  - Un client ne retire que SES articles.
 *  - Envoi idempotent (clé « table-group-<id>-<nb> ») : deux personnes qui appuient en même
 *    temps sur « Envoyer » ne créent qu'une seule commande.
 */
class GroupOrderService
{
    private const MAX_ITEMS = 60;

    public function __construct(private PDO $pdo, private OrderService $orders)
    {
    }

    /** Panier commun de la table du client + dernière commande de groupe envoyée (partage de l'addition). */
    public function current(array $client): array
    {
        $table = (string) $client['table_number'];
        $group = $this->openGroup($table);
        $items = $group ? $this->items((int) $group['id']) : [];
        $myId = (int) $client['id'];
        $members = [];
        $total = 0.0;
        $out = [];
        foreach ($items as $i) {
            $line = round((float) $i['unit_price'] * (int) $i['quantity'], 3);
            $total += $line;
            $name = $i['author_name'];
            $members[$name] = ($members[$name] ?? ['name' => $name, 'items' => 0, 'total' => 0.0]);
            $members[$name]['items'] += (int) $i['quantity'];
            $members[$name]['total'] = round($members[$name]['total'] + $line, 3);
            $out[] = [
                'id' => (int) $i['id'], 'mine' => (int) $i['client_id'] === $myId, 'author' => $name,
                'productId' => (int) $i['product_id'], 'quantity' => (int) $i['quantity'], 'label' => $i['label'],
                'unitPrice' => (float) $i['unit_price'], 'lineTotal' => $line,
            ];
        }
        return [
            'table' => $table,
            'groupId' => $group ? (int) $group['id'] : null,
            'items' => $out,
            'members' => array_values($members),
            'total' => round($total, 3),
            'lastSent' => $this->lastSent($table),
        ];
    }

    /**
     * Ajoute des articles au panier commun. Prix et options sont validés et
     * calculés par le système de commande (aucun prix ne vient du téléphone).
     *
     * @param array{items?: mixed} $b items : [{productId, quantity, options: [{optionId}]}]
     */
    public function add(array $client, array $b): array
    {
        $raw = $b['items'] ?? null;
        if (!is_array($raw) || !array_is_list($raw) || count($raw) < 1 || count($raw) > 30) {
            throw new InvalidArgumentException("items : 1 à 30 articles attendus");
        }
        $priced = [];
        foreach ($raw as $i => $item) {
            if (!is_array($item)) {
                throw new InvalidArgumentException("items[$i] doit être un objet");
            }
            $clean = ['productId' => $item['productId'] ?? null, 'quantity' => $item['quantity'] ?? null, 'options' => $item['options'] ?? []];
            $p = $this->orders->priceOrder(['items' => [$clean]], $client)['items'][0];
            $labels = array_column($p['options'], 'label');
            $priced[] = [
                'product_id' => (int) $p['productId'], 'quantity' => (int) $p['quantity'],
                'option_ids' => implode(',', array_map('intval', array_column($p['options'], 'id'))),
                'label' => mb_substr($p['productName'] . ($labels ? ' (' . implode(', ', $labels) . ')' : ''), 0, 500),
                'unit_price' => (float) $p['unitPrice'],
            ];
        }
        $table = (string) $client['table_number'];
        $author = mb_substr(trim($client['first_name'] . ' ' . mb_substr((string) $client['last_name'], 0, 1) . '.'), 0, 120);

        $this->pdo->beginTransaction();
        try {
            $group = $this->openGroup($table, true);
            if (!$group) {
                $this->pdo->prepare('INSERT INTO table_groups (table_number) VALUES (:t)')->execute(['t' => $table]);
                $groupId = (int) $this->pdo->lastInsertId();
            } else {
                $groupId = (int) $group['id'];
            }
            $count = $this->pdo->prepare('SELECT COUNT(*) FROM table_group_items WHERE group_id = :g');
            $count->execute(['g' => $groupId]);
            if ((int) $count->fetchColumn() + count($priced) > self::MAX_ITEMS) {
                throw new InvalidArgumentException("Panier de la table plein (" . self::MAX_ITEMS . " articles maximum)");
            }
            $ins = $this->pdo->prepare(
                'INSERT INTO table_group_items (group_id, client_id, author_name, product_id, quantity, option_ids, label, unit_price)
                 VALUES (:g, :c, :a, :p, :q, :o, :l, :u)'
            );
            foreach ($priced as $p) {
                $ins->execute(['g' => $groupId, 'c' => (int) $client['id'], 'a' => $author, 'p' => $p['product_id'], 'q' => $p['quantity'],
                    'o' => $p['option_ids'], 'l' => $p['label'], 'u' => $p['unit_price']]);
            }
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        return $this->current($client);
    }

    /** Retire UN de ses propres articles du panier commun. */
    public function remove(array $client, int $itemId): array
    {
        $s = $this->pdo->prepare(
            "SELECT i.id, i.client_id FROM table_group_items i JOIN table_groups g ON g.id = i.group_id
             WHERE i.id = :i AND g.table_number = :t AND g.status = 'OPEN'"
        );
        $s->execute(['i' => $itemId, 't' => (string) $client['table_number']]);
        $row = $s->fetch();
        if (!$row) {
            throw new NotFoundException("Article introuvable dans le panier de la table");
        }
        if ((int) $row['client_id'] !== (int) $client['id']) {
            throw new ForbiddenException("Vous ne pouvez retirer que vos propres articles");
        }
        $this->pdo->prepare('DELETE FROM table_group_items WHERE id = :i')->execute(['i' => $itemId]);
        return $this->current($client);
    }

    /** Envoie le panier commun en cuisine : UNE commande, créée par le système de commande existant. */
    public function send(array $client, array $b, array $session): array
    {
        $table = (string) $client['table_number'];
        $group = $this->openGroup($table);
        if (!$group) {
            throw new InvalidArgumentException("Le panier de la table est vide");
        }
        $groupId = (int) $group['id'];
        $items = $this->items($groupId);
        if (!$items) {
            throw new InvalidArgumentException("Le panier de la table est vide");
        }
        $payloadItems = [];
        foreach ($items as $i) {
            $payloadItems[] = [
                'productId' => (int) $i['product_id'], 'quantity' => (int) $i['quantity'],
                'options' => array_map(fn($id) => ['optionId' => (int) $id], array_values(array_filter(explode(',', $i['option_ids'])))),
                // Le serveur sait à qui apporter chaque plat.
                'note' => 'Pour ' . $i['author_name'],
            ];
        }
        $note = $b['note'] ?? null;
        $payload = ['items' => $payloadItems, 'note' => is_string($note) && trim($note) !== '' ? $note : 'Commande de groupe'];
        $replayed = false;
        $order = $this->orders->createOrder($payload, sprintf('table-group-%08d-%03d', $groupId, count($items)), $replayed, $client, $session);
        $this->pdo->prepare(
            "UPDATE table_groups SET status = 'SENT', order_id = :o, sent_by_client_id = :c, sent_at = NOW() WHERE id = :g AND status = 'OPEN'"
        )->execute(['o' => (int) $order['id'], 'c' => (int) $client['id'], 'g' => $groupId]);
        return ['orderId' => (int) $order['id'], 'replayed' => $replayed] + $this->current($client);
    }

    // ------------------------------------------------------------------

    private function openGroup(string $table, bool $forUpdate = false): ?array
    {
        $s = $this->pdo->prepare(
            "SELECT id FROM table_groups WHERE table_number = :t AND status = 'OPEN' AND created_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR)
             ORDER BY id DESC LIMIT 1" . ($forUpdate ? ' FOR UPDATE' : '')
        );
        $s->execute(['t' => $table]);
        return $s->fetch() ?: null;
    }

    private function items(int $groupId): array
    {
        $s = $this->pdo->prepare('SELECT * FROM table_group_items WHERE group_id = :g ORDER BY id');
        $s->execute(['g' => $groupId]);
        return $s->fetchAll();
    }

    /**
     * Dernière commande de groupe de la table (moins de 6 h) : statut et partage
     * de l'addition. Part de chacun = ses articles, au prorata du total réellement
     * dû (promotions et points compris) ; parts égales = total / nombre de personnes.
     */
    private function lastSent(string $table): ?array
    {
        $s = $this->pdo->prepare(
            "SELECT g.id, g.order_id, o.status, o.total, o.subtotal, o.payment_status
             FROM table_groups g JOIN orders o ON o.id = g.order_id
             WHERE g.table_number = :t AND g.status = 'SENT' AND g.sent_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR)
             ORDER BY g.id DESC LIMIT 1"
        );
        $s->execute(['t' => $table]);
        $g = $s->fetch();
        if (!$g) {
            return null;
        }
        $shares = [];
        $sum = 0.0;
        foreach ($this->items((int) $g['id']) as $i) {
            $line = (float) $i['unit_price'] * (int) $i['quantity'];
            $sum += $line;
            $shares[$i['author_name']] = ($shares[$i['author_name']] ?? 0) + $line;
        }
        $total = (float) $g['total'];
        $ratio = $sum > 0 ? $total / $sum : 1;
        $people = max(1, count($shares));
        $split = [];
        foreach ($shares as $name => $amount) {
            $split[] = ['name' => $name, 'items' => round($amount, 2), 'share' => round($amount * $ratio, 2)];
        }
        return [
            'orderId' => (int) $g['order_id'], 'status' => $g['status'], 'paymentStatus' => $g['payment_status'] ?? null,
            'total' => round($total, 2), 'split' => $split, 'equalShare' => round($total / $people, 2), 'people' => $people,
        ];
    }
}
