<?php
/**
 * Routes du module « SOUCOFFE Intelligent » — toutes sous /api/ai/…
 * Chargé à la demande par api/index.php : les routes existantes ne dépendent
 * jamais de ce fichier. Désactivé (ai_settings.enabled = '0'), tout répond 503
 * sauf GET /ai/status et PUT /ai/settings.
 *
 *   GET  /ai/status                     public : interrupteur + qualité des données
 *   PUT  /ai/settings                   ai.manage : activer/désactiver, créneaux horaires
 *   POST /ai/suggest                    public (client facultatif) : assistant « Suggérez-moi »
 *   GET  /ai/recommendations?seed=1,2   public (client facultatif) : recommandations
 *   GET  /ai/kitchen                    orders.prepare | orders.view.all : Smart Kitchen
 *   GET  /ai/bi?period=30               stats.view : BI + insights
 *   GET  /ai/forecast                   stats.view : prévisions
 *   GET  /ai/anomalies                  stats.view : comportements inhabituels
 *   POST /ai/ask                        stats.view : assistant manager
 *   GET  /ai/promotions                 promotions.view : idées de promotions (jamais créées)
 *   GET  /ai/stock                      stock.view
 *   POST /ai/stock/items                stock.manage
 *   PATCH /ai/stock/items/{id}          stock.manage (seuil, unité, archiver)
 *   POST /ai/stock/items/{id}/movements stock.manage (inventaire / livraison)
 *   PUT  /ai/stock/recipes              stock.manage (recette d'un produit)
 */
require_once __DIR__ . '/AiSupport.php';
require_once __DIR__ . '/RecommendationService.php';
require_once __DIR__ . '/AssistantService.php';
require_once __DIR__ . '/AnalyticsService.php';
require_once __DIR__ . '/KitchenService.php';
require_once __DIR__ . '/StockService.php';
require_once __DIR__ . '/ManagerAssistantService.php';

function ai_json_body(string $raw): array
{
    if ($raw === '') {
        return [];
    }
    $b = json_decode($raw, true);
    if (!is_array($b)) {
        throw new InvalidArgumentException('Corps JSON invalide');
    }
    return $b;
}

