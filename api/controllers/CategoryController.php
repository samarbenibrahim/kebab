<?php
/**
 * GET /api/categories
 */
class CategoryController
{
    public function __construct(private ProductService $service)
    {
    }

    public function index(): void
    {
        send_json(200, $this->service->listCategories());
    }
}
