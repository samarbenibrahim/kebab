<?php
/**
 * Assistant manager : questions en français sur les données de la base.
 * Reconnaissance d'intention par règles (aucun service externe, aucune donnée
 * inventée) ; chaque réponse renvoie la période analysée et les chiffres
 * utilisés. Question non reconnue -> liste des questions possibles.
 */
class AiManagerAssistantService
{
    public const EXAMPLES = [
        'Quels sont les produits les plus vendus aujourd’hui ?',
        'Quelle est l’heure la plus chargée ?',
        'Quel produit risque d’être en rupture ?',
        'Quelle est l’évolution des ventes cette semaine ?',
        'Quels produits sont peu vendus ?',
        'Quel est le panier moyen ?',
        'Quel est le chiffre d’affaires ce mois-ci ?',
        'Combien de commandes hier ?',
        'Quelle part de commandes à emporter ?',
        'Quels moyens de paiement ?',
        'Quel est le temps moyen de préparation ?',
        'Quelle est la prévision pour demain ?',
        'Y a-t-il des anomalies ?',
    ];

    public function __construct(private AiSupport $ai, private AiAnalyticsService $analytics, private AiStockService $stock)
    {
    }

    private function periodSpec(string $q, string $default = '30')
    {
        if (preg_match('/aujourd|ce jour|du jour/u', $q)) {
            return 'today';
        }
        if (preg_match('/\bhier\b/u', $q)) {
            return 'yesterday';
        }
        if (preg_match('/semaine derniere|semaine passee/u', $q)) {
            return 'lastweek';
        }
        if (preg_match('/cette semaine|la semaine/u', $q)) {
            return 'week';
        }
        if (preg_match('/ce mois|du mois|le mois/u', $q)) {
            return 'month';
        }
        if (preg_match('/(\d{1,3})\s*(?:derniers?\s*)?jours?/u', $q, $m) && (int) $m[1] >= 1 && (int) $m[1] <= 365) {
            return (int) $m[1];
        }
        if (preg_match('/\bannee\b|12 mois/u', $q)) {
            return 365;
        }
        return $default;
    }

    public function ask(string $question, array $session): array
    {
        $question = trim($question);
        if ($question === '' || mb_strlen($question) > 300) {
            throw new InvalidArgumentException('Posez une question de 300 caractères maximum.');
        }
        $q = AiSupport::norm($question);
        $intents = [
            'forecast' => '/prevision|prevoir|demain|prochains jours|va-t-on|attendre combien/u',
            'anomalies' => '/anomal|inhabituel|bizarre|suspect|anormal/u',
            'stock' => '/rupture|stock|manquer|reapprovision/u',
            'low' => '/peu vendu|moins vendu|se vend(?:ent)? pas|pas vendu|flop|invendu/u',
            'top' => '/plus vendu|meilleur(?:e)?s? vente|top|populaire|plus commande/u',
            'hour' => '/heure|pic|rush|affluence|plus charge|creux/u',
            'weekday' => '/quel jour|jour le plus|jours? de la semaine/u',
            'evolution' => '/evolution|tendance|progress|compar|augment|baiss/u',
            'basket' => '/panier moyen|ticket moyen/u',
            'cancel' => '/annul/u',
            'payment' => '/paiement|payer|espece|carte|en ligne|encaiss/u',
            'takeaway' => '/emporter|sur place|gobelet/u',
            'prep' => '/preparation|temps d.attente|cuisine|delai/u',
            'category' => '/categor/u',
            'revenue' => '/chiffre d.affaire|\bca\b|recette|ventes?\b|combien (?:avons|a-t-on) gagne|montant/u',
            'orders' => '/combien de commande|nombre de commande|commandes?\b/u',
        ];
        $intent = null;
        foreach ($intents as $k => $re) {
            if (preg_match($re, $q)) {
                $intent = $k;
                break;
            }
        }
        $res = $intent ? $this->answer($intent, $q) : [
            'answer' => 'Je ne sais répondre qu’aux questions sur les données du café. Exemples :',
            'examples' => self::EXAMPLES,
            'data' => null,
            'period' => null,
        ];
        $res['intent'] = $intent;
        $res['question'] = $question;
        $res['source'] = 'Base de données Kebab (commandes réelles)';
        $this->ai->logInteraction('ask', 'staff', (int) ($session['staff']['id'] ?? 0) ?: null, $question, $intent, $intent ? 1 : 0);
        return $res;
    }

