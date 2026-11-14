-- Commandes officielles côté serveur. Statuts stockés avec les libellés
-- français exacts déjà utilisés partout dans le frontend (cart.js
-- ORDER_STATUSES, admin.js) — aucune traduction/mapping arbitraire.
CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guest_name VARCHAR(150) NOT NULL,
    table_number VARCHAR(20) NOT NULL,
    party_size SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    status ENUM('Nouvelle','En préparation','Prête','Servie') NOT NULL DEFAULT 'Nouvelle',
    subtotal DECIMAL(10,3) NOT NULL,
    total DECIMAL(10,3) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_orders_status (status),
    KEY idx_orders_created_at (created_at),
    KEY idx_orders_table_number (table_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot du nom/prix au moment de la commande (product_id conservé pour
-- l'intégrité référentielle, mais product_name/unit_price ne doivent JAMAIS
-- être relus depuis `products` après coup : une commande passée doit rester
-- historiquement exacte même si le produit change de nom/prix plus tard).
CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    unit_price DECIMAL(10,3) NOT NULL,
    quantity SMALLINT UNSIGNED NOT NULL,
    line_total DECIMAL(10,3) NOT NULL,
    note VARCHAR(255) NULL,
    KEY idx_order_items_order_id (order_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT chk_order_items_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Même principe de snapshot pour les options choisies (option_id conservé,
-- option_name/price_delta figés). "quantity" prévu pour une future sélection
-- multiple d'une même option — non exploité tant que le frontend ne le permet
-- pas (les groupes MULTIPLE actuels sont des cases à cocher, pas des compteurs).
CREATE TABLE IF NOT EXISTS order_item_options (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_item_id BIGINT UNSIGNED NOT NULL,
    option_id BIGINT UNSIGNED NOT NULL,
    option_name VARCHAR(100) NOT NULL,
    price_delta DECIMAL(10,3) NOT NULL DEFAULT 0,
    quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    KEY idx_order_item_options_order_item_id (order_item_id),
    CONSTRAINT fk_oio_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id),
    CONSTRAINT fk_oio_option FOREIGN KEY (option_id) REFERENCES options(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_status_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    old_status ENUM('Nouvelle','En préparation','Prête','Servie') NULL,
    new_status ENUM('Nouvelle','En préparation','Prête','Servie') NOT NULL,
    changed_by VARCHAR(100) NULL, -- toujours NULL tant qu'il n'y a pas d'authentification admin
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_order_status_history_order_id (order_id),
    CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
