-- Menus (cartes) : un menu regroupe des catégories et a sa propre page
-- (Café = menu historique du site, Kebab = nouvelle offre). Ajouts uniquement :
-- une table nouvelle, une colonne nullable sur categories, 6 catégories vides.
-- Aucun produit, prix ou commande n'est créé ni modifié. Réexécutable.

CREATE TABLE IF NOT EXISTS menus (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(40) NOT NULL,
    name VARCHAR(80) NOT NULL,
    tagline VARCHAR(160) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_menus_slug (slug),
    UNIQUE KEY uq_menus_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO menus (slug, name, tagline, sort_order) VALUES
('cafe', 'Café', 'Votre pause café, à votre façon.', 1),
('kebab', 'Kebab', 'Goût, fraîcheur et saveur à chaque bouchée.', 2);

ALTER TABLE categories ADD COLUMN IF NOT EXISTS menu_id BIGINT UNSIGNED NULL AFTER id;

-- Toutes les catégories existantes appartiennent au menu Café : rien ne change pour elles.
UPDATE categories SET menu_id = (SELECT id FROM menus WHERE slug = 'cafe') WHERE menu_id IS NULL;

-- Clé étrangère : un menu qui contient des catégories ne peut pas être supprimé.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND CONSTRAINT_NAME = 'fk_categories_menu');
SET @sql := IF(@fk = 0, 'ALTER TABLE categories ADD KEY idx_categories_menu (menu_id), ADD CONSTRAINT fk_categories_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE RESTRICT', 'SELECT 1');
PREPARE st FROM @sql;
EXECUTE st;
DEALLOCATE PREPARE st;

-- Catégories du menu Kebab (vides : les produits et leurs prix sont saisis depuis l'admin).
INSERT IGNORE INTO categories (menu_id, name, sort_order)
SELECT m.id, c.name, c.sort_order FROM menus m
JOIN (SELECT 'Paninis et piadines' AS name, 101 AS sort_order
      UNION ALL SELECT 'Assiettes kebab', 102
      UNION ALL SELECT 'Menus kebab', 103
      UNION ALL SELECT 'Alternatives', 104
      UNION ALL SELECT 'Accompagnements', 105
      UNION ALL SELECT 'Sauces et suppléments', 106) c
WHERE m.slug = 'kebab';
