-- Correctif de 018 : la collation utf8mb4_unicode_ci compare sans accents, donc
-- la rubrique « Sucré » a été confondue avec le groupe « Sucre » (niveau de
-- sucre des boissons). On retire de ce groupe les 5 choix ajoutés par erreur
-- (jamais commandés), on détache le petit-déjeuner du groupe « Sucre » et on
-- crée la rubrique sous le nom « Douceurs ». Sans effet sur une base neuve
-- (018 corrigée utilise déjà « Douceurs »).

DELETE o FROM options o
JOIN option_groups g ON g.id = o.option_group_id AND g.name = 'Sucre' AND g.selection_type = 'SINGLE'
LEFT JOIN order_item_options x ON x.option_id = o.id
WHERE o.label IN ('Miel', 'Confiture maison', 'Pâte à tartiner', 'Fruits frais de saison', 'Granola et yaourt')
  AND x.id IS NULL;

DELETE pog FROM product_option_groups pog
JOIN products p ON p.id = pog.product_id AND p.slug = 'petit-dejeuner-compose'
JOIN option_groups g ON g.id = pog.option_group_id AND g.name = 'Sucre';

INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Douceurs', 'MULTIPLE', 0, 0, 3 WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Douceurs');

INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, v.label, v.price, v.sort FROM option_groups g JOIN (
    SELECT 'Miel' AS label, 1.000 AS price, 0 AS sort
    UNION ALL SELECT 'Confiture maison', 0.800, 1
    UNION ALL SELECT 'Pâte à tartiner', 1.200, 2
    UNION ALL SELECT 'Fruits frais de saison', 2.500, 3
    UNION ALL SELECT 'Granola et yaourt', 3.000, 4
) v WHERE g.name = 'Douceurs';

INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order)
SELECT p.id, g.id, 5 FROM products p JOIN option_groups g ON g.name = 'Douceurs'
WHERE p.slug = 'petit-dejeuner-compose';
