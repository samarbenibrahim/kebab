<?php
/**
 * Socle du module « SOUCOFFE Intelligent ».
 *
 * Le module est ADDITIF : il lit les tables existantes (commandes, produits…)
 * sans jamais les modifier, et n'écrit que dans ses propres tables
 * (ai_settings, ai_cache, ai_interactions, stock_*).
 * Interrupteur : ai_settings.enabled ('1' / '0'). Désactivé, toutes les routes
 * /ai/… répondent 503 (sauf la lecture et le changement de l'interrupteur) et
 * l'interface masque les blocs intelligents.
 */
class AiDisabledException extends RuntimeException
{
}

class AiSupport
{
    /** Seuils à partir desquels un modèle ML deviendrait pertinent (sinon : statistiques). */
    public const ML_MIN_ORDERS = 500;
    public const ML_MIN_DAYS = 60;

    private ?array $settings = null;

    public function __construct(private PDO $pdo)
    {
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    // ---- Réglages ----

    public function settings(): array
    {
        if ($this->settings === null) {
            $this->settings = [];
            try {
                foreach ($this->pdo->query('SELECT setting_key, setting_value FROM ai_settings')->fetchAll() as $r) {
                    $this->settings[$r['setting_key']] = $r['setting_value'];
                }
            } catch (PDOException $e) {
                // Migration 020 absente : module considéré comme désactivé.
                $this->settings = ['enabled' => '0'];
            }
        }
        return $this->settings;
    }

    public function enabled(): bool
    {
        return ($this->settings()['enabled'] ?? '0') === '1';
    }

    public function requireEnabled(): void
    {
        if (!$this->enabled()) {
            throw new AiDisabledException('Module intelligent désactivé');
        }
    }

    public function setSetting(string $key, string $value, ?int $staffId): void
    {
        $this->pdo->prepare(
            'INSERT INTO ai_settings (setting_key, setting_value, updated_by) VALUES (:k, :v, :s)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)'
        )->execute(['k' => $key, 'v' => $value, 's' => $staffId]);
        $this->settings = null;
        $this->cacheClear();
    }

    /** Créneaux horaires configurables (recommandations contextuelles). */
    public function timeSlots(): array
    {
        $slots = json_decode($this->settings()['time_slots'] ?? '[]', true);
        return is_array($slots) ? $slots : [];
    }

    public function currentSlot(?DateTimeImmutable $now = null): ?array
    {
        $h = (int) ($now ?? $this->now())->format('G');
        foreach ($this->timeSlots() as $s) {
            if ($h >= (int) $s['start'] && $h < (int) $s['end']) {
                return $s;
            }
        }
        return null;
    }

    /** Heure locale du restaurant = horloge de la base (comme PromotionService::now). */
    public function now(): DateTimeImmutable
    {
        static $now = null;
        return $now ??= new DateTimeImmutable((string) $this->pdo->query('SELECT NOW()')->fetchColumn());
    }

    // ---- Cache (table ai_cache) ----

    public function cached(string $key, int $ttlSeconds, callable $compute): array
    {
        try {
            $st = $this->pdo->prepare('SELECT payload FROM ai_cache WHERE cache_key = :k AND expires_at > NOW()');
            $st->execute(['k' => $key]);
            $hit = $st->fetchColumn();
            if ($hit !== false) {
                $data = json_decode($hit, true);
                if (is_array($data)) {
                    $data['cached'] = true;
                    return $data;
                }
            }
        } catch (PDOException $e) {
            return $compute();
        }
        $data = $compute();
        $data['generatedAt'] = $this->now()->format('Y-m-d H:i:s');
        try {
            $this->pdo->prepare(
                'REPLACE INTO ai_cache (cache_key, payload, expires_at) VALUES (:k, :p, DATE_ADD(NOW(), INTERVAL :t SECOND))'
            )->execute(['k' => $key, 'p' => json_encode($data, JSON_UNESCAPED_UNICODE), 't' => $ttlSeconds]);
        } catch (PDOException $e) {
            // cache indisponible : le résultat reste valable
        }
        $data['cached'] = false;
        return $data;
    }

    public function cacheClear(): void
    {
        try {
            $this->pdo->exec('DELETE FROM ai_cache');
        } catch (PDOException $e) {
        }
    }

    // ---- Qualité des données ----

    public function dataQuality(): array
    {
        $r = $this->pdo->query(
            "SELECT COUNT(*) AS n, COUNT(DISTINCT DATE(created_at)) AS days, MIN(created_at) AS first, MAX(created_at) AS last
             FROM orders WHERE cancelled_at IS NULL"
        )->fetch();
        $orders = (int) $r['n'];
        $days = (int) $r['days'];
        if ($orders >= 200 && $days >= 28) {
            $level = 'bonne';
        } elseif ($orders >= 30 && $days >= 7) {
            $level = 'moyenne';
        } else {
            $level = 'faible';
        }
        $mlReady = $orders >= self::ML_MIN_ORDERS && $days >= self::ML_MIN_DAYS;
        return [
            'orders' => $orders,
            'activeDays' => $days,
            'firstOrder' => $r['first'],
            'lastOrder' => $r['last'],
            'reliability' => $level,
            'method' => 'statistiques et règles',
            'ml' => [
                'active' => false,
                'ready' => $mlReady,
                'thresholds' => ['orders' => self::ML_MIN_ORDERS, 'days' => self::ML_MIN_DAYS],
                'reason' => $mlReady
                    ? 'Assez de données pour tester un modèle ML : à évaluer contre la méthode statistique avant activation.'
                    : sprintf('Machine learning non activé : %d commande(s) sur %d jour(s), il en faut au moins %d sur %d jours.', $orders, $days, self::ML_MIN_ORDERS, self::ML_MIN_DAYS),
            ],
        ];
    }

    // ---- Catalogue (lecture seule) ----

    /** Produits vendables (non supprimés), avec catégorie et popularité réelle. */
    public function catalog(bool $onlyAvailable = true): array
    {
        // Popularité = ventes des 90 derniers jours, gardée 10 min en cache : avec des
        // centaines de milliers de commandes, la recalculer à chaque demande coûterait
        // plus d'une seconde. La disponibilité des produits, elle, reste lue en direct.
        $pop = $this->cached('popularity:90', 600, function () {
            $map = [];
            foreach ($this->pdo->query(
                "SELECT oi.product_id, SUM(oi.quantity) AS qty FROM orders o
                 JOIN order_items oi ON oi.order_id = o.id
                 WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND o.cancelled_at IS NULL
                 GROUP BY oi.product_id"
            )->fetchAll() as $r) {
                $map[(string) $r['product_id']] = (int) $r['qty'];
            }
            return ['map' => $map];
        })['map'] ?? [];
        $rows = $this->pdo->query(
            "SELECT p.id, p.slug, p.name, p.description, p.base_price, p.calories, p.allergens, p.dietary_tags,
                    p.available, p.image_url, c.name AS category
             FROM products p
             JOIN categories c ON c.id = p.category_id
             WHERE p.deleted_at IS NULL" . ($onlyAvailable ? ' AND p.available = 1' : '') . "
             ORDER BY c.sort_order, p.name"
        )->fetchAll();
        foreach ($rows as &$r) {
            $r['sold'] = $pop[(string) $r['id']] ?? 0;
        }
        unset($r);
        return array_map(static function ($r) {
            $allergens = array_values(array_filter(array_map('trim', explode(',', (string) $r['allergens']))));
            $tags = array_values(array_filter(array_map('trim', explode(',', (string) $r['dietary_tags']))));
            return [
                'id' => (int) $r['id'],
                'slug' => $r['slug'],
                'name' => $r['name'],
                'description' => (string) $r['description'],
                'price' => round((float) $r['base_price'], 3),
                'calories' => $r['calories'] === null ? null : (int) $r['calories'],
                'allergens' => $allergens,
                'tags' => $tags,
                'available' => (bool) $r['available'],
                'image' => $r['image_url'],
                'category' => $r['category'],
                'sold' => (int) $r['sold'],
            ];
        }, $rows);
    }

    /** Une boisson ou un plat servi froid ? (déduit de la catégorie et du nom) */
    public static function isCold(array $p): bool
    {
        if (in_array($p['category'], ['Jus', 'Smoothies', 'Mojitos', 'Sodas'], true)) {
            return true;
        }
        return (bool) preg_match('/glac|iced|frapp|ice\b|ice tea/i', $p['name']);
    }

    public static function isHotDrink(array $p): bool
    {
        return $p['category'] === 'Cafés' && !self::isCold($p);
    }

    public static function isDrink(array $p): bool
    {
        return in_array($p['category'], ['Cafés', 'Jus', 'Smoothies', 'Mojitos', 'Sodas'], true);
    }

    public static function isFood(array $p): bool
    {
        return !self::isDrink($p);
    }

    // ---- Journal des questions ----

    public function logInteraction(string $kind, string $actorType, ?int $actorId, string $query, ?string $intent, int $count): void
    {
        try {
            $this->pdo->prepare(
                'INSERT INTO ai_interactions (kind, actor_type, actor_id, query, intent, result_count) VALUES (:k, :t, :i, :q, :in, :c)'
            )->execute([
                'k' => $kind, 't' => $actorType, 'i' => $actorId,
                'q' => mb_substr($query, 0, 255), 'in' => $intent, 'c' => min(65535, max(0, $count)),
            ]);
        } catch (PDOException $e) {
            // le journal ne bloque jamais la réponse
        }
    }

    // ---- Petits utilitaires ----

    public static function norm(string $s): string
    {
        $s = mb_strtolower($s, 'UTF-8');
        $s = strtr($s, ['à' => 'a', 'â' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'î' => 'i', 'ï' => 'i',
            'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'œ' => 'oe', '’' => "'"]);
        return $s;
    }

    public static function money(float $v): string
    {
        return number_format($v, 2, ',', ' ') . ' €';
    }
}
