<?php
/**
 * Surveillance des sessions clients (migration 022).
 *
 *  - heartbeat() : signal léger de l'espace client (pages 02 à 05, js/presence.js).
 *    Un seul UPDATE indexé ; refusé (429) s'il arrive moins de MIN_BEAT_SECONDS
 *    après le précédent. Le client ne peut toucher QUE la session de son jeton.
 *  - evaluate() : pas de tâche planifiée (serveur php -S) : les seuils sont
 *    évalués quand un écran admin interroge l'API, au plus toutes les
 *    EVAL_EVERY_SECONDS, en quelques requêtes ensemblistes. Doublons
 *    impossibles : clé unique (présence, type, seuil) + INSERT IGNORE.
 *  - Statuts : actif / inactif / connexion interrompue / session terminée.
 *    « Problème serveur confirmé » n'est JAMAIS déduit de la présence d'un
 *    client : seulement d'erreurs 5xx réellement mesurées (API ou navigateur)
 *    ou d'exceptions consignées dans le journal technique.
 *
 * Toutes les durées sont calculées par la base (NOW()) : aucune dépendance au
 * fuseau horaire de PHP.
 */
class PresenceService
{
    private const MIN_BEAT_SECONDS = 5;
    private const EVAL_EVERY_SECONDS = 10;
    private const CLEANUP_EVERY_SECONDS = 3600;
    private const NOTIF_KEEP_DAYS = 30;
    private const EXPIRE_NOTIF_AFTER_HOURS = 24;
    private const RECENT_ENDED_MINUTES = 120;
    private const HEALTH_WINDOW_MINUTES = 15;

    private const DEFAULTS = [
        'enabled' => '1', 'log_minutes' => '3', 'alert_minutes' => '5', 'idle_after_minutes' => '2',
        'idle_alert_minutes' => '10', 'heartbeat_seconds' => '30', 'slow_ms' => '2000', 'retention_days' => '7',
    ];

    private const STATUS_LABELS = [
        'active' => 'Connecté et actif', 'idle' => 'Connecté mais inactif',
        'interrupted' => 'Connexion interrompue', 'ended' => 'Session terminée',
    ];
    private const END_LABELS = ['logout' => 'Déconnexion', 'expired' => 'Expiration', 'revoked' => 'Session fermée (table libérée)'];

    private ?array $settings = null;

    public function __construct(private PDO $pdo)
    {
    }

    // ------------------------------------------------------------------
    // Réglages
    // ------------------------------------------------------------------

    public function settings(): array
    {
        if ($this->settings === null) {
            $rows = $this->pdo->query('SELECT setting_key, setting_value FROM presence_settings')->fetchAll(PDO::FETCH_KEY_PAIR);
            $s = array_merge(self::DEFAULTS, array_intersect_key($rows, self::DEFAULTS));
            $this->settings = [
                'enabled' => $s['enabled'] === '1',
                'logMinutes' => self::parseList($s['log_minutes']),
                'alertMinutes' => self::parseList($s['alert_minutes']),
                'idleAfterMinutes' => (int) $s['idle_after_minutes'],
                'idleAlertMinutes' => (int) $s['idle_alert_minutes'],
                'heartbeatSeconds' => (int) $s['heartbeat_seconds'],
                'slowMs' => (int) $s['slow_ms'],
                'retentionDays' => (int) $s['retention_days'],
            ];
        }
        return $this->settings;
    }