function ai_dispatch(PDO $pdo, string $method, string $path, callable $body, PromotionService $promotionService): void
{
    $ai = new AiSupport($pdo);
    $perm = static fn($p): array => Auth::requirePermission($pdo, $p);

    api_guard(function () use ($ai, $pdo, $method, $path, $body, $perm, $promotionService) {
        try {
            // ---- Toujours disponibles ----
            if ($method === 'GET' && $path === '/ai/status') {
                $out = ['enabled' => $ai->enabled()];
                if ($ai->enabled()) {
                    $out['dataQuality'] = $ai->dataQuality();
                    $out['timeSlots'] = $ai->timeSlots();
                    $slot = $ai->currentSlot();
                    $out['currentSlot'] = $slot ? $slot['label'] : null;
                }
                send_json(200, $out);
            }
            if ($method === 'PUT' && $path === '/ai/settings') {
                $session = $perm('ai.manage');
                $b = ai_json_body($body());
                $changes = [];
                if (array_key_exists('enabled', $b)) {
                    $ai->setSetting('enabled', $b['enabled'] ? '1' : '0', (int) $session['staff']['id']);
                    $changes['enabled'] = (bool) $b['enabled'];
                }
                if (array_key_exists('timeSlots', $b)) {
                    $slots = ai_validate_slots($b['timeSlots']);
                    $ai->setSetting('time_slots', json_encode($slots, JSON_UNESCAPED_UNICODE), (int) $session['staff']['id']);
                    $changes['timeSlots'] = count($slots);
                }
                if (!$changes) {
                    throw new InvalidArgumentException('Rien à modifier.');
                }
                Audit::log($pdo, $session, 'ai.settings', 'ai_settings', null, $changes);
                send_json(200, ['enabled' => $ai->enabled(), 'timeSlots' => $ai->timeSlots()]);
            }

            $ai->requireEnabled();
            $reco = new AiRecommendationService($ai);
            $analytics = new AiAnalyticsService($ai);
            $stock = new AiStockService($ai);

            if ($method === 'POST' && $path === '/ai/suggest') {
                $b = ai_json_body($body());
                $client = Auth::optionalClient($pdo);
                send_json(200, (new AiAssistantService($ai, $reco))->suggest((string) ($b['query'] ?? ''), $client));
            } elseif ($method === 'GET' && $path === '/ai/recommendations') {
                $seed = array_values(array_filter(array_map('intval', explode(',', (string) ($_GET['seed'] ?? ''))), fn($x) => $x > 0));
                $limit = max(1, min(8, (int) ($_GET['limit'] ?? 4)));
                send_json(200, $reco->recommend(Auth::optionalClient($pdo), array_slice($seed, 0, 20), $limit));
            } elseif ($method === 'GET' && $path === '/ai/kitchen') {
                $perm(['orders.prepare', 'orders.view.all']);
                send_json(200, (new AiKitchenService($ai))->snapshot());
            } elseif ($method === 'GET' && $path === '/ai/bi') {
                $perm('stats.view');
                $spec = (string) ($_GET['period'] ?? '30');
                if (!preg_match('/^(today|yesterday|week|lastweek|month|\d{1,3})$/', $spec)) {
                    throw new InvalidArgumentException('period invalide');
                }
                send_json(200, $ai->cached('bi:' . $spec, 60, fn() => $analytics->bi($spec)));
            } elseif ($method === 'GET' && $path === '/ai/forecast') {
                $perm('stats.view');
                send_json(200, $ai->cached('forecast', 900, fn() => $analytics->forecast()));
            } elseif ($method === 'GET' && $path === '/ai/anomalies') {
                $perm('stats.view');
                send_json(200, $ai->cached('anomalies', 300, fn() => $analytics->anomalies()));
            } elseif ($method === 'POST' && $path === '/ai/ask') {
                $session = $perm('stats.view');
                $b = ai_json_body($body());
                send_json(200, (new AiManagerAssistantService($ai, $analytics, $stock))->ask((string) ($b['question'] ?? ''), $session));
            } elseif ($method === 'GET' && $path === '/ai/promotions') {
                $perm('promotions.view');
                send_json(200, $ai->cached('promotions', 900, fn() => $analytics->promotionIdeas($promotionService, $reco)));
            } elseif ($method === 'GET' && $path === '/ai/stock') {
                $perm('stock.view');
                $f = $ai->cached('forecast', 900, fn() => $analytics->forecast());
                $factor = ($f['available'] ?? false) && ($f['averagePerDay'] ?? 0) > 0 ? $f['days'][0]['orders'] / $f['averagePerDay'] : 1.0;
                send_json(200, $stock->overview($factor));
            } elseif ($method === 'POST' && $path === '/ai/stock/items') {
                send_json(201, $stock->createItem(ai_json_body($body()), $perm('stock.manage')));
            } elseif ($method === 'PATCH' && preg_match('#^/ai/stock/items/(\d+)$#', $path, $m)) {
                send_json(200, $stock->updateItem((int) $m[1], ai_json_body($body()), $perm('stock.manage')));
            } elseif ($method === 'POST' && preg_match('#^/ai/stock/items/(\d+)/movements$#', $path, $m)) {
                send_json(201, $stock->movement((int) $m[1], ai_json_body($body()), $perm('stock.manage')));
            } elseif ($method === 'PUT' && $path === '/ai/stock/recipes') {
                send_json(200, $stock->setRecipe(ai_json_body($body()), $perm('stock.manage')));
            } else {
                send_error(404, "Route non trouvée : $method $path");
            }
        } catch (AiDisabledException $e) {
            send_error(503, $e->getMessage());
        }
    });
}

function ai_validate_slots($slots): array
{
    if (!is_array($slots) || !$slots || count($slots) > 12) {
        throw new InvalidArgumentException('timeSlots doit contenir entre 1 et 12 créneaux.');
    }
    $known = [];
    foreach ((new AiSupport(get_pdo_connection()))->catalog(false) as $p) {
        $known[$p['category']] = true;
    }
    $out = [];
    foreach ($slots as $s) {
        $start = $s['start'] ?? null;
        $end = $s['end'] ?? null;
        if (!is_int($start) || !is_int($end) || $start < 0 || $end > 24 || $start >= $end) {
            throw new InvalidArgumentException('Chaque créneau a une heure de début et de fin entre 0 et 24 (début < fin).');
        }
        $label = trim((string) ($s['label'] ?? ''));
        if ($label === '' || mb_strlen($label) > 40) {
            throw new InvalidArgumentException('Chaque créneau a un nom (40 caractères maximum).');
        }
        $cats = array_values(array_unique(array_filter((array) ($s['categories'] ?? []), fn($c) => is_string($c) && isset($known[$c]))));
        if (!$cats) {
            throw new InvalidArgumentException("Le créneau « $label » doit contenir au moins une catégorie existante.");
        }
        $out[] = ['start' => $start, 'end' => $end, 'label' => $label, 'categories' => $cats];
    }
    return $out;
}
