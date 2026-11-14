-- Service des cafés : tasse en verre (sur place) ou gobelet carton (à emporter),
-- et demandes « à emporter » envoyées par le client à l'équipe, qui y répond.
--
-- Le groupe « Service » n'est PAS obligatoire (is_required = 0) : les paniers
-- et commandes existants, qui ne le contiennent pas, restent valides. Le menu
-- présélectionne « Tasse en verre » et l'envoie toujours.
-- Réexécutable sans doublon (recherche par nom + libellés, INSERT IGNORE).

INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select)
SELECT 'Service', 'SINGLE', 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM option_groups WHERE name = 'Service');

INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, 'Tasse en verre (sur place)', 0, 0 FROM option_groups g WHERE g.name = 'Service';
INSERT IGNORE INTO options (option_group_id, label, price_delta, sort_order)
SELECT g.id, 'Gobelet à emporter', 0, 1 FROM option_groups g WHERE g.name = 'Service';

-- Tous les cafés (catégorie « Cafés ») proposent le choix, en premier.
INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order)
SELECT p.id, g.id, -1
FROM products p
JOIN categories c ON c.id = p.category_id AND c.name = 'Cafés'
JOIN option_groups g ON g.name = 'Service';

-- Demande « à emporter » : le client prévient l'équipe pour une commande qui
-- contient au moins un café en gobelet ; l'équipe accepte ou refuse avec un
-- message, que le client voit sur son suivi de commande.
CREATE TABLE IF NOT EXISTS takeaway_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    message VARCHAR(255) NULL,
    status ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
    admin_message VARCHAR(255) NULL,
    responded_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME NULL,
    KEY idx_tar_status (status),
    KEY idx_tar_client (client_id),
    KEY idx_tar_order (order_id),
    CONSTRAINT fk_tar_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_tar_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_tar_staff FOREIGN KEY (responded_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
