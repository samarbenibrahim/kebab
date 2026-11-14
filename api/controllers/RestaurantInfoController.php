<?php
/**
 * Infos pratiques du restaurant :
 *   GET /api/restaurant-info   public (accueil)
 *   PUT /api/restaurant-info   permission catalog.manage
 */
class RestaurantInfoController
{
    public function __construct(private RestaurantInfoService $info, private PDO $pdo)
    {
    }

    public function show(): void
    {
        api_guard(fn() => send_json(200, $this->info->get()));
    }

    public function update(string $raw, array $session): void
    {
        api_guard(fn() => send_json(200, $this->info->update(RequestValidator::parseJsonBody($raw), $this->pdo, $session)));
    }
}
