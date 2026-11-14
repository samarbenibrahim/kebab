<?php
/**
 * Menus (cartes : Café, Kebab, …) et catégories (migration 023).
 *
 *  - Public : menus actifs avec leurs catégories (pages de menu, accueil).
 *  - Administration (permission catalog.manage : admin, manager) : créer,
 *    renommer, (dés)activer, réordonner, supprimer. Suppression refusée (409)
 *    tant qu'un menu contient des catégories ou qu'une catégorie est utilisée
 *    par un produit (même supprimé : l'historique des commandes en dépend).
 *    Le menu « cafe » (menu historique du site) ne peut être ni supprimé ni désactivé.
 * Chaque action est inscrite au journal d'audit.
 */
class CatalogService
{
    private const CORE_MENU = 'cafe';

    public function __construct(private PDO $pdo)
    {
    }

    // ------------------------------------------------------------------
    // Lecture
    // ------------------------------------------------------------------

    /** @param bool $all true = menus inactifs compris (administration) */
    public function menus(bool $all = false): array
    {
        $menus = $this->pdo->query(
            'SELECT id, slug, name, tagline, sort_order, active FROM menus' . ($all ? '' : ' WHERE active = 1') . ' ORDER BY sort_order, id'
        )->fetchAll();
        $cats = $this->pdo->query(
            'SELECT c.id, c.name, c.sort_order, c.menu_id,
                    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS products,
                    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS all_products
             FROM categories c ORDER BY c.sort_order, c.id'
        )->fetchAll();
        $byMenu = [];
        foreach ($cats as $c) {
            $byMenu[(int) $c['menu_id']][] = [
                'id' => (int) $c['id'], 'name' => $c['name'], 'sortOrder' => (int) $c['sort_order'],
                'products' => (int) $c['products'],
                'deletable' => (int) $c['all_products'] === 0,
            ];
        }
        return array_map(fn(array $m) => [
            'id' => (int) $m['id'], 'slug' => $m['slug'], 'name' => $m['name'], 'tagline' => $m['tagline'],
            'sortOrder' => (int) $m['sort_order'], 'active' => (bool) $m['active'], 'core' => $m['slug'] === self::CORE_MENU,
            'categories' => $byMenu[(int) $m['id']] ?? [],
        ], $menus);
    }

    // ------------------------------------------------------------------
    // Menus
    // ------------------------------------------------------------------

    /**
     * @throws InvalidArgumentException 400
     * @throws ConflictException 409
     */
    public function createMenu(array $b, array $session): array
    {
        $name = RequestValidator::requiredText($b['name'] ?? null, 'name', 80);
        $tagline = RequestValidator::optionalText($b['tagline'] ?? null, 'tagline', 160);
        $this->assertNameFree('menus', $name, null, "Un menu « $name » existe déjà");
        $slug = $this->uniqueSlug($name);
        $sort = (int) $this->pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menus')->fetchColumn();
        $this->pdo->prepare('INSERT INTO menus (slug, name, tagline, sort_order) VALUES (:s, :n, :t, :o)')
            ->execute(['s' => $slug, 'n' => $name, 't' => $tagline, 'o' => $sort]);
        $id = (int) $this->pdo->lastInsertId();
        Audit::log($this->pdo, $session, 'menu.create', 'menu', $id, ['menu' => $name]);
        return $this->menu($id);
    }

