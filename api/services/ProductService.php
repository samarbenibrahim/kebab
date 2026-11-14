<?php
/**
 * Couche métier : orchestre le repository et transforme les lignes SQL
 * brutes en DTO exposés à l'API (jamais les lignes PDO directement).
 */
class ProductService
{
    public function __construct(
        private ProductRepository $products,
        private CategoryRepository $categories,
        private ?PDO $pdo = null
    ) {
    }

    public function listCategories(): array
    {
        return array_map(
            fn(array $row) => [
                'id' => (int) $row['id'],
                'name' => $row['name'],
                'sortOrder' => (int) $row['sort_order'],
                'menuId' => $row['menu_id'] === null ? null : (int) $row['menu_id'],
                'menuSlug' => $row['menu_slug'] ?? null,
                'menuName' => $row['menu_name'] ?? null,
            ],
            $this->categories->findAll()
        );
    }

    public function listProducts(array $filters): array
    {
        $result = $this->products->findAll($filters);
        return [
            'content' => array_map([$this, 'toProductResponse'], $result['items']),
            'page' => $filters['page'],
            'size' => $filters['limit'],
            'totalElements' => $result['total'],
        ];
    }

    public function getProduct(int $id): ?array
    {
        $product = $this->products->findById($id);
        return $product ? $this->toProductResponse($product) : null;
    }

