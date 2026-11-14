<?php
/**
 * Validation minimale des paramètres de requête entrants (§38 : ne jamais
 * faire confiance à l'entrée utilisateur, même sur des endpoints GET).
 */
class RequestValidator
{
    /**
     * @throws InvalidArgumentException
     */
    public static function validateProductFilters(array $query): array
    {
        $filters = ['page' => 0, 'limit' => 50];

        if (isset($query['categoryId'])) {
            if (!ctype_digit((string) $query['categoryId'])) {
                throw new InvalidArgumentException("categoryId doit être un entier positif");
            }
            $filters['categoryId'] = (int) $query['categoryId'];
        }

        if (isset($query['available'])) {
            $val = strtolower((string) $query['available']);
            if (!in_array($val, ['true', 'false', '1', '0'], true)) {
                throw new InvalidArgumentException("available doit être true ou false");
            }
            $filters['available'] = in_array($val, ['true', '1'], true);
        }

        if (isset($query['search'])) {
            $search = trim((string) $query['search']);
            if (mb_strlen($search) > 100) {
                throw new InvalidArgumentException("search trop long (max 100 caractères)");
            }
            $filters['search'] = $search;
        }

        if (isset($query['page'])) {
            if (!ctype_digit((string) $query['page'])) {
                throw new InvalidArgumentException("page doit être un entier positif ou nul");
            }
            $filters['page'] = (int) $query['page'];
        }

        if (isset($query['limit'])) {
            if (!ctype_digit((string) $query['limit']) || (int) $query['limit'] < 1 || (int) $query['limit'] > 100) {
                throw new InvalidArgumentException("limit doit être compris entre 1 et 100");
            }
            $filters['limit'] = (int) $query['limit'];
        }

        return $filters;
    }

    /**
     * @throws InvalidArgumentException
     */
    public static function validateId($rawId): int
    {
        if (!ctype_digit((string) $rawId)) {
            throw new InvalidArgumentException("Identifiant invalide");
        }
        return (int) $rawId;
    }

    // ---- Phase 3 : commandes ----

    private const ORDER_STATUSES = ['Nouvelle', 'En préparation', 'Prête', 'Servie'];

    /**
     * @throws InvalidArgumentException
     */
    public static function parseJsonBody(string $raw): array
    {
        if (trim($raw) === '') {
            throw new InvalidArgumentException("Le corps de la requête est vide");
        }
        $data = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
            throw new InvalidArgumentException("JSON invalide : " . json_last_error_msg());
        }
        return $data;
    }

    /**
     * @throws InvalidArgumentException
     */
    public static function validateOrderFilters(array $query): array
    {
        $filters = ['page' => 0, 'limit' => 20];

        if (isset($query['status'])) {
            if (!in_array($query['status'], self::ORDER_STATUSES, true)) {
                throw new InvalidArgumentException("status invalide : doit être l'un de " . implode(', ', self::ORDER_STATUSES));
            }
            $filters['status'] = $query['status'];
        }

        if (isset($query['tableNumber'])) {
            $table = trim((string) $query['tableNumber']);
            if ($table === '' || mb_strlen($table) > 20) {
                throw new InvalidArgumentException("tableNumber invalide");
            }
            $filters['tableNumber'] = $table;
        }

        if (isset($query['page'])) {
            if (!ctype_digit((string) $query['page'])) {
                throw new InvalidArgumentException("page doit être un entier positif ou nul");
            }
            $filters['page'] = (int) $query['page'];
        }

        if (isset($query['limit'])) {
            if (!ctype_digit((string) $query['limit']) || (int) $query['limit'] < 1 || (int) $query['limit'] > 100) {
                throw new InvalidArgumentException("limit doit être compris entre 1 et 100");
            }
            $filters['limit'] = (int) $query['limit'];
        }

        return $filters;
    }

    /**
     * @throws InvalidArgumentException
     */
    public static function validateStatusPayload(array $body): string
    {
        if (!isset($body['status']) || !is_string($body['status'])) {
            throw new InvalidArgumentException("status est requis (chaîne de caractères)");
        }
        if (!in_array($body['status'], self::ORDER_STATUSES, true)) {
            throw new InvalidArgumentException("status invalide : doit être l'un de " . implode(', ', self::ORDER_STATUSES));
        }
        return $body['status'];
    }

    private const PAYMENT_METHODS = ['online', 'cash', 'card'];

    /**
     * @throws InvalidArgumentException
     */
    public static function validatePaymentPayload(array $body): string
    {
        if (!isset($body['method']) || !is_string($body['method'])) {
            throw new InvalidArgumentException("method est requis (chaîne de caractères)");
        }
        if (!in_array($body['method'], self::PAYMENT_METHODS, true)) {
            throw new InvalidArgumentException("method invalide : doit être l'un de " . implode(', ', self::PAYMENT_METHODS));
        }
        return $body['method'];
    }

    /**
     * Numéro de table : chaîne courte non vide (« 5 », « T12 », « Terrasse 3 »).
     *
     * @throws InvalidArgumentException
     */
    public static function tableNumber($value, string $field = 'tableNumber'): string
    {
        if (!is_string($value) && !is_int($value)) {
            throw new InvalidArgumentException("$field est requis");
        }
        $t = trim((string) $value);
        if ($t === '') {
            throw new InvalidArgumentException("$field est requis");
        }
        // Liste blanche : lettres, chiffres, espace, point, tiret, souligné, dièse. Ni guillemets, ni apostrophes, ni
        // barres obliques ni chevrons : un numéro de table finit dans des pages et des URL, il ne doit jamais pouvoir
        // être interprété comme du code.
        if ($t === '—' || mb_strlen($t) > 20 || !preg_match('/^[\p{L}\p{N} ._#-]+$/u', $t)) {
            throw new InvalidArgumentException("$field invalide (20 caractères maximum : lettres, chiffres, espace, . _ - #)");
        }
        return $t;
    }

    /**
     * Texte obligatoire (nom, prénom…) : chaîne non vide, longueur bornée.
     *
     * @throws InvalidArgumentException
     */
    public static function requiredText($value, string $field, int $max): string
    {
        if (!is_string($value) || trim($value) === '') {
            throw new InvalidArgumentException("$field est requis");
        }
        $t = trim(preg_replace('/\s+/u', ' ', $value));
        if (mb_strlen($t) > $max || preg_match('/[\x00-\x1F<>]/u', $t)) {
            throw new InvalidArgumentException("$field invalide (max $max caractères, sans < ni >)");
        }
        return $t;
    }

    /**
     * Texte facultatif : null/absent/vide => null.
     *
     * @throws InvalidArgumentException
     */
    public static function optionalText($value, string $field, int $max): ?string
    {
        if ($value === null) {
            return null;
        }
        if (!is_string($value)) {
            throw new InvalidArgumentException("$field doit être une chaîne de caractères");
        }
        $t = trim($value);
        if ($t === '') {
            return null;
        }
        if (mb_strlen($t) > $max || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F<>]/u', $t)) {
            throw new InvalidArgumentException("$field invalide (max $max caractères, sans < ni >)");
        }
        return $t;
    }

    /**
     * @throws InvalidArgumentException
     */
    public static function partySize($value): int
    {
        if (!is_int($value) || $value < 1 || $value > 50) {
            throw new InvalidArgumentException("partySize doit être un entier entre 1 et 50");
        }
        return $value;
    }
}
