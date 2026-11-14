<?php
/**
 * POST  /api/waiter-calls                       (client identifié)
 * GET   /api/waiter-calls?status=pending        (admin : tout ; serveur : ses tables)
 * PATCH /api/waiter-calls/{id}/acknowledge      (admin, ou serveur pour ses tables)
 *
 * Traduit uniquement les exceptions du service en codes HTTP.
 */
class WaiterCallController
{
    public function __construct(private WaiterCallService $service, private PDO $pdo)
    {
    }

    public function create(array $session): void
    {
        $alreadyPending = false;
        $call = $this->service->createCall($session['client'], $alreadyPending);
        // 200 = une demande était déjà en attente pour cette table ; 201 = créée.
        send_json($alreadyPending ? 200 : 201, $call);
    }

    public function index(array $query, array $session): void
    {
        api_guard(function () use ($query, $session) {
            $tables = $session['role'] === 'server' ? Auth::serverTables($this->pdo, (int) $session['staff']['id']) : null;
            send_json(200, $this->service->listCalls($query, $tables));
        });
    }

    public function acknowledge($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $id = RequestValidator::validateId($rawId);
            $call = $this->service->getCall($id);
            // Un serveur ne peut acquitter que les appels de ses tables (sinon 404, sans rien révéler).
            if (!$call || !Auth::staffCanAccessTable($this->pdo, $session, (string) $call['table_number'])) {
                throw new NotFoundException("Appel introuvable");
            }
            send_json(200, $this->service->acknowledge($id, (int) $session['staff']['id']));
        });
    }
}
