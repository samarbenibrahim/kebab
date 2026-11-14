<?php
/**
 * Promotions intelligentes : règles automatiques appliquées par le SERVEUR au
 * calcul de la commande (le client ne peut ni les forcer ni les tricher).
 *
 * Une règle peut viser toute la commande, une catégorie ou un produit, avec un
 * minimum de commande, des jours de la semaine, une plage horaire (« happy
 * hour », y compris à cheval sur minuit) et une période de dates. Pour une
 * commande, la promotion la plus avantageuse s'applique (elles ne se cumulent
 * pas entre elles ; la fidélité, elle, s'applique ensuite).
 *
 * « Intelligentes » : le module analyse aussi l'historique des commandes pour
 * SUGGÉRER des promotions (heures creuses, produits qui ne se vendent pas).
 */
class PromotionService
{
    private const DAY_LABELS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

    public function __construct(private PDO $pdo)
    {
    }

    /** Heure locale du restaurant = horloge de la base (la même que created_at). */
    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable((string) $this->pdo->query('SELECT NOW()')->fetchColumn());
    }

    // ---- Lecture ----

    public function publicPromotion(array $p, ?DateTimeImmutable $now = null): array
    {
        $now = $now ?? $this->now();
        $days = [];
        for ($i = 0; $i < 7; $i++) {
            if ($p['days_mask'] & (1 << $i)) {
                $days[] = $i;
            }
        }
        return [
            'id' => (int) $p['id'],
            'name' => $p['name'],
            'description' => $p['description'],
            'kind' => $p['kind'],
            'value' => (float) $p['value'],
            'scope' => $p['scope'],
            'categoryId' => $p['category_id'] === null ? null : (int) $p['category_id'],
            'productId' => $p['product_id'] === null ? null : (int) $p['product_id'],
            'minOrder' => (float) $p['min_order'],
            'days' => $days,
            'startTime' => $p['start_time'] === null ? null : substr($p['start_time'], 0, 5),
            'endTime' => $p['end_time'] === null ? null : substr($p['end_time'], 0, 5),
            'startDate' => $p['start_date'],
            'endDate' => $p['end_date'],
            'active' => (bool) (int) $p['active'],
            'activeNow' => $this->isActiveAt($p, $now),
            'summary' => $this->summary($p),
        ];
    }

    public function listAll(): array
    {
        $now = $this->now();
        $rows = $this->pdo->query('SELECT * FROM promotions ORDER BY active DESC, id DESC')->fetchAll();
        return ['content' => array_map(fn($p) => $this->publicPromotion($p, $now), $rows)];
    }

    /** Promotions en vigueur MAINTENANT (visibles par les clients : affichage « offres du moment »). */
    public function listActiveNow(): array
    {
        $now = $this->now();
        $rows = $this->pdo->query('SELECT * FROM promotions WHERE active = 1')->fetchAll();
        $out = [];
        foreach ($rows as $p) {
            if ($this->isActiveAt($p, $now)) {
                $out[] = $this->publicPromotion($p, $now);
            }
        }
        return ['content' => $out];
    }

    private function summary(array $p): string
    {
        $v = (float) $p['value'];
        $what = $p['kind'] === 'percent' ? rtrim(rtrim(number_format($v, 1, ',', ''), '0'), ',') . ' %' : number_format($v, 2, ',', '') . ' €';
        $where = $p['scope'] === 'order' ? 'sur la commande' : ($p['scope'] === 'category' ? 'sur une catégorie' : 'sur un produit');
        $when = [];
        if ($p['start_time'] !== null) {
            $when[] = substr($p['start_time'], 0, 5) . '–' . substr($p['end_time'], 0, 5);
        }
        if ((int) $p['days_mask'] !== 127) {
            $d = [];
            for ($i = 0; $i < 7; $i++) {
                if ($p['days_mask'] & (1 << $i)) {
                    $d[] = self::DAY_LABELS[$i];
                }
            }
            $when[] = implode(', ', $d);
        }
        if ((float) $p['min_order'] > 0) {
            $when[] = 'dès ' . number_format((float) $p['min_order'], 2, ',', '') . ' €';
        }
        return "-$what $where" . ($when ? ' (' . implode(' · ', $when) . ')' : '');
    }

    // ---- Règles temporelles ----

    private function isActiveAt(array $p, DateTimeImmutable $now): bool
    {
        if (!(int) $p['active']) {
            return false;
        }
        $day = (int) $now->format('N') - 1; // 0 = lundi
        if (!($p['days_mask'] & (1 << $day))) {
            return false;
        }
        $date = $now->format('Y-m-d');
        if ($p['start_date'] !== null && $date < $p['start_date']) {
            return false;
        }
        if ($p['end_date'] !== null && $date > $p['end_date']) {
            return false;
        }
        if ($p['start_time'] !== null && $p['end_time'] !== null) {
            $t = $now->format('H:i:s');
            $s = $p['start_time'];
            $e = $p['end_time'];
            $inside = $s <= $e ? ($t >= $s && $t < $e) : ($t >= $s || $t < $e); // plage à cheval sur minuit
            if (!$inside) {
                return false;
            }
        }
        return true;
    }

    // ---- Calcul ----

    /**
     * @param array $lines chaque ligne : productId, categoryId, lineTotal
     * @return array{promotion:?array, discount:float}
     */
    public function evaluate(array $lines, float $subtotal, ?DateTimeImmutable $now = null): array
    {
        $now = $now ?? $this->now();
        $best = null;
        $bestAmount = 0.0;
        foreach ($this->pdo->query('SELECT * FROM promotions WHERE active = 1')->fetchAll() as $p) {
            if (!$this->isActiveAt($p, $now) || $subtotal + 1e-9 < (float) $p['min_order']) {
                continue;
            }
            $base = 0.0;
            foreach ($lines as $l) {
                if ($p['scope'] === 'order'
                    || ($p['scope'] === 'category' && (int) $p['category_id'] === (int) $l['categoryId'])
                    || ($p['scope'] === 'product' && (int) $p['product_id'] === (int) $l['productId'])) {
                    $base += (float) $l['lineTotal'];
                }
            }
            if ($base <= 0) {
                continue;
            }
            $amount = $p['kind'] === 'percent' ? $base * ((float) $p['value']) / 100 : min((float) $p['value'], $base);
            $amount = round(min($amount, $base), 3);
            if ($amount > $bestAmount) {
                $best = $p;
                $bestAmount = $amount;
            }
        }
        return ['promotion' => $best, 'discount' => $bestAmount];
    }

    // ---- Écriture (permission promotions.manage) ----

    /** @throws InvalidArgumentException 400 */
    private function validate(array $b, ?array $current = null): array
    {
        $get = fn(string $k, $default = null) => array_key_exists($k, $b) ? $b[$k] : ($current !== null ? ($current[$k] ?? $default) : $default);
        $name = RequestValidator::requiredText($b['name'] ?? ($current['name'] ?? null), 'name', 100);
        $desc = array_key_exists('description', $b) ? RequestValidator::optionalText($b['description'], 'description', 255) : ($current['description'] ?? null);

        $kind = $b['kind'] ?? ($current['kind'] ?? null);
        if (!in_array($kind, ['percent', 'fixed'], true)) {
            throw new InvalidArgumentException("kind doit être percent ou fixed");
        }
        $value = $b['value'] ?? ($current['value'] ?? null);
        if ((!is_int($value) && !is_float($value) && !(is_string($value) && is_numeric($value))) || $value <= 0) {
            throw new InvalidArgumentException("value doit être un nombre positif");
        }
        $value = round((float) $value, 3);
        if ($kind === 'percent' && $value > 90) {
            throw new InvalidArgumentException("Un pourcentage de remise ne peut pas dépasser 90 %");
        }
        if ($kind === 'fixed' && $value > 1000) {
            throw new InvalidArgumentException("Remise fixe trop élevée (1000 € maximum)");
        }

        $scope = $b['scope'] ?? ($current['scope'] ?? 'order');
        if (!in_array($scope, ['order', 'category', 'product'], true)) {
            throw new InvalidArgumentException("scope doit être order, category ou product");
        }
        $categoryId = null;
        $productId = null;
        if ($scope === 'category') {
            $categoryId = $b['categoryId'] ?? ($current['category_id'] ?? null);
            if (is_string($categoryId) && ctype_digit($categoryId)) {
                $categoryId = (int) $categoryId;
            }
            if (!is_int($categoryId)) {
                throw new InvalidArgumentException("categoryId est requis pour une promotion de catégorie");
            }
            $exists = $this->pdo->prepare('SELECT 1 FROM categories WHERE id = :id');
            $exists->execute(['id' => $categoryId]);
            if (!$exists->fetchColumn()) {
                throw new InvalidArgumentException("categoryId inconnu");
            }
        } elseif ($scope === 'product') {
            $productId = $b['productId'] ?? ($current['product_id'] ?? null);
            if (is_string($productId) && ctype_digit($productId)) {
                $productId = (int) $productId;
            }
            if (!is_int($productId)) {
                throw new InvalidArgumentException("productId est requis pour une promotion de produit");
            }
            $exists = $this->pdo->prepare('SELECT 1 FROM products WHERE id = :id AND deleted_at IS NULL');
            $exists->execute(['id' => $productId]);
            if (!$exists->fetchColumn()) {
                throw new InvalidArgumentException("productId inconnu");
            }
        }

        $minOrder = $b['minOrder'] ?? ($current['min_order'] ?? 0);
        if ((!is_int($minOrder) && !is_float($minOrder) && !(is_string($minOrder) && is_numeric($minOrder))) || $minOrder < 0 || $minOrder > 10000) {
            throw new InvalidArgumentException("minOrder doit être un nombre entre 0 et 10000");
        }

        $mask = $current['days_mask'] ?? 127;
        if (array_key_exists('days', $b)) {
            if (!is_array($b['days']) || !$b['days']) {
                throw new InvalidArgumentException("days doit être une liste non vide de jours (0 = lundi … 6 = dimanche)");
            }
            $mask = 0;
            foreach ($b['days'] as $d) {
                if (!is_int($d) || $d < 0 || $d > 6) {
                    throw new InvalidArgumentException("days : entiers de 0 (lundi) à 6 (dimanche)");
                }
                $mask |= 1 << $d;
            }
        }

        $startTime = array_key_exists('startTime', $b) ? $b['startTime'] : ($current['start_time'] ?? null);
        $endTime = array_key_exists('endTime', $b) ? $b['endTime'] : ($current['end_time'] ?? null);
        if ($startTime === '') {
            $startTime = null;
        }
        if ($endTime === '') {
            $endTime = null;
        }
        foreach (['startTime' => $startTime, 'endTime' => $endTime] as $label => $t) {
            if ($t !== null && !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/', (string) $t)) {
                throw new InvalidArgumentException("$label invalide (format HH:MM)");
            }
        }
        if (($startTime === null) !== ($endTime === null)) {
            throw new InvalidArgumentException("startTime et endTime vont ensemble");
        }
        if ($startTime !== null && strlen($startTime) === 5) {
            $startTime .= ':00';
        }
        if ($endTime !== null && strlen($endTime) === 5) {
            $endTime .= ':00';
        }

        $dates = [];
        foreach (['startDate' => 'start_date', 'endDate' => 'end_date'] as $key => $col) {
            $v = array_key_exists($key, $b) ? $b[$key] : ($current[$col] ?? null);
            if ($v === '') {
                $v = null;
            }
            if ($v !== null && (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4)))) {
                throw new InvalidArgumentException("$key invalide (format AAAA-MM-JJ)");
            }
            $dates[$col] = $v;
        }
        if ($dates['start_date'] !== null && $dates['end_date'] !== null && $dates['end_date'] < $dates['start_date']) {
            throw new InvalidArgumentException("endDate ne peut pas précéder startDate");
        }

        $active = array_key_exists('active', $b) ? $b['active'] : (bool) ($current['active'] ?? true);
        if (!is_bool($active)) {
            throw new InvalidArgumentException("active doit être true ou false");
        }

        return [
            'name' => $name, 'description' => $desc, 'kind' => $kind, 'value' => $value, 'scope' => $scope,
            'category_id' => $categoryId, 'product_id' => $productId, 'min_order' => round((float) $minOrder, 3),
            'days_mask' => $mask, 'start_time' => $startTime, 'end_time' => $endTime,
            'start_date' => $dates['start_date'], 'end_date' => $dates['end_date'], 'active' => $active ? 1 : 0,
        ];
    }

    public function create(array $payload, array $session): array
    {
        $v = $this->validate($payload);
        $this->pdo->prepare(
            'INSERT INTO promotions (name, description, kind, value, scope, category_id, product_id, min_order, days_mask,
                                     start_time, end_time, start_date, end_date, active, created_by)
             VALUES (:name, :description, :kind, :value, :scope, :category_id, :product_id, :min_order, :days_mask,
                     :start_time, :end_time, :start_date, :end_date, :active, :by)'
        )->execute($v + ['by' => (int) $session['staff']['id']]);
        $id = (int) $this->pdo->lastInsertId();
        Audit::log($this->pdo, $session, 'promotion.create', 'promotion', $id, ['name' => $v['name'], 'kind' => $v['kind'], 'value' => $v['value'], 'scope' => $v['scope']]);
        return $this->get($id);
    }

    public function update(int $id, array $payload, array $session): array
    {
        $current = $this->find($id);
        $v = $this->validate($payload, $current);
        $this->pdo->prepare(
            'UPDATE promotions SET name = :name, description = :description, kind = :kind, value = :value, scope = :scope,
                    category_id = :category_id, product_id = :product_id, min_order = :min_order, days_mask = :days_mask,
                    start_time = :start_time, end_time = :end_time, start_date = :start_date, end_date = :end_date, active = :active
             WHERE id = :id'
        )->execute($v + ['id' => $id]);
        Audit::log($this->pdo, $session, 'promotion.update', 'promotion', $id, ['name' => $v['name'], 'active' => (bool) $v['active'], 'value' => $v['value']]);
        return $this->get($id);
    }

    public function delete(int $id, array $session): void
    {
        $current = $this->find($id);
        $this->pdo->prepare('DELETE FROM promotions WHERE id = :id')->execute(['id' => $id]);
        Audit::log($this->pdo, $session, 'promotion.delete', 'promotion', $id, ['name' => $current['name']]);
    }

    private function find(int $id): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM promotions WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new NotFoundException("Promotion introuvable");
        }
        return $row;
    }

    public function get(int $id): array
    {
        return $this->publicPromotion($this->find($id));
    }

    // ---- Suggestions intelligentes ----

    /**
     * Analyse l'historique (30 derniers jours) :
     *  - heures creuses -> « happy hour » ;
     *  - produits disponibles jamais commandés depuis 14 jours -> remise produit.
     * Chaque suggestion contient un brouillon prêt à être créé tel quel.
     */
    public function suggestions(): array
    {
        $out = [];
        $orderCount = (int) $this->pdo->query(
            "SELECT COUNT(*) FROM orders WHERE cancelled_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        )->fetchColumn();

        if ($orderCount >= 10) {
            $byHour = array_fill(8, 14, 0); // 08h → 21h
            $rows = $this->pdo->query(
                "SELECT HOUR(created_at) AS h, COUNT(*) AS n FROM orders
                 WHERE cancelled_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY HOUR(created_at)"
            )->fetchAll();
            foreach ($rows as $r) {
                if (isset($byHour[(int) $r['h']])) {
                    $byHour[(int) $r['h']] = (int) $r['n'];
                }
            }
            asort($byHour);
            $avg = array_sum($byHour) / count($byHour);
            $slow = array_slice(array_keys($byHour), 0, 1, true);
            foreach ($slow as $h) {
                if ($byHour[$h] < $avg * 0.6) {
                    $end = sprintf('%02d:00', $h + 1);
                    $out[] = [
                        'type' => 'happy_hour',
                        'title' => sprintf('Happy hour %02dh–%02dh', $h, $h + 1),
                        'reason' => sprintf('%02dh est votre heure la plus creuse (%d commande(s) sur 30 jours, moyenne %.1f par heure).', $h, $byHour[$h], $avg),
                        'draft' => [
                            'name' => sprintf('Happy hour %02dh–%02dh', $h, $h + 1), 'kind' => 'percent', 'value' => 15, 'scope' => 'order',
                            'startTime' => sprintf('%02d:00', $h), 'endTime' => $end, 'minOrder' => 0,
                        ],
                    ];
                }
            }
        }

        $stale = $this->pdo->query(
            "SELECT p.id, p.name FROM products p
             WHERE p.deleted_at IS NULL AND p.available = 1
               AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                               WHERE oi.product_id = p.id AND o.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY))
               AND NOT EXISTS (SELECT 1 FROM promotions pr WHERE pr.scope = 'product' AND pr.product_id = p.id AND pr.active = 1)
             ORDER BY p.name LIMIT 3"
        )->fetchAll();
        if ($orderCount >= 10) {
            foreach ($stale as $p) {
                $out[] = [
                    'type' => 'slow_product',
                    'title' => '-10 % sur ' . $p['name'],
                    'reason' => $p['name'] . " n'a pas été commandé depuis 14 jours.",
                    'draft' => ['name' => '-10 % ' . $p['name'], 'kind' => 'percent', 'value' => 10, 'scope' => 'product', 'productId' => (int) $p['id'], 'minOrder' => 0],
                ];
            }
        }
        return [
            'content' => $out,
            'basedOnOrders' => $orderCount,
            'note' => $orderCount < 10 ? "Pas assez de données : il faut au moins 10 commandes sur 30 jours pour proposer des promotions pertinentes." : null,
        ];
    }
}
