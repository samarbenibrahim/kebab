<?php
/**
 * POST  /api/takeaway-requests                  (client : sa commande avec un café en gobelet)
 * GET   /api/takeaway-requests/mine             (client)
 * PATCH /api/takeaway-requests/{id}/cancel      (client)
 * GET   /api/takeaway-requests?status=pending   (takeaway.respond)
 * PATCH /api/takeaway-requests/{id}/respond     (takeaway.respond) {decision: accept|decline, message?}
 *
 * Traduit uniquement les exceptions du service en codes HTTP.
 */
class TakeawayController
{
    public function __construct(private TakeawayService $service)
    {
    }

    public function create(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(201, $this->service->create($session, RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function mine(array $session): void
    {
        send_json(200, $this->service->mine((int) $session['client']['id']));
    }

    public function cancel($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            send_json(200, $this->service->cancel((int) $session['client']['id'], RequestValidator::validateId($rawId)));
        });
    }

    public function index(array $query): void
    {
        api_guard(function () use ($query) {
            send_json(200, $this->service->list($query));
        });
    }

    public function respond($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            send_json(200, $this->service->respond($session, RequestValidator::validateId($rawId), RequestValidator::parseJsonBody($rawBody)));
        });
    }
}
