<?php
/**
 * Exceptions métier typées pour que le contrôleur puisse choisir le bon code
 * HTTP sans avoir à interpréter des messages texte.
 */
class NotFoundException extends RuntimeException
{
}

class ConflictException extends RuntimeException
{
}
// InvalidArgumentException (native PHP) est réutilisée pour les erreurs de
// validation (400), exactement comme le fait déjà RequestValidator en Phase 1.

// 401 : pas de session valide (jeton absent, expiré ou révoqué).
class UnauthorizedException extends RuntimeException
{
}

// 403 : session valide mais rôle insuffisant pour cette action.
class ForbiddenException extends RuntimeException
{
}

// 429 : trop de tentatives de connexion (verrouillage temporaire du compte).
class TooManyRequestsException extends RuntimeException
{
}
