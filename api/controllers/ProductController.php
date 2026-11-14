<?php
/**
 * GET /api/products
* GET /api/products/{id}
 * POST /api/products        (products.create : admin, manager)
 * PATCH /api/products/{id}   (personnel, permission par champ)
 * DELETE /api/products/{id}  (products.delete, suppression logique)
 */
class ProductController
{
    public function __construct(private ProductService $service)
    {
    }

    public function index(array $query): void
    {
        try {
            $filters = RequestValidator::validateProductFilters($query);
        } catch (InvalidArgumentException $e) {
            send_error(400, $e->getMessage());
        }
        send_json(200, $this->service->listProducts($filters));
    }

    public function show($rawId): void
    {
        try {
            $id = RequestValidator::validateId($rawId);
        } catch (InvalidArgumentException $e) {
            send_error(400, $e->getMessage());
        }
        $product = $this->service->getProduct($id);
        if (!$product) {
            send_error(404, "Produit introuvable");
        }
        send_json(200, $product);
    }

    public function create(string $rawBody, array $session): void
    {
        api_guard(function () use ($rawBody, $session) {
            send_json(201, $this->service->createProduct(RequestValidator::parseJsonBody($rawBody), $session));
        });
    }

    public function update($rawId, string $rawBody, array $session): void
    {
        api_guard(function () use ($rawId, $rawBody, $session) {
            $id = RequestValidator::validateId($rawId);
            send_json(200, $this->service->updateProduct($id, RequestValidator::parseJsonBody($rawBody), $session));
        });
    }

    public function delete($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $this->service->deleteProduct(RequestValidator::validateId($rawId), $session);
            send_json(200, ['ok' => true]);
        });
    }
}
