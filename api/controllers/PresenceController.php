<?php
/**
 * POST  /api/presence/heartbeat              (client) signal de l'espace client
 *
 * Administration (presence.view ; réglages : presence.manage) :
 * GET   /api/admin/presence                  sessions en cours et récentes, compteurs, santé de l'API
 * GET   /api/admin/presence/{id}             détail d'une session (client, table, commandes, événements)
 * GET   /api/admin/notifications?status=open|unread|all
 * PATCH /api/admin/notifications/{id}        {"action":"read"|"close"}
 * PATCH /api/admin/notifications/read-all
 * GET   /api/admin/presence-settings
 * PUT   /api/admin/presence-settings
 *
 * Traduit uniquement les exceptions du service en codes HTTP.
 */
class PresenceController
{
    public function __construct(private PresenceService $service)
    {
    }

    public function heartbeat(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(200, $this->service->heartbeat($session, RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function overview(): void
    {
        send_json(200, $this->service->overview());
    }

    public function detail($rawId): void
    {
        api_guard(function () use ($rawId) {
            send_json(200, $this->service->detail(RequestValidator::validateId($rawId)));
        });
    }

    public function notifications(array $query): void
    {
        api_guard(function () use ($query) {
            send_json(200, $this->service->notifications($query));
        });
    }

    public function act($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            $id = RequestValidator::validateId($rawId);
            send_json(200, $this->service->actOnNotification($id, RequestValidator::parseJsonBody($rawBody), $session));
        });
    }

    public function readAll(array $session): void
    {
        send_json(200, $this->service->readAll($session));
    }

    public function settings(): void
    {
        send_json(200, $this->service->settings());
    }

    public function updateSettings(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(200, $this->service->updateSettings(RequestValidator::parseJsonBody($rawBody), $session));
        });
    }
}
