<?php
/**
 * POST  /api/clients                       identification d'un client (public)
 * GET   /api/clients/me                    profil + dernière demande de table
 * PATCH /api/clients/me                    modifier le nombre de personnes
 * PATCH /api/clients/me/table              appliquer la table accordée par l'admin
 *
 * POST  /api/table-change-requests         prévenir l'admin d'un changement de table
 * GET   /api/table-change-requests/mine    ma dernière demande
 * PATCH /api/table-change-requests/{id}/cancel
 * GET   /api/table-change-requests         (admin) demandes, ?status=pending
 * PATCH /api/table-change-requests/{id}/respond   (admin) accepter (table) / refuser
 * GET   /api/tables/occupied               (admin) tables occupées
 *
 * Traduit uniquement les exceptions du service en codes HTTP.
 */
class ClientController
{
    public function __construct(private AuthService $auth, private ClientService $service)
    {
    }

    public function register(string $rawBody): void
    {
        api_guard(function () use ($rawBody) {
            send_json(201, $this->auth->registerClient(RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function me(array $session): void
    {
        send_json(200, $this->service->profile((int) $session['client']['id']));
    }

    public function updateMe(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(200, $this->service->updateParty((int) $session['client']['id'], RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function applyTable(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(200, $this->service->applyTable((int) $session['client']['id'], RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function requestChange(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(201, $this->service->requestTableChange((int) $session['client']['id'], RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function mine(array $session): void
    {
        $profile = $this->service->profile((int) $session['client']['id']);
        send_json(200, ['tableRequest' => $profile['tableRequest'], 'tableNumber' => $profile['client']['tableNumber']]);
    }

    public function cancel($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            send_json(200, $this->service->cancelRequest((int) $session['client']['id'], RequestValidator::validateId($rawId)));
        });
    }

    public function index(array $query): void
    {
        api_guard(function () use ($query) {
            send_json(200, $this->service->listRequests($query));
        });
    }

    public function respond($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            $id = RequestValidator::validateId($rawId);
            send_json(200, $this->service->respond($session, $id, RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function occupied(): void
    {
        send_json(200, $this->service->occupiedTables());
    }
}
