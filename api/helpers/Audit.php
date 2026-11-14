<?php
/**
 * Journal d'audit : qui a fait quoi, quand, sur quoi. Écrit par l'API à chaque
 * action sensible (connexions, comptes, produits, commandes, paiements, tables,
 * promotions, fidélité). Une panne du journal ne doit jamais bloquer l'action
 * métier : elle est signalée dans le log PHP.
 */
class Audit
{
    /**
     * @param array|null $session session courante (Auth::require) ou null (système / échec de connexion)
     * @param array|null $actor   acteur explicite {type, id, name, role} quand il n'y a pas de session
     */
    public static function log(PDO $pdo, ?array $session, string $action, string $entity, $entityId = null, array $details = [], ?array $actor = null): void
    {
        try {
            if ($actor === null) {
                if ($session === null) {
                    $actor = ['type' => 'system', 'id' => null, 'name' => null, 'role' => null];
                } elseif ($session['role'] === 'client') {
                    $c = $session['client'];
                    $actor = ['type' => 'client', 'id' => (int) $c['id'], 'name' => trim($c['first_name'] . ' ' . $c['last_name']), 'role' => 'client'];
                } else {
                    $s = $session['staff'];
                    $actor = ['type' => 'staff', 'id' => (int) $s['id'], 'name' => $s['display_name'], 'role' => $s['role']];
                }
            }
            $json = $details ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
            if ($json !== null && strlen($json) > 2000) {
                $json = substr($json, 0, 1990) . '…"}';
            }
            $pdo->prepare(
                'INSERT INTO audit_log (actor_type, actor_id, actor_name, actor_role, action, entity, entity_id, details, ip)
                 VALUES (:t, :i, :n, :r, :a, :e, :eid, :d, :ip)'
            )->execute([
                't' => $actor['type'], 'i' => $actor['id'], 'n' => $actor['name'], 'r' => $actor['role'],
                'a' => $action, 'e' => $entity, 'eid' => $entityId === null ? null : (string) $entityId,
                'd' => $json, 'ip' => substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45) ?: null,
            ]);
        } catch (Throwable $e) {
            error_log('[SOUCOFFE AUDIT] ' . $e->getMessage());
        }
    }
}
