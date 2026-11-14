<?php
/**
 * Toute la logique métier des commandes : validation, vérification
 * produits/options/contraintes de groupe, calcul du prix serveur (promotions
 * et points de fidélité compris), création transactionnelle, transitions de
 * statut, encaissement. Le contrôleur ne fait que traduire les exceptions en
 * codes HTTP — aucune règle métier n'y vit.
 *
 * Règle absolue : le prix/total envoyé par le frontend n'est JAMAIS lu ni
 * utilisé. Seuls productId, quantity, options[].optionId, note et
 * redeemPoints sont pris en compte ; tout le reste du payload est ignoré.
 */
class OrderService
{
    // Séquence stricte, à sens unique : un statut ne peut avancer que vers le
    // suivant, jamais reculer ni sauter une étape.
    private const STATUSES = ['Nouvelle', 'En préparation', 'Prête', 'Servie'];
    private const ALLOWED_TRANSITIONS = [
        'Nouvelle' => 'En préparation',
        'En préparation' => 'Prête',
        'Prête' => 'Servie',
        'Servie' => null, // terminal
    ];

    public function __construct(
        private PDO $pdo,
        private ProductService $products,
        private OrderRepository $orders,
        private ?PromotionService $promotions = null,
        private ?LoyaltyService $loyalty = null,
        private ?TableService $tables = null
    ) {
    }

    /**
     * Valide la commande et calcule TOUT côté serveur (articles, promotion,
     * points de fidélité, total). Sert à la fois à la création et à l'aperçu
     * affiché au client avant qu'il confirme.
     *
     * @return array{guestName:string, tableNumber:string, partySize:int, clientId:?int, note:?string, items:array,
     *               subtotal:float, discount:float, promotion:?array, loyaltyPoints:int, loyaltyDiscount:float,
     *               total:float, account:?array}
     * @throws InvalidArgumentException 400
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function priceOrder(array $payload, ?array $client = null): array
    {
        $clientId = null;
        if ($client !== null) {
            // Client identifié : identité, table et nombre de personnes viennent du
            // SERVEUR (sa session), jamais du corps de la requête.
            $clientId = (int) $client['id'];
            $guestName = trim($client['first_name'] . ' ' . $client['last_name']);
            $tableNumber = (string) $client['table_number'];
            $partySize = (int) $client['party_size'];
        } else {
            $guestName = $this->validateGuestName($payload['guestName'] ?? null);
            $tableNumber = $this->validateTableNumber($payload['tableNumber'] ?? null);
            $partySize = $this->validatePartySize($payload['partySize'] ?? 1);
        }

        $orderNote = $payload['note'] ?? null;
        if ($orderNote !== null) {
            if (!is_string($orderNote)) {
                throw new InvalidArgumentException("note doit être une chaîne de caractères");
            }
            $orderNote = trim($orderNote);
            if (mb_strlen($orderNote) > 255) {
                throw new InvalidArgumentException("note trop longue (max 255 caractères)");
            }
            if ($orderNote === '') {
                $orderNote = null;
            }
        }

        if (!isset($payload['items']) || !is_array($payload['items']) || count($payload['items']) === 0) {
            throw new InvalidArgumentException("items doit être un tableau non vide");
        }
        $items = [];
        $subtotal = 0.0;
        foreach ($payload['items'] as $index => $rawItem) {
            if (!is_array($rawItem)) {
                throw new InvalidArgumentException("items[$index] doit être un objet");
            }
            $items[] = $this->validateAndPriceItem($rawItem, $index);
        }
        foreach ($items as $item) {
            $subtotal += $item['lineTotal'];
        }
        $subtotal = round($subtotal, 3);

        // ---- Promotion automatique (la plus avantageuse) ----
        $promotion = null;
        $discount = 0.0;
        if ($this->promotions) {
            $ev = $this->promotions->evaluate($items, $subtotal);
            $promotion = $ev['promotion'];
            $discount = $ev['discount'];
        }
        $afterPromo = round($subtotal - $discount, 3);

        // ---- Points de fidélité (facultatif) ----
        $account = ($client !== null && $this->loyalty) ? $this->loyalty->accountForClient($client) : null;
        $redeem = $this->loyalty
            ? $this->loyalty->quoteRedeem($account, $payload['redeemPoints'] ?? null, $afterPromo)
            : ['points' => 0, 'discount' => 0.0];

        return [
            'guestName' => $guestName, 'tableNumber' => $tableNumber, 'partySize' => $partySize, 'clientId' => $clientId,
            'note' => $orderNote, 'items' => $items, 'subtotal' => $subtotal,
            'discount' => $discount, 'promotion' => $promotion,
            'loyaltyPoints' => $redeem['points'], 'loyaltyDiscount' => $redeem['discount'],
            'total' => round($afterPromo - $redeem['discount'], 3), 'account' => $account,
        ];
    }

    /** Aperçu (rien n'est enregistré) : montants, promotion, points utilisables, attente estimée. */
    public function previewOrder(array $payload, array $client): array
    {
        $p = $this->priceOrder($payload, $client);
        $qty = array_sum(array_column($p['items'], 'quantity'));
        $wait = (new WaitingTimeService($this->pdo))->estimateNew((int) $qty);
        $account = $p['account'];
        return [
            'items' => array_map(fn($i) => [
                'productId' => $i['productId'], 'name' => $i['productName'], 'quantity' => $i['quantity'],
                'unitPrice' => $i['unitPrice'], 'lineTotal' => $i['lineTotal'],
            ], $p['items']),
            'subtotal' => $p['subtotal'],
            'promotion' => $p['promotion'] ? ['id' => (int) $p['promotion']['id'], 'name' => $p['promotion']['name'], 'amount' => $p['discount']] : null,
            'discount' => $p['discount'],
            'loyaltyPointsUsed' => $p['loyaltyPoints'],
            'loyaltyDiscount' => $p['loyaltyDiscount'],
            'total' => $p['total'],
            'loyalty' => $account ? [
                'points' => (int) $account['points'],
                'estimatedEarn' => (int) floor($p['total'] * LoyaltyService::tierFor((int) $account['lifetime_points'])['multiplier']),
                'maxRedeemPoints' => (int) floor(floor(($p['subtotal'] - $p['discount']) * LoyaltyService::MAX_REDEEM_SHARE)) * LoyaltyService::REDEEM_RATE,
            ] : null,
            'waiting' => $wait,
        ];
    }