    /**
     * @throws InvalidArgumentException 400
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function updateMenu(int $id, array $b, array $session): array
    {
        $cur = $this->menuRow($id);
        $set = [];
        if (array_key_exists('name', $b)) {
            $set['name'] = RequestValidator::requiredText($b['name'], 'name', 80);
            $this->assertNameFree('menus', $set['name'], $id, "Un menu « {$set['name']} » existe déjà");
        }
        if (array_key_exists('tagline', $b)) {
            $set['tagline'] = RequestValidator::optionalText($b['tagline'], 'tagline', 160);
        }
        if (array_key_exists('active', $b)) {
            if (!is_bool($b['active'])) {
                throw new InvalidArgumentException("active doit être true ou false");
            }
            if (!$b['active'] && $cur['slug'] === self::CORE_MENU) {
                throw new ConflictException("Le menu principal ne peut pas être désactivé");
            }
            $set['active'] = $b['active'] ? 1 : 0;
        }
        if (array_key_exists('sortOrder', $b)) {
            $set['sort_order'] = self::intIn($b['sortOrder'], 'sortOrder', 0, 1000);
        }
        if (!$set) {
            throw new InvalidArgumentException("Aucun champ à modifier");
        }
        $this->update('menus', $id, $set);
        Audit::log($this->pdo, $session, 'menu.update', 'menu', $id, ['menu' => $cur['name']] + $set);
        return $this->menu($id);
    }

    /**
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function deleteMenu(int $id, array $session): void
    {
        $cur = $this->menuRow($id);
        if ($cur['slug'] === self::CORE_MENU) {
            throw new ConflictException("Le menu principal ne peut pas être supprimé");
        }
        $n = $this->pdo->prepare('SELECT COUNT(*) FROM categories WHERE menu_id = :m');
        $n->execute(['m' => $id]);
        if ((int) $n->fetchColumn() > 0) {
            throw new ConflictException("Ce menu contient des catégories : déplacez-les ou supprimez-les d'abord");
        }
        $this->pdo->prepare('DELETE FROM menus WHERE id = :id')->execute(['id' => $id]);
        Audit::log($this->pdo, $session, 'menu.delete', 'menu', $id, ['menu' => $cur['name']]);
    }

    // ------------------------------------------------------------------
    // Catégories
    // ------------------------------------------------------------------

    /**
     * @throws InvalidArgumentException 400
     * @throws ConflictException 409
     */
    public function createCategory(array $b, array $session): array
    {
        $name = RequestValidator::requiredText($b['name'] ?? null, 'name', 100);
        $menuId = self::intIn($b['menuId'] ?? null, 'menuId', 1, PHP_INT_MAX);
        $menu = $this->menuRow($menuId, true);
        $this->assertNameFree('categories', $name, null, "Une catégorie « $name » existe déjà");
        $sort = array_key_exists('sortOrder', $b)
            ? self::intIn($b['sortOrder'], 'sortOrder', 0, 10000)
            : (int) $this->pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories')->fetchColumn();
        $this->pdo->prepare('INSERT INTO categories (menu_id, name, sort_order) VALUES (:m, :n, :o)')
            ->execute(['m' => $menuId, 'n' => $name, 'o' => $sort]);
        $id = (int) $this->pdo->lastInsertId();
        Audit::log($this->pdo, $session, 'category.create', 'category', $id, ['categorie' => $name, 'menu' => $menu['name']]);
        return $this->category($id);
    }

    /**
     * @throws InvalidArgumentException 400
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function updateCategory(int $id, array $b, array $session): array
    {
        $cur = $this->categoryRow($id);
        $set = [];
        if (array_key_exists('name', $b)) {
            $set['name'] = RequestValidator::requiredText($b['name'], 'name', 100);
            $this->assertNameFree('categories', $set['name'], $id, "Une catégorie « {$set['name']} » existe déjà");
        }
        if (array_key_exists('menuId', $b)) {
            $set['menu_id'] = self::intIn($b['menuId'], 'menuId', 1, PHP_INT_MAX);
            $this->menuRow($set['menu_id'], true);
        }
        if (array_key_exists('sortOrder', $b)) {
            $set['sort_order'] = self::intIn($b['sortOrder'], 'sortOrder', 0, 10000);
        }
        if (!$set) {
            throw new InvalidArgumentException("Aucun champ à modifier");
        }
        $this->update('categories', $id, $set);
        Audit::log($this->pdo, $session, 'category.update', 'category', $id, ['categorie' => $cur['name']] + $set);
        return $this->category($id);
    }

    /**
     * @throws NotFoundException 404
     * @throws ConflictException 409
     */
    public function deleteCategory(int $id, array $session): void
    {
        $cur = $this->categoryRow($id);
        $n = $this->pdo->prepare('SELECT COUNT(*) FROM products WHERE category_id = :c');
        $n->execute(['c' => $id]);
        if ((int) $n->fetchColumn() > 0) {
            throw new ConflictException("Cette catégorie contient des produits (ou en a contenu, pour l'historique des commandes) : elle ne peut pas être supprimée");
        }
        $this->pdo->prepare('DELETE FROM categories WHERE id = :id')->execute(['id' => $id]);
        Audit::log($this->pdo, $session, 'category.delete', 'category', $id, ['categorie' => $cur['name']]);
    }

