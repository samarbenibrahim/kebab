<?php
/**
 * POST  /api/orders                  (client identifié)
 * POST  /api/orders/preview          (client : montants, promotion, points, attente estimée — rien n'est créé)
 * GET   /api/orders                  (client : les siennes ; serveur : ses tables ; autres rôles : orders.view.all)
 * GET   /api/orders/{id}             (idem, avec contrôle d'accès)
 * GET   /api/orders/{id}/eta         (temps d'attente estimé)
 * PATCH /api/orders/{id}/status      (En préparation / Prête : orders.prepare ; Servie : orders.serve)
 * PATCH /api/orders/{id}/payment     (client : en ligne ; personnel : payments.collect — espèces / carte / en ligne)
 * PATCH /api/orders/{id}/cancel      (client propriétaire, ou orders.cancel)
 * GET   /api/waiting-time?items=N    (attente estimée pour une nouvelle commande)
 *
 * Traduit uniquement les exceptions du service en codes HTTP — aucune règle
 * métier ici (§24). Le contrôle d'accès (rôle / permission / propriétaire /
 * table servie) est appliqué AVANT toute lecture ou modification.
 */
class OrderController
{
    public function __construct(private OrderService $service, private PDO $pdo)
    {
    }

    public function create(string $rawBody, array $session): void
    {
        $replayed = false;
        api_guard(function () use ($rawBody, $session, &$replayed) {
            $payload = RequestValidator::parseJsonBody($rawBody);
            $key = isset($_SERVER['HTTP_IDEMPOTENCY_KEY']) ? trim($_SERVER['HTTP_IDEMPOTENCY_KEY']) : null;
            $order = $this->service->createOrder($payload, $key === '' ? null : $key, $replayed, $session['client'], $session);
            if ($replayed) {
                // Requête rejouée avec la même clé : 200 (pas 201) = "déjà créée".
                header('Idempotent-Replayed: true');
                send_json(200, $order);
            }
            send_json(201, $order);
        });
    }

    public function preview(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(200, $this->service->previewOrder(RequestValidator::parseJsonBody($rawBody), $session['client']));
        });
    }

    /** Charge la commande et vérifie que la session a le droit d'y toucher (sinon 404, sans rien révéler). */
    private function loadAccessible($rawId, array $session): array
    {
        $id = RequestValidator::validateId($rawId);
        $order = $this->service->getOrder($id);
        if (!$order || !Auth::canAccessOrder($this->pdo, $session, $order)) {
            throw new NotFoundException("Commande introuvable");
        }
        return $order;
    }

    private function requirePermission(array $session, string $permission): void
    {
        if (!Auth::can($session, $permission)) {
            throw new ForbiddenException("Permission refusée pour votre rôle");
        }
    }

    public function show($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            send_json(200, $this->loadAccessible($rawId, $session));
        });
    }

    public function eta($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            send_json(200, $this->service->waitingTime($this->loadAccessible($rawId, $session)));
        });
    }

    public function waitingTime(array $query, array $session): void
    {
        api_guard(function () use ($query) {
            $items = 1;
            if (isset($query['items'])) {
                if (!ctype_digit((string) $query['items']) || (int) $query['items'] < 1 || (int) $query['items'] > 200) {
                    throw new InvalidArgumentException("items doit être un entier entre 1 et 200");
                }
                $items = (int) $query['items'];
            }
            send_json(200, (new WaitingTimeService($this->pdo))->estimateNew($items));
        });
    }

    public function index(array $query, array $session): void
    {
        api_guard(function () use ($query, $session) {
            $filters = RequestValidator::validateOrderFilters($query);
            if ($session['role'] === 'client') {
                unset($filters['tableNumber']);
                $filters['clientId'] = (int) $session['client']['id'];
            } elseif ($session['role'] === 'server') {
                $filters['tables'] = Auth::serverTables($this->pdo, (int) $session['staff']['id']);
            } else {
                $this->requirePermission($session, 'orders.view.all');
            }
            send_json(200, $this->service->listOrders($filters));
        });
    }

    public function updateStatus($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            $order = $this->loadAccessible($rawId, $session);
            $body = RequestValidator::parseJsonBody($rawBody);
            $status = RequestValidator::validateStatusPayload($body);
            // La cuisine prépare, le serveur sert : chaque étape a sa permission.
            $needed = $status === 'Servie' ? 'orders.serve' : 'orders.prepare';
            $this->requirePermission($session, $needed);
            send_json(200, $this->service->updateStatus((int) $order['id'], $status, $session));
        });
    }

    public function cancel($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $order = $this->loadAccessible($rawId, $session);
            if ($session['role'] !== 'client') {
                $this->requirePermission($session, 'orders.cancel');
            }
            send_json(200, $this->service->cancelOrder((int) $order['id'], $session));
        });
    }

    public function pay($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            $order = $this->loadAccessible($rawId, $session);
            $body = RequestValidator::parseJsonBody($rawBody);
            $method = RequestValidator::validatePaymentPayload($body);
            if ($session['role'] === 'client') {
                // Un client ne peut pas déclarer lui-même « payé en espèces / par carte » : seul le personnel encaisse.
                if ($method !== 'online') {
                    throw new ForbiddenException("Les paiements en espèces et par carte sont enregistrés par la caisse");
                }
            } else {
                $this->requirePermission($session, 'payments.collect');
            }
            send_json(200, $this->service->payOrder((int) $order['id'], $method, $session));
        });
    }
}
