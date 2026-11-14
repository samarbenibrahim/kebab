<?php
/**
 * Plan de salle et encaissement par table.
 *
 * GET    /api/tables                     tables.view (toutes) ou tables.view.own (serveur : les siennes)
 * POST   /api/tables                     tables.manage — ajouter une table {tableNumber, seats}
 * DELETE /api/tables/{n}                 tables.manage
 * POST   /api/tables/bill-request        client : demande l'addition de SA table
 * POST   /api/tables/{n}/bill            bill.request (serveur : ses tables) — addition demandée
 * PATCH  /api/tables/{n}/payment         payments.collect — encaisse TOUTES les commandes à régler {method}
 * POST   /api/tables/{n}/release         tables.release — fin de service (clients déconnectés, table à nettoyer)
 * POST   /api/tables/{n}/clean           tables.clean (serveur : ses tables) — table nettoyée, de nouveau libre
 */
class TableController
{
    public function __construct(private TableService $service, private OrderService $orders, private PDO $pdo)
    {
    }

    private function need(array $session, string $permission): void
    {
        if (!Auth::can($session, $permission)) {
            throw new ForbiddenException("Permission refusée pour votre rôle");
        }
    }

    /** Le serveur n'agit que sur ses tables (les autres rôles : toutes). */
    private function scope(array $session, string $table): void
    {
        if (!Auth::staffCanAccessTable($this->pdo, $session, $table)) {
            throw new NotFoundException("Table introuvable");
        }
    }

    public function index(array $session): void
    {
        api_guard(function () use ($session) {
            if (Auth::can($session, 'tables.view')) {
                $only = null;
            } else {
                $this->need($session, 'tables.view.own');
                $only = Auth::serverTables($this->pdo, (int) $session['staff']['id']);
            }
            send_json(200, $this->service->listTables($only));
        });
    }

    public function add(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            $this->need($session, 'tables.manage');
            $b = RequestValidator::parseJsonBody($rawBody);
            send_json(201, $this->service->addTable($b['tableNumber'] ?? null, $b['seats'] ?? null, $session));
        });
    }

    public function remove($table, array $session): void
    {
        api_guard(function () use ($table, $session) {
            $this->need($session, 'tables.manage');
            $this->service->removeTable(RequestValidator::tableNumber(rawurldecode((string) $table)), $session);
            send_json(200, ['ok' => true]);
        });
    }

    public function clientBill(array $session): void
    {
        api_guard(function () use ($session) {
            send_json(200, $this->service->requestBill((string) $session['client']['table_number'], $session));
        });
    }

    public function staffBill($table, array $session): void
    {
        api_guard(function () use ($table, $session) {
            $this->need($session, 'bill.request');
            $t = RequestValidator::tableNumber(rawurldecode((string) $table));
            $this->scope($session, $t);
            send_json(200, $this->service->requestBill($t, $session));
        });
    }

    public function release($table, array $session): void
    {
        api_guard(function () use ($table, $session) {
            $this->need($session, 'tables.release');
            send_json(200, $this->service->release(RequestValidator::tableNumber(rawurldecode((string) $table)), $session));
        });
    }

    public function clean($table, array $session): void
    {
        api_guard(function () use ($table, $session) {
            $this->need($session, 'tables.clean');
            $t = RequestValidator::tableNumber(rawurldecode((string) $table));
            $this->scope($session, $t);
            send_json(200, $this->service->clean($t, $session));
        });
    }

    /** Encaisse d'un coup toutes les commandes non payées de la table (transaction unique : tout ou rien). */
    public function payTable($table, string $rawBody, array $session): void
    {
        api_guard(function () use ($table, $rawBody, $session) {
            $this->need($session, 'payments.collect');
            $t = RequestValidator::tableNumber(rawurldecode((string) $table));
            $method = RequestValidator::validatePaymentPayload(RequestValidator::parseJsonBody($rawBody));
            $stmt = $this->pdo->prepare("SELECT id FROM orders WHERE table_number = :t AND cancelled_at IS NULL AND payment_status = 'pending' ORDER BY id");
            $stmt->execute(['t' => $t]);
            $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
            if (!$ids) {
                throw new ConflictException("Aucune commande à encaisser sur cette table");
            }
            $this->pdo->beginTransaction();
            try {
                foreach ($ids as $id) {
                    $this->orders->payOrder((int) $id, $method, $session);
                }
                $this->pdo->commit();
            } catch (Throwable $e) {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->rollBack();
                }
                throw $e;
            }
            Audit::log($this->pdo, $session, 'table.payment', 'table', $t, ['methode' => $method, 'commandes' => count($ids)]);
            $list = $this->service->listTables([$t])['content'];
            send_json(200, ['paidOrders' => count($ids), 'table' => $list[0] ?? null]);
        });
    }
}