    /**
     * @throws InvalidArgumentException 400
     */
    public function updateSettings(array $payload, array $session): array
    {
        $map = [
            'enabled' => 'enabled', 'logMinutes' => 'log_minutes', 'alertMinutes' => 'alert_minutes',
            'idleAfterMinutes' => 'idle_after_minutes', 'idleAlertMinutes' => 'idle_alert_minutes',
            'heartbeatSeconds' => 'heartbeat_seconds', 'slowMs' => 'slow_ms', 'retentionDays' => 'retention_days',
        ];
        $ranges = [
            'idleAfterMinutes' => [1, 60, "Délai d'inactivité"], 'idleAlertMinutes' => [0, 720, "Alerte d'inactivité"],
            'heartbeatSeconds' => [15, 300, 'Intervalle du signal'], 'slowMs' => [500, 30000, 'Seuil de lenteur'],
            'retentionDays' => [1, 90, 'Conservation'],
        ];
        $values = [];
        foreach ($map as $field => $key) {
            if (!array_key_exists($field, $payload)) {
                continue;
            }
            $v = $payload[$field];
            if ($field === 'enabled') {
                if (!is_bool($v)) {
                    throw new InvalidArgumentException("enabled doit être vrai ou faux");
                }
                $values[$key] = $v ? '1' : '0';
            } elseif ($field === 'logMinutes' || $field === 'alertMinutes') {
                $list = is_array($v) ? $v : explode(',', (string) $v);
                $clean = [];
                foreach ($list as $m) {
                    $m = trim((string) $m);
                    if ($m === '') {
                        continue;
                    }
                    if (!ctype_digit($m) || (int) $m < 1 || (int) $m > 720) {
                        throw new InvalidArgumentException("Les seuils de présence sont des minutes entre 1 et 720");
                    }
                    $clean[(int) $m] = (int) $m;
                }
                if (count($clean) > 5) {
                    throw new InvalidArgumentException("5 seuils au maximum par liste");
                }
                ksort($clean);
                $values[$key] = implode(',', $clean);
            } else {
                [$min, $max, $label] = $ranges[$field];
                if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
                    throw new InvalidArgumentException("$label : nombre entier attendu");
                }
                if ((int) $v < $min || (int) $v > $max) {
                    throw new InvalidArgumentException("$label : valeur entre $min et $max attendue");
                }
                $values[$key] = (string) (int) $v;
            }
        }
        if (!$values) {
            throw new InvalidArgumentException("Aucun réglage à modifier");
        }
        $stmt = $this->pdo->prepare(
            'INSERT INTO presence_settings (setting_key, setting_value, updated_by) VALUES (:k, :v, :by)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)'
        );
        foreach ($values as $k => $v) {
            $stmt->execute(['k' => $k, 'v' => $v, 'by' => (int) $session['staff']['id']]);
        }
        Audit::log($this->pdo, $session, 'presence.settings', 'presence_settings', null, $values);
        $this->settings = null;
        return $this->settings();
    }

    // ------------------------------------------------------------------
    // Signal de l'espace client
    // ------------------------------------------------------------------

    /**
     * @throws InvalidArgumentException 400
     * @throws TooManyRequestsException 429
     */
    public function heartbeat(array $session, array $payload): array
    {
        $s = $this->settings();
        if (!$s['enabled']) {
            return ['ok' => true, 'enabled' => false];
        }
        $page = isset($payload['page']) && is_string($payload['page']) && preg_match('/^[0-9A-Za-z_-]{1,40}$/', $payload['page']) ? $payload['page'] : null;
        $device = in_array($payload['device'] ?? null, ['mobile', 'desktop'], true) ? $payload['device'] : null;
        $visible = !array_key_exists('visible', $payload) || $payload['visible'] !== false;
        $active = ($payload['active'] ?? false) === true;
        $m = is_array($payload['metrics'] ?? null) ? $payload['metrics'] : [];
        // Compteurs envoyés depuis le dernier signal accepté : plafonnés (un client ne peut pas gonfler les chiffres).
        $clamp = static fn($v, int $max): int => is_int($v) || (is_string($v) && ctype_digit($v)) ? max(0, min($max, (int) $v)) : 0;
        $params = [
            'sid' => $session['sessionId'], 'page' => $page, 'device' => $device, 'vis' => $visible ? 1 : 0, 'act' => $active ? 1 : 0,
            'net' => $clamp($m['netFailures'] ?? 0, 50), 'e5' => $clamp($m['http5xx'] ?? 0, 50),
            'slow' => $clamp($m['slow'] ?? 0, 50), 'max' => $clamp($m['maxMs'] ?? 0, 120000),
            'min' => self::MIN_BEAT_SECONDS,
        ];

        $update = $this->pdo->prepare(
            'UPDATE client_presence SET last_heartbeat_at = NOW(), visible = :vis,
                    last_activity_at = IF(:act = 1, NOW(), last_activity_at),
                    page = COALESCE(:page, page), device = COALESCE(:device, device), heartbeats = heartbeats + 1,
                    net_failures = net_failures + :net, http_5xx = http_5xx + :e5, slow_requests = slow_requests + :slow,
                    max_response_ms = GREATEST(max_response_ms, :max)
             WHERE session_id = :sid AND ended_at IS NULL
               AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= NOW() - INTERVAL :min SECOND
                    OR (visible <> :vis2 AND last_heartbeat_at <= NOW() - INTERVAL 1 SECOND))'
        );
        // Passage premier plan <-> arrière-plan : accepté même juste après un signal (au plus 1 par seconde).
        $update->execute($params + ['vis2' => $params['vis']]);
        if ($update->rowCount() === 0) {
            $row = $this->pdo->prepare('SELECT id FROM client_presence WHERE session_id = :s');
            $row->execute(['s' => $session['sessionId']]);
            if ($row->fetchColumn() !== false) {
                throw new TooManyRequestsException("Signal trop fréquent");
            }
            // Premier signal de cette session : la ligne est créée (heure de connexion = ouverture de session).
            unset($params['min']);
            $this->pdo->prepare(
                'INSERT INTO client_presence (session_id, client_id, started_at, last_heartbeat_at, last_activity_at, visible, page, device,
                                              heartbeats, net_failures, http_5xx, slow_requests, max_response_ms)
                 SELECT s.id, s.client_id, s.created_at, NOW(), IF(:act = 1, NOW(), NULL), :vis, :page, :device, 1, :net, :e5, :slow, :max
                 FROM auth_sessions s WHERE s.id = :sid
                 ON DUPLICATE KEY UPDATE last_heartbeat_at = NOW()'
            )->execute($params);
        }
        return ['ok' => true, 'enabled' => true, 'intervalSeconds' => $s['heartbeatSeconds'], 'slowMs' => $s['slowMs']];
    }

    /** Déconnexion volontaire : appelée par AuthService::logout juste avant la suppression de la session. */
    public function endSession(int $sessionId, string $reason): void
    {
        try {
            $this->pdo->prepare('UPDATE client_presence SET ended_at = NOW(), end_reason = :r WHERE session_id = :s AND ended_at IS NULL')
                ->execute(['r' => $reason, 's' => $sessionId]);
        } catch (Throwable $e) {
            error_log('[SOUCOFFE PRESENCE] ' . $e->getMessage()); // ne bloque jamais la déconnexion
        }
    }

    /**
     * Fin de requête en anomalie (5xx ou lente), mesurée par l'API elle-même :
     * consignée dans le journal technique et rattachée à la session client
     * concernée. Ne fait RIEN pour une requête normale (aucune requête SQL).
     */
    public static function recordRequestEnd(PDO $pdo, float $startedAt): void
    {
        try {
            $ms = (int) round((microtime(true) - $startedAt) * 1000);
            $status = http_response_code() ?: 200;
            if ($status < 500 && $ms < 500) {
                return; // cas normal : coût nul
            }
            $slowMs = (int) ($pdo->query("SELECT setting_value FROM presence_settings WHERE setting_key = 'slow_ms'")->fetchColumn() ?: 2000);
            $isError = $status >= 500;
            $isSlow = $ms >= $slowMs;
            if (!$isError && !$isSlow) {
                return;
            }
            Logger::log('warning', $isError ? 'http_5xx' : 'slow_request', ['status' => $status, 'ms' => $ms]);
            $token = Auth::token();
            if ($token !== null) {
                $pdo->prepare(
                    'UPDATE client_presence p JOIN auth_sessions s ON s.id = p.session_id
                     SET p.server_errors = p.server_errors + :e, p.server_slow = p.server_slow + :sl
                     WHERE s.token_hash = :h AND s.role = \'client\' AND p.ended_at IS NULL'
                )->execute(['e' => $isError ? 1 : 0, 'sl' => $isSlow ? 1 : 0, 'h' => Auth::hash($token)]);
            }
        } catch (Throwable $e) {
            // la mesure ne doit jamais casser une réponse déjà envoyée
        }
    }

    // ------------------------------------------------------------------
    // Évaluation des seuils (déclenchée par les écrans admin)
    // ------------------------------------------------------------------

    /** Évalue si la dernière évaluation date de plus de EVAL_EVERY_SECONDS (un seul écran gagne la main). */
    public function evaluateIfDue(): void
    {
        if (!$this->settings()['enabled'] || !$this->claim('last_eval_at', self::EVAL_EVERY_SECONDS)) {
            return;
        }
        $this->evaluate();
        if ($this->claim('last_cleanup_at', self::CLEANUP_EVERY_SECONDS)) {
            $this->cleanup();
        }
    }

    public function evaluate(): void
    {
        $s = $this->settings();
        $fresh = $this->freshSeconds();

        // 1. Toute session client ouverte a sa ligne de présence (sans signal = connexion interrompue).
        $this->pdo->exec(
            "INSERT IGNORE INTO client_presence (session_id, client_id, started_at)
             SELECT id, client_id, created_at FROM auth_sessions WHERE role = 'client' AND client_id IS NOT NULL AND expires_at > NOW()"
        );
        // 2. Sessions disparues ou expirées : terminées (la déconnexion volontaire est déjà marquée par endSession).
        $this->pdo->prepare(
            "UPDATE client_presence p LEFT JOIN auth_sessions s ON s.id = p.session_id
             SET p.end_reason = IF(s.id IS NOT NULL OR p.started_at <= NOW() - INTERVAL :h HOUR, 'expired', 'revoked'),
                 p.ended_at = IF(s.id IS NOT NULL, LEAST(s.expires_at, NOW()), NOW())
             WHERE p.ended_at IS NULL AND (s.id IS NULL OR s.expires_at <= NOW())"
        )->execute(['h' => Auth::SESSION_HOURS]);

        $insert = "INSERT IGNORE INTO admin_notifications (type, level, presence_id, client_id, threshold_minutes)
             SELECT :type, :level, p.id, p.client_id, :t FROM client_presence p
             WHERE p.ended_at IS NULL AND p.started_at <= NOW() - INTERVAL :t2 MINUTE AND %s";
        // 3. Présence ACTIVE prolongée : signal récent, onglet visible, interaction récente.
        $activeCond = 'p.last_heartbeat_at >= NOW() - INTERVAL :fresh SECOND AND p.visible = 1
                       AND p.last_activity_at >= NOW() - INTERVAL :idle MINUTE';
        $stmt = $this->pdo->prepare(sprintf($insert, $activeCond));
        foreach ([['info', $s['logMinutes']], ['alert', $s['alertMinutes']]] as [$level, $list]) {
            foreach ($list as $t) {
                $stmt->execute(['type' => 'presence', 'level' => $level, 't' => $t, 't2' => $t, 'fresh' => $fresh, 'idle' => $s['idleAfterMinutes']]);
            }
        }
        // 4. Inactivité prolongée (seuil distinct) : session vivante (signal récent ou onglet en arrière-plan), aucune interaction.
        if ($s['idleAlertMinutes'] > 0) {
            $idleCond = 'p.last_heartbeat_at IS NOT NULL AND (p.last_heartbeat_at >= NOW() - INTERVAL :fresh SECOND OR p.visible = 0)
                         AND COALESCE(p.last_activity_at, p.started_at) <= NOW() - INTERVAL :idle MINUTE';
            $this->pdo->prepare(sprintf($insert, $idleCond))->execute([
                'type' => 'inactivity', 'level' => 'alert', 't' => $s['idleAlertMinutes'], 't2' => 0,
                'fresh' => $fresh, 'idle' => $s['idleAlertMinutes'],
            ]);
        }
        // 5. Problème serveur CONFIRMÉ pendant la session (erreurs 5xx mesurées).
        $this->pdo->exec(
            "INSERT IGNORE INTO admin_notifications (type, level, presence_id, client_id, threshold_minutes)
             SELECT 'server_issue', 'alert', p.id, p.client_id, 0 FROM client_presence p
             WHERE p.ended_at IS NULL AND (p.server_errors > 0 OR p.http_5xx > 0)"
        );
    }

    /** Nettoyage : présences terminées anciennes, notifications clôturées anciennes, notifications orphelines expirées. */
    public function cleanup(): void
    {
        $s = $this->settings();
        $this->pdo->prepare('DELETE FROM client_presence WHERE ended_at IS NOT NULL AND ended_at < NOW() - INTERVAL :d DAY')
            ->execute(['d' => $s['retentionDays']]); // notifications liées : ON DELETE CASCADE
        $this->pdo->prepare('DELETE FROM admin_notifications WHERE closed_at IS NOT NULL AND closed_at < NOW() - INTERVAL :d DAY')
            ->execute(['d' => self::NOTIF_KEEP_DAYS]);
        $this->pdo->prepare(
            'UPDATE admin_notifications n JOIN client_presence p ON p.id = n.presence_id
             SET n.closed_at = NOW(), n.expired = 1
             WHERE n.closed_at IS NULL AND p.ended_at IS NOT NULL AND p.ended_at < NOW() - INTERVAL :h HOUR'
        )->execute(['h' => self::EXPIRE_NOTIF_AFTER_HOURS]);
    }

    // ------------------------------------------------------------------
    // Lecture (administration)
    // ------------------------------------------------------------------

    public function overview(): array
    {
        $this->evaluateIfDue();
        $rows = $this->pdo->prepare(
            $this->presenceSelect() . ' WHERE p.ended_at IS NULL OR p.ended_at >= NOW() - INTERVAL :m MINUTE
             ORDER BY p.ended_at IS NULL DESC, p.started_at DESC LIMIT 200'
        );
        $rows->execute(['m' => self::RECENT_ENDED_MINUTES]);
        $sessions = array_map(fn(array $r) => $this->publicPresence($r), $rows->fetchAll());
        $counts = ['active' => 0, 'idle' => 0, 'interrupted' => 0, 'ended' => 0, 'serverIssue' => 0];
        foreach ($sessions as $p) {
            $counts[$p['status']]++;
            if ($p['serverIssue'] && $p['status'] !== 'ended') {
                $counts['serverIssue']++;
            }
        }
        return ['settings' => $this->settings(), 'counts' => $counts, 'sessions' => $sessions, 'health' => $this->health()];
    }

    /**
     * @throws NotFoundException 404
     */
    public function detail(int $presenceId): array
    {
        $stmt = $this->pdo->prepare($this->presenceSelect() . ' WHERE p.id = :id');
        $stmt->execute(['id' => $presenceId]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new NotFoundException("Session introuvable");
        }
        $orders = $this->pdo->prepare(
            'SELECT id, status, total, payment_status, cancelled_at IS NOT NULL AS cancelled, created_at
             FROM orders WHERE client_id = :c AND created_at >= :since ORDER BY id DESC LIMIT 20'
        );
        $orders->execute(['c' => $row['client_id'], 'since' => $row['started_at']]);
        $notifs = $this->pdo->prepare('SELECT type, level, threshold_minutes, created_at FROM admin_notifications WHERE presence_id = :p ORDER BY id');
        $notifs->execute(['p' => $presenceId]);
        return $this->publicPresence($row) + [
            'orders' => array_map(static fn(array $o) => [
                'id' => (int) $o['id'], 'status' => $o['status'], 'total' => (float) $o['total'],
                'paid' => $o['payment_status'] === 'paid', 'cancelled' => (bool) $o['cancelled'], 'createdAt' => $o['created_at'],
            ], $orders->fetchAll()),
            'events' => array_map(fn(array $n) => [
                'type' => $n['type'], 'level' => $n['level'], 'title' => $this->notifTitle($n['type'], (int) $n['threshold_minutes']),
                'createdAt' => $n['created_at'],
            ], $notifs->fetchAll()),
        ];
    }

    public function notifications(array $query): array
    {
        $this->evaluateIfDue();
        $status = $query['status'] ?? 'open';
        if (!in_array($status, ['open', 'unread', 'all'], true)) {
            throw new InvalidArgumentException("status doit valoir open, unread ou all");
        }
        $where = ['open' => 'n.closed_at IS NULL', 'unread' => 'n.closed_at IS NULL AND n.read_at IS NULL', 'all' => '1 = 1'][$status];
        $rows = $this->pdo->query(
            'SELECT n.id AS notif_id, n.type, n.level, n.threshold_minutes, n.created_at AS notif_created_at,
                    TIMESTAMPDIFF(SECOND, n.created_at, NOW()) AS notif_age, n.read_at, n.closed_at, n.expired, '
            . substr($this->presenceSelect(), strlen('SELECT '))
            . " JOIN admin_notifications n ON n.presence_id = p.id WHERE $where ORDER BY n.id DESC LIMIT 100"
        )->fetchAll();
        $unread = (int) $this->pdo->query(
            "SELECT COUNT(*) FROM admin_notifications WHERE closed_at IS NULL AND read_at IS NULL AND level = 'alert'"
        )->fetchColumn();
        return [
            'unreadCount' => $unread,
            'content' => array_map(fn(array $r) => [
                'id' => (int) $r['notif_id'],
                'type' => $r['type'],
                'level' => $r['level'],
                'title' => $this->notifTitle($r['type'], (int) $r['threshold_minutes']),
                'thresholdMinutes' => (int) $r['threshold_minutes'],
                'createdAt' => $r['notif_created_at'],
                'ageSeconds' => (int) $r['notif_age'],
                'read' => $r['read_at'] !== null,
                'closed' => $r['closed_at'] !== null,
                'expired' => (bool) $r['expired'],
                'session' => $this->publicPresence($r),
            ], $rows),
        ];
    }

    /**
     * @throws NotFoundException 404
     * @throws InvalidArgumentException 400
     */
    public function actOnNotification(int $id, array $payload, array $session): array
    {
        $action = $payload['action'] ?? null;
        $sql = [
            'read' => 'UPDATE admin_notifications SET read_at = COALESCE(read_at, NOW()), read_by = COALESCE(read_by, :by) WHERE id = :id',
            'close' => 'UPDATE admin_notifications SET read_at = COALESCE(read_at, NOW()), read_by = COALESCE(read_by, :by),
                        closed_at = COALESCE(closed_at, NOW()), closed_by = COALESCE(closed_by, :by2) WHERE id = :id',
        ][$action] ?? null;
        if ($sql === null) {
            throw new InvalidArgumentException("action doit valoir read ou close");
        }
        $exists = $this->pdo->prepare('SELECT 1 FROM admin_notifications WHERE id = :id');
        $exists->execute(['id' => $id]);
        if (!$exists->fetchColumn()) {
            throw new NotFoundException("Notification introuvable");
        }
        $by = (int) $session['staff']['id'];
        $params = ['by' => $by, 'id' => $id] + ($action === 'close' ? ['by2' => $by] : []);
        $this->pdo->prepare($sql)->execute($params);
        return ['ok' => true, 'id' => $id, 'action' => $action];
    }

    public function readAll(array $session): array
    {
        $stmt = $this->pdo->prepare('UPDATE admin_notifications SET read_at = NOW(), read_by = :by WHERE read_at IS NULL AND closed_at IS NULL');
        $stmt->execute(['by' => (int) $session['staff']['id']]);
        return ['ok' => true, 'updated' => $stmt->rowCount()];
    }

    // ------------------------------------------------------------------
    // Santé de l'API (journal technique, fenêtre glissante)
    // ------------------------------------------------------------------

    /**
     * Compte les anomalies RÉELLEMENT consignées dans api/logs (fin du fichier
     * du jour seulement : lecture bornée à 256 Ko, coût constant).
     */
    public function health(): array
    {
        $out = ['windowMinutes' => self::HEALTH_WINDOW_MINUTES, 'serverErrors' => 0, 'unhandled' => 0, 'slowRequests' => 0, 'maxMs' => 0];
        $file = dirname(__DIR__) . '/logs/api-' . date('Y-m-d') . '.log';
        if (is_readable($file)) {
            $size = filesize($file);
            $fh = fopen($file, 'rb');
            if ($fh) {
                $offset = max(0, $size - 262144);
                fseek($fh, $offset);
                $chunk = stream_get_contents($fh);
                fclose($fh);
                $lines = explode("\n", (string) $chunk);
                if ($offset > 0) {
                    array_shift($lines); // première ligne possiblement tronquée
                }
                $since = time() - self::HEALTH_WINDOW_MINUTES * 60;
                foreach ($lines as $line) {
                    if ($line === '' || strpos($line, '"event"') === false) {
                        continue;
                    }
                    $e = json_decode($line, true);
                    if (!is_array($e) || !isset($e['ts']) || strtotime($e['ts']) < $since) {
                        continue;
                    }
                    if ($e['event'] === 'http_5xx') {
                        $out['serverErrors']++;
                    } elseif ($e['event'] === 'unhandled_exception') {
                        $out['unhandled']++;
                    } elseif ($e['event'] === 'slow_request') {
                        $out['slowRequests']++;
                    }
                    if (isset($e['ms'])) {
                        $out['maxMs'] = max($out['maxMs'], (int) $e['ms']);
                    }
                }
            }
        }
        $incident = $out['serverErrors'] + $out['unhandled'];
        if ($incident > 0) {
            $out['status'] = 'incident';
            $out['label'] = "Problème serveur confirmé : $incident erreur(s) serveur sur " . self::HEALTH_WINDOW_MINUTES . ' min';
        } elseif ($out['slowRequests'] > 0) {
            $out['status'] = 'slow';
            $out['label'] = $out['slowRequests'] . ' réponse(s) lente(s) sur ' . self::HEALTH_WINDOW_MINUTES . ' min, aucune erreur serveur';
        } else {
            $out['status'] = 'ok';
            $out['label'] = 'Aucune erreur serveur ni lenteur consignée sur ' . self::HEALTH_WINDOW_MINUTES . ' min';
        }
        return $out;
    }

    // ------------------------------------------------------------------
    // Interne
    // ------------------------------------------------------------------

    /** Un signal est « récent » s'il date de moins de 2 intervalles + 15 s de marge. */
    private function freshSeconds(): int
    {
        return $this->settings()['heartbeatSeconds'] * 2 + 15;
    }

    /** Verrou optimiste sur un horodatage de réglage : vrai pour UN seul appelant par période. */
    private function claim(string $key, int $everySeconds): bool
    {
        $now = time();
        $stmt = $this->pdo->prepare(
            'UPDATE presence_settings SET setting_value = :now WHERE setting_key = :k AND CAST(setting_value AS UNSIGNED) <= :cut'
        );
        $stmt->execute(['now' => (string) $now, 'k' => $key, 'cut' => $now - $everySeconds]);
        return $stmt->rowCount() === 1;
    }

    private function presenceSelect(): string
    {
        return 'SELECT p.id, p.session_id, p.client_id, p.started_at, p.last_heartbeat_at, p.last_activity_at, p.visible, p.page, p.device,
                       p.heartbeats, p.net_failures, p.http_5xx, p.slow_requests, p.max_response_ms, p.server_errors, p.server_slow,
                       p.ended_at, p.end_reason,
                       TIMESTAMPDIFF(SECOND, p.started_at, COALESCE(p.ended_at, NOW())) AS duration_s,
                       TIMESTAMPDIFF(SECOND, p.last_heartbeat_at, NOW()) AS beat_age_s,
                       TIMESTAMPDIFF(SECOND, COALESCE(p.last_activity_at, p.started_at), NOW()) AS idle_s,
                       c.first_name, c.last_name, c.table_number, c.party_size
                FROM client_presence p JOIN clients c ON c.id = p.client_id';
    }

    private function statusOf(array $r): string
    {
        if ($r['ended_at'] !== null) {
            return 'ended';
        }
        $beatAge = $r['beat_age_s'] === null ? null : (int) $r['beat_age_s'];
        if ($beatAge === null || $beatAge > $this->freshSeconds()) {
            // Onglet passé en arrière-plan (signalé) : inactif, pas une coupure.
            return $beatAge !== null && !(int) $r['visible'] ? 'idle' : 'interrupted';
        }
        if (!(int) $r['visible'] || (int) $r['idle_s'] > $this->settings()['idleAfterMinutes'] * 60) {
            return 'idle';
        }
        return 'active';
    }

    private function publicPresence(array $r): array
    {
        $status = $this->statusOf($r);
        $serverIssue = (int) $r['server_errors'] > 0 || (int) $r['http_5xx'] > 0;
        $hint = null;
        if ($status === 'interrupted') {
            $hint = $r['last_heartbeat_at'] === null
                ? "Aucun signal reçu depuis l'ouverture de la session"
                : ((int) $r['net_failures'] > 0 ? 'Plus de signal ; échecs réseau signalés par l\'appareil (réseau suspecté)' : 'Plus de signal (appareil fermé ou réseau coupé)');
        } elseif ($status === 'idle') {
            $hint = !(int) $r['visible'] ? 'Application en arrière-plan' : 'Aucune interaction récente';
        } elseif ($status === 'ended') {
            $hint = self::END_LABELS[$r['end_reason']] ?? null;
        }
        return [
            'id' => (int) $r['id'],
            'clientId' => (int) $r['client_id'],
            'name' => trim($r['first_name'] . ' ' . $r['last_name']),
            'tableNumber' => $r['table_number'],
            'partySize' => (int) $r['party_size'],
            'startedAt' => $r['started_at'],
            'durationSeconds' => (int) $r['duration_s'],
            'lastHeartbeatAt' => $r['last_heartbeat_at'],
            'lastHeartbeatAgeSeconds' => $r['beat_age_s'] === null ? null : (int) $r['beat_age_s'],
            'idleSeconds' => (int) $r['idle_s'],
            'status' => $status,
            'statusLabel' => self::STATUS_LABELS[$status],
            'statusHint' => $hint,
            'serverIssue' => $serverIssue,
            'page' => $r['page'],
            'device' => $r['device'],
            'endedAt' => $r['ended_at'],
            'endReason' => $r['end_reason'],
            'metrics' => [
                'netFailures' => (int) $r['net_failures'], 'http5xx' => (int) $r['http_5xx'],
                'slowRequests' => (int) $r['slow_requests'], 'maxResponseMs' => (int) $r['max_response_ms'],
                'serverErrors' => (int) $r['server_errors'], 'serverSlow' => (int) $r['server_slow'],
                'heartbeats' => (int) $r['heartbeats'],
            ],
        ];
    }

    private function notifTitle(string $type, int $minutes): string
    {
        if ($type === 'presence') {
            return "Client actif depuis plus de $minutes min";
        }
        if ($type === 'inactivity') {
            return "Client connecté mais inactif depuis $minutes min";
        }
        return 'Erreurs serveur pendant la session';
    }

    /** "3, 5" -> [3, 5] (entiers 1..720, triés, sans doublon). */
    private static function parseList(string $v): array
    {
        $out = [];
        foreach (explode(',', $v) as $m) {
            $m = trim($m);
            if (ctype_digit($m) && (int) $m >= 1 && (int) $m <= 720) {
                $out[(int) $m] = (int) $m;
            }
        }
        ksort($out);
        return array_values($out);
    }
}
