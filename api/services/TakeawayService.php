<?php
/**
 * Demandes « à emporter » : un client qui a commandé au moins un café en
 * « Gobelet à emporter » prévient l'équipe ; l'équipe (permission
 * takeaway.respond) accepte ou refuse avec un message que le client voit sur
 * son suivi de commande. Même logique que les changements de table.
 */
class TakeawayService
{
    public const STATUSES = ['pending', 'accepted', 'declined', 'cancelled'];

    public function __construct(private PDO $pdo, private TakeawayRepository $repo)
    {
    }

    /**
     * @throws InvalidArgumentException 400 (commande sans gobelet, commande annulée)
     * @throws NotFoundException 404 (commande d'un autre client)
     * @throws ConflictException 409 (demande déjà en attente pour cette commande)
     */
    public function create(array $session, array $payload): array
    {
        $clientId = (int) $session['client']['id'];
        $orderId = $payload['orderId'] ?? null;
        if (!is_int($orderId) || $orderId < 1) {
            throw new InvalidArgumentException('orderId doit être un entier positif');
        }
        $message = RequestValidator::optionalText($payload['message'] ?? null, 'message', 255);

        $this->pdo->beginTransaction();
        try {
            $order = $this->repo->findOrder($orderId);
            // Commande d'un autre client : introuvable, sans rien révéler.
            if (!$order || (int) $order['client_id'] !== $clientId) {
                throw new NotFoundException('Commande introuvable');
            }
            if ($order['cancelled_at'] !== null) {
                throw new InvalidArgumentException('Cette commande a été annulée');
            }
            if (!$this->repo->takeawayItems($orderId)) {
                throw new InvalidArgumentException("Cette commande ne contient aucun café en gobelet à emporter");
            }
            // Verrou implicite par la transaction : un double clic ne crée qu'une demande.
            if ($this->repo->findPendingForOrder($orderId)) {
                throw new ConflictException("Une demande est déjà en attente de réponse de l'équipe");
            }
            $id = $this->repo->insert($clientId, $orderId, $message);
            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'takeaway.request', 'order', $orderId, ['message' => $message]);
        return $this->publicRequest($this->repo->findById($id));
    }

    public function mine(int $clientId): array
    {
        return ['content' => array_map(fn($r) => $this->publicRequest($r), $this->repo->listForClient($clientId))];
    }

    public function list(array $query): array
    {
        $status = $query['status'] ?? null;
        if ($status !== null && !in_array($status, self::STATUSES, true)) {
            throw new InvalidArgumentException('status invalide');
        }
        return ['content' => array_map(fn($r) => $this->publicRequest($r), $this->repo->listByStatus($status))];
    }

    /**
     * @throws NotFoundException 404
     * @throws ConflictException 409 (déjà traitée)
     */
    public function respond(array $session, int $id, array $payload): array
    {
        $decision = $payload['decision'] ?? null;
        if (!in_array($decision, ['accept', 'decline'], true)) {
            throw new InvalidArgumentException('decision doit valoir "accept" ou "decline"');
        }
        $message = RequestValidator::optionalText($payload['message'] ?? null, 'message', 255);

        $this->pdo->beginTransaction();
        try {
            $req = $this->repo->findById($id, true);
            if (!$req) {
                throw new NotFoundException('Demande introuvable');
            }
            if ($req['status'] !== 'pending') {
                throw new ConflictException('Cette demande a déjà reçu une réponse');
            }
            $this->repo->respond($id, $decision === 'accept' ? 'accepted' : 'declined', $message, (int) $session['staff']['id']);
            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'takeaway.respond', 'order', (int) $req['order_id'], ['decision' => $decision, 'message' => $message]);
        return $this->publicRequest($this->repo->findById($id));
    }

    /** @throws NotFoundException|ConflictException */
    public function cancel(int $clientId, int $id): array
    {
        $req = $this->repo->findById($id);
        if (!$req || (int) $req['client_id'] !== $clientId) {
            throw new NotFoundException('Demande introuvable');
        }
        if ($req['status'] !== 'pending') {
            throw new ConflictException('Cette demande a déjà reçu une réponse');
        }
        $this->repo->cancel($id);
        return $this->publicRequest($this->repo->findById($id));
    }

    private function publicRequest(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'orderId' => (int) $r['order_id'],
            'orderRef' => 'SOU-' . str_pad((string) $r['order_id'], 6, '0', STR_PAD_LEFT),
            'tableNumber' => (string) $r['table_number'],
            'guestName' => $r['guest_name'],
            'orderStatus' => $r['order_status'],
            'message' => $r['message'],
            'status' => $r['status'],
            'adminMessage' => $r['admin_message'],
            'responderName' => $r['responder_name'],
            'createdAt' => $r['created_at'],
            'respondedAt' => $r['responded_at'],
            'items' => array_map(static fn($i) => ['name' => $i['product_name'], 'quantity' => (int) $i['quantity']], $this->repo->takeawayItems((int) $r['order_id'])),
        ];
    }
}
