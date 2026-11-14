<?php
/**
 * Filet de sécurité : toute exception non attrapée (ex. erreur PDO) est
 * transformée en réponse JSON générique — jamais de message SQL ni de stack
 * trace renvoyé au client (§38).
 */
function register_global_exception_handler(): void
{
    set_exception_handler(function (Throwable $e): void {
        error_log('[SOUCOFFE API] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
        if (class_exists('Logger')) {
            Logger::log('error', 'unhandled_exception', [
                'type' => get_class($e),
                'message' => $e->getMessage(),
                'at' => basename($e->getFile()) . ':' . $e->getLine(),
            ]);
        }
        send_error(500, "Erreur interne du serveur");
    });
}
