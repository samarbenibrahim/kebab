<?php
/**
 * Smart Stock (module additif, tables stock_*).
 *
 * Règle d'or : la quantité RÉELLE ne vient que des saisies humaines
 * (inventaire = quantité constatée, livraison = quantité ajoutée). Le module
 * ESTIME la consommation à partir des commandes et des recettes, mais ne
 * l'écrit jamais : l'estimation est recalculée à chaque lecture.
 */
class AiStockService
{
    public function __construct(private AiSupport $ai)
    {
    }

    private function pdo(): PDO
    {
        return $this->ai->pdo();
    }

    /** Quantité consommée (estimée) d'un ingrédient entre deux instants. */
    private function consumption(int $itemId, string $from, ?string $to = null): float
    {
        $st = $this->pdo()->prepare(
            "SELECT COALESCE(SUM(oi.quantity * r.quantity_per_unit), 0)
             FROM stock_recipes r
             JOIN order_items oi ON oi.product_id = r.product_id
             JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL
             WHERE r.stock_item_id = :i AND o.created_at > :f" . ($to ? ' AND o.created_at <= :t' : '')
        );
        $params = ['i' => $itemId, 'f' => $from];
        if ($to) {
            $params['t'] = $to;
        }
        $st->execute($params);
        return (float) $st->fetchColumn();
    }

    public function overview(?float $tomorrowFactor = null): array
    {
        $items = $this->pdo()->query('SELECT * FROM stock_items WHERE active = 1 ORDER BY name')->fetchAll();
        $out = [];
        $sinceFirst = $this->pdo()->query('SELECT TIMESTAMPDIFF(SECOND, MIN(created_at), NOW()) FROM orders WHERE cancelled_at IS NULL')->fetchColumn();
        $nowDb = (string) $this->pdo()->query('SELECT NOW()')->fetchColumn();
        foreach ($items as $it) {
            $id = (int) $it['id'];
            $st = $this->pdo()->prepare("SELECT id, quantity, created_at FROM stock_movements WHERE stock_item_id = :i AND type = 'count' ORDER BY id DESC LIMIT 1");
            $st->execute(['i' => $id]);
            $count = $st->fetch();
            $recipes = $this->pdo()->prepare('SELECT r.product_id, p.name, r.quantity_per_unit FROM stock_recipes r JOIN products p ON p.id = r.product_id WHERE r.stock_item_id = :i ORDER BY p.name');
            $recipes->execute(['i' => $id]);
            $recipeRows = $recipes->fetchAll();

            // Consommation moyenne sur 14 jours (ou depuis la première commande si plus récent)
            $windowDays = 14;
            if ($sinceFirst !== null && $sinceFirst !== false) {
                $since = (int) $sinceFirst / 86400;
                $windowDays = max(1, min(14, (int) ceil($since)));
            }
            $used14 = $recipeRows ? $this->consumption($id, (new DateTimeImmutable($nowDb))->modify("-$windowDays days")->format('Y-m-d H:i:s')) : 0.0;
            $avgDaily = $used14 / $windowDays;

            $estimated = null;
            $deliveries = 0.0;
            $consumed = 0.0;
            if ($count) {
                $d = $this->pdo()->prepare("SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE stock_item_id = :i AND type = 'delivery' AND id > :m");
                // Ordre de saisie (id) et non l'heure : une livraison saisie dans la même seconde que l'inventaire compte.
                $d->execute(['i' => $id, 'm' => $count['id']]);
                $deliveries = (float) $d->fetchColumn();
                $consumed = $recipeRows ? $this->consumption($id, $count['created_at']) : 0.0;
                $estimated = (float) $count['quantity'] + $deliveries - $consumed;
            }
            $tomorrow = $avgDaily * ($tomorrowFactor ?? 1.0);
            $daysLeft = ($estimated !== null && $avgDaily > 0) ? $estimated / $avgDaily : null;
            $min = (float) $it['min_threshold'];
            if ($estimated === null) {
                $risk = 'inconnu';
                $message = 'Faites un premier inventaire pour suivre ce produit.';
            } elseif ($estimated <= 0) {
                $risk = 'rupture';
                $message = 'Stock estimé épuisé : vérifiez et faites un inventaire.';
            } elseif ($estimated <= $min || ($daysLeft !== null && $daysLeft < 1.5) || ($tomorrow > 0 && $estimated < $tomorrow)) {
                $risk = 'élevé';
                $message = 'Risque de rupture';
            } elseif ($daysLeft !== null && $daysLeft < 4) {
                $risk = 'moyen';
                $message = 'À surveiller';
            } else {
                $risk = 'faible';
                $message = $recipeRows ? 'Stock suffisant' : 'Aucune recette liée : consommation non estimée.';
            }
            $out[] = [
                'id' => $id,
                'name' => $it['name'],
                'unit' => $it['unit'],
                'minThreshold' => round($min, 3),
                'lastCount' => $count ? ['quantity' => round((float) $count['quantity'], 3), 'at' => $count['created_at']] : null,
                'deliveriesSinceCount' => round($deliveries, 3),
                'consumedSinceCount' => round($consumed, 3),
                'estimatedStock' => $estimated === null ? null : round($estimated, 3),
                'avgDailyConsumption' => round($avgDaily, 3),
                'consumptionWindowDays' => $windowDays,
                'forecastTomorrow' => round($tomorrow, 3),
                'daysLeft' => $daysLeft === null ? null : round($daysLeft, 1),
                'risk' => $risk,
                'message' => $message,
                'recipes' => array_map(fn($r) => ['productId' => (int) $r['product_id'], 'name' => $r['name'], 'quantityPerUnit' => (float) $r['quantity_per_unit']], $recipeRows),
            ];
        }
        $rank = ['rupture' => 0, 'élevé' => 1, 'moyen' => 2, 'inconnu' => 3, 'faible' => 4];
        usort($out, fn($a, $b) => $rank[$a['risk']] <=> $rank[$b['risk']] ?: strcmp($a['name'], $b['name']));
        return ['items' => $out, 'note' => 'Stock réel = dernier inventaire + livraisons. La consommation est une estimation (commandes × recettes) et ne modifie jamais le stock enregistré.'];
    }