    /**
     * @throws InvalidArgumentException 400 — payload invalide
     * @throws NotFoundException 404 — produit introuvable
     * @throws ConflictException 409 — produit indisponible
     */
    public function createOrder(array $payload, ?string $idempotencyKey = null, bool &$replayed = false, ?array $client = null, ?array $session = null): array
    {
        if ($idempotencyKey !== null && !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $idempotencyKey)) {
            throw new InvalidArgumentException("Idempotency-Key invalide (8 à 64 caractères : lettres, chiffres, - et _)");
        }
        $p = $this->priceOrder($payload, $client);

        // ---- Idempotence : même clé + même contenu => la commande déjà créée ----
        $hash = null;
        if ($idempotencyKey !== null) {
            $hash = hash('sha256', json_encode([
                $p['clientId'], $p['guestName'], $p['tableNumber'], $p['partySize'], $p['note'], $p['loyaltyPoints'],
                array_map(function ($i) {
                    $ids = array_column($i['options'], 'id');
                    sort($ids);
                    return [$i['productId'], $i['quantity'], $ids, $i['note']];
                }, $p['items']),
            ], JSON_UNESCAPED_UNICODE));
            $existing = $this->orders->findByIdempotencyKey($idempotencyKey);
            if ($existing) {
                return $this->replayOrder($existing, $hash, $replayed);
            }
        }

