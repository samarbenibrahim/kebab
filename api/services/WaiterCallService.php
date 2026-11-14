<?php
/**
 * Appels serveur : un client identifié appelle depuis SA table (celle de sa
 * session, pas celle du corps de la requête). Une seule demande en attente
 * par table — un second appel renvoie la demande déjà en attente au lieu
 * d'en empiler une nouvelle.
 */
class WaiterCallService
{
    public function __construct(private WaiterCallRepository $calls)
    {
    }

    /**
     * @param array $client ligne `clients` de la session
     */
    public function createCall(array $client, bool &$alreadyPending = false): array
    {
        $table = (string) $client['table_number'];
        $guest = trim($client['first_name'] . ' ' . $client['last_name']);

        $existing = $this->calls->findPendingByTable($table);
        if ($existing) {
            $alreadyPending = true;
            return $existing;
        }
        return $this->calls->findById($this->calls->insert($table, $guest, (int) $client['id']));
    }

    /**
     * @param string[]|null $tables null = toutes les tables (admin) ; sinon uniquement celles-ci (serveur)
     * @throws InvalidArgumentException 400
     */
    public function listCalls(array $query, ?array $tables = null): array
    {
        $status = null;
        if (isset($query['status'])) {
            if (!in_array($query['status'], ['pending', 'acknowledged'], true)) {
                throw new InvalidArgumentException("status invalide : pending ou acknowledged");
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
        return ['content' => $this->calls->findAll($status, $limit, $tables)];
    }

    public function getCall(int $id): ?array
    {
        return $this->calls->findById($id);
    }

    /**
     * Acquittement idempotent : deux membres du staff qui cliquent en même
     * temps obtiennent tous deux la demande acquittée.
     *
     * @throws NotFoundException 404
     */
    public function acknowledge(int $id, int $staffId): array
    {
        if (!$this->calls->findById($id)) {
            throw new NotFoundException("Appel introuvable");
        }
        $this->calls->acknowledge($id, $staffId);
        return $this->calls->findById($id);
    }
}
