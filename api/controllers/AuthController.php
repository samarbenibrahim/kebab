<?php
/**
 * POST /api/auth/login            connexion du personnel (admin / serveur)
 * POST /api/auth/logout           fin de session (tout rôle)
 * GET  /api/auth/me               identité de la session courante
 *
 * Gestion des comptes (admin) :
 * GET    /api/staff               liste des comptes
 * POST   /api/staff               créer un serveur
 * PATCH  /api/staff/{id}          modifier (nom, mot de passe, actif)
 * DELETE /api/staff/{id}          supprimer un serveur
 * PUT    /api/staff/{id}/tables   définir les tables d'un serveur (admin)
 *
 * Tables servies (serveur connecté) :
 * GET/PUT /api/staff/me/tables
 *
 * Traduit uniquement les exceptions du service en codes HTTP.
 */
class AuthController
{
    public function __construct(private AuthService $service)
    {
    }

    public function login(string $rawBody): void
    {
        api_guard(function () use ($rawBody) {
            send_json(200, $this->service->loginStaff(RequestValidator::parseJsonBody($rawBody)));
        });
    }

    public function logout(array $session): void
    {
        api_guard(function () use ($session) {
            $this->service->logout($session);
            send_json(200, ['ok' => true]);
        });
    }

    public function me(array $session): void
    {
        send_json(200, $this->service->me($session));
    }

    public function staffIndex(): void
    {
        send_json(200, $this->service->listStaff());
    }

    public function staffCreate(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(201, $this->service->createStaff(RequestValidator::parseJsonBody($rawBody), $session));
        });
    }

    public function staffUpdate($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            $id = RequestValidator::validateId($rawId);
            send_json(200, $this->service->updateStaff($id, RequestValidator::parseJsonBody($rawBody), $session));
        });
    }

    public function staffDelete($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $this->service->deleteStaff(RequestValidator::validateId($rawId), $session);
            send_json(200, ['ok' => true]);
        });
    }

    public function staffSetTables($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            $id = RequestValidator::validateId($rawId);
            $body = RequestValidator::parseJsonBody($rawBody);
            send_json(200, $this->service->setServerTables($id, $body['tables'] ?? null, false, $session));
        });
    }

    public function myTables(array $session): void
    {
        send_json(200, $this->service->getServerTables((int) $session['staff']['id']));
    }

    public function setMyTables(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            $body = RequestValidator::parseJsonBody($rawBody);
            send_json(200, $this->service->setServerTables((int) $session['staff']['id'], $body['tables'] ?? null, true, $session));
        });
    }
}
