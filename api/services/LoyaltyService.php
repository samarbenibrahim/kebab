<?php
/**
 * Fidélité. Un compte par numéro de téléphone (les clients de la salle sont
 * des sessions anonymes : le téléphone les relie d'une visite à l'autre).
 *
 * Règles (constantes ci-dessous, modifiables ici) :
 *  - gain : 1 point par € payé, multiplié par le palier (Bronze x1, Argent x1,25, Or x1,5),
 *    crédité quand la commande est PAYÉE ;
 *  - utilisation : 10 points = 1 € de remise, minimum 50 points, jamais plus de
 *    50 % du montant de la commande, déduits dès la création de la commande et
 *    restitués si elle est annulée.
 */
class LoyaltyService
{
    public const REDEEM_RATE = 10;
    public const MIN_REDEEM = 50;
    public const MAX_REDEEM_SHARE = 0.5;
    public const TIERS = [
        ['name' => 'Bronze', 'min' => 0, 'multiplier' => 1.0],
        ['name' => 'Argent', 'min' => 200, 'multiplier' => 1.25],
        ['name' => 'Or', 'min' => 500, 'multiplier' => 1.5],
    ];

    public function __construct(private PDO $pdo)
    {
    }

    /** Chiffres uniquement ; 8 chiffres = numéro tunisien (préfixe 216 ajouté) ; « 00 » initial retiré. */
    public static function normalizePhone(string $phone): string
    {
        $d = preg_replace('/\D+/', '', $phone);
        if (strpos($d, '00') === 0) {
            $d = substr($d, 2);
        }
        if (strlen($d) === 8) {
            $d = '216' . $d;
        }
        return $d;
    }

    public static function tierFor(int $lifetimePoints): array
    {
        $tier = self::TIERS[0];
        foreach (self::TIERS as $t) {
            if ($lifetimePoints >= $t['min']) {
                $tier = $t;
            }
        }
        return $tier;
    }

    public function findAccount(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM loyalty_accounts WHERE id = :id');
        $stmt->execute(['id' => $id]);
        return $stmt->fetch() ?: null;
    }

    /** Trouve ou crée le compte du téléphone et le lie au client. */
    public function linkClient(int $clientId, string $phone, string $name): void
    {
        $normalized = self::normalizePhone($phone);
        if (strlen($normalized) < 8) {
            return;
        }
        $this->pdo->prepare('INSERT IGNORE INTO loyalty_accounts (phone, name) VALUES (:p, :n)')
            ->execute(['p' => $normalized, 'n' => $name]);
        $stmt = $this->pdo->prepare('SELECT id FROM loyalty_accounts WHERE phone = :p');
        $stmt->execute(['p' => $normalized]);
        $accountId = $stmt->fetchColumn();
        if ($accountId) {
            $this->pdo->prepare('UPDATE clients SET loyalty_account_id = :a WHERE id = :c')
                ->execute(['a' => $accountId, 'c' => $clientId]);
        }
    }

    public function accountForClient(array $client): ?array
    {
        return empty($client['loyalty_account_id']) ? null : $this->findAccount((int) $client['loyalty_account_id']);
    }

    /** Vue publique d'un compte (téléphone masqué). */
    public function publicAccount(array $a): array
    {
        $tier = self::tierFor((int) $a['lifetime_points']);
        $next = null;
        foreach (self::TIERS as $t) {
            if ($t['min'] > (int) $a['lifetime_points']) {
                $next = $t;
                break;
            }
        }
        $digits = $a['phone'];
        return [
            'id' => (int) $a['id'],
            'name' => $a['name'],
            'phone' => '••••' . substr($digits, -3),
            'points' => (int) $a['points'],
            'lifetimePoints' => (int) $a['lifetime_points'],
            'tier' => $tier['name'],
            'tierMultiplier' => $tier['multiplier'],
            'nextTier' => $next ? $next['name'] : null,
            'pointsToNextTier' => $next ? $next['min'] - (int) $a['lifetime_points'] : 0,
            'redeemRate' => self::REDEEM_RATE,
            'minRedeem' => self::MIN_REDEEM,
            'maxRedeemShare' => self::MAX_REDEEM_SHARE,
            'redeemValue' => round(((int) $a['points']) / self::REDEEM_RATE, 3),
            'createdAt' => $a['created_at'],
        ];
    }

