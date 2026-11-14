<?php
/**
 * Recommandations progressives (lecture seule) :
 *   niveau 1 — règles : créneau horaire configurable + popularité réelle + disponibilité ;
 *   niveau 2 — historique du client (ses commandes, ou celles de son compte fidélité) ;
 *   niveau 3 — comportements similaires : produits commandés ensemble dans
 *              d'autres commandes (au moins MIN_SUPPORT commandes communes) ;
 *   niveau 4 — machine learning : pas activé tant que AiSupport::dataQuality()
 *              ne le permet pas.
 * Aucune donnée n'est inventée : sans historique, la réponse est marquée
 * « suggestion générale ».
 */
class AiRecommendationService
{
    public const MIN_SUPPORT = 2;

    public function __construct(private AiSupport $ai)
    {
    }

    /** Produits déjà commandés par ce client (ou par son compte fidélité) : [productId => quantité]. */
    public function clientHistory(?array $client): array
    {
        if (!$client) {
            return [];
        }
        $pdo = $this->ai->pdo();
        if (!empty($client['loyalty_account_id'])) {
            $st = $pdo->prepare(
                "SELECT oi.product_id, SUM(oi.quantity) AS q FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL
                 JOIN clients c ON c.id = o.client_id AND c.loyalty_account_id = :a
                 GROUP BY oi.product_id"
            );
            $st->execute(['a' => $client['loyalty_account_id']]);
        } else {
            $st = $pdo->prepare(
                "SELECT oi.product_id, SUM(oi.quantity) AS q FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL AND o.client_id = :c
                 GROUP BY oi.product_id"
            );
            $st->execute(['c' => $client['id']]);
        }
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[(int) $r['product_id']] = (int) $r['q'];
        }
        return $out;
    }

    /** Produits commandés avec $seedIds dans les mêmes commandes : [productId => nb de commandes communes]. */
    public function coOccurrence(array $seedIds): array
    {
        $seedIds = array_values(array_unique(array_map('intval', $seedIds)));
        if (!$seedIds) {
            return [];
        }
        $in = implode(',', array_fill(0, count($seedIds), '?'));
        $st = $this->ai->pdo()->prepare(
            "SELECT b.product_id, COUNT(DISTINCT b.order_id) AS n
             FROM order_items a
             JOIN order_items b ON b.order_id = a.order_id AND b.product_id <> a.product_id
             JOIN orders o ON o.id = a.order_id AND o.cancelled_at IS NULL
             WHERE a.product_id IN ($in) AND b.product_id NOT IN ($in)
             GROUP BY b.product_id HAVING n >= " . self::MIN_SUPPORT . "
             ORDER BY n DESC"
        );
        $st->execute(array_merge($seedIds, $seedIds));
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[(int) $r['product_id']] = (int) $r['n'];
        }
        return $out;
    }

    /**
     * @param array|null $client  ligne clients (session) ou null
     * @param int[]      $seedIds produits de référence (panier) — facultatif
     */
    public function recommend(?array $client, array $seedIds = [], int $limit = 4): array
    {
        $catalog = $this->ai->catalog(true);
        $byId = [];
        foreach ($catalog as $p) {
            $byId[$p['id']] = $p;
        }
        $slot = $this->ai->currentSlot();
        $history = $this->clientHistory($client);
        $co = $this->coOccurrence($seedIds ?: array_keys($history));
        $maxSold = max(1, ...array_map(fn($p) => $p['sold'], $catalog ?: [['sold' => 1]]));

        $scored = [];
        foreach ($catalog as $p) {
            if (in_array($p['id'], $seedIds, true)) {
                continue;
            }
            $score = 0.0;
            $reasons = [];
            if ($slot && in_array($p['category'], $slot['categories'], true)) {
                $score += 2.0;
                $reasons[] = 'idéal ' . mb_strtolower($slot['label']);
            }
            if ($p['sold'] > 0) {
                $score += 1.5 * $p['sold'] / $maxSold;
                if ($p['sold'] === $maxSold) {
                    $reasons[] = 'le plus commandé';
                }
            }
            if (isset($history[$p['id']])) {
                $score += 3.0 + min(2, $history[$p['id']] * 0.5);
                $reasons[] = 'vous l’avez déjà pris';
            }
            if (isset($co[$p['id']])) {
                $score += 2.5 + min(2, $co[$p['id']] * 0.5);
                $reasons[] = sprintf('souvent pris ensemble (%d commandes)', $co[$p['id']]);
            }
            $scored[] = ['p' => $p, 'score' => $score, 'reasons' => $reasons];
        }
        usort($scored, fn($a, $b) => $b['score'] <=> $a['score'] ?: $a['p']['price'] <=> $b['p']['price']);

        $level = 1;
        if ($history) {
            $level = 2;
        }
        if ($co) {
            $level = 3;
        }
        $items = array_map(fn($s) => self::item($s['p'], $s['reasons']), array_slice($scored, 0, $limit));
        return [
            'level' => $level,
            'general' => $level === 1,
            'basis' => [1 => 'Suggestion générale (heure de la journée et popularité)', 2 => 'Basé sur vos commandes précédentes', 3 => 'Basé sur ce que commandent les autres clients'][$level],
            'slot' => $slot ? $slot['label'] : null,
            'items' => $items,
            'ml' => $this->ai->dataQuality()['ml'],
        ];
    }

    public static function item(array $p, array $reasons = []): array
    {
        return [
            'id' => $p['id'],
            'slug' => $p['slug'],
            'name' => $p['name'],
            'price' => $p['price'],
            'category' => $p['category'],
            'calories' => $p['calories'],
            'allergens' => $p['allergens'],
            'reason' => $reasons ? ucfirst(implode(' · ', $reasons)) : null,
        ];
    }
}
