<?php
/**
 * Espace client : profil et demandes de changement de table. Un client ne
 * change JAMAIS de table seul : il prévient l'administration (demande), qui
 * répond par une table disponible ; le client applique ensuite exactement
 * cette table.
 */
class ClientService
{
    public function __construct(private PDO $pdo, private ClientRepository $clients, private ?TableService $tables = null)
    {
    }

    public static function publicClient(array $c): array
    {
        return [
            'id' => (int) $c['id'],
            'firstName' => $c['first_name'],
            'lastName' => $c['last_name'],
            'phone' => $c['phone'],
            'tableNumber' => $c['table_number'],
            'partySize' => (int) $c['party_size'],
            'createdAt' => $c['created_at'],
        ];
    }

    public static function publicRequest(array $r): array
    {
        $out = [
            'id' => (int) $r['id'],
            'clientId' => (int) $r['client_id'],
            'fromTable' => $r['from_table'],
            'requestedTable' => $r['requested_table'],
            'reason' => $r['reason'],
            'status' => $r['status'],
            'approvedTable' => $r['approved_table'],
            'adminMessage' => $r['admin_message'],
            'createdAt' => $r['created_at'],
            'respondedAt' => $r['responded_at'],
            'appliedAt' => $r['applied_at'],
        ];
        if (isset($r['first_name'])) {
            $out['clientName'] = $r['first_name'] . ' ' . $r['last_name'];
            $out['currentTable'] = $r['current_table'];
            $out['partySize'] = (int) $r['party_size'];
        }
        return $out;
    }

    /** Profil + dernière demande de changement de table. */
    public function profile(int $clientId): array
    {
        $client = $this->clients->findById($clientId);
        $latest = $this->clients->findLatestRequestOf($clientId);
        return [
            'client' => self::publicClient($client),
            'tableRequest' => $latest ? self::publicRequest($latest) : null,
        ];
    }

    /**
     * @throws InvalidArgumentException 400
     */
    public function updateParty(int $clientId, array $payload): array
    {
        $this->clients->updateParty($clientId, RequestValidator::partySize($payload['partySize'] ?? null));
        return $this->profile($clientId);
    }

    /**
     * @throws InvalidArgumentException 400
     * @throws ConflictException 409 — une demande est déjà en attente
     */
    public function requestTableChange(int $clientId, array $payload): array
    {
        $requested = null;
        if (isset($payload['requestedTable']) && $payload['requestedTable'] !== '') {
            $requested = RequestValidator::tableNumber($payload['requestedTable'], 'requestedTable');
        }
        $reason = RequestValidator::optionalText($payload['reason'] ?? null, 'reason', 255);

        $this->pdo->beginTransaction();
        try {
            // Verrou sur la ligne du client : deux clics simultanés ne créent qu'une demande.
            $client = $this->clients->findById($clientId, true);
            if ($requested !== null && $requested === $client['table_number']) {
                throw new InvalidArgumentException("C'est déjà votre table actuelle");
            }
            if ($this->clients->findLatestRequestOf($clientId, 'pending')) {
                throw new ConflictException("Une demande est déjà en attente de réponse de l'administration");
            }
            $id = $this->clients->insertRequest($clientId, $client['table_number'], $requested, $reason);
            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        return self::publicRequest($this->clients->findRequestById($id));
    }

    /**
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function cancelRequest(int $clientId, int $requestId): array
    {
        $req = $this->clients->findRequestById($requestId);
        if (!$req || (int) $req['client_id'] !== $clientId) {
            throw new NotFoundException("Demande introuvable");
        }
        if ($req['status'] !== 'pending') {
            throw new ConflictException("Cette demande a déjà reçu une réponse et ne peut plus être annulée");
        }
        $this->clients->setRequestStatus($requestId, 'cancelled');
        return self::publicRequest($this->clients->findRequestById($requestId));
    }

    /**
     * @throws InvalidArgumentException 400
     */
    public function listRequests(array $query): array
    {
        $status = null;
        if (isset($query['status'])) {
            if (!in_array($query['status'], ['pending', 'approved', 'rejected', 'applied', 'cancelled'], true)) {
                throw new InvalidArgumentException("status invalide");
            }
            $status = $query['status'];
        }
        $limit = 50;
        if (isset($query['limit'])) {
            if (!ctype_digit((string) $query['limit']) || (int) $query['limit'] < 1 || (int) $query['limit'] > 100) {
                throw new InvalidArgumentException("limit doit être compris entre 1 et 100");
            }
            $limit = (int) $query['limit'];
        }
        return ['content' => array_map([self::class, 'publicRequest'], $this->clients->listRequests($status, $limit))];
    }

    /**
     * Réponse de l'admin : accepter en désignant la table disponible, ou refuser.
     *
     * @throws InvalidArgumentException 400
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function respond(array $session, int $requestId, array $payload): array
    {
        $decision = $payload['decision'] ?? null;
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new InvalidArgumentException("decision doit être approve ou reject");
        }
        $message = RequestValidator::optionalText($payload['message'] ?? null, 'message', 255);
        $table = null;
        if ($decision === 'approve') {
            $table = RequestValidator::tableNumber($payload['tableNumber'] ?? null);
        }

        $this->pdo->beginTransaction();
        try {
            $req = $this->clients->findRequestById($requestId, true);
            if (!$req) {
                throw new NotFoundException("Demande introuvable");
            }
            if ($req['status'] !== 'pending') {
                throw new ConflictException("Cette demande a déjà reçu une réponse");
            }
            if ($decision === 'approve') {
                $client = $this->clients->findById((int) $req['client_id']);
                if ($client && $client['table_number'] === $table) {
                    throw new InvalidArgumentException("C'est déjà la table actuelle du client");
                }
            }
            $this->clients->respond(
                $requestId,
                $decision === 'approve' ? 'approved' : 'rejected',
                $table,
                $message,
                (int) $session['staff']['id']
            );
            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'table_request.respond', 'table_request', $requestId, ['decision' => $decision, 'table' => $table, 'message' => $message]);
        return self::publicRequest($this->clients->findRequestById($requestId));
    }

    /**
     * Le client applique la table que l'admin lui a attribuée. Toute autre
     * valeur est refusée : impossible de choisir sa table sans accord.
     *
     * @throws InvalidArgumentException 400
     * @throws ConflictException 409
     */
    public function applyTable(int $clientId, array $payload): array
    {
        $table = RequestValidator::tableNumber($payload['tableNumber'] ?? null);

        $this->pdo->beginTransaction();
        try {
            $client = $this->clients->findById($clientId, true);
            $latest = $this->clients->findLatestRequestOf($clientId);
            if (!$latest || $latest['status'] !== 'approved') {
                throw new ConflictException("Aucun changement de table n'a été accepté par l'administration");
            }
            if ($table !== $latest['approved_table']) {
                throw new ConflictException("L'administration vous a attribué la table " . $latest['approved_table']);
            }
            $this->clients->updateTable($clientId, $table);
            if ($this->tables) {
                $this->tables->ensureExists($table);
            }
            $this->clients->moveActiveRecords($clientId, $table);
            $this->clients->setRequestStatus((int) $latest['id'], 'applied');
            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        Audit::log($this->pdo, null, 'client.table_change', 'client', $clientId, ['de' => $client['table_number'], 'vers' => $table], ['type' => 'client', 'id' => $clientId, 'name' => $client['first_name'] . ' ' . $client['last_name'], 'role' => 'client']);
        return $this->profile($clientId);
    }

    public function occupiedTables(): array
    {
        return ['content' => $this->clients->occupiedTables()];
    }
}
