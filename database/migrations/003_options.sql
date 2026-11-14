CREATE TABLE IF NOT EXISTS option_groups (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    selection_type ENUM('SINGLE','MULTIPLE') NOT NULL DEFAULT 'SINGLE',
    is_required TINYINT(1) NOT NULL DEFAULT 0,
    min_select SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    max_select SMALLINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS options (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    option_group_id BIGINT UNSIGNED NOT NULL,
    label VARCHAR(100) NOT NULL,
    price_delta DECIMAL(10,3) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_options_group_label (option_group_id, label),
    CONSTRAINT fk_options_group FOREIGN KEY (option_group_id) REFERENCES option_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_option_groups (
    product_id BIGINT UNSIGNED NOT NULL,
    option_group_id BIGINT UNSIGNED NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, option_group_id),
    CONSTRAINT fk_pog_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_pog_option_group FOREIGN KEY (option_group_id) REFERENCES option_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
