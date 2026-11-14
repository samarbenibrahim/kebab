<?php
/**
 * Smart Kitchen : pour chaque commande active, temps d'attente, préparation
 * estimée, retard, à emporter, et un ORDRE DE PRIORITÉ SUGGÉRÉ.
 * Lecture seule : l'équipe garde la main sur les statuts (boutons existants).
 */
class AiKitchenService
{
    private const TAKEAWAY_OPTION = 'Gobelet à emporter';

    public function __construct(private AiSupport $ai)
    {
    }

    public function snapshot(): array
    {
        $pdo = $this->ai->pdo();
        $k = (new WaitingTimeService($pdo))->kitchenStats();
        $avgPrep = max(1.0, (float) $k['avgPrepMinutes']);
        $avgItems = max(1.0, (float) $k['avgItems']);

        $orders = $pdo->query(
            "SELECT o.id, o.table_number, o.status, o.created_at,
                    TIMESTAMPDIFF(SECOND, o.created_at, NOW()) AS age,
                    (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id) AS items,
                    EXISTS (SELECT 1 FROM order_items oi JOIN order_item_options oo ON oo.order_item_id = oi.id
                            WHERE oi.order_id = o.id AND oo.option_name = '" . self::TAKEAWAY_OPTION . "') AS takeaway,
                    EXISTS (SELECT 1 FROM takeaway_requests tr WHERE tr.order_id = o.id AND tr.status IN ('pending','accepted')) AS takeaway_req,
                    (SELECT TIMESTAMPDIFF(SECOND, MAX(h.created_at), NOW()) FROM order_status_history h WHERE h.order_id = o.id AND h.new_status = 'En préparation') AS prep_secs
             FROM orders o
             WHERE o.cancelled_at IS NULL AND o.status IN ('Nouvelle', 'En préparation')
             ORDER BY o.id"
        )->fetchAll();

        $list = [];
        foreach ($orders as $o) {
            $wait = max(0, (int) round((int) $o['age'] / 60));
            $scale = max(0.6, min(2.0, max(1, (int) $o['items']) / $avgItems));
            $prep = round($avgPrep * $scale, 1);
            $elapsedPrep = 0;
            if ($o['status'] === 'En préparation' && $o['prep_secs'] !== null) {
                $elapsedPrep = max(0, (int) round((int) $o['prep_secs'] / 60));
            }
            $remaining = max(0, round($prep - $elapsedPrep, 1));
            $late = $wait > $avgPrep * 1.5;
            $takeaway = (bool) $o['takeaway'] || (bool) $o['takeaway_req'];
            // Score : ancienneté relative + petit bonus aux commandes à emporter (le client attend debout)
            // et aux commandes courtes (libèrent vite un poste). Purement indicatif.
            $score = $wait / $avgPrep + ($takeaway ? 0.3 : 0) + ($prep <= $avgPrep ? 0.1 : 0) + ($late ? 0.5 : 0);
            $reasons = [];
            if ($late) {
                $reasons[] = 'en retard';
            }
            if ($takeaway) {
                $reasons[] = 'à emporter';
            }
            if ($prep <= $avgPrep * 0.8) {
                $reasons[] = 'rapide à préparer';
            }
            $list[] = [
                'orderId' => (int) $o['id'],
                'number' => 'SOU-' . str_pad((string) $o['id'], 6, '0', STR_PAD_LEFT),
                'table' => $o['table_number'],
                'status' => $o['status'],
                'items' => (int) $o['items'],
                'waitMinutes' => $wait,
                'estimatedPrepMinutes' => $prep,
                'remainingMinutes' => $remaining,
                'late' => $late,
                'takeaway' => $takeaway,
                'score' => round($score, 2),
                'reasons' => $reasons,
            ];
        }
        $toStart = array_values(array_filter($list, fn($x) => $x['status'] === 'Nouvelle'));
        usort($toStart, fn($a, $b) => $b['score'] <=> $a['score'] ?: $a['orderId'] <=> $b['orderId']);
        $rank = [];
        foreach ($toStart as $i => $x) {
            $rank[$x['orderId']] = $i + 1;
        }
        foreach ($list as &$x) {
            $x['suggestedRank'] = $rank[$x['orderId']] ?? null;
        }
        unset($x);
        $work = array_sum(array_map(fn($x) => $x['remainingMinutes'], $list));
        $parallel = max(1, (int) $k['parallel']);
        $clear = round($work / $parallel, 0);
        $load = $clear >= 30 ? 'forte' : ($clear >= 12 ? 'moyenne' : 'faible');
        return [
            'avgPrepMinutes' => $avgPrep,
            'basis' => $k['basis'] . ' (' . $k['samples'] . ' commande(s))',
            'parallel' => $parallel,
            'queue' => count($list),
            'estimatedClearMinutes' => $clear,
            'load' => $load,
            'lateCount' => count(array_filter($list, fn($x) => $x['late'])),
            'orders' => $list,
            'suggestedOrder' => array_map(fn($x) => $x['orderId'], $toStart),
            'manual' => true,
        ];
    }
}
