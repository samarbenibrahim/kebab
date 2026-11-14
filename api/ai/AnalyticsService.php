<?php
/**
 * BI, insights, prévisions et détection d'anomalies — calculés UNIQUEMENT sur
 * les commandes réelles (lecture seule). Méthodes statistiques simples et
 * explicables ; chaque résultat indique sa période et la taille de
 * l'échantillon. Les prévisions sont des estimations, jamais des certitudes,
 * et une anomalie est un signal à vérifier, jamais une accusation.
 */
class AiAnalyticsService
{
    private const DAY_NAMES = [1 => 'lundi', 2 => 'mardi', 3 => 'mercredi', 4 => 'jeudi', 5 => 'vendredi', 6 => 'samedi', 7 => 'dimanche'];
    private const TAKEAWAY_OPTION = 'Gobelet à emporter';

    public function __construct(private AiSupport $ai)
    {
    }

    private function pdo(): PDO
    {
        return $this->ai->pdo();
    }

    /** Période : 'today' | 'yesterday' | 'week' | 'lastweek' | 'month' | nombre de jours. */
    public function period($spec): array
    {
        $today = $this->ai->now()->setTime(0, 0);
        // Fin de période incluse : +1 s pour compter les commandes de la seconde en cours (filtre created_at < :t).
        $now = $this->ai->now()->modify('+1 second');
        switch ((string) $spec) {
            case 'today':
                return ['from' => $today, 'to' => $now, 'label' => "aujourd'hui"];
            case 'yesterday':
                return ['from' => $today->modify('-1 day'), 'to' => $today, 'label' => 'hier'];
            case 'week':
                return ['from' => $today->modify('monday this week'), 'to' => $now, 'label' => 'cette semaine'];
            case 'lastweek':
                $mon = $today->modify('monday this week');
                return ['from' => $mon->modify('-7 days'), 'to' => $mon, 'label' => 'la semaine dernière'];
            case 'month':
                return ['from' => $today->modify('first day of this month'), 'to' => $now, 'label' => 'ce mois-ci'];
        }
        $days = (int) $spec;
        if ($days < 1 || $days > 365) {
            throw new InvalidArgumentException('La période doit être comprise entre 1 et 365 jours.');
        }
        return ['from' => $today->modify('-' . ($days - 1) . ' days'), 'to' => $now, 'label' => $days === 1 ? "aujourd'hui" : "les $days derniers jours"];
    }

    public static function periodOut(array $p): array
    {
        return ['from' => $p['from']->format('Y-m-d H:i'), 'to' => $p['to']->format('Y-m-d H:i'), 'label' => $p['label']];
    }

    private function run(string $sql, array $p, array $extra = []): array
    {
        $st = $this->pdo()->prepare($sql);
        $st->execute(array_merge(['f' => $p['from']->format('Y-m-d H:i:s'), 't' => $p['to']->format('Y-m-d H:i:s')], $extra));
        return $st->fetchAll();
    }

    // ================= BI =================