    private static function num($v, string $field, bool $allowZero = true): float
    {
        if (!is_numeric($v) || (float) $v < 0 || (!$allowZero && (float) $v == 0.0) || (float) $v > 1000000) {
            throw new InvalidArgumentException("$field doit être un nombre positif");
        }
        return round((float) $v, 4);
    }

    public function createItem(array $b, array $session): array
    {
        $name = trim((string) ($b['name'] ?? ''));
        $unit = trim((string) ($b['unit'] ?? ''));
        if ($name === '' || mb_strlen($name) > 100) {
            throw new InvalidArgumentException('Indiquez un nom (100 caractères maximum).');
        }
        if ($unit === '' || mb_strlen($unit) > 20) {
            throw new InvalidArgumentException('Indiquez une unité (ex : L, kg, pièces).');
        }
        $min = self::num($b['minThreshold'] ?? 0, 'Le seuil minimum');
        $exists = $this->pdo()->prepare('SELECT id, active FROM stock_items WHERE name = :n');
        $exists->execute(['n' => $name]);
        if ($row = $exists->fetch()) {
            if ((int) $row['active']) {
                throw new ConflictException('Un article de stock porte déjà ce nom.');
            }
            $this->pdo()->prepare('UPDATE stock_items SET active = 1, unit = :u, min_threshold = :m WHERE id = :i')->execute(['u' => $unit, 'm' => $min, 'i' => $row['id']]);
            $id = (int) $row['id'];
        } else {
            $this->pdo()->prepare('INSERT INTO stock_items (name, unit, min_threshold, created_by) VALUES (:n, :u, :m, :s)')
                ->execute(['n' => $name, 'u' => $unit, 'm' => $min, 's' => $session['staff']['id'] ?? null]);
            $id = (int) $this->pdo()->lastInsertId();
        }
        Audit::log($this->pdo(), $session, 'stock.item_create', 'stock_item', $id, ['name' => $name, 'unit' => $unit, 'min' => $min]);
        if (isset($b['initialCount']) && $b['initialCount'] !== '' && $b['initialCount'] !== null) {
            $this->movement($id, ['type' => 'count', 'quantity' => $b['initialCount'], 'note' => 'Inventaire initial'], $session);
        }
        return ['id' => $id];
    }

