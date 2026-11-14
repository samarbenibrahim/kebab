-- Module « SOUCOFFE Intelligent » : tables NOUVELLES uniquement.
-- Aucune table existante n'est modifiée ; aucune donnée existante n'est lue
-- ou écrite par cette migration. Réexécutable sans effet (IF NOT EXISTS,
-- INSERT IGNORE). Le module se désactive avec ai_settings.enabled = '0'.

-- Réglages du module (interrupteur, créneaux horaires des recommandations).
CREATE TABLE IF NOT EXISTS ai_settings (
    setting_key VARCHAR(60) NOT NULL PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_by BIGINT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ai_settings (setting_key, setting_value) VALUES
('enabled', '1'),
('time_slots', '[{"start":6,"end":11,"label":"Le matin","categories":["Cafés","Croissants","Petit-déjeuner"]},{"start":11,"end":15,"label":"Le midi","categories":["Sandwichs","Jus"]},{"start":15,"end":19,"label":"Après-midi","categories":["Cafés","Desserts","Smoothies"]},{"start":19,"end":24,"label":"Le soir","categories":["Mojitos","Sodas","Desserts"]},{"start":0,"end":6,"label":"La nuit","categories":["Mojitos","Sodas","Desserts"]}]');

-- Cache des calculs (BI, prévisions, anomalies) : évite de tout recalculer
-- à chaque ouverture de page. Supprimable à tout moment sans perte.
CREATE TABLE IF NOT EXISTS ai_cache (
    cache_key VARCHAR(120) NOT NULL PRIMARY KEY,
    payload MEDIUMTEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    KEY idx_ai_cache_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Questions posées aux assistants (client « Suggérez-moi », assistant manager),
-- pour mesurer leur utilité. Pas de donnée personnelle hors identifiant.
CREATE TABLE IF NOT EXISTS ai_interactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    kind ENUM('suggest','ask') NOT NULL,
    actor_type ENUM('client','staff','anonymous') NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    query VARCHAR(255) NOT NULL,
    intent VARCHAR(60) NULL,
    result_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_int_kind (kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Smart Stock : ingrédients / consommables suivis (lait, grains, gobelets…).
-- La quantité « réelle » n'est JAMAIS modifiée automatiquement : elle vient
-- uniquement des mouvements saisis par l'équipe (inventaire, livraison).
CREATE TABLE IF NOT EXISTS stock_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    min_threshold DECIMAL(10,3) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_stock_items_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mouvements saisis : « count » = inventaire (quantité constatée),
-- « delivery » = livraison reçue (quantité ajoutée).
CREATE TABLE IF NOT EXISTS stock_movements (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stock_item_id BIGINT UNSIGNED NOT NULL,
    type ENUM('count','delivery') NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    note VARCHAR(255) NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_stock_mv_item (stock_item_id, created_at),
    CONSTRAINT fk_stock_mv_item FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recettes : quantité d'un ingrédient consommée par unité vendue d'un produit
-- (ex. Cappuccino -> 0,15 L de lait). Sert à ESTIMER la consommation.
CREATE TABLE IF NOT EXISTS stock_recipes (
    product_id BIGINT UNSIGNED NOT NULL,
    stock_item_id BIGINT UNSIGNED NOT NULL,
    quantity_per_unit DECIMAL(10,4) NOT NULL,
    PRIMARY KEY (product_id, stock_item_id),
    KEY idx_stock_rec_item (stock_item_id),
    CONSTRAINT fk_stock_rec_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_stock_rec_item FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
