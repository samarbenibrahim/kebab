-- Appels serveur ("Appeler le serveur") : une demande d'aide liée à une table,
-- visible par le staff (admin) tant qu'elle n'est pas acquittée.
CREATE TABLE IF NOT EXISTS waiter_calls (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    table_number VARCHAR(20) NOT NULL,
    guest_name VARCHAR(150) NULL,
    status ENUM('pending','acknowledged') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP NULL,
    KEY idx_waiter_calls_status (status),
    KEY idx_waiter_calls_table (table_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
