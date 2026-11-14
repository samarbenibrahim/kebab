<?php
/**
 * Gestion intelligente des tables. Le statut est DÉRIVÉ (jamais saisi à la main) :
 *
 *   free      Libre                     personne, aucune commande à régler
 *   occupied  Occupée                   client connecté ou commande servie non payée
 *   preparing Commande en préparation   au moins une commande Nouvelle / En préparation / Prête
 *   bill      Addition demandée         demandée par le client ou le personnel
 *   cleaning  À nettoyer                table libérée après paiement, pas encore nettoyée
 *
 * Priorité en cas de cumul : addition > préparation > occupée > à nettoyer > libre.
 */
class TableService
{
    public const LABELS = [
        'free' => 'Libre', 'occupied' => 'Occupée', 'preparing' => 'Commande en préparation',
        'bill' => 'Addition demandée', 'cleaning' => 'À nettoyer',
    ];

    public function __construct(private PDO $pdo)
    {
    }

    /** Numéro affiché « Table 01 » pour les numéros purement numériques. */
    public static function displayName(string $n): string
    {
        return 'Table ' . (ctype_digit($n) && strlen($n) < 2 ? '0' . $n : $n);
    }

    /** Ajoute une table inconnue au plan (clients qui s'installent à une table non déclarée). */
    public function ensureExists(string $table): void
    {
        $this->pdo->prepare('INSERT IGNORE INTO restaurant_tables (table_number) VALUES (:t)')->execute(['t' => $table]);
    }

    /**
     * @param string[]|null $onlyTables null = toutes ; sinon uniquement celles-ci (serveur)
     */
    public function listTables(?array $onlyTables = null): array
    {
        $defined = [];
        foreach ($this->pdo->query('SELECT * FROM restaurant_tables')->fetchAll() as $r) {
            $defined[$r['table_number']] = $r;
        }
        $clients = $this->pdo->query(
            'SELECT c.table_number, COUNT(DISTINCT c.id) AS n FROM clients c
             JOIN auth_sessions s ON s.client_id = c.id AND s.expires_at > NOW() GROUP BY c.table_number'
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        $orders = [];
        foreach ($this->pdo->query(
            "SELECT table_number,
                    SUM(status IN ('Nouvelle','En préparation','Prête')) AS active,
                    SUM(status = 'Prête') AS ready,
                    SUM(payment_status = 'pending') AS unpaid,
                    COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN total END), 0) AS unpaid_total,
                    MIN(created_at) AS since
             FROM orders WHERE cancelled_at IS NULL AND (payment_status = 'pending' OR status <> 'Servie')
             GROUP BY table_number"
        )->fetchAll() as $r) {
            $orders[$r['table_number']] = $r;
        }
        $servers = $this->pdo->query(
            'SELECT t.table_number, s.display_name FROM server_tables t JOIN staff s ON s.id = t.staff_id'
        )->fetchAll(PDO::FETCH_KEY_PAIR);

        $numbers = array_unique(array_merge(array_keys($defined), array_keys($clients), array_keys($orders)));
        usort($numbers, fn($a, $b) => strnatcmp((string) $a, (string) $b));

