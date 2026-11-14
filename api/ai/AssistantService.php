<?php
/**
 * Assistant client « Suggérez-moi » : comprend une demande en français
 * (budget, chaud/froid, sucre, léger, allergènes, catégorie, combinaison)
 * et PROPOSE des produits disponibles. Il n'ajoute jamais rien au panier.
 * Analyse par règles transparentes : chaque critère compris est renvoyé
 * (« understood ») pour que le client voie comment sa demande a été lue.
 */
class AiAssistantService
{
    private const CATEGORY_WORDS = [
        'Cafés' => ['cafe', 'coffee', 'espresso', 'expresso', 'cappuccino', 'latte', 'creme', 'turc', 'noisette'],
        'Croissants' => ['croissant', 'viennoiserie', 'pain au chocolat', 'chausson'],
        'Jus' => ['jus', 'citronnade', 'orange pressee'],
        'Smoothies' => ['smoothie'],
        'Mojitos' => ['mojito', 'cocktail'],
        'Sodas' => ['soda', 'coca', 'sprite', 'schweppes', 'gazeuse', 'ice tea'],
        'Sandwichs' => ['sandwich', 'panini', 'toast', 'sale'],
        'Desserts' => ['dessert', 'gateau', 'patisserie', 'tiramisu', 'cheesecake', 'cookie', 'fondant', 'chocolat'],
        'Petit-déjeuner' => ['petit dej', 'petit-dej', 'petit dejeuner', 'petit-dejeuner', 'breakfast', 'brunch'],
    ];

    public function __construct(private AiSupport $ai, private AiRecommendationService $reco)
    {
    }

    public function parse(string $query, array $catalog): array
    {
        $q = AiSupport::norm($query);
        $c = ['budget' => null, 'temperature' => null, 'lowSugar' => false, 'sweet' => false, 'light' => false,
            'hungry' => false, 'categories' => [], 'excludeAllergens' => [], 'tags' => [], 'combo' => false, 'understood' => []];

        // Budget : « moins de 8 DT », « max 10 », « 8dt », « pas cher »
        if (preg_match('/(?:moins de|max(?:imum)?|maxi|sous|pas plus de|jusqu.?a|budget(?: de)?|<|inferieur a)\s*(\d+(?:[.,]\d+)?)/u', $q, $m)
            || preg_match('/(\d+(?:[.,]\d+)?)\s*(?:dt|dinars?|tnd)\b/u', $q, $m)) {
            $c['budget'] = (float) str_replace(',', '.', $m[1]);
            $c['understood'][] = 'Budget : ' . AiSupport::money($c['budget']) . ' maximum';
        } elseif (preg_match('/pas cher|petit prix|economique|bon marche|abordable/u', $q)) {
            $prices = array_map(fn($p) => $p['price'], $catalog);
            sort($prices);
            $c['budget'] = $prices ? $prices[(int) floor(count($prices) / 3)] : null;
            if ($c['budget'] !== null) {
                $c['understood'][] = 'Petit prix (jusqu’à ' . AiSupport::money($c['budget']) . ')';
            }
        }

        if (preg_match('/frais|fraiche|froid|glace|rafraich|desalter|il fait chaud|ete\b/u', $q)) {
            $c['temperature'] = 'cold';
            $c['understood'][] = 'Quelque chose de frais';
        } elseif (preg_match('/\bchaud|chaude|rechauff|bien chaud/u', $q)) {
            $c['temperature'] = 'hot';
            $c['understood'][] = 'Quelque chose de chaud';
        }

        if (preg_match('/pas trop sucre|peu sucre|sans sucre|moins sucre|pas sucre|pas trop doux/u', $q)) {
            $c['lowSugar'] = true;
            $c['understood'][] = 'Peu sucré';
        } elseif (preg_match('/gourmand|sucre|douceur|chocolat/u', $q)) {
            $c['sweet'] = true;
            $c['understood'][] = 'Gourmand';
        }

        if (preg_match('/leger|legere|light|peu calori|regime|healthy|sain\b|equilibre/u', $q)) {
            $c['light'] = true;
            $c['understood'][] = 'Léger (peu de calories)';
        }
        if (preg_match('/faim|copieux|consistant|rassasi|manger|affame/u', $q)) {
            $c['hungry'] = true;
            $c['understood'][] = 'Bien copieux';
        }

        foreach (self::CATEGORY_WORDS as $cat => $words) {
            foreach ($words as $w) {
                if (preg_match('/\b' . preg_quote($w, '/') . '/u', $q)) {
                    $c['categories'][] = $cat;
                    break;
                }
            }
        }
        $c['categories'] = array_values(array_unique($c['categories']));
        // « chocolat » seul compte comme gourmandise, pas comme demande de dessert si une autre catégorie est citée
        if ($c['categories']) {
            $c['understood'][] = 'Catégorie : ' . implode(', ', $c['categories']);
        }
        if (count($c['categories']) >= 2 && preg_match('/\bavec\b|\bet\b|\+/u', $q)) {
            $c['combo'] = true;
            $c['understood'][] = 'Une association (' . implode(' + ', $c['categories']) . ')';
        }

        $allergenWords = ['Gluten' => 'gluten', 'Lait' => 'lait|lactose', 'Œufs' => 'oeufs?', 'Fruits à coque' => 'noix|fruits? a coque|amande', 'Soja' => 'soja', 'Sésame' => 'sesame', 'Poisson' => 'poisson'];
        foreach ($allergenWords as $a => $re) {
            if (preg_match('/sans (?:' . $re . ')|allergi\w* (?:au |a la |aux )?(?:' . $re . ')/u', $q)) {
                $c['excludeAllergens'][] = $a;
            }
        }
        if ($c['excludeAllergens']) {
            $c['understood'][] = 'Sans : ' . implode(', ', $c['excludeAllergens']);
        }
        if (preg_match('/vegan|vegetalien/u', $q)) {
            $c['tags'][] = 'vegan';
            $c['understood'][] = 'Vegan';
        } elseif (preg_match('/vegetarien|sans viande/u', $q)) {
            $c['tags'][] = 'vegetarien';
            $c['understood'][] = 'Végétarien';
        }
        return $c;
    }

