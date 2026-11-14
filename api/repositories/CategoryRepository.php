<?php
/**
 * Accès SQL brut pour les catégories — aucune logique métier ici.
 */
class CategoryRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    public function findAll(): array
    {
        // Menu de rattachement (migration 023) : catégories d'un menu désactivé exclues du catalogue public.
        return $this->pdo
            ->query('SELECT c.id, c.name, c.sort_order, c.menu_id, m.slug AS menu_slug, m.name AS menu_name
                     FROM categories c LEFT JOIN menus m ON m.id = c.menu_id
                     WHERE m.id IS NULL OR m.active = 1
                     ORDER BY COALESCE(m.sort_order, 0) ASC, c.sort_order ASC')
            ->fetchAll();
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, name, sort_order FROM categories WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }
}
