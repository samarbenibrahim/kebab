<?php
/**
 * Envoie une réponse JSON cohérente et arrête l'exécution.
 * Centralise le code HTTP + le Content-Type pour tous les contrôleurs.
 */
function send_json(int $statusCode, $data): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

function send_error(int $statusCode, string $message): void
{
    // Refus d'accès et limites atteintes : tracés dans le journal technique.
    if (in_array($statusCode, [401, 403, 429], true) && class_exists('Logger')) {
        Logger::log('warning', 'http_' . $statusCode, ['message' => $message]);
    }
    // Jamais de détail SQL/stack trace exposé au client (règle sécurité §38).
    send_json($statusCode, ['error' => $message]);
}

/**
 * Exécute un handler de route et traduit les exceptions métier en codes HTTP
 * (400 validation, 401/403 accès, 404, 409, 429). Le handler termine lui-même
 * par send_json(). Toute autre exception remonte au filet de sécurité global
 * (500 générique, jamais de détail SQL).
 */
function api_guard(callable $handler): void
{
    try {
        $handler();
    } catch (InvalidArgumentException $e) {
        send_error(400, $e->getMessage());
    } catch (UnauthorizedException $e) {
        send_error(401, $e->getMessage());
    } catch (ForbiddenException $e) {
        send_error(403, $e->getMessage());
    } catch (NotFoundException $e) {
        send_error(404, $e->getMessage());
    } catch (ConflictException $e) {
        send_error(409, $e->getMessage());
    } catch (TooManyRequestsException $e) {
        send_error(429, $e->getMessage());
    }
}
