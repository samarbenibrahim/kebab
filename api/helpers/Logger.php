<?php
/**
 * Journal technique structuré (une ligne JSON par événement) dans
 * api/logs/api-AAAA-MM-JJ.log — dossier jamais servi (l'API ne sert aucun
 * fichier, le routeur du site refuse /api).
 * Complète le journal d'audit métier (table audit_log) sans le remplacer.
 * Ne journalise JAMAIS de mot de passe, de jeton ni de corps de requête.
 */
class Logger
{
    public static function log(string $level, string $event, array $context = []): void
    {
        try {
            $dir = dirname(__DIR__) . '/logs';
            if (!is_dir($dir)) {
                @mkdir($dir, 0750, true);
            }
            $line = [
                'ts' => date('c'),
                'level' => $level,
                'event' => $event,
                'method' => $_SERVER['REQUEST_METHOD'] ?? null,
                'path' => isset($_SERVER['REQUEST_URI']) ? (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : null,
                'ip' => $_SERVER['REMOTE_ADDR'] ?? null,
            ] + self::clean($context);
            @file_put_contents($dir . '/api-' . date('Y-m-d') . '.log',
                json_encode($line, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        } catch (Throwable $e) {
            // le journal ne doit jamais casser une réponse
        }
    }

    /** Retire toute clé sensible, au cas où un appelant en passerait une. */
    private static function clean(array $c): array
    {
        foreach (array_keys($c) as $k) {
            if (preg_match('/pass|token|secret|authorization|cookie/i', (string) $k)) {
                $c[$k] = '[masqué]';
            }
        }
        return $c;
    }
}
