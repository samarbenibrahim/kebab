-- Un client ne change pas de table seul : il prévient l'admin (demande), qui
-- répond par une table disponible ; le client applique ensuite cette table.
CREATE TABLE IF NOT EXISTS table_change_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id BIGINT UNSIGNED NOT NULL,
    from_table VARCHAR(20) NOT NULL,
    requested_table VARCHAR(20) NULL,
    reason VARCHAR(255) NULL,
    status ENUM('pending','approved','rejected','applied','cancelled') NOT NULL DEFAULT 'pending',
    approved_table VARCHAR(20) NULL,
    admin_message VARCHAR(255) NULL,
    responded_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME NULL,
    applied_at DATETIME NULL,
    KEY idx_tcr_status (status),
    KEY idx_tcr_client (client_id),
    CONSTRAINT fk_tcr_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_tcr_staff FOREIGN KEY (responded_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