    // ------------------------------------------------------------------
    // Interne
    // ------------------------------------------------------------------

    private function menu(int $id): array
    {
        foreach ($this->menus(true) as $m) {
            if ($m['id'] === $id) {
                return $m;
            }
        }
        throw new NotFoundException("Menu introuvable");
    }

    private function category(int $id): array
    {
        $r = $this->categoryRow($id);
        return ['id' => (int) $r['id'], 'name' => $r['name'], 'sortOrder' => (int) $r['sort_order'], 'menuId' => (int) $r['menu_id']];
    }

    /** @throws NotFoundException 404 (ou 400 si $asInput : identifiant fourni dans le corps) */
    private function menuRow(int $id, bool $asInput = false): array
    {
        $s = $this->pdo->prepare('SELECT * FROM menus WHERE id = :id');
        $s->execute(['id' => $id]);
        $r = $s->fetch();
        if (!$r) {
            if ($asInput) {
                throw new InvalidArgumentException("Menu inconnu");
            }
            throw new NotFoundException("Menu introuvable");
        }
        return $r;
    }

    private function categoryRow(int $id): array
    {
        $s = $this->pdo->prepare('SELECT * FROM categories WHERE id = :id');
        $s->execute(['id' => $id]);
        $r = $s->fetch();
        if (!$r) {
            throw new NotFoundException("Catégorie introuvable");
        }
        return $r;
    }

    /** Noms uniques sans tenir compte de la casse. */
    private function assertNameFree(string $table, string $name, ?int $exceptId, string $message): void
    {
        $s = $this->pdo->prepare("SELECT id FROM $table WHERE LOWER(name) = LOWER(:n)" . ($exceptId ? ' AND id <> :id' : ''));
        $s->execute(['n' => $name] + ($exceptId ? ['id' => $exceptId] : []));
        if ($s->fetchColumn() !== false) {
            throw new ConflictException($message);
        }
    }

    /** @param array<string, mixed> $set colonnes fixées par le code (jamais par l'utilisateur) */
    private function update(string $table, int $id, array $set): void
    {
        $cols = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($set)));
        $this->pdo->prepare("UPDATE $table SET $cols WHERE id = :id")->execute($set + ['id' => $id]);
    }

    private function uniqueSlug(string $name): string
    {
        $map = ['à' => 'a', 'â' => 'a', 'ä' => 'a', 'ç' => 'c', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'î' => 'i', 'ï' => 'i',
            'ì' => 'i', 'ô' => 'o', 'ö' => 'o', 'ò' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ñ' => 'n', 'œ' => 'oe'];
        $base = trim(preg_replace('/[^a-z0-9]+/', '-', strtr(mb_strtolower($name), $map)), '-');
        $base = substr($base, 0, 30) ?: 'menu';
        $slug = $base;
        $check = $this->pdo->prepare('SELECT 1 FROM menus WHERE slug = :s');
        for ($i = 2; $check->execute(['s' => $slug]) && $check->fetchColumn(); $i++) {
            $slug = $base . '-' . $i;
        }
        return $slug;
    }

    /** @throws InvalidArgumentException 400 */
    private static function intIn($v, string $field, int $min, int $max): int
    {
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw new InvalidArgumentException("$field doit être un entier");
        }
        $v = (int) $v;
        if ($v < $min || $v > $max) {
            throw new InvalidArgumentException("$field hors limites");
        }
        return $v;
    }
}