    public function bi($periodSpec): array
    {
        $p = $this->period($periodSpec);
        $w = 'o.created_at >= :f AND o.created_at < :t';

        $k = $this->run("SELECT COUNT(*) AS all_orders, COALESCE(SUM(o.cancelled_at IS NOT NULL), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN o.cancelled_at IS NULL THEN o.total END), 0) AS gross,
                COALESCE(SUM(CASE WHEN o.cancelled_at IS NULL AND o.payment_status = 'paid' THEN o.total END), 0) AS revenue,
                COALESCE(SUM(CASE WHEN o.cancelled_at IS NULL THEN o.discount_total + o.loyalty_discount END), 0) AS discounts
             FROM orders o WHERE $w", $p)[0];
        $orders = (int) $k['all_orders'] - (int) $k['cancelled'];

        $byHour = array_fill(0, 24, ['orders' => 0, 'amount' => 0.0]);
        foreach ($this->run("SELECT HOUR(o.created_at) AS h, COUNT(*) AS n, SUM(o.total) AS a FROM orders o WHERE $w AND o.cancelled_at IS NULL GROUP BY h", $p) as $r) {
            $byHour[(int) $r['h']] = ['orders' => (int) $r['n'], 'amount' => round((float) $r['a'], 3)];
        }
        $byWeekday = [];
        foreach (self::DAY_NAMES as $i => $n) {
            $byWeekday[$i] = ['day' => $n, 'orders' => 0, 'amount' => 0.0];
        }
        foreach ($this->run("SELECT WEEKDAY(o.created_at) + 1 AS d, COUNT(*) AS n, SUM(o.total) AS a FROM orders o WHERE $w AND o.cancelled_at IS NULL GROUP BY d", $p) as $r) {
            $byWeekday[(int) $r['d']]['orders'] = (int) $r['n'];
            $byWeekday[(int) $r['d']]['amount'] = round((float) $r['a'], 3);
        }
        $byDay = array_map(fn($r) => ['date' => $r['d'], 'orders' => (int) $r['n'], 'amount' => round((float) $r['a'], 3)],
            $this->run("SELECT DATE(o.created_at) AS d, COUNT(*) AS n, SUM(o.total) AS a FROM orders o WHERE $w AND o.cancelled_at IS NULL GROUP BY d ORDER BY d", $p));

        $byCategory = array_map(fn($r) => ['category' => $r['c'], 'quantity' => (int) $r['q'], 'amount' => round((float) $r['a'], 3)],
            $this->run("SELECT c.name AS c, SUM(oi.quantity) AS q, SUM(oi.line_total) AS a
                FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL
                JOIN products pr ON pr.id = oi.product_id JOIN categories c ON c.id = pr.category_id
                WHERE $w GROUP BY c.id, c.name ORDER BY a DESC", $p));
        $byProduct = array_map(fn($r) => ['productId' => (int) $r['id'], 'name' => $r['n'], 'quantity' => (int) $r['q'], 'amount' => round((float) $r['a'], 3)],
            $this->run("SELECT oi.product_id AS id, oi.product_name AS n, SUM(oi.quantity) AS q, SUM(oi.line_total) AS a
                FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL
                WHERE $w GROUP BY oi.product_id, oi.product_name ORDER BY q DESC, a DESC", $p));

        // Sur place / à emporter : une commande est « à emporter » si au moins un article est servi en gobelet.
        $tk = $this->run("SELECT COUNT(*) AS n, COALESCE(SUM(EXISTS (SELECT 1 FROM order_items oi JOIN order_item_options oo ON oo.order_item_id = oi.id
                    WHERE oi.order_id = o.id AND oo.option_name = :opt)), 0) AS tk
                FROM orders o WHERE $w AND o.cancelled_at IS NULL", $p, ['opt' => self::TAKEAWAY_OPTION])[0];

        $payments = ['cash' => ['orders' => 0, 'amount' => 0.0], 'card' => ['orders' => 0, 'amount' => 0.0], 'online' => ['orders' => 0, 'amount' => 0.0]];
        $unpaid = 0;
        foreach ($this->run("SELECT o.payment_status AS s, o.payment_method AS m, COUNT(*) AS n, SUM(o.total) AS a FROM orders o
                WHERE $w AND o.cancelled_at IS NULL GROUP BY o.payment_status, o.payment_method", $p) as $r) {
            if ($r['s'] === 'paid' && isset($payments[$r['m']])) {
                $payments[$r['m']] = ['orders' => (int) $r['n'], 'amount' => round((float) $r['a'], 3)];
            } else {
                $unpaid += (int) $r['n'];
            }
        }

        $prep = $this->run("SELECT AVG(TIMESTAMPDIFF(SECOND, o.created_at, h.created_at)) AS s, COUNT(*) AS n
                FROM orders o JOIN order_status_history h ON h.order_id = o.id AND h.new_status = 'Prête'
                WHERE $w AND o.cancelled_at IS NULL AND TIMESTAMPDIFF(SECOND, o.created_at, h.created_at) BETWEEN 30 AND 5400", $p)[0];

        $out = [
            'period' => self::periodOut($p),
            'kpis' => [
                'grossSales' => round((float) $k['gross'], 3),
                'revenue' => round((float) $k['revenue'], 3),
                'orders' => $orders,
                'averageBasket' => $orders > 0 ? round((float) $k['gross'] / $orders, 3) : 0.0,
                'cancelled' => (int) $k['cancelled'],
                'cancellationRate' => (int) $k['all_orders'] > 0 ? round(100 * (int) $k['cancelled'] / (int) $k['all_orders'], 1) : 0.0,
                'discounts' => round((float) $k['discounts'], 3),
                'avgPrepMinutes' => $prep['s'] !== null ? round((float) $prep['s'] / 60, 1) : null,
                'prepSamples' => (int) $prep['n'],
            ],
            'byHour' => $byHour,
            'byWeekday' => array_values($byWeekday),
            'byDay' => $byDay,
            'byCategory' => $byCategory,
            'byProduct' => array_slice($byProduct, 0, 15),
            'service' => ['onSite' => $orders - (int) $tk['tk'], 'takeaway' => (int) $tk['tk']],
            'payments' => $payments,
            'unpaidOrders' => $unpaid,
        ];
        $out['insights'] = $this->insights($out);
        return $out;
    }

    /** Phrases calculées sur les chiffres ci-dessus ; aucune n'est produite sans échantillon suffisant. */
    private function insights(array $bi): array
    {
        $n = $bi['kpis']['orders'];
        $basis = sprintf('%d commande(s), %s', $n, $bi['period']['label']);
        $out = [];
        if ($n < 5) {
            return [['text' => 'Pas assez de commandes sur la période pour dégager une tendance fiable (' . $n . ' commande(s)).', 'basis' => $basis, 'kind' => 'info']];
        }
        // Créneau de 3 h le plus chargé
        $best = null;
        for ($h = 0; $h <= 21; $h++) {
            $sum = $bi['byHour'][$h]['orders'] + $bi['byHour'][$h + 1]['orders'] + $bi['byHour'][$h + 2]['orders'];
            if ($best === null || $sum > $best[1]) {
                $best = [$h, $sum];
            }
        }
        $share = $best[1] / $n;
        if ($share >= 0.4) {
            $out[] = ['text' => sprintf('Les commandes sont concentrées entre %02d:00 et %02d:00 (%d %% des commandes).', $best[0], $best[0] + 3, round($share * 100)), 'basis' => $basis, 'kind' => 'peak'];
        }
        if ($bi['byCategory']) {
            $tot = array_sum(array_map(fn($c) => $c['amount'], $bi['byCategory']));
            $top = $bi['byCategory'][0];
            if ($tot > 0) {
                $out[] = ['text' => sprintf('La catégorie « %s » représente %d %% des ventes.', $top['category'], round(100 * $top['amount'] / $tot)), 'basis' => $basis, 'kind' => 'category'];
            }
        }
        if ($bi['byProduct']) {
            $p = $bi['byProduct'][0];
            $out[] = ['text' => sprintf('Produit le plus vendu : %s (%d vendu(s)).', $p['name'], $p['quantity']), 'basis' => $basis, 'kind' => 'product'];
        }
        $tk = $bi['service']['takeaway'];
        if ($tk > 0) {
            $out[] = ['text' => sprintf('%d %% des commandes contiennent au moins un article à emporter.', round(100 * $tk / $n)), 'basis' => $basis, 'kind' => 'service'];
        }
        if ($n >= 10 && $bi['kpis']['cancellationRate'] >= 10) {
            $out[] = ['text' => sprintf('Taux d’annulation de %s %% : à surveiller.', str_replace('.', ',', (string) $bi['kpis']['cancellationRate'])), 'basis' => $basis, 'kind' => 'warning'];
        }
        if ($bi['unpaidOrders'] > 0) {
            $out[] = ['text' => sprintf('%d commande(s) de la période ne sont pas encore encaissées.', $bi['unpaidOrders']), 'basis' => $basis, 'kind' => 'warning'];
        }
        $days = array_filter($bi['byWeekday'], fn($d) => $d['orders'] > 0);
        if (count($days) >= 4 && $n >= 20) {
            usort($days, fn($a, $b) => $b['orders'] <=> $a['orders']);
            $out[] = ['text' => sprintf('Le %s est le jour le plus actif (%d commande(s)).', $days[0]['day'], $days[0]['orders']), 'basis' => $basis, 'kind' => 'day'];
        }
        return $out;
    }

    // ================= Prévisions =================

    /** Commandes par jour calendaire (zéros compris) entre la première commande et hier. */
    private function dailyHistory(int $maxDays = 56): array
    {
        $today = $this->ai->now()->setTime(0, 0);
        $first = $this->pdo()->query("SELECT MIN(DATE(created_at)) FROM orders WHERE cancelled_at IS NULL")->fetchColumn();
        if (!$first) {
            return [];
        }
        $start = max(new DateTimeImmutable($first), $today->modify("-$maxDays days"));
        $rows = [];
        $st = $this->pdo()->prepare("SELECT DATE(created_at) AS d, COUNT(*) AS n, SUM(total) AS a FROM orders
            WHERE cancelled_at IS NULL AND created_at >= :s AND created_at < :t GROUP BY d");
        $st->execute(['s' => $start->format('Y-m-d'), 't' => $today->format('Y-m-d')]);
        foreach ($st->fetchAll() as $r) {
            $rows[$r['d']] = ['n' => (int) $r['n'], 'a' => (float) $r['a']];
        }
        $out = [];
        for ($d = $start; $d < $today; $d = $d->modify('+1 day')) {
            $key = $d->format('Y-m-d');
            $out[] = ['date' => $key, 'weekday' => (int) $d->format('N'), 'orders' => $rows[$key]['n'] ?? 0, 'amount' => $rows[$key]['a'] ?? 0.0];
        }
        return $out;
    }

    public function forecast(): array
    {
        $hist = $this->dailyHistory();
        $quality = $this->ai->dataQuality();
        $nDays = count($hist);
        $total = array_sum(array_column($hist, 'orders'));
        $base = [
            'label' => 'Prévision',
            'method' => 'Moyenne des commandes par jour (zéros compris), corrigée par jour de semaine quand chaque jour a été observé au moins 2 fois ; répartition horaire et par produit selon l’historique.',
            'historyDays' => $nDays,
            'historyOrders' => $total,
            'reliability' => $quality['reliability'],
            'ml' => $quality['ml'],
        ];
        if ($nDays < 3 || $total < 3) {
            return $base + ['available' => false, 'note' => 'Pas assez d’historique pour une prévision (il faut au moins 3 jours et 3 commandes).', 'days' => [], 'tomorrowHours' => [], 'tomorrowProducts' => []];
        }
        $mean = $total / $nDays;
        $meanAmount = array_sum(array_column($hist, 'amount')) / $nDays;
        // Coefficient par jour de semaine (si ≥ 2 observations de ce jour)
        $wd = [];
        foreach ($hist as $h) {
            $wd[$h['weekday']][] = $h['orders'];
        }
        $factor = [];
        foreach (range(1, 7) as $d) {
            $factor[$d] = (isset($wd[$d]) && count($wd[$d]) >= 2 && $mean > 0) ? (array_sum($wd[$d]) / count($wd[$d])) / $mean : 1.0;
        }
        $today = $this->ai->now()->setTime(0, 0);
        $days = [];
        for ($i = 1; $i <= 7; $i++) {
            $d = $today->modify("+$i day");
            $exp = $mean * $factor[(int) $d->format('N')];
            $spread = 1.64 * sqrt(max($exp, 0.5)); // ≈ intervalle 90 % d'une loi de Poisson
            $days[] = [
                'date' => $d->format('Y-m-d'),
                'day' => self::DAY_NAMES[(int) $d->format('N')],
                'orders' => round($exp, 1),
                'low' => max(0, (int) floor($exp - $spread)),
                'high' => (int) ceil($exp + $spread),
                'amount' => round($meanAmount * $factor[(int) $d->format('N')], 3),
            ];
        }
        // Répartition horaire et produits (sur l'historique complet récent)
        $hours = array_fill(0, 24, 0);
        foreach ($this->pdo()->query("SELECT HOUR(created_at) AS h, COUNT(*) AS n FROM orders WHERE cancelled_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 56 DAY) GROUP BY h")->fetchAll() as $r) {
            $hours[(int) $r['h']] = (int) $r['n'];
        }
        $hTot = max(1, array_sum($hours));
        $tomorrow = $days[0]['orders'];
        $tomorrowHours = [];
        foreach ($hours as $h => $n) {
            if ($n > 0) {
                $tomorrowHours[] = ['hour' => $h, 'orders' => round($tomorrow * $n / $hTot, 1)];
            }
        }
        $prod = $this->pdo()->query("SELECT oi.product_id AS id, oi.product_name AS n, SUM(oi.quantity) AS q FROM order_items oi
            JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL AND o.created_at >= DATE_SUB(NOW(), INTERVAL 56 DAY)
            GROUP BY oi.product_id, oi.product_name ORDER BY q DESC LIMIT 8")->fetchAll();
        $tomorrowProducts = array_map(fn($r) => ['productId' => (int) $r['id'], 'name' => $r['n'], 'quantity' => round((int) $r['q'] / $nDays * ($tomorrow / max($mean, 0.001)), 1)], $prod);
        $cat = $this->pdo()->query("SELECT c.name AS c, SUM(oi.quantity) AS q FROM order_items oi
            JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL AND o.created_at >= DATE_SUB(NOW(), INTERVAL 56 DAY)
            JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id GROUP BY c.id, c.name ORDER BY q DESC")->fetchAll();
        $peak = null;
        foreach ($tomorrowHours as $h) {
            if ($peak === null || $h['orders'] > $peak['orders']) {
                $peak = $h;
            }
        }
        return $base + [
            'available' => true,
            'note' => $quality['reliability'] === 'faible' ? 'Fiabilité faible : historique très court, à prendre comme un ordre de grandeur.' : null,
            'averagePerDay' => round($mean, 2),
            'days' => $days,
            'tomorrowHours' => $tomorrowHours,
            'tomorrowPeakHour' => $peak ? $peak['hour'] : null,
            'tomorrowProducts' => $tomorrowProducts,
            'categories' => array_map(fn($r) => ['category' => $r['c'], 'quantityPerDay' => round((int) $r['q'] / $nDays, 2)], $cat),
        ];
    }

    // ================= Anomalies =================

    private static function meanStd(array $xs): array
    {
        $n = count($xs);
        if ($n === 0) {
            return [0.0, 0.0];
        }
        $m = array_sum($xs) / $n;
        $v = 0.0;
        foreach ($xs as $x) {
            $v += ($x - $m) ** 2;
        }
        return [$m, sqrt($v / max(1, $n - 1))];
    }

    public function anomalies(): array
    {
        $hist = $this->dailyHistory(28);
        $baselineOrders = array_sum(array_column($hist, 'orders'));
        $out = [
            'message' => 'Comportement inhabituel détecté',
            'disclaimer' => 'Une alerte signale un écart par rapport à l’habitude. Elle ne désigne ni une fraude ni une erreur : à vérifier par l’équipe.',
            'baselineDays' => count($hist),
            'baselineOrders' => $baselineOrders,
            'refunds' => 'Non suivi : le système ne gère pas de remboursements.',
            'items' => [],
        ];
        if (count($hist) < 14 || $baselineOrders < 20) {
            $out['available'] = false;
            $out['note'] = sprintf('Détection en attente de données : %d jour(s) et %d commande(s) de référence, il en faut au moins 14 jours et 20 commandes.', count($hist), $baselineOrders);
            return $out;
        }
        $out['available'] = true;
        $now = $this->ai->now();
        $hourNow = (int) $now->format('G');
        // Comparaison à heure égale : commandes d'aujourd'hui jusqu'à maintenant vs mêmes heures les jours précédents.
        $st = $this->pdo()->prepare("SELECT DATE(created_at) AS d, COUNT(*) AS n, COALESCE(SUM(total),0) AS a, COALESCE(SUM(cancelled_at IS NOT NULL),0) AS c
            FROM orders WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 28 DAY) AND HOUR(created_at) <= :h GROUP BY d");
        $st->execute(['h' => $hourNow]);
        $byDate = [];
        foreach ($st->fetchAll() as $r) {
            $byDate[$r['d']] = $r;
        }
        $todayKey = $now->format('Y-m-d');
        $series = ['n' => [], 'a' => [], 'c' => []];
        foreach ($hist as $h) {
            $r = $byDate[$h['date']] ?? ['n' => 0, 'a' => 0, 'c' => 0];
            $series['n'][] = (int) $r['n'] - (int) $r['c'];
            $series['a'][] = (float) $r['a'];
            $series['c'][] = (int) $r['c'];
        }
        $t = $byDate[$todayKey] ?? ['n' => 0, 'a' => 0, 'c' => 0];
        $todayOrders = (int) $t['n'] - (int) $t['c'];
        $checks = [
            ['orders', 'commandes', $todayOrders, $series['n'], false],
            ['revenue', 'chiffre d’affaires', (float) $t['a'], $series['a'], true],
        ];
        foreach ($checks as [$key, $label, $x, $xs, $money]) {
            [$m, $sd] = self::meanStd($xs);
            $sd = max($sd, $money ? 5.0 : 1.0);
            $z = ($x - $m) / $sd;
            if (abs($z) >= 2.5) {
                $out['items'][] = [
                    'metric' => $key,
                    'severity' => abs($z) >= 4 ? 'forte' : 'modérée',
                    'direction' => $z > 0 ? 'hausse' : 'baisse',
                    'text' => sprintf('%s inhabituelle des %s aujourd’hui jusqu’à %dh : %s contre %s en moyenne à la même heure.',
                        $z > 0 ? 'Hausse' : 'Baisse', $label, $hourNow,
                        $money ? AiSupport::money($x) : (string) $x, $money ? AiSupport::money($m) : number_format($m, 1, ',', '')),
                ];
            }
        }
        $cancelRate = array_sum($series['c']) / max(1, array_sum($series['n']) + array_sum($series['c']));
        if ((int) $t['c'] >= 3 && (int) $t['c'] / max(1, (int) $t['n']) > max(0.15, 3 * $cancelRate)) {
            $out['items'][] = ['metric' => 'cancellations', 'severity' => 'modérée', 'direction' => 'hausse',
                'text' => sprintf('Annulations inhabituelles aujourd’hui : %d sur %d commandes (habituellement %d %%).', (int) $t['c'], (int) $t['n'], round($cancelRate * 100))];
        }
        // Produit vendu anormalement : quantité du jour très au-dessus de sa moyenne quotidienne.
        $pq = $this->pdo()->query("SELECT oi.product_id AS id, oi.product_name AS name,
                SUM(CASE WHEN DATE(o.created_at) = CURDATE() THEN oi.quantity ELSE 0 END) AS today,
                SUM(CASE WHEN DATE(o.created_at) < CURDATE() THEN oi.quantity ELSE 0 END) AS past
             FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL
             WHERE o.created_at >= DATE_SUB(CURDATE(), INTERVAL 28 DAY) GROUP BY oi.product_id, oi.product_name")->fetchAll();
        foreach ($pq as $r) {
            $avg = (int) $r['past'] / count($hist);
            if ((int) $r['today'] >= 5 && (int) $r['today'] > max(3 * $avg, $avg + 4)) {
                $out['items'][] = ['metric' => 'product', 'severity' => 'modérée', 'direction' => 'hausse',
                    'text' => sprintf('%s : %d vendu(s) aujourd’hui contre %s par jour en moyenne.', $r['name'], (int) $r['today'], number_format($avg, 1, ',', ''))];
            }
        }
        // Activité à une heure jamais observée
        $hoursSeen = $this->pdo()->query("SELECT DISTINCT HOUR(created_at) FROM orders WHERE created_at < CURDATE() AND created_at >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)")->fetchAll(PDO::FETCH_COLUMN);
        $todayHours = $this->pdo()->query("SELECT HOUR(created_at) AS h, COUNT(*) AS n FROM orders WHERE DATE(created_at) = CURDATE() GROUP BY h")->fetchAll();
        foreach ($todayHours as $r) {
            if (!in_array((int) $r['h'], array_map('intval', $hoursSeen), true) && (int) $r['n'] >= 2) {
                $out['items'][] = ['metric' => 'activity', 'severity' => 'modérée', 'direction' => 'hausse',
                    'text' => sprintf('Activité à une heure inhabituelle : %d commande(s) vers %dh, heure sans commande les 28 derniers jours.', (int) $r['n'], (int) $r['h'])];
            }
        }
        return $out;
    }

    // ================= Suggestions de promotions =================

    /** Complète les suggestions existantes (PromotionService) ; ne crée jamais rien. */
    public function promotionIdeas(PromotionService $promos, AiRecommendationService $reco): array
    {
        $base = $promos->suggestions();
        $ideas = array_map(fn($s) => $s + ['source' => 'règle existante'], $base['content']);
        $orders30 = (int) $base['basedOnOrders'];

        // Produits peu vendus sur 30 jours (disponibles, sous 20 % de la médiane, au moins 10 commandes au total)
        if ($orders30 >= 10) {
            $rows = $this->pdo()->query("SELECT p.id, p.name, COALESCE(SUM(oi.quantity), 0) AS q FROM products p
                LEFT JOIN order_items oi ON oi.product_id = p.id
                LEFT JOIN orders o ON o.id = oi.order_id AND o.cancelled_at IS NULL AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                WHERE p.deleted_at IS NULL AND p.available = 1 GROUP BY p.id, p.name")->fetchAll();
            $qs = array_map(fn($r) => (int) $r['q'], $rows);
            sort($qs);
            $median = $qs ? $qs[(int) floor(count($qs) / 2)] : 0;
            if ($median > 0) {
                foreach ($rows as $r) {
                    if ((int) $r['q'] > 0 && (int) $r['q'] < 0.2 * $median) {
                        $ideas[] = ['type' => 'low_seller', 'source' => 'module intelligent',
                            'title' => 'Mettre en avant ' . $r['name'],
                            'reason' => sprintf('%s : %d vente(s) en 30 jours, contre %d pour un produit médian.', $r['name'], (int) $r['q'], $median),
                            'draft' => ['name' => '-10 % ' . $r['name'], 'kind' => 'percent', 'value' => 10, 'scope' => 'product', 'productId' => (int) $r['id'], 'minOrder' => 0]];
                    }
                }
            }
        }
        // Jour de semaine le plus faible (au moins 3 semaines d'historique)
        $hist = $this->dailyHistory(56);
        if (count($hist) >= 21 && $orders30 >= 20) {
            $wd = [];
            foreach ($hist as $h) {
                $wd[$h['weekday']][] = $h['orders'];
            }
            $avgs = [];
            foreach ($wd as $d => $xs) {
                if (count($xs) >= 3) {
                    $avgs[$d] = array_sum($xs) / count($xs);
                }
            }
            if (count($avgs) >= 5) {
                asort($avgs);
                $d = array_key_first($avgs);
                $overall = array_sum($avgs) / count($avgs);
                if ($avgs[$d] < 0.6 * $overall) {
                    $ideas[] = ['type' => 'slow_day', 'source' => 'module intelligent',
                        'title' => 'Offre du ' . self::DAY_NAMES[$d],
                        'reason' => sprintf('Le %s compte %s commande(s) en moyenne, contre %s sur la semaine.', self::DAY_NAMES[$d], number_format($avgs[$d], 1, ',', ''), number_format($overall, 1, ',', '')),
                        'draft' => ['name' => 'Offre du ' . self::DAY_NAMES[$d], 'kind' => 'percent', 'value' => 10, 'scope' => 'order', 'days' => [$d - 1], 'minOrder' => 0]];
                }
            }
        }
        // Produits complémentaires : paires souvent commandées ensemble
        $pairs = $this->pdo()->query("SELECT a.product_id AS a, b.product_id AS b, MIN(a.product_name) AS na, MIN(b.product_name) AS nb, COUNT(DISTINCT a.order_id) AS n
            FROM order_items a JOIN order_items b ON b.order_id = a.order_id AND b.product_id > a.product_id
            JOIN orders o ON o.id = a.order_id AND o.cancelled_at IS NULL
            GROUP BY a.product_id, b.product_id HAVING n >= " . AiRecommendationService::MIN_SUPPORT . " ORDER BY n DESC LIMIT 2")->fetchAll();
        foreach ($pairs as $r) {
            $ideas[] = ['type' => 'pair', 'source' => 'module intelligent',
                'title' => 'Duo ' . $r['na'] . ' + ' . $r['nb'],
                'reason' => sprintf('Commandés ensemble dans %d commandes : une offre duo peut augmenter le panier moyen.', (int) $r['n']),
                'draft' => ['name' => 'Duo ' . $r['na'] . ' + ' . $r['nb'], 'kind' => 'percent', 'value' => 10, 'scope' => 'product', 'productId' => (int) $r['b'], 'minOrder' => 0]];
        }
        return [
            'content' => $ideas,
            'basedOnOrders' => $orders30,
            'autoCreate' => false,
            'note' => $base['note'] ?? ($ideas ? null : 'Aucune opportunité nette dans les données actuelles.'),
        ];
    }
}