        $out = [];
        foreach ($numbers as $n) {
            $n = (string) $n;
            if ($onlyTables !== null && !in_array($n, $onlyTables, true)) {
                continue;
            }
            $d = $defined[$n] ?? null;
            $o = $orders[$n] ?? null;
            $clientCount = (int) ($clients[$n] ?? 0);
            $active = $o ? (int) $o['active'] : 0;
            $unpaid = $o ? (int) $o['unpaid'] : 0;
            $bill = $d && $d['bill_requested_at'] !== null;
            $cleaning = $d && (int) $d['needs_cleaning'] === 1;

            if ($bill) {
                $status = 'bill';
            } elseif ($active > 0) {
                $status = 'preparing';
            } elseif ($clientCount > 0 || $unpaid > 0) {
                $status = 'occupied';
            } elseif ($cleaning) {
                $status = 'cleaning';
            } else {
                $status = 'free';
            }
            $out[] = [
                'tableNumber' => $n,
                'name' => self::displayName($n),
                'seats' => $d && $d['seats'] !== null ? (int) $d['seats'] : null,
                'defined' => $d !== null,
                'status' => $status,
                'statusLabel' => self::LABELS[$status],
                'clients' => $clientCount,
                'activeOrders' => $active,
                'readyOrders' => $o ? (int) $o['ready'] : 0,
                'unpaidOrders' => $unpaid,
                'unpaidTotal' => $o ? round((float) $o['unpaid_total'], 3) : 0.0,
                'occupiedSince' => $o ? $o['since'] : null,
                'billRequestedAt' => $d ? $d['bill_requested_at'] : null,
                'needsCleaning' => $cleaning,
                'server' => $servers[$n] ?? null,
            ];
        }
        return ['content' => $out];
    }

    private function find(string $table): array
    {
        foreach ($this->listTables()['content'] as $t) {
            if ($t['tableNumber'] === $table) {
                return $t;
            }
        }
        throw new NotFoundException("Table introuvable");
    }

    // ---- Plan de salle (tables.manage) ----

    public function addTable($number, $seats, array $session): array
    {
        $n = RequestValidator::tableNumber($number);
        $s = null;
        if ($seats !== null && $seats !== '') {
            if (!is_int($seats) || $seats < 1 || $seats > 50) {
                throw new InvalidArgumentException("seats doit être un entier entre 1 et 50");
            }
            $s = $seats;
        }
        $stmt = $this->pdo->prepare('INSERT IGNORE INTO restaurant_tables (table_number, seats) VALUES (:t, :s)');
        $stmt->execute(['t' => $n, 's' => $s]);
        if ($stmt->rowCount() === 0) {
            throw new ConflictException("La table $n existe déjà");
        }
        Audit::log($this->pdo, $session, 'table.create', 'table', $n, ['seats' => $s]);
        return $this->find($n);
    }

    public function removeTable(string $table, array $session): void
    {
        $t = $this->find($table);
        if ($t['status'] !== 'free' && $t['status'] !== 'cleaning') {
            throw new ConflictException("Impossible de supprimer une table " . mb_strtolower($t['statusLabel']));
        }
        $this->pdo->prepare('DELETE FROM restaurant_tables WHERE table_number = :t')->execute(['t' => $table]);
        Audit::log($this->pdo, $session, 'table.delete', 'table', $table);
    }

    // ---- Addition ----

    /** Le client ou le personnel demande l'addition (il faut au moins une commande à régler). */
    public function requestBill(string $table, array $session): array
    {
        if ($session['role'] !== 'client' && !Auth::can($session, 'bill.request')) {
            throw new ForbiddenException("Permission refusée pour votre rôle");
        }
        $t = $this->find($table);
        if ($t['unpaidOrders'] === 0) {
            throw new ConflictException("Aucune commande à régler sur cette table");
        }
        $this->ensureExists($table);
        $this->pdo->prepare('UPDATE restaurant_tables SET bill_requested_at = COALESCE(bill_requested_at, NOW()) WHERE table_number = :t')->execute(['t' => $table]);
        Audit::log($this->pdo, $session, 'table.bill_requested', 'table', $table, ['montant' => $t['unpaidTotal']]);
        return $this->find($table);
    }

    /** Appelé après chaque encaissement : plus rien à régler => l'addition n'est plus « demandée ». */
    public function onPayment(string $table): void
    {
        $stmt = $this->pdo->prepare("SELECT COUNT(*) FROM orders WHERE table_number = :t AND cancelled_at IS NULL AND payment_status = 'pending'");
        $stmt->execute(['t' => $table]);
        if ((int) $stmt->fetchColumn() === 0) {
            $this->pdo->prepare('UPDATE restaurant_tables SET bill_requested_at = NULL WHERE table_number = :t')->execute(['t' => $table]);
        }
    }

    // ---- Fin de service ----

    /**
     * Libère la table : tout est servi ET payé. Les clients installés sont
     * déconnectés (leurs sessions se ferment) et la table passe « À nettoyer ».
     */
    public function release(string $table, array $session): array
    {
        $t = $this->find($table);
        if ($t['activeOrders'] > 0) {
            throw new ConflictException("Des commandes sont encore en cours sur cette table");
        }
        if ($t['unpaidOrders'] > 0) {
            throw new ConflictException("Il reste " . number_format($t['unpaidTotal'], 2, ',', '') . " € à encaisser sur cette table");
        }
        $this->ensureExists($table);
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('UPDATE restaurant_tables SET needs_cleaning = 1, bill_requested_at = NULL WHERE table_number = :t')->execute(['t' => $table]);
            $this->pdo->prepare(
                'DELETE FROM auth_sessions WHERE client_id IN (SELECT id FROM clients WHERE table_number = :t)'
            )->execute(['t' => $table]);
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        Audit::log($this->pdo, $session, 'table.release', 'table', $table);
        return $this->find($table);
    }

    public function clean(string $table, array $session): array
    {
        $t = $this->find($table);
        if (!$t['needsCleaning']) {
            throw new ConflictException("Cette table n'est pas à nettoyer");
        }
        $this->pdo->prepare('UPDATE restaurant_tables SET needs_cleaning = 0 WHERE table_number = :t')->execute(['t' => $table]);
        Audit::log($this->pdo, $session, 'table.clean', 'table', $table);
        return $this->find($table);
    }
}
