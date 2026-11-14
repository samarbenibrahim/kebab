-- Gestion intelligente des tables : la salle (plan) et l'état manuel de chaque
-- table. Le statut affiché (libre / occupée / en préparation / addition
-- demandée / à nettoyer) est DÉRIVÉ par l'API des clients, commandes et
-- drapeaux ci-dessous.
CREATE TABLE IF NOT EXISTS restaurant_tables (
    table_number VARCHAR(20) NOT NULL PRIMARY KEY,
    seats SMALLINT UNSIGNED NULL,
    needs_cleaning TINYINT(1) NOT NULL DEFAULT 0,
    bill_requested_at DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO restaurant_tables (table_number, seats) VALUES
    ('1', 2), ('2', 2), ('3', 4), ('4', 4), ('5', 4), ('6', 4),
    ('7', 6), ('8', 6), ('9', 2), ('10', 2), ('11', 4), ('12', 8);

-- Promotions automatiques : appliquées par le SERVEUR au calcul de la commande.
-- days_mask : bit 0 = lundi ... bit 6 = dimanche (127 = tous les jours).
CREATE TABLE IF NOT EXISTS promotions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    kind ENUM('percent','fixed') NOT NULL,
    value DECIMAL(10,3) NOT NULL,
    scope ENUM('order','category','product') NOT NULL DEFAULT 'order',
    category_id BIGINT UNSIGNED NULL,
    product_id BIGINT UNSIGNED NULL,
    min_order DECIMAL(10,3) NOT NULL DEFAULT 0,
    days_mask TINYINT UNSIGNED NOT NULL DEFAULT 127,
    start_time TIME NULL,
    end_time TIME NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_promotions_active (active),
    CONSTRAINT fk_promotions_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_promotions_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_promotions_staff FOREIGN KEY (created_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fidélité : un compte par numéro de téléphone (les clients de la salle sont
-- des sessions anonymes ; le téléphone est ce qui les relie d'une visite à l'autre).
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    points INT NOT NULL DEFAULT 0,
    lifetime_points INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_loyalty_phone (phone),
    CONSTRAINT chk_loyalty_points CHECK (points >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    account_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    points INT NOT NULL,
    type ENUM('earn','redeem','refund','adjust') NOT NULL,
    note VARCHAR(255) NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_loyalty_tx_account (account_id),
    KEY idx_loyalty_tx_order (order_id),
    CONSTRAINT fk_loyalty_tx_account FOREIGN KEY (account_id) REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_loyalty_tx_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clients
    ADD COLUMN loyalty_account_id BIGINT UNSIGNED NULL,
    ADD CONSTRAINT fk_clients_loyalty FOREIGN KEY (loyalty_account_id) REFERENCES loyalty_accounts(id) ON DELETE SET NULL;

-- Détail des remises sur la commande (total = subtotal - discount_total - loyalty_discount).
ALTER TABLE orders
    ADD COLUMN discount_total DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER subtotal,
    ADD COLUMN promotion_id BIGINT UNSIGNED NULL AFTER discount_total,
    ADD COLUMN promotion_name VARCHAR(100) NULL AFTER promotion_id,
    ADD COLUMN loyalty_points_used INT NOT NULL DEFAULT 0 AFTER promotion_name,
    ADD COLUMN loyalty_discount DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER loyalty_points_used,
    ADD COLUMN points_earned INT NOT NULL DEFAULT 0 AFTER loyalty_discount;
