<?php
/**
 * GET    /api/menus                 (public) menus actifs + catégories
 * GET    /api/admin/menus           (catalog.manage) tous les menus, compteurs de produits
 * POST   /api/menus                 (catalog.manage) {name, tagline?}
 * PATCH  /api/menus/{id}            (catalog.manage) {name?, tagline?, active?, sortOrder?}
 * DELETE /api/menus/{id}            (catalog.manage) seulement s'il est vide
 * POST   /api/categories            (catalog.manage) {name, menuId, sortOrder?}
 * PATCH  /api/categories/{id}       (catalog.manage) {name?, menuId?, sortOrder?}
 * DELETE /api/categories/{id}       (catalog.manage) seulement si aucun produit ne l'utilise
 *
 * Traduit uniquement les exceptions du service en codes HTTP.
 */
class CatalogController
{
    public function __construct(private CatalogService $service)
    {
    }

    public function menus(bool $all): void
    {
        send_json(200, ['content' => $this->service->menus($all)]);
    }

    public function createMenu(string $raw, array $session): void
    {
        api_guard(fn() => send_json(201, $this->service->createMenu(RequestValidator::parseJsonBody($raw), $session)));
    }

    public function updateMenu($rawId, string $raw, array $session): void
    {
        api_guard(fn() => send_json(200, $this->service->updateMenu(RequestValidator::validateId($rawId), RequestValidator::parseJsonBody($raw), $session)));
    }

    public function deleteMenu($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $this->service->deleteMenu(RequestValidator::validateId($rawId), $session);
            send_json(200, ['ok' => true]);
        });
    }

    public function createCategory(string $raw, array $session): void
    {
        api_guard(fn() => send_json(201, $this->service->createCategory(RequestValidator::parseJsonBody($raw), $session)));
    }

    public function updateCategory($rawId, string $raw, array $session): void
    {
        api_guard(fn() => send_json(200, $this->service->updateCategory(RequestValidator::validateId($rawId), RequestValidator::parseJsonBody($raw), $session)));
    }

    public function deleteCategory($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $this->service->deleteCategory(RequestValidator::validateId($rawId), $session);
            send_json(200, ['ok' => true]);
        });
    }
}
