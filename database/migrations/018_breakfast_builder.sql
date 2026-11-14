-- Petit-déjeuner à composer : le client choisit, rubrique par rubrique, ce
-- qu'il veut (boisson chaude obligatoire, le reste au choix). Chaque choix
-- est une option SQL avec son prix : le SERVEUR valide les choix (min / max
-- par rubrique) et calcule le prix, comme pour les autres produits.
-- Prix de départ proposés ; réexécutable sans doublon.
-- ATTENTION : la collation compare les noms SANS accents (« Sucré » = « Sucre »,
-- le groupe du sucre des boissons) : d'où le nom « Douceurs » (voir 019).

INSERT INTO products (category_id, slug, name, description, base_price, image_url, emoji, available, allergens, calories, dietary_tags)
SELECT c.id, 'petit-dejeuner-compose', 'Petit-déjeuner à composer',
       'Pain frais et beurre inclus : choisissez votre boisson, puis composez le reste selon vos envies.',
       5.000, '../images/products/petit-dejeuner-compose.jpg', '🍳', 1, 'Gluten,Lait,Œufs', NULL, 'vegetarien'
FROM categories c WHERE c.name = 'Petit-déjeuner'
ON DUPLICATE KEY UPDATE products.id = products.id;

-- ---- Rubriques (groupes d'options) ----
INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Boisson chaude', 'SINGLE', 1, 1, 1 WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Boisson chaude');
INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Jus frais', 'SINGLE', 0, 0, 1 WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Jus frais');
INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Viennoiseries', 'MULTIPLE', 0, 0, 2 WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Viennoiseries');
INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Œufs', 'SINGLE', 0, 0, 1 WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Œufs');
INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Salé', 'MULTIPLE', 0, 0, 4 WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Salé');
INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Douceurs', 'MULTIPLE', 0, 0, 3 WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Douceurs');

-- ---- Choix de chaque rubrique (libellé, supplément, ordre) ----
INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, v.label, v.price, v.sort FROM option_groups g JOIN (
    SELECT 'Espresso' AS label, 0.000 AS price, 0 AS sort
    UNION ALL SELECT 'Café crème', 1.000, 1
    UNION ALL SELECT 'Cappuccino', 1.500, 2
    UNION ALL SELECT 'Café turc', 1.000, 3
    UNION ALL SELECT 'Thé à la menthe', 0.500, 4
    UNION ALL SELECT 'Chocolat chaud', 1.500, 5
) v WHERE g.name = 'Boisson chaude';

INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, v.label, v.price, v.sort FROM option_groups g JOIN (
    SELECT 'Orange pressée' AS label, 2.500 AS price, 0 AS sort
    UNION ALL SELECT 'Citron frais', 2.000, 1
    UNION ALL SELECT 'Fraise', 3.000, 2
    UNION ALL SELECT 'Mangue', 3.300, 3
) v WHERE g.name = 'Jus frais';

INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, v.label, v.price, v.sort FROM option_groups g JOIN (
    SELECT 'Croissant pur beurre' AS label, 2.000 AS price, 0 AS sort
    UNION ALL SELECT 'Pain au chocolat', 2.300, 1
    UNION ALL SELECT 'Pancakes fruits rouges', 3.500, 2
    UNION ALL SELECT 'Simit au sésame', 1.800, 3
) v WHERE g.name = 'Viennoiseries';

INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, v.label, v.price, v.sort FROM option_groups g JOIN (
    SELECT 'Œuf au plat' AS label, 1.500 AS price, 0 AS sort
    UNION ALL SELECT 'Œufs brouillés', 2.500, 1
    UNION ALL SELECT 'Omelette nature', 2.500, 2
    UNION ALL SELECT 'Omelette fromage', 3.200, 3
) v WHERE g.name = 'Œufs';

INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, v.label, v.price, v.sort FROM option_groups g JOIN (
    SELECT 'Fromage blanc' AS label, 1.500 AS price, 0 AS sort
    UNION ALL SELECT 'Fromage kasar', 1.800, 1
    UNION ALL SELECT 'Olives noires et vertes', 1.000, 2
    UNION ALL SELECT 'Tomates et concombre', 1.200, 3
    UNION ALL SELECT 'Blanc de dinde', 2.500, 4
) v WHERE g.name = 'Salé';

INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, v.label, v.price, v.sort FROM option_groups g JOIN (
    SELECT 'Miel' AS label, 1.000 AS price, 0 AS sort
    UNION ALL SELECT 'Confiture maison', 0.800, 1
    UNION ALL SELECT 'Pâte à tartiner', 1.200, 2
    UNION ALL SELECT 'Fruits frais de saison', 2.500, 3
    UNION ALL SELECT 'Granola et yaourt', 3.000, 4
) v WHERE g.name = 'Douceurs';

-- ---- Rubriques liées au produit, dans l'ordre d'affichage ----
INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order)
SELECT p.id, g.id, CASE g.name
    WHEN 'Boisson chaude' THEN 0 WHEN 'Jus frais' THEN 1 WHEN 'Viennoiseries' THEN 2
    WHEN 'Œufs' THEN 3 WHEN 'Salé' THEN 4 WHEN 'Douceurs' THEN 5 END
FROM products p JOIN option_groups g ON g.name IN ('Boisson chaude', 'Jus frais', 'Viennoiseries', 'Œufs', 'Salé', 'Douceurs')
WHERE p.slug = 'petit-dejeuner-compose';