    private function passes(array $p, array $c, array $relax = []): bool
    {
        if ($c['budget'] !== null && $p['price'] > $c['budget'] + 0.0001) {
            return false;
        }
        foreach ($c['excludeAllergens'] as $a) {
            if (in_array($a, $p['allergens'], true)) {
                return false;
            }
        }
        foreach ($c['tags'] as $t) {
            if (!in_array($t, $p['tags'], true)) {
                return false;
            }
        }
        if ($c['categories'] && !in_array('categories', $relax, true) && !in_array($p['category'], $c['categories'], true)) {
            return false;
        }
        if (!in_array('temperature', $relax, true)) {
            if ($c['temperature'] === 'cold' && !AiSupport::isCold($p)) {
                return false;
            }
            if ($c['temperature'] === 'hot' && !(AiSupport::isHotDrink($p) || ($c['categories'] && AiSupport::isFood($p)))) {
                return false;
            }
        }
        if ($c['lowSugar'] && in_array($p['category'], ['Desserts', 'Sodas'], true)) {
            return false;
        }
        if ($c['light'] && !in_array('light', $relax, true) && ($p['calories'] === null || $p['calories'] > 250)) {
            return false;
        }
        return true;
    }

    private function score(array $p, array $c, ?array $slot, array $history, int $maxSold): array
    {
        $s = 0.0;
        $why = [];
        if ($slot && in_array($p['category'], $slot['categories'], true)) {
            $s += 1.0;
        }
        $s += 1.5 * $p['sold'] / max(1, $maxSold);
        if ($p['sold'] > 0 && $p['sold'] === $maxSold) {
            $why[] = 'le plus commandé';
        }
        if (isset($history[$p['id']])) {
            $s += 2.0;
            $why[] = 'vous l’avez déjà apprécié';
        }
        if ($c['light'] && $p['calories'] !== null) {
            $s += max(0, (250 - $p['calories']) / 250);
            $why[] = '≈ ' . $p['calories'] . ' kcal';
        }
        if ($c['hungry'] && $p['calories'] !== null) {
            $s += min(2, $p['calories'] / 400);
            if (AiSupport::isFood($p)) {
                $s += 1.0;
            }
        }
        if ($c['sweet'] && in_array($p['category'], ['Desserts', 'Croissants', 'Smoothies'], true)) {
            $s += 1.0;
        }
        if ($c['lowSugar'] && $p['category'] === 'Cafés') {
            $why[] = 'choisissez « Sucre : peu » dans la fiche';
        }
        if ($c['budget'] !== null) {
            $why[] = AiSupport::money($p['price']);
        }
        if (AiSupport::isCold($p) && $c['temperature'] === 'cold') {
            $why[] = 'servi frais';
        }
        return [$s, $why];
    }

