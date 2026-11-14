-- Plusieurs photos par produit, choix gérés depuis l'admin, commande de groupe à table.
-- Ajouts uniquement : 3 tables nouvelles. Aucun produit, prix,
-- option ou commande existant n'est modifié. Réexécutable.

-- Galerie : photos supplémentaires d'un produit (la photo principale reste products.image_url).
CREATE TABLE IF NOT EXISTS product_images (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    url VARCHAR(500) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_product_images_product (product_id, sort_order),
    CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Commande de groupe : un panier commun par table, rempli depuis plusieurs téléphones,
-- envoyé en UNE commande par le système de commande existant (POST /orders inchangé).
CREATE TABLE IF NOT EXISTS table_groups (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    table_number VARCHAR(10) NOT NULL,
    status ENUM('OPEN', 'SENT') NOT NULL DEFAULT 'OPEN',
    order_id BIGINT UNSIGNED NULL,
    sent_by_client_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP NULL,
    KEY idx_table_groups_table (table_number, status),
    KEY idx_table_groups_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS table_group_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    author_name VARCHAR(120) NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    quantity INT NOT NULL,
    option_ids VARCHAR(500) NOT NULL DEFAULT '',
    label VARCHAR(500) NOT NULL,
    unit_price DECIMAL(10,3) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_tgi_group (group_id),
    CONSTRAINT fk_tgi_group FOREIGN KEY (group_id) REFERENCES table_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