        // ---- Écriture transactionnelle : tout ou rien (§13) ----
        $this->pdo->beginTransaction();
        try {
            $orderId = $this->orders->insertOrder(
                $p['guestName'], $p['tableNumber'], $p['partySize'], $p['subtotal'], $p['total'],
                $idempotencyKey, $hash, $p['note'], $p['clientId']
            );
            $this->orders->insertStatusHistory($orderId, null, 'Nouvelle');

            foreach ($p['items'] as $item) {
                $orderItemId = $this->orders->insertOrderItem(
                    $orderId, $item['productId'], $item['productName'],
                    $item['unitPrice'], $item['quantity'], $item['lineTotal'], $item['note']
                );
                foreach ($item['options'] as $opt) {
                    $this->orders->insertOrderItemOption($orderItemId, $opt['id'], $opt['label'], $opt['priceDelta']);
                }
            }

            $this->orders->setDiscounts(
                $orderId, $p['discount'], $p['promotion'] ? (int) $p['promotion']['id'] : null,
                $p['promotion']['name'] ?? null, $p['loyaltyPoints'], $p['loyaltyDiscount']
            );
            if ($p['loyaltyPoints'] > 0 && $p['account']) {
                $this->loyalty->redeem((int) $p['account']['id'], $orderId, $p['loyaltyPoints']);
            }
            if ($this->tables) {
                $this->tables->ensureExists($p['tableNumber']);
            }
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            // Deux requêtes simultanées avec la même clé : la contrainte UNIQUE
            // en a refusé une — on renvoie la commande déjà créée par l'autre.
            if ($idempotencyKey !== null && $e instanceof PDOException && ($e->errorInfo[1] ?? null) === 1062) {
                $existing = $this->orders->findByIdempotencyKey($idempotencyKey);
                if ($existing) {
                    return $this->replayOrder($existing, $hash, $replayed);
                }
            }
            throw $e;
        }