    /**
     * Modification d'un produit par le personnel. Chaque champ exige SA
     * permission : le prix (products.price), la disponibilité (products.availability),
     * le nom / la description (products.edit). Ex. la cuisine peut déclarer une
     * rupture de stock mais pas changer un prix.
     *
     * @throws InvalidArgumentException 400
     * @throws ForbiddenException 403
     * @throws NotFoundException 404
     */
    public function updateProduct(int $id, array $payload, array $session): array
    {
        $current = $this->products->findById($id);
        if (!$current) {
            throw new NotFoundException("Produit introuvable");
        }
        $fields = [];
        $diff = [];
        if (array_key_exists('basePrice', $payload)) {
            $this->requirePermission($session, 'products.price', 'le prix');
            $p = $payload['basePrice'];
            if ((!is_int($p) && !is_float($p)) || $p <= 0 || $p > 1000) {
                throw new InvalidArgumentException("basePrice doit être un nombre entre 0 (exclu) et 1000");
            }
            $p = round((float) $p, 3);
            $fields['base_price'] = $p;
            $diff['prix'] = ['avant' => (float) $current['base_price'], 'apres' => $p];
        }
        if (array_key_exists('available', $payload)) {
            $this->requirePermission($session, 'products.availability', 'la disponibilité');
            if (!is_bool($payload['available'])) {
                throw new InvalidArgumentException("available doit être true ou false");
            }
            $fields['available'] = $payload['available'] ? 1 : 0;
            $diff['disponible'] = ['avant' => (bool) $current['available'], 'apres' => $payload['available']];
        }
        if (array_key_exists('name', $payload)) {
            $this->requirePermission($session, 'products.edit', 'le nom');
            $fields['name'] = RequestValidator::requiredText($payload['name'], 'name', 150);
            $diff['nom'] = ['avant' => $current['name'], 'apres' => $fields['name']];
        }
        if (array_key_exists('description', $payload)) {
            $this->requirePermission($session, 'products.edit', 'la description');
            $fields['description'] = RequestValidator::optionalText($payload['description'], 'description', 1000);
            $diff['description'] = 'modifiée';
        }
        // Étiquette affichée aux clients (permission products.edit) : 'popular', 'new' ou null (aucune).
        if (array_key_exists('badge', $payload)) {
            $this->requirePermission($session, 'products.edit', "l'étiquette");
            $b = $payload['badge'];
            if ($b !== null && !in_array($b, ['popular', 'new'], true)) {
                throw new InvalidArgumentException("badge doit être 'popular', 'new' ou null");
            }
            $fields['badge'] = $b;
            $diff['etiquette'] = ['avant' => $current['badge'] ?? null, 'apres' => $b];
        }
        // Photo (permission products.edit) : lien, photo importée (data URL) ou null pour revenir au visuel par défaut.
        // L'ancien fichier n'est jamais supprimé (retour en arrière possible).
        $newFile = null;
        if (array_key_exists('imageUrl', $payload) || array_key_exists('imageData', $payload)) {
            $this->requirePermission($session, 'products.edit', 'la photo');
            $imageUrl = self::validateImageUrl($payload['imageUrl'] ?? null);
            $imageData = $payload['imageData'] ?? null;
            if ($imageData !== null && $imageUrl !== null) {
                throw new InvalidArgumentException("Choisissez un lien d'image OU une photo importée, pas les deux");
            }
            if ($imageData !== null) {
                $image = self::decodeImage($imageData);
                $fileName = $current['slug'] . '-' . bin2hex(random_bytes(3)) . '.' . $image['ext'];
                $newFile = dirname(__DIR__, 2) . '/images/products/' . $fileName;
                if (@file_put_contents($newFile, $image['bytes'], LOCK_EX) === false) {
                    throw new RuntimeException("Écriture de l'image impossible : $newFile");
                }
                $imageUrl = '../images/products/' . $fileName;
            }
            $fields['image_url'] = $imageUrl;
            $diff['photo'] = $imageUrl === null ? 'retirée' : 'modifiée';
        }
        // Toutes les photos d'un coup (images[] : la 1re = principale, les autres = galerie).
        $newGallery = null;
        $written = $newFile !== null ? [$newFile] : [];
        if (array_key_exists('images', $payload)) {
            $this->requirePermission($session, 'products.edit', 'les photos');
            if (array_key_exists('imageUrl', $payload) || array_key_exists('imageData', $payload)) {
                throw new InvalidArgumentException("Utilisez images[] OU imageUrl/imageData, pas les deux");
            }
            $images = self::validateImageList($payload['images']) ?? [];
            $stored = $this->storeImages($current['slug'], $images);
            $written = $stored['files'];
            $fields['image_url'] = $stored['urls'][0] ?? null;
            $newGallery = array_slice($stored['urls'], 1);
            $diff['photos'] = count($stored['urls']);
        }
        $newGroups = null;
        if (array_key_exists('optionGroupIds', $payload)) {
            $this->requirePermission($session, 'products.edit', 'les choix');
            $newGroups = $this->validateOptionGroupIds($payload['optionGroupIds']);
            $diff['choix'] = count($newGroups);
        }
        if (!$fields && $newGallery === null && $newGroups === null) {
            throw new InvalidArgumentException("Aucun champ à modifier (basePrice, available, name, description, badge, imageUrl, imageData, images, optionGroupIds)");
        }
        $tx = $this->pdo !== null && ($newGallery !== null || $newGroups !== null);
        try {
            if ($tx) {
                $this->pdo->beginTransaction();
            }
            if ($fields) {
                $this->products->updateFields($id, $fields);
            }
            if ($newGallery !== null) {
                $this->products->replaceImages($id, $newGallery);
            }
            if ($newGroups !== null) {
                $this->products->replaceOptionGroups($id, $newGroups);
            }
            if ($tx) {
                $this->pdo->commit();
            }
        } catch (Throwable $e) {
            if ($tx && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            foreach ($written as $w) {
                @unlink($w);
            }
            throw $e;
        }
        if ($this->pdo) {
            Audit::log($this->pdo, $session, isset($diff['prix']) ? 'product.price' : 'product.update', 'product', $id, ['produit' => $current['name']] + $diff);
        }
        return $this->getProduct($id);
    }

    /** Allergènes acceptés (14 allergènes réglementaires, libellés déjà utilisés en base). */
    private const ALLERGENS = [
        'Gluten', 'Lait', 'Œufs', 'Soja', 'Fruits à coque', 'Arachides', 'Sésame', 'Moutarde',
        'Poisson', 'Crustacés', 'Mollusques', 'Céleri', 'Sulfites', 'Lupin',
    ];
    private const DIETARY_TAGS = ['vegan', 'vegetarien', 'sans-gluten'];
    private const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

    /**
     * Ajout d'un produit (permission products.create). Le slug est généré
     * depuis le nom ; le produit reçoit les options habituelles de sa
     * catégorie ; une photo importée est enregistrée dans images/products/.
     *
     * @throws InvalidArgumentException 400
     * @throws ConflictException 409
     */
    public function createProduct(array $payload, array $session): array
    {
        if (!$this->pdo) {
            throw new RuntimeException('ProductService::createProduct exige la connexion PDO');
        }
        $name =RequestValidator::requiredText($payload['name'] ?? null, 'name', 150);
        $categoryId = $payload['categoryId'] ?? null;
        if (!is_int($categoryId) && !(is_string($categoryId) && ctype_digit($categoryId))) {
            throw new InvalidArgumentException("categoryId est requis");
        }
        $categoryId = (int) $categoryId;
        // findById (et non findAll) : on peut préparer les produits d'un menu encore désactivé.
        $category = $this->categories->findById($categoryId);
        if (!$category) {
            throw new InvalidArgumentException("Catégorie inconnue");
        }
        $price = $payload['basePrice'] ?? null;
        if ((!is_int($price) && !is_float($price)) || $price <= 0 || $price > 1000) {
            throw new InvalidArgumentException("basePrice doit être un nombre entre 0 (exclu) et 1000");
        }
        $description = RequestValidator::optionalText($payload['description'] ?? null, 'description', 1000);
        $available = $payload['available'] ?? true;
        if (!is_bool($available)) {
            throw new InvalidArgumentException("available doit être true ou false");
        }
        $emoji = RequestValidator::optionalText($payload['emoji'] ?? null, 'emoji', 4);
        if ($emoji !== null && preg_match('/[A-Za-z0-9]/', $emoji)) {
            throw new InvalidArgumentException("emoji : un emoji uniquement (ex. ☕)");
        }
        $calories = $payload['calories'] ?? null;
        if ($calories !== null && (!is_int($calories) || $calories < 0 || $calories > 3000)) {
            throw new InvalidArgumentException("calories doit être un entier entre 0 et 3000");
        }
        // null = non renseigné ; [] = aucun allergène déclaré.
        $allergens = $payload['allergens'] ?? null;
        if ($allergens !== null) {
            $allergens = self::validateList($allergens, self::ALLERGENS, 'allergens');
        }
        $tags = self::validateList($payload['dietaryTags'] ?? [], self::DIETARY_TAGS, 'dietaryTags');
        $imageUrl = self::validateImageUrl($payload['imageUrl'] ?? null);
        $imageData = $payload['imageData'] ?? null;
        if ($imageData !== null && $imageUrl !== null) {
            throw new InvalidArgumentException("Choisissez un lien d'image OU une photo importée, pas les deux");
        }
        $image = $imageData !== null ? self::decodeImage($imageData) : null;
        // Plusieurs photos (images[]) : la 1re devient la photo principale, les suivantes la galerie.
        $images = self::validateImageList($payload['images'] ?? null);
        if ($images !== null && ($imageData !== null || $imageUrl !== null)) {
            throw new InvalidArgumentException("Utilisez images[] OU imageUrl/imageData, pas les deux");
        }
        $chosenGroups = array_key_exists('optionGroupIds', $payload) ? $this->validateOptionGroupIds($payload['optionGroupIds']) : null;

        if ($this->products->nameExistsInCategory($name, $categoryId)) {
            throw new ConflictException("Un produit « $name » existe déjà dans la catégorie {$category['name']}");
        }
        $slug = $this->uniqueSlug($name);

        // Photo importée : écrite sous un nom choisi par le serveur (slug + extension du type vérifié).
        $file = null;
        if ($image !== null) {
            $dir = dirname(__DIR__, 2) . '/images/products';
            $fileName = $slug . '.' . $image['ext'];
            if (file_exists($dir . '/' . $fileName)) {
                $fileName = $slug . '-' . bin2hex(random_bytes(3)) . '.' . $image['ext'];
            }
            $file = $dir . '/' . $fileName;
            if (@file_put_contents($file, $image['bytes'], LOCK_EX) === false) {
                throw new RuntimeException("Écriture de l'image impossible : $file");
            }
            $imageUrl = '../images/products/' . $fileName;
        }
        $written = $file !== null ? [$file] : [];
        $gallery = [];
        if ($images !== null) {
            $stored = $this->storeImages($slug, $images);
            $written = $stored['files'];
            $imageUrl = $stored['urls'][0] ?? null;
            $gallery = array_slice($stored['urls'], 1);
        }

        // Calculé AVANT l'insertion : le nouveau produit (encore sans option) ne doit pas compter dans la catégorie.
        // Choix faits dans l'admin (optionGroupIds) : ils remplacent les options habituelles de la catégorie.
        $groups = [];
        if ($chosenGroups !== null) {
            foreach ($chosenGroups as $i => $g) {
                $groups[$g] = ($i + 1) * 10;
            }
        } else {
            $groups = $this->products->commonOptionGroupsOfCategory($categoryId);
        }
        $this->pdo->beginTransaction();
        try {
            $id = $this->products->insert([
                'category_id' => $categoryId, 'slug' => $slug, 'name' => $name, 'description' => $description,
                'base_price' => round((float) $price, 3), 'image_url' => $imageUrl, 'emoji' => $emoji,
                'available' => $available ? 1 : 0,
                'allergens' => $allergens === null ? null : implode(',', $allergens),
                'calories' => $calories, 'dietary_tags' => implode(',', $tags),
            ]);
            $this->products->attachOptionGroups($id, $groups);
            if ($gallery) {
                $this->products->replaceImages($id, $gallery);
            }
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            foreach ($written as $w) {
                @unlink($w);
            }
            throw $e;
        }
        Audit::log($this->pdo, $session, 'product.create', 'product', $id, [
            'produit' => $name, 'categorie' => $category['name'], 'prix' => round((float) $price, 3), 'options' => count($groups),
            'photos' => ($imageUrl !== null ? 1 : 0) + count($gallery),
        ]);
        return $this->getProduct($id);
    }

    /** @throws InvalidArgumentException 400 */
    private static function validateList($value, array $allowed, string $field): array
    {
        if (!is_array($value)) {
            throw new InvalidArgumentException("$field doit être une liste");
        }
        $out = [];
        foreach ($value as $v) {
            if (!is_string($v) || !in_array($v, $allowed, true)) {
                throw new InvalidArgumentException("$field : valeur inconnue (" . implode(', ', $allowed) . ")");
            }
            $out[$v] = $v;
        }
        return array_values($out);
    }

    /** Lien http(s) ou image déjà présente sur le site (../images/...) ; rien d'autre (pas de javascript:, data:, etc.). */
    private static function validateImageUrl($value): ?string
    {
        if ($value === null || (is_string($value) && trim($value) === '')) {
            return null;
        }
        $v = is_string($value) ? trim($value) : '';
        if (strlen($v) > 500
            || !(preg_match('#^https?://[^\s<>"\'`]+$#i', $v) || preg_match('#^\.\./images/[A-Za-z0-9/_.-]+\.(jpe?g|png|webp|gif)$#i', $v))
            || strpos($v, '..', 3) !== false) {
            throw new InvalidArgumentException("imageUrl : lien http(s) ou chemin ../images/… vers une image attendu");
        }
        return $v;
    }

    /**
     * Photo envoyée en data URL (déjà compressée par le navigateur). Le
     * contenu est vérifié comme image réelle (type et dimensions lus dans les
     * octets, pas dans ce que déclare le client).
     *
     * @return array{bytes:string, ext:string}
     * @throws InvalidArgumentException 400
     */
    private static function decodeImage($value): array
    {
        if (!is_string($value) || !preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $value, $m)) {
            throw new InvalidArgumentException("imageData : photo JPEG, PNG ou WebP attendue");
        }
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || strlen($bytes) > self::MAX_IMAGE_BYTES) {
            throw new InvalidArgumentException("imageData : photo illisible ou trop lourde (2 Mo maximum)");
        }
        $info = @getimagesizefromstring($bytes);
        $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$info['mime'] ?? ''] ?? null;
        if (!$info || $ext === null || $info[0] < 16 || $info[1] < 16 || $info[0] > 4000 || $info[1] > 4000) {
            throw new InvalidArgumentException("imageData : le fichier n'est pas une image valide");
        }
        return ['bytes' => $bytes, 'ext' => $ext];
    }

    private const MAX_IMAGES = 6;

    /**
     * images[] : 0 à 6 entrées, chacune un lien (http(s) ou ../images/…) ou une photo en data URL.
     * null = champ absent. Les photos sont vérifiées ici, AVANT toute écriture.
     *
     * @return array<int, array{url:?string, image:?array}>|null
     * @throws InvalidArgumentException 400
     */
    private static function validateImageList($value): ?array
    {
        if ($value === null) {
            return null;
        }
        if (!is_array($value) || !array_is_list($value)) {
            throw new InvalidArgumentException("images doit être une liste");
        }
        if (count($value) > self::MAX_IMAGES) {
            throw new InvalidArgumentException("images : " . self::MAX_IMAGES . " photos maximum");
        }
        $out = [];
        foreach ($value as $v) {
            if (is_string($v) && str_starts_with($v, 'data:')) {
                $out[] = ['url' => null, 'image' => self::decodeImage($v)];
            } else {
                $url = self::validateImageUrl($v);
                if ($url === null) {
                    throw new InvalidArgumentException("images : entrée vide");
                }
                $out[] = ['url' => $url, 'image' => null];
            }
        }
        return $out;
    }

    /**
     * Écrit les photos importées dans images/products/ (noms choisis par le serveur).
     *
     * @return array{urls: string[], files: string[]}
     */
    private function storeImages(string $slug, array $images): array
    {
        $dir = dirname(__DIR__, 2) . '/images/products';
        $urls = [];
        $files = [];
        foreach ($images as $img) {
            if ($img['image'] === null) {
                $urls[] = $img['url'];
                continue;
            }
            $fileName = $slug . '-' . bin2hex(random_bytes(3)) . '.' . $img['image']['ext'];
            if (@file_put_contents($dir . '/' . $fileName, $img['image']['bytes'], LOCK_EX) === false) {
                foreach ($files as $f) {
                    @unlink($f);
                }
                throw new RuntimeException("Écriture de l'image impossible : $dir/$fileName");
            }
            $files[] = $dir . '/' . $fileName;
            $urls[] = '../images/products/' . $fileName;
        }
        return ['urls' => $urls, 'files' => $files];
    }

    /**
     * optionGroupIds : liste (éventuellement vide) d'ids de groupes de choix existants, sans doublon.
     *
     * @return int[]
     * @throws InvalidArgumentException 400
     */
    private function validateOptionGroupIds($value): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > 20) {
            throw new InvalidArgumentException("optionGroupIds doit être une liste (20 groupes maximum)");
        }
        $ids = [];
        foreach ($value as $v) {
            if (!is_int($v) || $v < 1) {
                throw new InvalidArgumentException("optionGroupIds : identifiants entiers attendus");
            }
            $ids[$v] = $v;
        }
        $ids = array_values($ids);
        if (count($this->products->existingOptionGroupIds($ids)) !== count($ids)) {
            throw new InvalidArgumentException("optionGroupIds : groupe de choix inconnu");
        }
        return $ids;
    }

    /** "Café Glacé Noisette" -> "cafe-glace-noisette" (puis -2, -3… si déjà pris). */
    private function uniqueSlug(string $name): string
    {
        $map = [
            'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ç' => 'c', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'î' => 'i', 'ï' => 'i', 'í' => 'i', 'ô' => 'o', 'ö' => 'o', 'ó' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ú' => 'u',
            'ÿ' => 'y', 'ñ' => 'n', 'œ' => 'oe', 'æ' => 'ae',
        ];
        $base = strtr(mb_strtolower($name), $map);
        $base = trim(preg_replace('/[^a-z0-9]+/', '-', $base), '-');
        $base = substr($base, 0, 80) ?: 'produit';
        $slug = $base;
        for ($i = 2; $this->products->slugExists($slug); $i++) {
            $slug = $base . '-' . $i;
        }
        return $slug;
    }

    /** @throws NotFoundException 404 */
    public function deleteProduct(int $id, array $session): void
    {
        $current = $this->products->findById($id);
        if (!$current) {
            throw new NotFoundException("Produit introuvable");
        }
        $this->products->softDelete($id);
        if ($this->pdo) {
            Audit::log($this->pdo, $session, 'product.delete', 'product', $id, ['produit' => $current['name']]);
        }
    }

    private function requirePermission(array $session, string $permission, string $what): void
    {
        if (!Auth::can($session, $permission)) {
            throw new ForbiddenException("Votre rôle ne permet pas de modifier $what d'un produit");
        }
    }

    private function toProductResponse(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'name' => $row['name'],
            'categoryId' => (int) $row['category_id'],
            'description' => $row['description'],
            'basePrice' => (float) $row['base_price'],
            'imageUrl' => $row['image_url'],
            'emoji' => $row['emoji'],
            'available' => (bool) $row['available'],
            // Infos indicatives (données de démonstration). allergens : null =
            // non renseigné, [] = aucun allergène déclaré.
            'allergens' => $row['allergens'] === null ? null : self::csvToList($row['allergens']),
            'calories' => $row['calories'] === null ? null : (int) $row['calories'],
            'dietaryTags' => self::csvToList($row['dietary_tags'] ?? ''),
            // Étiquette choisie dans l'admin : 'popular', 'new' ou null.
            'badge' => $row['badge'] ?? null,
            'optionGroups' => $row['optionGroups'] ?? [],
            // Galerie : photos supplémentaires, après la photo principale (imageUrl).
            'images' => $row['images'] ?? [],
        ];
    }

    private static function csvToList(?string $csv): array
    {
        if ($csv === null || trim($csv) === '') {
            return [];
        }
        return array_values(array_filter(array_map('trim', explode(',', $csv)), fn($v) => $v !== ''));
    }
}
