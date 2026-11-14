-- Index de performance pour les gros volumes (centaines de milliers de commandes).
-- ADDITIF : aucune table, colonne ou donnée n'est modifiée ; seuls des index
-- sont ajoutés (réexécutable : IF NOT EXISTS). Gain mesuré sur une copie de
-- test chargée de 200 000 commandes avant application à la base réelle.

-- Statistiques / BI : filtres par date + annulation, avec les montants lus
-- directement dans l'index (pas de lecture de la table).
CREATE INDEX IF NOT EXISTS idx_orders_stats
    ON orders (created_at, cancelled_at, payment_status, payment_method, total);

-- Ventes par produit : lignes d'une commande avec produit et quantités dans l'index.
CREATE INDEX IF NOT EXISTS idx_order_items_sales
    ON order_items (order_id, product_id, quantity, line_total);
CREATE INDEX IF NOT EXISTS idx_order_items_product_order
    ON order_items (product_id, order_id, quantity);

-- « À emporter » : recherche d'une option par nom dans les articles d'une commande.
CREATE INDEX IF NOT EXISTS idx_oio_item_name
    ON order_item_options (order_item_id, option_name);

-- Temps de préparation : historique des passages à « Prête ».
CREATE INDEX IF NOT EXISTS idx_osh_status_time
    ON order_status_history (new_status, created_at, order_id);