    public function updateItem(int $id, array $b, array $session): array
    {
        $item = $this->find($id);
        $sets = [];
        $params = ['i' => $id];
        if (array_key_exists('minThreshold', $b)) {
            $sets[] = 'min_threshold = :m';
            $params['m'] = self::num($b['minThreshold'], 'Le seuil minimum');
        }
        if (array_key_exists('unit', $b)) {
            $u = trim((string) $b['unit']);
            if ($u === '' || mb_strlen($u) > 20) {
                throw new InvalidArgumentException('Unité invalide.');
            }
            $sets[] = 'unit = :u';
            $params['u'] = $u;
        }
        if (array_key_exists('active', $b)) {
            // Archiver (jamais supprimer) : l'historique des mouvements est conservé.
            $sets[] = 'active = :a';
            $params['a'] = $b['active'] ? 1 : 0;
        }
        if (!$sets) {
            throw new InvalidArgumentException('Rien à modifier.');
        }
        $this->pdo()->prepare('UPDATE stock_items SET ' . implode(', ', $sets) . ' WHERE id = :i')->execute($params);
        Audit::log($this->pdo(), $session, 'stock.item_update', 'stock_item', $id, ['name' => $item['name']] + array_diff_key($params, ['i' => 1]));
        return ['id' => $id];
    }

    public function movement(int $id, array $b, array $session): array
    {
        $item = $this->find($id);
        $type = $b['type'] ?? '';
        if (!in_array($type, ['count', 'delivery'], true)) {
            throw new InvalidArgumentException('type doit être « count » (inventaire) ou « delivery » (livraison).');
        }
        $qty = self::num($b['quantity'] ?? null, 'La quantité', $type === 'count');
        $note = isset($b['note']) ? mb_substr(trim((string) $b['note']), 0, 255) : null;
        $this->pdo()->prepare('INSERT INTO stock_movements (stock_item_id, type, quantity, note, created_by) VALUES (:i, :t, :q, :n, :s)')
            ->execute(['i' => $id, 't' => $type, 'q' => $qty, 'n' => $note ?: null, 's' => $session['staff']['id'] ?? null]);
        Audit::log($this->pdo(), $session, $type === 'count' ? 'stock.count' : 'stock.delivery', 'stock_item', $id, ['name' => $item['name'], 'quantity' => $qty, 'unit' => $item['unit']]);
        return ['id' => (int) $this->pdo()->lastInsertId()];
    }

    /** Remplace la recette d'UN produit (lignes de la table stock_recipes uniquement). */
    public function setRecipe(array $b, array $session): array
    {
        $productId = (int) ($b['productId'] ?? 0);
        $p = $this->pdo()->prepare('SELECT id, name FROM products WHERE id = :i AND deleted_at IS NULL');
        $p->execute(['i' => $productId]);
        $product = $p->fetch();
        if (!$product) {
            throw new NotFoundException('Produit introuvable.');
        }
        $lines = $b['items'] ?? [];
        if (!is_array($lines) || count($lines) > 20) {
            throw new InvalidArgumentException('items doit être une liste (20 ingrédients maximum).');
        }
        $clean = [];
        foreach ($lines as $l) {
            $sid = (int) ($l['stockItemId'] ?? 0);
            $this->find($sid);
            $clean[$sid] = self::num($l['quantity'] ?? null, 'La quantité par unité', false);
        }
        $this->pdo()->beginTransaction();
        try {
            $this->pdo()->prepare('DELETE FROM stock_recipes WHERE product_id = :p')->execute(['p' => $productId]);
            $ins = $this->pdo()->prepare('INSERT INTO stock_recipes (product_id, stock_item_id, quantity_per_unit) VALUES (:p, :s, :q)');
            foreach ($clean as $sid => $q) {
                $ins->execute(['p' => $productId, 's' => $sid, 'q' => $q]);
            }
            $this->pdo()->commit();
        } catch (Throwable $e) {
            $this->pdo()->rollBack();
            throw $e;
        }
        Audit::log($this->pdo(), $session, 'stock.recipe', 'product', $productId, ['product' => $product['name'], 'items' => $clean]);
        return ['productId' => $productId, 'items' => count($clean)];
    }

    private function find(int $id): array
    {
        $st = $this->pdo()->prepare('SELECT * FROM stock_items WHERE id = :i');
        $st->execute(['i' => $id]);
        $row = $st->fetch();
        if (!$row) {
            throw new NotFoundException('Article de stock introuvable.');
        }
        return $row;
    }
}
