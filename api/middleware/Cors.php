<?php
/**
 * En-têtes CORS : le frontend actuel est servi en fichiers statiques
 * (file:// ou un serveur simple sur un autre port que l'API), il faut donc
 * autoriser explicitement les appels fetch() cross-origin.
 */
function apply_cors_headers(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Idempotency-Key, X-Auth-Token');
    header('Access-Control-Expose-Headers: Idempotent-Replayed');
    // En-têtes de sécurité : réponses JSON jamais interprétées comme autre chose,
    // jamais affichées dans un cadre, jamais mises en cache (données personnelles).
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Cache-Control: no-store');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}
