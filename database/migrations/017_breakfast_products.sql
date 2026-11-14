-- Nouveaux produits illustrés par les photos ajoutées au projet :
-- catégorie « Petit-déjeuner » (4 formules) et le Café Turc.
-- Prix de départ proposés, modifiables ensuite dans l'admin (products.price).
-- N'écrase JAMAIS un produit existant (ON DUPLICATE KEY UPDATE id = id) :
-- un prix déjà modifié dans l'admin reste intact si la migration est rejouée.

INSERT INTO categories (name, sort_order)
VALUES ('Petit-déjeuner', 9)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO products (category_id, slug, name, description, base_price, image_url, emoji, available, allergens, calories, dietary_tags)
SELECT c.id, 'cafe-turc', 'Café Turc',
       'Café finement moulu, préparé au cezve et servi avec sa mousse onctueuse.',
       4.500, '../images/products/cafe-turc.jpg', '☕', 1, NULL, 5, 'vegan,vegetarien,sans-gluten'
FROM categories c WHERE c.name = 'Cafés'
ON DUPLICATE KEY UPDATE products.id = products.id;

INSERT INTO products (category_id, slug, name, description, base_price, image_url, emoji, available, allergens, calories, dietary_tags)
SELECT c.id, v.slug, v.name, v.description, v.price, v.img, v.emoji, 1, v.allergens, v.calories, v.tags
FROM categories c
JOIN (
    SELECT 'petit-dejeuner-healthy' AS slug, 'Petit-déjeuner Healthy' AS name,
           'Pain frais, fromages, olives, légumes croquants, œuf au plat, miel et confitures maison.' AS description,
           14.000 AS price, '../images/products/petit-dejeuner-healthy.jpg' AS img, '🥗' AS emoji,
           'Gluten,Lait,Œufs' AS allergens, 520 AS calories, 'vegetarien' AS tags
    UNION ALL SELECT 'petit-dejeuner-sucre', 'Petit-déjeuner Sucré',
           'Croissants, pancakes aux fruits rouges, granola au yaourt, fruits frais et chocolat chaud.',
           12.000, '../images/products/petit-dejeuner-sucre.jpg', '🥐', 'Gluten,Lait,Œufs', 680, 'vegetarien'
    UNION ALL SELECT 'petit-dejeuner-sale', 'Petit-déjeuner Salé',
           'Plateau de fromages, crackers, olives, tomates, concombre, crêpes salées et fruits frais.',
           15.000, '../images/products/petit-dejeuner-sale.jpg', '🧀', 'Gluten,Lait,Œufs', 720, 'vegetarien'
    UNION ALL SELECT 'petit-dejeuner-turc', 'Petit-déjeuner Turc',
           'Simit, fromages blancs, olives, miel en rayon, confitures, œuf et thé turc.',
           18.000, '../images/products/petit-dejeuner-turc.jpg', '🫖', 'Gluten,Lait,Œufs', 750, 'vegetarien'
) v
WHERE c.name = 'Petit-déjeuner'
ON DUPLICATE KEY UPDATE id = products.id;

-- Café Turc : choix du service (tasse / gobelet) et du sucre, comme un café.
INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order)
SELECT p.id, g.id, -1 FROM products p JOIN option_groups g ON g.name = 'Service' WHERE p.slug = 'cafe-turc';
INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order)
SELECT p.id, g.id, 2 FROM products p JOIN option_groups g ON g.name = 'Sucre' WHERE p.slug = 'cafe-turc';