        Audit::log($this->pdo, $session, 'order.create', 'order', $orderId, [
            'table' => $p['tableNumber'], 'total' => $p['total'], 'promotion' => $p['promotion']['name'] ?? null,
            'remise' => $p['discount'], 'pointsUtilises' => $p['loyaltyPoints'],
        ]);
        return $this->orders->findById($orderId);
    }

    private function replayOrder(array $existing, string $hash, bool &$replayed): array
    {
        if ($existing['idempotency_hash'] !== $hash) {
            throw new ConflictException("Cette clé d'idempotence a déjà été utilisée pour une commande différente");
        }
        $replayed = true;
        return $this->orders->findById((int) $existing['id']);
    }

    public function getOrder(int $id): ?array
    {
        return $this->orders->findById($id);
    }

    public function listOrders(array $filters): array
    {
        $result = $this->orders->findAll($filters);
        return [
            'content' => $result['items'],
            'page' => $filters['page'],
            'size' => $filters['limit'],
            'totalElements' => $result['total'],
        ];
    }

    /** Estimation du temps d'attente d'une commande (Smart Waiting Time). */
    public function waitingTime(array $order): array
    {
        return (new WaitingTimeService($this->pdo))->estimateOrder($order);
    }

    /**
     * @throws NotFoundException 404
     * @throws InvalidArgumentException 400 — statut inconnu
     * @throws ConflictException 409 — transition non autorisée
     */
    public function updateStatus(int $id, string $newStatus, ?array $session = null): array
    {
        $order = $this->orders->findOrderRow($id);
        if (!$order) {
            throw new NotFoundException("Commande introuvable");
        }
        if (!in_array($newStatus, self::STATUSES, true)) {
            throw new InvalidArgumentException("Statut inconnu : $newStatus");
        }
        if ($order['cancelled_at'] !== null) {
            throw new ConflictException("Cette commande a été annulée");
        }
        $currentStatus = $order['status'];
        $expectedNext = self::ALLOWED_TRANSITIONS[$currentStatus] ?? null;
        if ($expectedNext === null || $newStatus !== $expectedNext) {
            throw new ConflictException(
                "Transition non autorisée : '$currentStatus' → '$newStatus' " .
                "(seule transition valide depuis '$currentStatus' : " . ($expectedNext ?? 'aucune, statut terminal') . ')'
            );
        }

        $by = $session && $session['role'] !== 'client' ? $session['staff']['display_name'] : null;
        $this->pdo->beginTransaction();
        try {
            $this->orders->updateStatus($id, $newStatus);
            $this->orders->insertStatusHistory($id, $currentStatus, $newStatus, $by);
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        Audit::log($this->pdo, $session, 'order.status', 'order', $id, ['table' => $order['table_number'], 'de' => $currentStatus, 'vers' => $newStatus]);
        return $this->orders->findById($id);
    }

    /**
     * Encaissement : espèces, carte (personnel) ou en ligne (client). Crédite
     * les points de fidélité et met à jour l'état de la table.
     *
     * @throws NotFoundException 404
     * @throws ConflictException 409 — déjà payée / annulée
     */
    public function payOrder(int $id, string $method, ?array $session = null): array
    {
        $order = $this->orders->findOrderRow($id);
        if (!$order) {
            throw new NotFoundException("Commande introuvable");
        }
        if ($order['cancelled_at'] !== null) {
            throw new ConflictException("Cette commande a été annulée");
        }
        if ($order['payment_status'] === 'paid') {
            throw new ConflictException("Cette commande est déjà payée");
        }

        $ownTx = !$this->pdo->inTransaction();
        if ($ownTx) {
            $this->pdo->beginTransaction();
        }
        try {
            $paidBy = $session && $session['role'] !== 'client' ? (int) $session['staff']['id'] : null;
            $this->orders->markPaid($id, $method, $paidBy);
            $earned = $this->loyalty ? $this->loyalty->earn($order) : 0;
            if ($this->tables) {
                $this->tables->onPayment((string) $order['table_number']);
            }
            if ($ownTx) {
                $this->pdo->commit();
            }
        } catch (Throwable $e) {
            if ($ownTx && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'order.payment', 'order', $id, [
            'table' => $order['table_number'], 'methode' => $method, 'montant' => (float) $order['total'], 'pointsGagnes' => $earned,
        ]);
        return $this->orders->findById($id);
    }

    /**
     * Annulation, possible uniquement tant que la commande est « Nouvelle » et
     * non payée (aucun remboursement d'argent n'est modélisé). Les points de
     * fidélité utilisés sont restitués.
     *
     * @throws NotFoundException 404
     * @throws ConflictException 409 — déjà annulée, déjà prise en charge ou payée
     */
    public function cancelOrder(int $id, ?array $session = null): array
    {
        $order = $this->orders->findOrderRow($id);
        if (!$order) {
            throw new NotFoundException("Commande introuvable");
        }
        if ($order['cancelled_at'] !== null) {
            throw new ConflictException("Cette commande est déjà annulée");
        }
        if ($order['status'] !== 'Nouvelle') {
            throw new ConflictException("Annulation impossible : la commande est déjà « {$order['status']} »");
        }
        if ($order['payment_status'] === 'paid') {
            throw new ConflictException("Annulation impossible : la commande est déjà payée, adressez-vous au personnel");
        }
        $this->pdo->beginTransaction();
        try {
            if ($this->orders->markCancelled($id) === 0) {
                throw new ConflictException("Annulation impossible : la commande vient d'être prise en charge");
            }
            if ($this->loyalty) {
                $this->loyalty->refund($order);
            }
            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'order.cancel', 'order', $id, ['table' => $order['table_number'], 'pointsRestitues' => (int) $order['loyalty_points_used']]);
        return $this->orders->findById($id);
    }

    // ---------------------------------------------------------------------

    private function validateGuestName($value): string
    {
        if (!is_string($value) || trim($value) === '') {
            throw new InvalidArgumentException("guestName est requis");
        }
        $name = trim($value);
        if (mb_strlen($name) > 150) {
            throw new InvalidArgumentException("guestName trop long (max 150 caractères)");
        }
        return $name;
    }

    private function validateTableNumber($value): string
    {
        if ($value === null || (is_string($value) && trim($value) === '')) {
            throw new InvalidArgumentException("tableNumber est requis");
        }
        $table = trim((string) $value);
        if (mb_strlen($table) > 20) {
            throw new InvalidArgumentException("tableNumber trop long (max 20 caractères)");
        }
        return $table;
    }

    private function validatePartySize($value): int
    {
        if (!is_int($value) || $value < 1 || $value > 50) {
            throw new InvalidArgumentException("partySize doit être un entier entre 1 et 50");
        }
        return $value;
    }

    /**
     * Valide un item de commande et calcule son prix serveur. Ne fait
     * JAMAIS confiance à un éventuel price/unitPrice/lineTotal envoyé par le
     * frontend — ces champs, s'ils sont présents dans le payload, sont
     * simplement ignorés (jamais lus ci-dessous).
     */
    private function validateAndPriceItem(array $rawItem, int $index): array
    {
        $productId = $rawItem['productId'] ?? null;
        if (!is_int($productId) || $productId < 1) {
            throw new InvalidArgumentException("items[$index].productId doit être un entier positif");
        }

        $quantity = $rawItem['quantity'] ?? null;
        if (!is_int($quantity) || $quantity < 1) {
            throw new InvalidArgumentException("items[$index].quantity doit être un entier positif (0, négatif, décimal et chaîne sont refusés)");
        }
        if ($quantity > 50) {
            throw new InvalidArgumentException("items[$index].quantity trop élevée (max 50)");
        }

        $product = $this->products->getProduct($productId);
        if (!$product) {
            throw new NotFoundException("items[$index] : produit #$productId introuvable");
        }
        if (!$product['available']) {
            throw new ConflictException("items[$index] : produit '{$product['name']}' actuellement indisponible");
        }

        $note = $rawItem['note'] ?? null;
        if ($note !== null) {
            if (!is_string($note)) {
                throw new InvalidArgumentException("items[$index].note doit être une chaîne de caractères");
            }
            $note = trim($note);
            if (mb_strlen($note) > 255) {
                throw new InvalidArgumentException("items[$index].note trop longue (max 255 caractères)");
            }
            if ($note === '') {
                $note = null;
            }
        }

        // ---- Validation des options par rapport aux groupes RÉELLEMENT
        // liés à CE produit (product_option_groups), jamais une liste
        // recopiée en dur (§11). ----
        $requestedOptionIds = [];
        foreach (($rawItem['options'] ?? []) as $optIndex => $rawOpt) {
            $optionId = is_array($rawOpt) ? ($rawOpt['optionId'] ?? null) : null;
            if (!is_int($optionId) || $optionId < 1) {
                throw new InvalidArgumentException("items[$index].options[$optIndex].optionId doit être un entier positif");
            }
            $requestedOptionIds[] = $optionId;
        }
        if (count($requestedOptionIds) !== count(array_unique($requestedOptionIds))) {
            throw new InvalidArgumentException("items[$index] : option sélectionnée en double");
        }

        // Index de toutes les options autorisées pour ce produit, groupées par option_group.
        $optionById = [];
        $selectedCountByGroup = [];
        foreach ($product['optionGroups'] as $group) {
            $selectedCountByGroup[$group['id']] = 0;
            foreach ($group['options'] as $opt) {
                $optionById[$opt['id']] = ['group' => $group, 'option' => $opt];
            }
        }

        $selectedOptions = [];
        foreach ($requestedOptionIds as $optionId) {
            if (!isset($optionById[$optionId])) {
                throw new InvalidArgumentException(
                    "items[$index] : l'option #$optionId n'est pas autorisée pour le produit '{$product['name']}'"
                );
            }
            $entry = $optionById[$optionId];
            $selectedCountByGroup[$entry['group']['id']]++;
            $selectedOptions[] = $entry['option'];
        }

        // Contraintes de groupe (required / min / max) — dérivées de SQL, jamais recopiées en dur.
        foreach ($product['optionGroups'] as $group) {
            $count = $selectedCountByGroup[$group['id']];
            if ($group['isRequired'] && $count < max(1, $group['minSelect'])) {
                throw new InvalidArgumentException(
                    "items[$index] : le groupe d'options '{$group['name']}' est obligatoire (au moins {$group['minSelect']} sélection(s) attendue(s))"
                );
            }
            if ($count < $group['minSelect']) {
                throw new InvalidArgumentException(
                    "items[$index] : le groupe '{$group['name']}' requiert au moins {$group['minSelect']} sélection(s), $count reçue(s)"
                );
            }
            if ($group['maxSelect'] !== null && $count > $group['maxSelect']) {
                throw new InvalidArgumentException(
                    "items[$index] : le groupe '{$group['name']}' autorise au maximum {$group['maxSelect']} sélection(s), $count reçue(s)"
                );
            }
        }

        // ---- Calcul serveur (§12) ----
        $unitPrice = $product['basePrice'];
        foreach ($selectedOptions as $opt) {
            $unitPrice += $opt['priceDelta'];
        }
        $lineTotal = round($unitPrice * $quantity, 3);

        return [
            'productId' => $productId,
            'categoryId' => $product['categoryId'],
            'productName' => $product['name'],
            'unitPrice' => round($unitPrice, 3),
            'quantity' => $quantity,
            'lineTotal' => $lineTotal,
            'note' => $note,
            'options' => array_map(fn($o) => ['id' => $o['id'], 'label' => $o['label'], 'priceDelta' => $o['priceDelta']], $selectedOptions),
        ];
    }
}
