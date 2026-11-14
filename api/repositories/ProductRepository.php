<?php
/**
 * Accès SQL brut pour les produits + leurs groupes d'options/options.
 * Toutes les requêtes utilisent des paramètres préparés (aucune concaténation
 * de valeurs utilisateur dans le SQL).
 */
class ProductRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /**
     * @param array{categoryId?:int, available?:bool, search?:string, page:int, limit:int} $filters
     * @return array{items: array, total: int}
     */
    public function findAll(array $filters): array
    {
        $where = ['p.deleted_at IS NULL'];
        $params = [];

        if (isset($filters['categoryId'])) {
            $where[] = 'p.category_id = :categoryId';
            $params['categoryId'] = $filters['categoryId'];
        }
        if (isset($filters['available'])) {
            $where[] = 'p.available = :available';
            $params['available'] = $filters['available'] ? 1 : 0;
        }
        if (isset($filters['search']) && $filters['search'] !== '') {
            $where[] = 'p.name LIKE :search';
            $params['search'] = '%' . $filters['search'] . '%';
        }
        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $countStmt = $this->pdo->prepare("SELECT COUNT(*) FROM products p $whereSql");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $limit = $filters['limit'];
        $offset = $filters['page'] * $limit;

        $sql = "SELECT p.id, p.category_id, p.slug, p.name, p.description, p.base_price,
                       p.image_url, p.emoji, p.available, p.allergens, p.calories, p.dietary_tags, p.badge
                FROM products p
                $whereSql
                ORDER BY p.name ASC
                LIMIT :limit OFFSET :offset";
        $stmt = $this->pdo->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        $products = $stmt->fetchAll();

        if ($products) {
            $ids = array_column($products, 'id');
            $optionGroupsByProduct = $this->findOptionGroupsForProducts($ids);
            $imagesByProduct = $this->findImagesForProducts($ids);
            foreach ($products as &$product) {
                $product['optionGroups'] = $optionGroupsByProduct[$product['id']] ?? [];
                $product['images'] = $imagesByProduct[$product['id']] ?? [];
            }
            unset($product);
        }

        return ['items' => $products, 'total' => $total];
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, category_id, slug, name, description, base_price, image_url, emoji, available,
                    allergens, calories, dietary_tags, badge
             FROM products WHERE id = :id AND deleted_at IS NULL'
        );
        $stmt->execute(['id' => $id]);
        $product = $stmt->fetch();
        if (!$product) {
            return null;
        }
        $groups = $this->findOptionGroupsForProducts([$id]);
        $product['optionGroups'] = $groups[$id] ?? [];
        $product['images'] = $this->findImagesForProducts([$id])[$id] ?? [];
        return $product;
    }

    /** Met à jour les colonnes autorisées (liste blanche fixe : jamais de nom de colonne venant de l'utilisateur). */
    public function updateFields(int $id, array $fields): void
    {
        $allowed = ['base_price' => 'base_price', 'available' => 'available', 'name' => 'name', 'description' => 'description', 'image_url' => 'image_url', 'badge' => 'badge'];
        $set = [];
        $params = ['id' => $id];
        foreach ($fields as $column => $value) {
            if (!isset($allowed[$column])) {
                continue;
            }
            $set[] = $allowed[$column] . ' = :' . $column;
            $params[$column] = $value;
        }
        if ($set) {
            $this->pdo->prepare('UPDATE products SET ' . implode(', ', $set) . ' WHERE id = :id AND deleted_at IS NULL')->execute($params);
        }
    }

    /** Le slug est-il déjà pris (y compris par un produit supprimé : la clé unique couvre toutes les lignes) ? */
    public function slugExists(string $slug): bool
    {
        $stmt = $this->pdo->prepare('SELECT 1 FROM products WHERE slug = :slug');
        $stmt->execute(['slug' => $slug]);
        return (bool) $stmt->fetchColumn();
    }

    /** Un produit actif porte-t-il déjà ce nom dans cette catégorie (sans tenir compte de la casse) ? */
    public function nameExistsInCategory(string $name, int $categoryId): bool
    {
        $stmt = $this->pdo->prepare('SELECT 1 FROM products WHERE category_id = :c AND LOWER(name) = LOWER(:n) AND deleted_at IS NULL');
        $stmt->execute(['c' => $categoryId, 'n' => $name]);
        return (bool) $stmt->fetchColumn();
    }

    /** @param array<string, mixed> $p colonnes de products (liste fixe, valeurs déjà validées) */
    public function insert(array $p): int
    {
        $this->pdo->prepare(
            'INSERT INTO products (category_id, slug, name, description, base_price, image_url, emoji, available, allergens, calories, dietary_tags)
             VALUES (:category_id, :slug, :name, :description, :base_price, :image_url, :emoji, :available, :allergens, :calories, :dietary_tags)'
        )->execute([
            'category_id' => $p['category_id'], 'slug' => $p['slug'], 'name' => $p['name'], 'description' => $p['description'],
            'base_price' => $p['base_price'], 'image_url' => $p['image_url'], 'emoji' => $p['emoji'], 'available' => $p['available'],
            'allergens' => $p['allergens'], 'calories' => $p['calories'], 'dietary_tags' => $p['dietary_tags'],
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Groupes d'options communs à TOUS les produits actifs d'une catégorie
     * (ex. Cafés : Service, Taille, Lait, Sucre, Extras), dans leur ordre
     * habituel. Une catégorie hétérogène (Petit-déjeuner, Offres) n'en a aucun.
     *
     * @return array<int, int> option_group_id => sort_order
     */
    public function commonOptionGroupsOfCategory(int $categoryId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT pog.option_group_id, MIN(pog.sort_order) AS so
             FROM product_option_groups pog JOIN products p ON p.id = pog.product_id AND p.deleted_at IS NULL
             WHERE p.category_id = :c
             GROUP BY pog.option_group_id
             HAVING COUNT(DISTINCT p.id) = (SELECT COUNT(*) FROM products WHERE category_id = :c2 AND deleted_at IS NULL)
             ORDER BY so'
        );
        $stmt->execute(['c' => $categoryId, 'c2' => $categoryId]);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_KEY_PAIR));
    }

    /** @param array<int, int> $groups option_group_id => sort_order */
    public function attachOptionGroups(int $productId, array $groups): void
    {
        $stmt = $this->pdo->prepare('INSERT IGNORE INTO product_option_groups (product_id, option_group_id, sort_order) VALUES (:p, :g, :s)');
        foreach ($groups as $groupId => $sort) {
            $stmt->execute(['p' => $productId, 'g' => $groupId, 's' => $sort]);
        }
    }

    public function softDelete(int $id): void
    {
        $this->pdo->prepare('UPDATE products SET deleted_at = NOW(), available = 0 WHERE id = :id AND deleted_at IS NULL')->execute(['id' => $id]);
    }

    public function findBySlug(string $slug): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id FROM products WHERE slug = :slug AND deleted_at IS NULL');
        $stmt->execute(['slug' => $slug]);
        $id = $stmt->fetchColumn();
        return $id ? $this->findById((int) $id) : null;
    }

    /**
     * Photos supplémentaires (galerie), dans l'ordre, pour un lot de produits.
     *
     * @param int[] $productIds
     * @return array<int, string[]>
     */
    private function findImagesForProducts(array $productIds): array
    {
        if (!$productIds) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($productIds), '?'));
        $stmt = $this->pdo->prepare("SELECT product_id, url FROM product_images WHERE product_id IN ($placeholders) ORDER BY sort_order, id");
        $stmt->execute(array_values($productIds));
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[$r['product_id']][] = $r['url'];
        }
        return $out;
    }

    /** Remplace la galerie d'un produit (liste d'URL déjà validées). */
    public function replaceImages(int $productId, array $urls): void
    {
        $this->pdo->prepare('DELETE FROM product_images WHERE product_id = :p')->execute(['p' => $productId]);
        $stmt = $this->pdo->prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (:p, :u, :s)');
        foreach (array_values($urls) as $i => $url) {
            $stmt->execute(['p' => $productId, 'u' => $url, 's' => $i]);
        }
    }

    /** Remplace les groupes de choix d'un produit (ids déjà validés, dans l'ordre voulu). */
    public function replaceOptionGroups(int $productId, array $groupIds): void
    {
        $this->pdo->prepare('DELETE FROM product_option_groups WHERE product_id = :p')->execute(['p' => $productId]);
        $groups = [];
        foreach (array_values($groupIds) as $i => $g) {
            $groups[(int) $g] = ($i + 1) * 10;
        }
        $this->attachOptionGroups($productId, $groups);
    }

    /** @return int[] ids des groupes d'options qui existent parmi ceux demandés */
    public function existingOptionGroupIds(array $ids): array
    {
        if (!$ids) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->pdo->prepare("SELECT id FROM option_groups WHERE id IN ($placeholders)");
        $stmt->execute(array_values($ids));
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    /**
     * Charge les groupes d'options + options pour un lot de produits en 2
     * requêtes (évite le N+1 : une requête par produit serait ici une erreur
     * de performance explicitement à éviter, §41).
     *
     * @param int[] $productIds
     * @return array<int, array> groupes indexés par product_id
     */
    private function findOptionGroupsForProducts(array $productIds): array
    {
        if (!$productIds) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($productIds), '?'));

        $groupsStmt = $this->pdo->prepare(
            "SELECT pog.product_id, og.id, og.name, og.selection_type, og.is_required,
                    og.min_select, og.max_select, pog.sort_order
             FROM product_option_groups pog
             JOIN option_groups og ON og.id = pog.option_group_id
             WHERE pog.product_id IN ($placeholders)
             ORDER BY pog.sort_order ASC"
        );
        $groupsStmt->execute($productIds);
        $groupRows = $groupsStmt->fetchAll();

        if (!$groupRows) {
            return [];
        }
        $groupIds = array_unique(array_column($groupRows, 'id'));
        $optPlaceholders = implode(',', array_fill(0, count($groupIds), '?'));
        $optionsStmt = $this->pdo->prepare(
            "SELECT id, option_group_id, label, price_delta, sort_order
             FROM options WHERE option_group_id IN ($optPlaceholders)
             ORDER BY sort_order ASC"
        );
        $optionsStmt->execute(array_values($groupIds));
        $optionRows = $optionsStmt->fetchAll();

        $optionsByGroup = [];
        foreach ($optionRows as $opt) {
            $optionsByGroup[$opt['option_group_id']][] = [
                'id' => (int) $opt['id'],
                'label' => $opt['label'],
                'priceDelta' => (float) $opt['price_delta'],
            ];
        }

        $result = [];
        foreach ($groupRows as $row) {
            $result[$row['product_id']][] = [
                'id' => (int) $row['id'],
                'name' => $row['name'],
                'selectionType' => $row['selection_type'],
                'isRequired' => (bool) $row['is_required'],
                'minSelect' => (int) $row['min_select'],
                'maxSelect' => $row['max_select'] !== null ? (int) $row['max_select'] : null,
                'options' => $optionsByGroup[$row['id']] ?? [],
            ];
        }
        return $result;
    }
}