    public function history(int $accountId, int $limit = 20): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, order_id, points, type, note, created_at FROM loyalty_transactions WHERE account_id = :a ORDER BY id DESC LIMIT :l'
        );
        $stmt->bindValue(':a', $accountId, PDO::PARAM_INT);
        $stmt->bindValue(':l', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /** Profil fidélité du client connecté. */
    public function meForClient(array $client): array
    {
        $account = $this->accountForClient($client);
        if (!$account) {
            return ['enrolled' => false, 'message' => "Renseignez votre téléphone à l'identification pour gagner des points."];
        }
        return ['enrolled' => true, 'account' => $this->publicAccount($account), 'history' => $this->history((int) $account['id'])];
    }

    /**
     * Valide une demande d'utilisation de points sur une commande dont le
     * montant (après promotion) est $baseTotal.
     *
     * @return array{points:int, discount:float}
     * @throws InvalidArgumentException 400
     */
    public function quoteRedeem(?array $account, $requested, float $baseTotal): array
    {
        if ($requested === null || $requested === 0) {
            return ['points' => 0, 'discount' => 0.0];
        }
        if (!is_int($requested) || $requested < 0) {
            throw new InvalidArgumentException("redeemPoints doit être un entier positif");
        }
        if (!$account) {
            throw new InvalidArgumentException("Aucun compte fidélité : renseignez votre téléphone à l'identification");
        }
        if ($requested < self::MIN_REDEEM) {
            throw new InvalidArgumentException("Minimum " . self::MIN_REDEEM . " points à utiliser");
        }
        if ($requested % self::REDEEM_RATE !== 0) {
            throw new InvalidArgumentException("Les points s'utilisent par multiples de " . self::REDEEM_RATE);
        }
        if ($requested > (int) $account['points']) {
            throw new InvalidArgumentException("Solde insuffisant : " . (int) $account['points'] . " points disponibles");
        }
        $discount = round($requested / self::REDEEM_RATE, 3);
        $cap = floor($baseTotal * self::MAX_REDEEM_SHARE * 1000) / 1000;
        if ($discount > $cap) {
            $maxPoints = (int) floor($cap) * self::REDEEM_RATE;
            throw new InvalidArgumentException("Vous pouvez utiliser au maximum $maxPoints points sur cette commande (50 % du montant)");
        }
        return ['points' => $requested, 'discount' => $discount];
    }

    /** Déduit les points (à appeler dans la transaction de création de la commande). */
    public function redeem(int $accountId, int $orderId, int $points): void
    {
        $stmt = $this->pdo->prepare('UPDATE loyalty_accounts SET points = points - :p WHERE id = :id AND points >= :p2');
        $stmt->execute(['p' => $points, 'p2' => $points, 'id' => $accountId]);
        if ($stmt->rowCount() === 0) {
            throw new ConflictException("Solde de points insuffisant");
        }
        $this->tx($accountId, $orderId, -$points, 'redeem', 'Points utilisés sur la commande', null);
    }

    /** Restitue les points d'une commande annulée. */
    public function refund(array $order): void
    {
        $points = (int) ($order['loyalty_points_used'] ?? 0);
        if ($points <= 0 || empty($order['client_id'])) {
            return;
        }
        $accountId = $this->accountIdForClientId((int) $order['client_id']);
        if (!$accountId) {
            return;
        }
        $this->pdo->prepare('UPDATE loyalty_accounts SET points = points + :p WHERE id = :id')->execute(['p' => $points, 'id' => $accountId]);
        $this->tx($accountId, (int) $order['id'], $points, 'refund', 'Commande annulée : points restitués', null);
    }

    /** Crédite les points d'une commande payée (une seule fois par commande). */
    public function earn(array $order): int
    {
        if ((int) ($order['points_earned'] ?? 0) > 0 || empty($order['client_id'])) {
            return 0;
        }
        $accountId = $this->accountIdForClientId((int) $order['client_id']);
        $account = $accountId ? $this->findAccount($accountId) : null;
        if (!$account) {
            return 0;
        }
        $tier = self::tierFor((int) $account['lifetime_points']);
        $points = (int) floor(((float) $order['total']) * $tier['multiplier']);
        if ($points <= 0) {
            return 0;
        }
        $this->pdo->prepare('UPDATE loyalty_accounts SET points = points + :p, lifetime_points = lifetime_points + :p2 WHERE id = :id')
            ->execute(['p' => $points, 'p2' => $points, 'id' => $accountId]);
        $this->pdo->prepare('UPDATE orders SET points_earned = :p WHERE id = :id')->execute(['p' => $points, 'id' => $order['id']]);
        $this->tx($accountId, (int) $order['id'], $points, 'earn', 'Gain sur commande payée (palier ' . $tier['name'] . ')', null);
        return $points;
    }

    /** Ajustement manuel (permission loyalty.adjust) : le solde ne peut pas devenir négatif. */
    public function adjust(int $accountId, $points, $note, array $session): array
    {
        if (!is_int($points) || $points === 0 || abs($points) > 100000) {
            throw new InvalidArgumentException("points doit être un entier non nul (±100000 maximum)");
        }
        $note = RequestValidator::requiredText($note, 'note', 255);
        $account = $this->findAccount($accountId);
        if (!$account) {
            throw new NotFoundException("Compte fidélité introuvable");
        }
        if ((int) $account['points'] + $points < 0) {
            throw new ConflictException("Le solde ne peut pas devenir négatif (" . (int) $account['points'] . " points)");
        }
        $this->pdo->prepare('UPDATE loyalty_accounts SET points = points + :p WHERE id = :id')->execute(['p' => $points, 'id' => $accountId]);
        $this->tx($accountId, null, $points, 'adjust', $note, (int) $session['staff']['id']);
        Audit::log($this->pdo, $session, 'loyalty.adjust', 'loyalty_account', $accountId, ['points' => $points, 'note' => $note]);
        return $this->publicAccount($this->findAccount($accountId));
    }

    public function listAccounts(?string $q, int $limit): array
    {
        $sql = 'SELECT * FROM loyalty_accounts' . ($q !== null && $q !== '' ? ' WHERE name LIKE :q OR phone LIKE :q2' : '') . ' ORDER BY lifetime_points DESC, id ASC LIMIT :l';
        $stmt = $this->pdo->prepare($sql);
        if ($q !== null && $q !== '') {
            $stmt->bindValue(':q', '%' . $q . '%');
            $stmt->bindValue(':q2', '%' . preg_replace('/\D+/', '', $q) . '%');
        }
        $stmt->bindValue(':l', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return ['content' => array_map([$this, 'publicAccount'], $stmt->fetchAll())];
    }

    public function accountWithHistory(int $id): array
    {
        $a = $this->findAccount($id);
        if (!$a) {
            throw new NotFoundException("Compte fidélité introuvable");
        }
        return ['account' => $this->publicAccount($a), 'history' => $this->history($id, 50)];
    }

    // ---- interne ----

    private function accountIdForClientId(int $clientId): ?int
    {
        $stmt = $this->pdo->prepare('SELECT loyalty_account_id FROM clients WHERE id = :id');
        $stmt->execute(['id' => $clientId]);
        $v = $stmt->fetchColumn();
        return $v ? (int) $v : null;
    }

    private function tx(int $accountId, ?int $orderId, int $points, string $type, string $note, ?int $by): void
    {
        $this->pdo->prepare(
            'INSERT INTO loyalty_transactions (account_id, order_id, points, type, note, created_by) VALUES (:a, :o, :p, :t, :n, :b)'
        )->execute(['a' => $accountId, 'o' => $orderId, 'p' => $points, 't' => $type, 'n' => $note, 'b' => $by]);
    }
}
