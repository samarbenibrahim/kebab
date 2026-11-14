-- Authentification : comptes du personnel (admin / serveur), clients identifiés,
-- sessions à jeton opaque (seul le hash SHA-256 du jeton est stocké).
CREATE TABLE IF NOT EXISTS staff (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role ENUM('admin','server') NOT NULL,
    username VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    failed_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_staff_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clients (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(70) NOT NULL,
    last_name VARCHAR(70) NOT NULL,
    phone VARCHAR(30) NULL,
    table_number VARCHAR(20) NOT NULL,
    party_size SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_clients_table (table_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    role ENUM('admin','server','client') NOT NULL,
    staff_id BIGINT UNSIGNED NULL,
    client_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    UNIQUE KEY uq_auth_sessions_token (token_hash),
    KEY idx_auth_sessions_expires (expires_at),
    CONSTRAINT fk_auth_sessions_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
    CONSTRAINT fk_auth_sessions_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une commande / un appel serveur appartient à un client identifié (NULL =
-- données antérieures à l'authentification, visibles seulement du personnel).
ALTER TABLE orders
    ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER id,
    ADD KEY idx_orders_client (client_id),
    ADD CONSTRAINT fk_orders_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE waiter_calls
    ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER id,
    ADD COLUMN acknowledged_by BIGINT UNSIGNED NULL,
    ADD KEY idx_waiter_calls_client (client_id),
    ADD CONSTRAINT fk_waiter_calls_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_waiter_calls_staff FOREIGN KEY (acknowledged_by) REFERENCES staff(id) ON DELETE SET NULL;