    public function suggest(string $query, ?array $client, int $limit = 4): array
    {
        $query = trim($query);
        if ($query === '' || mb_strlen($query) > 200) {
            throw new InvalidArgumentException('Décrivez votre envie en 200 caractères maximum.');
        }
        $catalog = $this->ai->catalog(true);
        $c = $this->parse($query, $catalog);
        $slot = $this->ai->currentSlot();
        $history = $this->reco->clientHistory($client);
        $maxSold = 1;
        foreach ($catalog as $p) {
            $maxSold = max($maxSold, $p['sold']);
        }

        // Filtre strict, puis assouplissements successifs annoncés au client.
        $relaxSteps = [[], ['light'], ['light', 'temperature'], ['light', 'temperature', 'categories']];
        $relaxed = [];
        $pool = [];
        foreach ($relaxSteps as $relax) {
            $pool = array_values(array_filter($catalog, fn($p) => $this->passes($p, $c, $relax)));
            if ($pool) {
                $relaxed = $relax;
                break;
            }
        }
        // Sans aucun critère reconnu : le créneau horaire guide la proposition.
        $noCriteria = !$c['understood'];
        if ($noCriteria && $slot) {
            $pool = array_values(array_filter($catalog, fn($p) => in_array($p['category'], $slot['categories'], true))) ?: $catalog;
        }

        $scored = array_map(function ($p) use ($c, $slot, $history, $maxSold) {
            [$s, $why] = $this->score($p, $c, $slot, $history, $maxSold);
            return ['p' => $p, 's' => $s, 'why' => $why];
        }, $pool);
        usort($scored, fn($a, $b) => $b['s'] <=> $a['s'] ?: $a['p']['price'] <=> $b['p']['price']);

        $combos = [];
        $products = [];
        if ($c['combo'] && count($c['categories']) >= 2) {
            // Une proposition par paire : meilleur produit de chaque catégorie, budget total respecté.
            [$catA, $catB] = $c['categories'];
            $as = array_values(array_filter($scored, fn($x) => $x['p']['category'] === $catA));
            $bs = array_values(array_filter($scored, fn($x) => $x['p']['category'] === $catB));
            foreach ($as as $a) {
                foreach ($bs as $b) {
                    $total = $a['p']['price'] + $b['p']['price'];
                    if ($c['budget'] !== null && $total > $c['budget'] + 0.0001) {
                        continue;
                    }
                    $combos[] = ['items' => [AiRecommendationService::item($a['p'], $a['why']), AiRecommendationService::item($b['p'], $b['why'])],
                        'total' => round($total, 3), 'score' => $a['s'] + $b['s']];
                }
            }
            usort($combos, fn($x, $y) => $y['score'] <=> $x['score'] ?: $x['total'] <=> $y['total']);
            $seen = [];
            $combos = array_values(array_filter($combos, function ($cb) use (&$seen) {
                $k = $cb['items'][0]['id'];
                if (isset($seen[$k])) {
                    return false;
                }
                return $seen[$k] = true;
            }));
            $combos = array_map(function ($cb) {
                unset($cb['score']);
                return $cb;
            }, array_slice($combos, 0, 3));
        }
        foreach (array_slice($scored, 0, $limit) as $x) {
            $products[] = AiRecommendationService::item($x['p'], $x['why']);
        }

        $notes = [];
        if (in_array('categories', $relaxed, true)) {
            $notes[] = 'Rien dans cette catégorie ne correspond à tous vos critères : voici les produits les plus proches.';
        } elseif (in_array('temperature', $relaxed, true)) {
            $notes[] = 'Aucun produit ne coche toutes les cases : nous avons élargi au chaud et au froid.';
        } elseif (in_array('light', $relaxed, true)) {
            $notes[] = 'Aucun produit de moins de 250 kcal ne correspond : voici les plus légers possibles.';
        }
        if ($c['combo'] && !$combos) {
            $notes[] = 'Aucune association ne tient dans votre budget.';
        }
        if ($noCriteria) {
            $notes[] = $slot ? 'Suggestion générale pour ' . mb_strtolower($slot['label']) . '.' : 'Suggestion générale.';
        }
        if (!$pool) {
            $notes[] = 'Aucun produit disponible ne correspond. Parcourez le menu complet.';
        }

        $count = count($products) + count($combos);
        $this->ai->logInteraction('suggest', $client ? 'client' : 'anonymous', $client ? (int) $client['id'] : null, $query,
            $c['combo'] ? 'combo' : ($c['categories'][0] ?? ($c['temperature'] ?? null)), $count);

        return [
            'query' => $query,
            'understood' => $c['understood'],
            'general' => $noCriteria || !$history,
            'personalized' => (bool) $history,
            'notes' => $notes,
            'products' => $products,
            'combos' => $combos,
            'autoAdd' => false,
        ];
    }
}
