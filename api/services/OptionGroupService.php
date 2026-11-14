<?php
/**
 * Groupes de choix (« Pain », « Sauce », « Taille »…) gérés depuis l'admin
 * (permission catalog.manage : admin, manager).
 *
 *  - Un groupe a un nom, un type (1 choix / plusieurs), « obligatoire » ou non,
 *    un maximum (plusieurs choix) et ses choix (libellé + supplément en euros).
 *  - Un choix déjà commandé n'est jamais supprimé (l'historique des commandes
 *    en dépend) : 409. Un groupe utilisé par un produit ne peut pas être supprimé.
 *  - Les groupes sont ensuite attachés aux produits depuis la fiche produit
 *    (optionGroupIds, ProductService).
 * Chaque action est inscrite au journal d'audit.
 */
class OptionGroupService
{
    public function __construct(private PDO $pdo)
    {
    }

    /** Tous les groupes, avec leurs choix, les produits qui les utilisent et s'ils ont déjà été commandés. */
    public function all(): array
    {
        $groups = $this->pdo->query('SELECT id, name, selection_type, is_required, min_select, max_select FROM option_groups ORDER BY name, id')->fetchAll();
        $options = $this->pdo->query(
            'SELECT o.id, o.option_group_id, o.label, o.price_delta,
                    (SELECT COUNT(*) FROM order_item_options oio WHERE oio.option_id = o.id) AS ordered
             FROM options o ORDER BY o.sort_order, o.id'
        )->fetchAll();
        $products = $this->pdo->query(
            'SELECT pog.option_group_id, p.name FROM product_option_groups pog
             JOIN products p ON p.id = pog.product_id AND p.deleted_at IS NULL ORDER BY p.name'
        )->fetchAll();
        $optByGroup = [];
        foreach ($options as $o) {
            $optByGroup[(int) $o['option_group_id']][] = [
                'id' => (int) $o['id'], 'label' => $o['label'], 'priceDelta' => (float) $o['price_delta'], 'ordered' => (int) $o['ordered'] > 0,
            ];
        }
        $prodByGroup = [];
        foreach ($products as $p) {
            $prodByGroup[(int) $p['option_group_id']][] = $p['name'];
        }
        return array_map(fn($g) => [
            'id' => (int) $g['id'],
            'name' => $g['name'],
            'multiple' => $g['selection_type'] === 'MULTIPLE',
            'required' => (bool) $g['is_required'],
            'max' => $g['max_select'] === null ? null : (int) $g['max_select'],
            'options' => $optByGroup[(int) $g['id']] ?? [],
            'products' => $prodByGroup[(int) $g['id']] ?? [],
        ], $groups);
    }

    public function create(array $b, array $session): array
    {
        $g = $this->validateGroup($b, true);
        $options = $this->validateOptions($b['options'] ?? null);
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare(
                'INSERT INTO option_groups (name, selection_type, is_required, min_select, max_select) VALUES (:n, :t, :r, :mi, :ma)'
            )->execute($g);
            $id = (int) $this->pdo->lastInsertId();
            $this->writeOptions($id, $options);
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        Audit::log($this->pdo, $session, 'option_group.create', 'option_group', $id, ['nom' => $g['n'], 'choix' => count($options)]);
        return $this->one($id);
    }

    public function update(int $id, array $b, array $session): array
    {
        $current = $this->row($id);
        $g = $this->validateGroup($b + [
            'name' => $current['name'], 'multiple' => $current['selection_type'] === 'MULTIPLE',
            'required' => (bool) $current['is_required'], 'max' => $current['max_select'] === null ? null : (int) $current['max_select'],
        ], false);
        $options = array_key_exists('options', $b) ? $this->validateOptions($b['options']) : null;
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare(
                'UPDATE option_groups SET name = :n, selection_type = :t, is_required = :r, min_select = :mi, max_select = :ma WHERE id = :id'
            )->execute($g + ['id' => $id]);
            if ($options !== null) {
                $this->writeOptions($id, $options);
            }
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        Audit::log($this->pdo, $session, 'option_group.update', 'option_group', $id, ['nom' => $g['n']]);
        return $this->one($id);
    }

    public function delete(int $id, array $session): void
    {
        $current = $this->row($id);
        $used = $this->pdo->prepare('SELECT COUNT(*) FROM product_option_groups pog JOIN products p ON p.id = pog.product_id AND p.deleted_at IS NULL WHERE pog.option_group_id = :g');
        $used->execute(['g' => $id]);
        if ((int) $used->fetchColumn() > 0) {
            throw new ConflictException("Ce groupe est utilisé par des produits : retirez-le d'abord de ces produits");
        }
        $ordered = $this->pdo->prepare('SELECT COUNT(*) FROM order_item_options oio JOIN options o ON o.id = oio.option_id WHERE o.option_group_id = :g');
        $ordered->execute(['g' => $id]);
        if ((int) $ordered->fetchColumn() > 0) {
            throw new ConflictException("Ce groupe a déjà été commandé : il est conservé pour l'historique des commandes");
        }
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('DELETE FROM product_option_groups WHERE option_group_id = :g')->execute(['g' => $id]);
            $this->pdo->prepare('DELETE FROM options WHERE option_group_id = :g')->execute(['g' => $id]);
            $this->pdo->prepare('DELETE FROM option_groups WHERE id = :g')->execute(['g' => $id]);
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
        Audit::log($this->pdo, $session, 'option_group.delete', 'option_group', $id, ['nom' => $current['name']]);
    }

