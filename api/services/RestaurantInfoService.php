<?php
/**
 * Infos pratiques du restaurant (adresse, téléphone, horaires, lien de carte),
 * saisies par l'admin et affichées sur l'accueil. Stockées dans un fichier JSON
 * (api/data/restaurant-info.json) : aucune table, aucune migration.
 * Rien n'est inventé : un champ vide n'est simplement pas affiché.
 */
class RestaurantInfoService
{
    private const DAYS = 7; // 0 = lundi … 6 = dimanche
    private const MAX_SLOTS = 2;

    public function __construct(private string $file)
    {
    }

    public function get(): array
    {
        $data = is_file($this->file) ? json_decode((string) file_get_contents($this->file), true) : null;
        return $this->normalize(is_array($data) ? $data : []);
    }

    public function update(array $body, PDO $pdo, array $session): array
    {
        $info = $this->validate($body);
        $info['updatedAt'] = date('c');
        $dir = dirname($this->file);
        if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
            throw new RuntimeException('Dossier de données introuvable');
        }
        $tmp = $this->file . '.tmp';
        if (file_put_contents($tmp, json_encode($info, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) === false || !rename($tmp, $this->file)) {
            throw new RuntimeException('Enregistrement impossible');
        }
        Audit::log($pdo, $session, 'restaurant_info.update', 'restaurant_info', null, []);
        return $this->get();
    }

    private function text($v, int $max, string $label): string
    {
        if ($v === null) return '';
        if (!is_string($v)) throw new InvalidArgumentException("$label : texte attendu");
        $v = trim(preg_replace('/\s+/u', ' ', $v));
        if (mb_strlen($v) > $max) throw new InvalidArgumentException("$label : $max caractères maximum");
        return $v;
    }

    private function validate(array $b): array
    {
        $phone = $this->text($b['phone'] ?? '', 30, 'Téléphone');
        if ($phone !== '' && !preg_match('/^\+?[0-9 .\-()]{6,30}$/', $phone)) {
            throw new InvalidArgumentException('Téléphone : chiffres, espaces, + . - ( ) uniquement');
        }
        $email = $this->text($b['email'] ?? '', 120, 'E-mail');
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('E-mail invalide');
        }
        $maps = $this->text($b['mapsUrl'] ?? '', 500, 'Lien de la carte');
        if ($maps !== '' && !preg_match('#^https://#i', $maps)) {
            throw new InvalidArgumentException('Lien de la carte : doit commencer par https://');
        }
        $hours = $b['hours'] ?? [];
        if (!is_array($hours) || count($hours) > self::DAYS) {
            throw new InvalidArgumentException('Horaires : 7 jours maximum');
        }
        $outHours = [];
        for ($d = 0; $d < self::DAYS; $d++) {
            $day = $hours[$d] ?? ['closed' => true, 'slots' => []];
            if (!is_array($day)) throw new InvalidArgumentException('Horaires invalides');
            $slots = [];
            foreach (array_slice((array) ($day['slots'] ?? []), 0, self::MAX_SLOTS) as $s) {
                $from = (string) ($s['from'] ?? '');
                $to = (string) ($s['to'] ?? '');
                if ($from === '' && $to === '') continue;
                if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $from) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $to)) {
                    throw new InvalidArgumentException('Horaires : format HH:MM attendu');
                }
                $slots[] = ['from' => $from, 'to' => $to];
            }
            $outHours[] = ['closed' => !empty($day['closed']) || !$slots, 'slots' => empty($day['closed']) ? $slots : []];
        }
        return [
            'address' => $this->text($b['address'] ?? '', 160, 'Adresse'),
            'city' => $this->text($b['city'] ?? '', 80, 'Ville'),
            'phone' => $phone,
            'email' => $email,
            'mapsUrl' => $maps,
            'hoursNote' => $this->text($b['hoursNote'] ?? '', 160, 'Remarque horaires'),
            'hours' => $outHours,
        ];
    }

    private function normalize(array $d): array
    {
        $hours = [];
        $hasHours = false;
        for ($i = 0; $i < self::DAYS; $i++) {
            $day = $d['hours'][$i] ?? null;
            $slots = is_array($day) ? array_values(array_filter((array) ($day['slots'] ?? []), 'is_array')) : [];
            if (is_array($day)) $hasHours = true;
            $hours[] = ['closed' => is_array($day) ? (bool) ($day['closed'] ?? !$slots) : true, 'slots' => $slots];
        }
        return [
            'address' => (string) ($d['address'] ?? ''),
            'city' => (string) ($d['city'] ?? ''),
            'phone' => (string) ($d['phone'] ?? ''),
            'email' => (string) ($d['email'] ?? ''),
            'mapsUrl' => (string) ($d['mapsUrl'] ?? ''),
            'hoursNote' => (string) ($d['hoursNote'] ?? ''),
            'hours' => $hours,
            'hasHours' => $hasHours,
            'updatedAt' => $d['updatedAt'] ?? null,
        ];
    }
}
