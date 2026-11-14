-- Tables servies par chaque serveur. table_number est la clé primaire : une
-- table n'a qu'un serveur à la fois (l'admin peut la réaffecter).
CREATE TABLE IF NOT EXISTS server_tables (
    table_number VARCHAR(20) NOT NULL PRIMARY KEY,
    staff_id BIGINT UNSIGNED NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_server_tables_staff (staff_id),
    CONSTRAINT fk_server_tables_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
