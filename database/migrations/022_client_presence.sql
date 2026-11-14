-- Surveillance des sessions clients : tables NOUVELLES uniquement.
-- Aucune table existante n'est modifiée ; aucune donnée existante n'est
-- écrite. Réexécutable sans effet (IF NOT EXISTS, INSERT IGNORE).
-- Le module se désactive avec presence_settings.enabled = '0'.

-- Une ligne par session client (auth_sessions.id). Volontairement SANS clé
-- étrangère vers auth_sessions : la session est supprimée à la déconnexion,
-- la présence, elle, doit survivre pour dire COMMENT elle s'est terminée.
-- Aucune donnée sensible : ni jeton, ni IP, ni téléphone.
CREATE TABLE IF NOT EXISTS client_presence (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    started_at DATETIME NOT NULL,                 -- ouverture de la session (heure de connexion)
    last_heartbeat_at DATETIME NULL,              -- dernier signal reçu de l'espace client
    last_activity_at DATETIME NULL,               -- dernière interaction réelle (toucher, clic, défilement, clavier)
    visible TINYINT(1) NOT NULL DEFAULT 1,        -- onglet au premier plan au dernier signal
    page VARCHAR(40) NULL,                        -- dossier de la page (ex. 03-Cafes), rien d'autre
    device ENUM('mobile','desktop') NULL,
    heartbeats INT UNSIGNED NOT NULL DEFAULT 0,
    -- Mesuré par le navigateur du client (cumul des signaux) :
    net_failures INT UNSIGNED NOT NULL DEFAULT 0, -- appels API sans réponse (réseau coupé, API arrêtée)
    http_5xx INT UNSIGNED NOT NULL DEFAULT 0,     -- réponses 5xx reçues
    slow_requests INT UNSIGNED NOT NULL DEFAULT 0,-- réponses plus lentes que le seuil
    max_response_ms INT UNSIGNED NOT NULL DEFAULT 0,
    -- Mesuré par l'API elle-même (api/index.php, à la fin de chaque requête en anomalie) :
    server_errors INT UNSIGNED NOT NULL DEFAULT 0,
    server_slow INT UNSIGNED NOT NULL DEFAULT 0,
    ended_at DATETIME NULL,
    end_reason ENUM('logout','expired','revoked') NULL,
    UNIQUE KEY uq_presence_session (session_id),
    KEY idx_presence_open (ended_at, started_at),
    KEY idx_presence_client (client_id),
    CONSTRAINT fk_presence_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Centre de notifications de l'administration. La clé unique rend les
-- doublons impossibles : UNE notification par session, par type et par seuil,
-- même si plusieurs écrans admin évaluent en même temps (INSERT IGNORE).
CREATE TABLE IF NOT EXISTS admin_notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type ENUM('presence','inactivity','server_issue') NOT NULL,
    level ENUM('info','alert') NOT NULL,          -- info = événement enregistré ; alert = signalé (badge + son)
    presence_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    threshold_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME NULL,
    read_by BIGINT UNSIGNED NULL,
    closed_at DATETIME NULL,
    closed_by BIGINT UNSIGNED NULL,
    expired TINYINT(1) NOT NULL DEFAULT 0,        -- clôturée automatiquement (session terminée depuis longtemps)
    UNIQUE KEY uq_notif_once (presence_id, type, threshold_minutes),
    KEY idx_notif_open (closed_at, created_at),
    CONSTRAINT fk_notif_presence FOREIGN KEY (presence_id) REFERENCES client_presence(id) ON DELETE CASCADE,
    CONSTRAINT fk_notif_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    CONSTRAINT fk_notif_read_by FOREIGN KEY (read_by) REFERENCES staff(id) ON DELETE SET NULL,
    CONSTRAINT fk_notif_closed_by FOREIGN KEY (closed_by) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Réglages (modifiables depuis la vue « Clients connectés »).
CREATE TABLE IF NOT EXISTS presence_settings (
    setting_key VARCHAR(60) NOT NULL PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    updated_by BIGINT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO presence_settings (setting_key, setting_value) VALUES
('enabled', '1'),
('log_minutes', '3'),          -- présence active : événement enregistré (liste, ex. "3")
('alert_minutes', '5'),        -- présence active : alerte admin (liste, ex. "5,15")
('idle_after_minutes', '2'),   -- sans interaction depuis N min = « inactif »
('idle_alert_minutes', '10'),  -- alerte d'inactivité prolongée (0 = désactivée)
('heartbeat_seconds', '30'),
('slow_ms', '2000'),           -- réponse API jugée anormalement lente
('retention_days', '7'),       -- conservation des présences terminées
-- Horodatages internes (évaluation au plus toutes les 10 s, nettoyage horaire).
('last_eval_at', '0'),
('last_cleanup_at', '0');
