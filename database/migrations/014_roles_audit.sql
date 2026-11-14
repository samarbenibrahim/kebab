-- Rôles du personnel : admin, manager, serveur, caissier, cuisine.
-- (« server » reste le code du rôle SERVEUR pour ne rien casser.)
ALTER TABLE staff
    MODIFY role ENUM('admin','manager','server','cashier','kitchen') NOT NULL;

ALTER TABLE auth_sessions
    MODIFY role ENUM('admin','manager','server','cashier','kitchen','client') NOT NULL;

-- Paiements : espèces, carte, en ligne + qui a encaissé.
ALTER TABLE orders
    MODIFY payment_method ENUM('online','cash','card') NULL,
    ADD COLUMN paid_by BIGINT UNSIGNED NULL AFTER paid_at,
    ADD CONSTRAINT fk_orders_paid_by FOREIGN KEY (paid_by) REFERENCES staff(id) ON DELETE SET NULL;

-- Suppression de produit = suppression logique (les commandes passées
-- gardent leur produit : l'historique reste exact).
ALTER TABLE products
    ADD COLUMN deleted_at DATETIME NULL,
    ADD KEY idx_products_deleted (deleted_at);

-- Journal d'audit / historique : qui a fait quoi, quand. Volontairement SANS
-- clé étrangère : une entrée survit à la suppression du compte ou de la
-- ressource concernée. L'API ne propose ni modification ni suppression.
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_type ENUM('staff','client','system') NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    actor_name VARCHAR(150) NULL,
    actor_role VARCHAR(20) NULL,
    action VARCHAR(60) NOT NULL,
    entity VARCHAR(40) NOT NULL,
    entity_id VARCHAR(40) NULL,
    details TEXT NULL,
    ip VARCHAR(45) NULL,
    KEY idx_audit_created (created_at),
    KEY idx_audit_action (action),
    KEY idx_audit_entity (entity, entity_id),
    KEY idx_audit_actor (actor_type, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