    private function answer(string $intent, string $q): array
    {
        if ($intent === 'forecast') {
            $f = $this->analytics->forecast();
            if (!$f['available']) {
                return ['answer' => $f['note'], 'data' => null, 'period' => null];
            }
            $d = $f['days'][0];
            $txt = sprintf('Prévision pour %s %s : environ %s commande(s) (entre %d et %d), pour ≈ %s.', $d['day'], date('d/m', strtotime($d['date'])),
                number_format($d['orders'], 1, ',', ''), $d['low'], $d['high'], AiSupport::money($d['amount']));
            if ($f['tomorrowPeakHour'] !== null) {
                $txt .= sprintf(' Heure probablement la plus chargée : %dh.', $f['tomorrowPeakHour']);
            }
            $txt .= ' Fiabilité : ' . $f['reliability'] . '.';
            return ['answer' => $txt, 'data' => $f['days'], 'period' => ['label' => sprintf('historique de %d jour(s), %d commande(s)', $f['historyDays'], $f['historyOrders'])], 'forecast' => true];
        }
        if ($intent === 'anomalies') {
            $a = $this->analytics->anomalies();
            if (!$a['available']) {
                return ['answer' => $a['note'], 'data' => null, 'period' => ['label' => sprintf('%d jour(s) de référence', $a['baselineDays'])]];
            }
            $txt = $a['items'] ? $a['message'] . ' : ' . implode(' ', array_map(fn($i) => $i['text'], $a['items'])) . ' ' . $a['disclaimer']
                : 'Aucun comportement inhabituel détecté aujourd’hui par rapport aux 28 derniers jours.';
            return ['answer' => $txt, 'data' => $a['items'], 'period' => ['label' => "aujourd'hui comparé aux 28 derniers jours"]];
        }
        if ($intent === 'stock') {
            $items = $this->stock->overview()['items'];
            if (!$items) {
                return ['answer' => 'Aucun article de stock n’est encore suivi. Ajoutez-en dans Intelligence → Smart Stock.', 'data' => null, 'period' => null];
            }
            $risky = array_values(array_filter($items, fn($i) => in_array($i['risk'], ['rupture', 'élevé'], true)));
            $unknown = count(array_filter($items, fn($i) => $i['risk'] === 'inconnu'));
            $txt = $risky ? 'Risque de rupture : ' . implode(', ', array_map(fn($i) => sprintf('%s (stock estimé %s %s%s)', $i['name'],
                    $i['estimatedStock'] === null ? '?' : number_format($i['estimatedStock'], 1, ',', ''), $i['unit'],
                    $i['daysLeft'] !== null ? ', ≈ ' . number_format($i['daysLeft'], 1, ',', '') . ' jour(s)' : ''), $risky)) . '.'
                : 'Aucun article suivi n’est en risque de rupture.';
            if ($unknown) {
                $txt .= sprintf(' %d article(s) sans inventaire : leur niveau est inconnu.', $unknown);
            }
            return ['answer' => $txt, 'data' => $risky, 'period' => ['label' => 'stock estimé maintenant']];
        }

        $p = $this->periodSpec($q, $intent === 'evolution' ? 'week' : '30');
        $bi = $this->analytics->bi($p);
        $period = $bi['period'];
        $k = $bi['kpis'];
        if ($k['orders'] === 0 && !in_array($intent, ['low', 'evolution', 'cancel'], true)) {
            return ['answer' => 'Aucune commande enregistrée ' . $period['label'] . '.', 'data' => null, 'period' => $period];
        }
        switch ($intent) {
            case 'top':
                $top = array_slice($bi['byProduct'], 0, 5);
                return ['answer' => 'Produits les plus vendus ' . $period['label'] . ' : ' . implode(', ', array_map(fn($x) => sprintf('%s (%d)', $x['name'], $x['quantity']), $top)) . '.', 'data' => $top, 'period' => $period];
            case 'low':
                $sold = [];
                foreach ($bi['byProduct'] as $x) {
                    $sold[$x['productId']] = $x['quantity'];
                }
                $cat = $this->ai->catalog(true);
                $zero = array_values(array_filter($cat, fn($x) => !isset($sold[$x['id']])));
                $few = $bi['byProduct'];
                usort($few, fn($a, $b) => $a['quantity'] <=> $b['quantity']);
                $txt = sprintf('%d produit(s) disponible(s) sans aucune vente %s', count($zero), $period['label']);
                $txt .= $zero ? ' (dont ' . implode(', ', array_map(fn($x) => $x['name'], array_slice($zero, 0, 6))) . ').' : '.';
                if ($few) {
                    $txt .= ' Parmi les produits vendus, les moins demandés : ' . implode(', ', array_map(fn($x) => sprintf('%s (%d)', $x['name'], $x['quantity']), array_slice($few, 0, 3))) . '.';
                }
                return ['answer' => $txt, 'data' => ['neverSold' => array_map(fn($x) => $x['name'], $zero), 'leastSold' => array_slice($few, 0, 5)], 'period' => $period];
            case 'hour':
                $best = null;
                foreach ($bi['byHour'] as $h => $x) {
                    if ($x['orders'] > 0 && ($best === null || $x['orders'] > $bi['byHour'][$best]['orders'])) {
                        $best = $h;
                    }
                }
                return ['answer' => sprintf('L’heure la plus chargée %s est %dh–%dh avec %d commande(s) sur %d.', $period['label'], $best, $best + 1, $bi['byHour'][$best]['orders'], $k['orders']),
                    'data' => array_values(array_filter(array_map(fn($x, $h) => ['hour' => $h] + $x, $bi['byHour'], array_keys($bi['byHour'])), fn($x) => $x['orders'] > 0)), 'period' => $period];
            case 'weekday':
                $days = $bi['byWeekday'];
                usort($days, fn($a, $b) => $b['orders'] <=> $a['orders']);
                return ['answer' => sprintf('Jour le plus actif %s : %s (%d commande(s)).', $period['label'], $days[0]['day'], $days[0]['orders']), 'data' => $bi['byWeekday'], 'period' => $period];
            case 'evolution':
                $prevSpec = $p === 'week' ? 'lastweek' : null;
                if ($prevSpec) {
                    $prev = $this->analytics->bi($prevSpec);
                    $a = $k['grossSales'];
                    $b = $prev['kpis']['grossSales'];
                    $var = $b > 0 ? sprintf('%+d %%', round(100 * ($a - $b) / $b)) : 'non comparable (aucune vente la semaine dernière)';
                    return ['answer' => sprintf('Cette semaine : %s pour %d commande(s). La semaine dernière : %s pour %d commande(s). Évolution : %s.',
                        AiSupport::money($a), $k['orders'], AiSupport::money($b), $prev['kpis']['orders'], $var),
                        'data' => ['current' => $k, 'previous' => $prev['kpis'], 'byDay' => $bi['byDay']], 'period' => $period];
                }
                return ['answer' => 'Ventes par jour ' . $period['label'] . ' : ' . ($bi['byDay'] ? implode(', ', array_map(fn($d) => date('d/m', strtotime($d['date'])) . ' ' . AiSupport::money($d['amount']), $bi['byDay'])) : 'aucune') . '.', 'data' => $bi['byDay'], 'period' => $period];
            case 'basket':
                return ['answer' => sprintf('Panier moyen %s : %s (%d commande(s)).', $period['label'], AiSupport::money($k['averageBasket']), $k['orders']), 'data' => $k, 'period' => $period];
            case 'cancel':
                return ['answer' => sprintf('%d commande(s) annulée(s) %s, soit %s %% des commandes.', $k['cancelled'], $period['label'], str_replace('.', ',', (string) $k['cancellationRate'])), 'data' => $k, 'period' => $period];
            case 'payment':
                $pm = $bi['payments'];
                return ['answer' => sprintf('Encaissé %s : espèces %s (%d), carte %s (%d), en ligne %s (%d). Non encaissées : %d commande(s).', $period['label'],
                    AiSupport::money($pm['cash']['amount']), $pm['cash']['orders'], AiSupport::money($pm['card']['amount']), $pm['card']['orders'],
                    AiSupport::money($pm['online']['amount']), $pm['online']['orders'], $bi['unpaidOrders']), 'data' => $pm, 'period' => $period];
            case 'takeaway':
                $s = $bi['service'];
                return ['answer' => sprintf('%s : %d commande(s) sur place et %d avec au moins un article à emporter (%d %%).', ucfirst($period['label']), $s['onSite'], $s['takeaway'], round(100 * $s['takeaway'] / max(1, $k['orders']))), 'data' => $s, 'period' => $period];
            case 'prep':
                return ['answer' => $k['avgPrepMinutes'] === null ? 'Temps de préparation non mesurable ' . $period['label'] . ' : aucune commande n’est passée à « Prête » en moins de 90 minutes (les durées plus longues sont ignorées car elles correspondent à des commandes oubliées).'
                    : sprintf('Temps moyen de préparation %s : %s min (sur %d commande(s)).', $period['label'], str_replace('.', ',', (string) $k['avgPrepMinutes']), $k['prepSamples']), 'data' => $k, 'period' => $period];
            case 'category':
                return ['answer' => 'Ventes par catégorie ' . $period['label'] . ' : ' . implode(', ', array_map(fn($c) => sprintf('%s %s', $c['category'], AiSupport::money($c['amount'])), $bi['byCategory'])) . '.', 'data' => $bi['byCategory'], 'period' => $period];
            case 'orders':
                return ['answer' => sprintf('%d commande(s) %s (hors annulations), %d annulée(s).', $k['orders'], $period['label'], $k['cancelled']), 'data' => $k, 'period' => $period];
            case 'revenue':
            default:
                return ['answer' => sprintf('Ventes %s : %s pour %d commande(s), dont %s déjà encaissés.', $period['label'], AiSupport::money($k['grossSales']), $k['orders'], AiSupport::money($k['revenue'])), 'data' => $k, 'period' => $period];
        }
    }
}
