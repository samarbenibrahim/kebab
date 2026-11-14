<?php
/**
 * Smart Waiting Time : estimation du temps d'attente à partir de l'HISTORIQUE
 * réel de la cuisine, pas d'un chiffre fixe.
 *
 *   - durée moyenne de préparation = moyenne (création -> « Prête ») des 40
 *     dernières commandes des 14 derniers jours (valeur par défaut 8 min tant
 *     qu'il y a moins de 5 échantillons) ;
 *   - une commande plus grosse que la moyenne prend proportionnellement plus
 *     de temps (facteur borné entre 0,6 et 2) ;
 *   - la file d'attente compte : chaque commande devant soi ajoute
 *     (durée moyenne / cuisiniers en parallèle) ; les cuisiniers en parallèle =
 *     comptes « cuisine » connectés, 2 au minimum.
 * Une commande déjà « En préparation » ne subit plus la file : on retranche
 * le temps déjà écoulé.
 */
class WaitingTimeService
{
    private const DEFAULT_PREP_MINUTES = 8.0;
    private const MIN_SAMPLES = 5;
    private const MIN_PARALLEL = 2;

    public function __construct(private PDO $pdo)
    {
    }

    /** Indicateurs de la cuisine à l'instant T. */
    public function kitchenStats(): array
    {
        $rows = $this->pdo->query(
            "SELECT TIMESTAMPDIFF(SECOND, o.created_at, h.created_at) AS secs,
                    (SELECT COALESCE(SUM(quantity), 1) FROM order_items WHERE order_id = o.id) AS qty
             FROM order_status_history h JOIN orders o ON o.id = h.order_id
             WHERE h.new_status = 'Prête' AND o.cancelled_at IS NULL AND h.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
             ORDER BY h.id DESC LIMIT 40"
        )->fetchAll();
        $secs = [];
        $qty = [];
        foreach ($rows as $r) {
            $s = (int) $r['secs'];
            if ($s >= 30 && $s <= 5400) { // ignore les aberrations (< 30 s ou > 90 min)
                $secs[] = $s;
                $qty[] = max(1, (int) $r['qty']);
            }
        }
        $enough = count($secs) >= self::MIN_SAMPLES;
        $avgPrep = $enough ? array_sum($secs) / count($secs) / 60 : self::DEFAULT_PREP_MINUTES;
        $avgQty = $enough ? array_sum($qty) / count($qty) : 2.0;

        $queue = (int) $this->pdo->query("SELECT COUNT(*) FROM orders WHERE cancelled_at IS NULL AND status IN ('Nouvelle','En préparation')")->fetchColumn();
        $cooks = (int) $this->pdo->query(
            "SELECT COUNT(DISTINCT staff_id) FROM auth_sessions WHERE role = 'kitchen' AND expires_at > NOW()"
        )->fetchColumn();

        return [
            'avgPrepMinutes' => round($avgPrep, 1),
            'avgItems' => round($avgQty, 1),
            'samples' => count($secs),
            'basis' => $enough ? 'historique' : 'estimation par défaut',
            'queue' => $queue,
            'parallel' => max(self::MIN_PARALLEL, $cooks),
        ];
    }

    private static function scale(int $qty, float $avgQty): float
    {
        return max(0.6, min(2.0, $qty / max(1.0, $avgQty)));
    }

    /** Estimation pour une commande qu'on s'apprête à passer (panier de $itemQty articles). */
    public function estimateNew(int $itemQty): array
    {
        $k = $this->kitchenStats();
        $own = $k['avgPrepMinutes'] * self::scale(max(1, $itemQty), $k['avgItems']);
        $wait = ($k['queue'] / $k['parallel']) * $k['avgPrepMinutes'];
        return $this->result((int) ceil($own + $wait), $k, $k['queue'], 'Nouvelle');
    }

    /** Estimation pour une commande existante. */
    public function estimateOrder(array $order): array
    {
        $k = $this->kitchenStats();
        if ($order['cancelled_at'] !== null || in_array($order['status'], ['Prête', 'Servie'], true)) {
            return $this->result(0, $k, 0, $order['status']);
        }
        $qty = (int) $this->pdo->query('SELECT COALESCE(SUM(quantity), 1) FROM order_items WHERE order_id = ' . (int) $order['id'])->fetchColumn();
        $own = $k['avgPrepMinutes'] * self::scale(max(1, $qty), $k['avgItems']);

        if ($order['status'] === 'En préparation') {
            $stmt = $this->pdo->prepare(
                "SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) FROM order_status_history WHERE order_id = :id AND new_status = 'En préparation' ORDER BY id DESC LIMIT 1"
            );
            $stmt->execute(['id' => $order['id']]);
            $elapsed = ((int) $stmt->fetchColumn()) / 60;
            return $this->result((int) max(1, ceil($own - $elapsed)), $k, 0, 'En préparation');
        }

        $stmt = $this->pdo->prepare(
            "SELECT COUNT(*) FROM orders WHERE cancelled_at IS NULL AND status IN ('Nouvelle','En préparation') AND id < :id"
        );
        $stmt->execute(['id' => $order['id']]);
        $ahead = (int) $stmt->fetchColumn();
        $wait = ($ahead / $k['parallel']) * $k['avgPrepMinutes'];
        return $this->result((int) ceil($own + $wait), $k, $ahead, 'Nouvelle');
    }

    private function result(int $minutes, array $k, int $ahead, string $status): array
    {
        return [
            'etaMinutes' => $minutes,
            'ordersAhead' => $ahead,
            'status' => $status,
            'avgPrepMinutes' => $k['avgPrepMinutes'],
            'basis' => $k['basis'],
            'samples' => $k['samples'],
            'kitchenParallel' => $k['parallel'],
        ];
    }
}