    // ------------------------------------------------------------------

    private function one(int $id): array
    {
        foreach ($this->all() as $g) {
            if ($g['id'] === $id) {
                return $g;
            }
        }
        throw new NotFoundException("Groupe de choix introuvable");
    }

    private function row(int $id): array
    {
        $s = $this->pdo->prepare('SELECT * FROM option_groups WHERE id = :id');
        $s->execute(['id' => $id]);
        $row = $s->fetch();
        if (!$row) {
            throw new NotFoundException("Groupe de choix introuvable");
        }
        return $row;
    }

    /** @return array{n:string, t:string, r:int, mi:int, ma:?int} */
    private function validateGroup(array $b, bool $creating): array
    {
        $name = RequestValidator::requiredText($b['name'] ?? null, 'name', 60);
        foreach (['multiple', 'required'] as $k) {
            if (isset($b[$k]) && !is_bool($b[$k])) {
                throw new InvalidArgumentException("$k doit être true ou false");
            }
        }
        $multiple = (bool) ($b['multiple'] ?? false);
        $required = (bool) ($b['required'] ?? false);
        $max = $b['max'] ?? null;
        if ($max !== null && (!is_int($max) || $max < 1 || $max > 20)) {
            throw new InvalidArgumentException("max doit être un entier entre 1 et 20 (ou vide)");
        }
        return [
            'n' => $name, 't' => $multiple ? 'MULTIPLE' : 'SINGLE', 'r' => $required ? 1 : 0,
            'mi' => $required ? 1 : 0, 'ma' => $multiple ? $max : 1,
        ];
    }

    /** @return array<int, array{id:?int, label:string, price:float}> */
    private function validateOptions($value): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) < 1 || count($value) > 30) {
            throw new InvalidArgumentException("options : 1 à 30 choix attendus");
        }
        $out = [];
        $labels = [];
        foreach ($value as $i => $o) {
            if (!is_array($o)) {
                throw new InvalidArgumentException("options[$i] doit être un objet");
            }
            $label = RequestValidator::requiredText($o['label'] ?? null, "options[$i].label", 80);
            $key = mb_strtolower($label);
            if (isset($labels[$key])) {
                throw new InvalidArgumentException("Le choix « $label » est en double");
            }
            $labels[$key] = true;
            $price = $o['priceDelta'] ?? 0;
            if ((!is_int($price) && !is_float($price)) || $price < 0 || $price > 100) {
                throw new InvalidArgumentException("options[$i].priceDelta doit être un nombre entre 0 et 100");
            }
            $id = $o['id'] ?? null;
            if ($id !== null && (!is_int($id) || $id < 1)) {
                throw new InvalidArgumentException("options[$i].id invalide");
            }
            $out[] = ['id' => $id, 'label' => $label, 'price' => round((float) $price, 3)];
        }
        return $out;
    }

    /** Applique la liste des choix : met à jour, ajoute, et retire ceux qui ne sont plus listés (jamais commandés). */
    private function writeOptions(int $groupId, array $options): void
    {
        $existing = $this->pdo->prepare('SELECT id FROM options WHERE option_group_id = :g');
        $existing->execute(['g' => $groupId]);
        $existingIds = array_map('intval', $existing->fetchAll(PDO::FETCH_COLUMN));
        $kept = [];
        foreach ($options as $o) {
            if ($o['id'] !== null) {
                if (!in_array($o['id'], $existingIds, true)) {
                    throw new InvalidArgumentException("Choix inconnu dans ce groupe");
                }
                $kept[] = $o['id'];
            }
        }
        foreach (array_diff($existingIds, $kept) as $gone) {
            $s = $this->pdo->prepare('SELECT COUNT(*) FROM order_item_options WHERE option_id = :o');
            $s->execute(['o' => $gone]);
            if ((int) $s->fetchColumn() > 0) {
                throw new ConflictException("Un choix déjà commandé ne peut pas être retiré (historique des commandes)");
            }
            $this->pdo->prepare('DELETE FROM options WHERE id = :o')->execute(['o' => $gone]);
        }
        // Libellés provisoires d'abord : échanger deux libellés ne heurte pas la clé unique (groupe, libellé).
        $tmp = $this->pdo->prepare("UPDATE options SET label = CONCAT('~', id) WHERE id = :id");
        foreach ($kept as $k) {
            $tmp->execute(['id' => $k]);
        }
        $upd = $this->pdo->prepare('UPDATE options SET label = :l, price_delta = :p, sort_order = :s WHERE id = :id');
        $ins = $this->pdo->prepare('INSERT INTO options (option_group_id, label, price_delta, sort_order) VALUES (:g, :l, :p, :s)');
        foreach ($options as $i => $o) {
            if ($o['id'] !== null) {
                $upd->execute(['l' => $o['label'], 'p' => $o['price'], 's' => ($i + 1) * 10, 'id' => $o['id']]);
            } else {
                $ins->execute(['g' => $groupId, 'l' => $o['label'], 'p' => $o['price'], 's' => ($i + 1) * 10]);
            }
        }
    }
}
