<?php
/**
 * Promotions, fidélité, statistiques, audit.
 *
 * GET    /api/promotions/active          public — offres en vigueur maintenant
 * GET    /api/promotions                 promotions.view
 * GET    /api/promotions/suggestions     promotions.view — suggestions issues de l'historique
 * POST   /api/promotions                 promotions.manage
 * PATCH  /api/promotions/{id}            promotions.manage
 * DELETE /api/promotions/{id}            promotions.manage
 *
 * GET    /api/loyalty/me                 client — points, palier, historique
 * GET    /api/loyalty                    loyalty.view — comptes (?q=nom ou téléphone)
 * GET    /api/loyalty/{id}               loyalty.view
 * POST   /api/loyalty/{id}/adjust        loyalty.adjust {points, note}
 *
 * GET    /api/stats/summary?days=30      stats.view
 * GET    /api/audit                      audit.view — journal (filtres : action, actorType, actor, entity, entityId, from, to, page, limit)
 */
class ManagementController
{
    public function __construct(
        private PromotionService $promotions,
        private LoyaltyService $loyalty,
        private StatsService $stats,
        private PDO $pdo
    ) {
    }

    private function need(array $session, string $permission): void
    {
        if (!Auth::can($session, $permission)) {
            throw new ForbiddenException("Permission refusée pour votre rôle");
        }
    }

    // ---- Promotions ----

    public function promotionsActive(): void
    {
        send_json(200, $this->promotions->listActiveNow());
    }

    public function promotionsList(array $session): void
    {
        api_guard(function () use ($session) {
            $this->need($session, 'promotions.view');
            send_json(200, $this->promotions->listAll());
        });
    }

    public function promotionsSuggestions(array $session): void
    {
        api_guard(function () use ($session) {
            $this->need($session, 'promotions.view');
            send_json(200, $this->promotions->suggestions());
        });
    }

    public function promotionCreate(string $raw, array $session): void
    {
        api_guard(function () use ($raw, $session) {
            $this->need($session, 'promotions.manage');
            send_json(201, $this->promotions->create(RequestValidator::parseJsonBody($raw), $session));
        });
    }

    public function promotionUpdate($rawId, string $raw, array $session): void
    {
        api_guard(function () use ($rawId, $raw, $session) {
            $this->need($session, 'promotions.manage');
            send_json(200, $this->promotions->update(RequestValidator::validateId($rawId), RequestValidator::parseJsonBody($raw), $session));
        });
    }

    public function promotionDelete($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $this->need($session, 'promotions.manage');
            $this->promotions->delete(RequestValidator::validateId($rawId), $session);
            send_json(200, ['ok' => true]);
        });
    }

    // ---- Fidélité ----

    public function loyaltyMe(array $session): void
    {
        send_json(200, $this->loyalty->meForClient($session['client']));
    }

    public function loyaltyList(array $query, array $session): void
    {
        api_guard(function () use ($query, $session) {
            $this->need($session, 'loyalty.view');
            $q = isset($query['q']) ? trim((string) $query['q']) : null;
            send_json(200, $this->loyalty->listAccounts($q, 100));
        });
    }

    public function loyaltyShow($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $this->need($session, 'loyalty.view');
            send_json(200, $this->loyalty->accountWithHistory(RequestValidator::validateId($rawId)));
        });
    }

    public function loyaltyAdjust($rawId, string $raw, array $session): void
    {
        api_guard(function () use ($rawId, $raw, $session) {
            $this->need($session, 'loyalty.adjust');
            $b = RequestValidator::parseJsonBody($raw);
            send_json(200, $this->loyalty->adjust(RequestValidator::validateId($rawId), $b['points'] ?? null, $b['note'] ?? null, $session));
        });
    }

    // ---- Statistiques / audit ----

    public function statsSummary(array $query, array $session): void
    {
        api_guard(function () use ($query, $session) {
            $this->need($session, 'stats.view');
            send_json(200, $this->stats->summary($query));
        });
    }

    public function audit(array $query, array $session): void
    {
        api_guard(function () use ($query, $session) {
            $this->need($session, 'audit.view');
            send_json(200, $this->stats->audit($query));
        });
    }
}
