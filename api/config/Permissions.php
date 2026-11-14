<?php
/**
 * Rôles et permissions du personnel. C'est LA source de vérité : l'API refuse
 * (403) toute action dont la permission manque, quel que soit ce que l'écran
 * affiche. Le front n'utilise cette liste que pour masquer ce qui serait refusé.
 *
 * Rôles : admin, manager, server (SERVEUR), cashier (CAISSIER), kitchen (CUISINE).
 * L'admin possède toutes les permissions (« gérer tout »).
 */
class Permissions
{
    /** Toutes les permissions connues (= celles de l'admin). */
    public const ALL = [
        'orders.view.all',     // voir toutes les commandes
        'orders.view.own',     // voir les commandes de SES tables (serveur)
        'orders.prepare',      // Nouvelle -> En préparation -> Prête
        'orders.serve',        // Prête -> Servie
        'orders.cancel',       // annuler une commande
        'payments.collect',    // encaisser (espèces / carte)
        'calls.handle',        // voir et acquitter les appels serveur
        'tables.view',         // plan de salle complet
        'tables.view.own',     // plan de salle : ses tables
        'tables.manage',       // ajouter / supprimer une table du plan
        'tables.clean',        // marquer une table nettoyée
        'tables.release',      // libérer une table (fin de service)
        'bill.request',        // marquer « addition demandée »
        'table_requests.respond', // répondre aux changements de table des clients
        'takeaway.respond',    // répondre aux demandes « à emporter » des clients
        'products.price',      // modifier un prix
        'products.availability', // marquer disponible / en rupture
        'products.edit',       // modifier nom, description
        'products.delete',     // supprimer un produit
        'products.create',     // ajouter un produit au catalogue
        'catalog.manage',      // gérer les menus (cartes) et les catégories
        'promotions.view',
        'promotions.manage',
        'loyalty.view',
        'loyalty.adjust',
        'stats.view',          // statistiques
        'audit.view',          // journal d'audit / historique
        'staff.manage',        // gérer les employés
        // Module « SOUCOFFE Intelligent » (ajouts) :
        'ai.manage',           // activer/désactiver le module, régler les créneaux
        'stock.view',          // voir le Smart Stock
        'stock.manage',        // saisir inventaires, livraisons, recettes
        // Surveillance des sessions clients (migration 022) :
        'presence.view',       // clients connectés, centre de notifications, santé de l'API
        'presence.manage',     // régler les seuils de surveillance
    ];

    private const MATRIX = [
        'manager' => [
            'orders.view.all', 'orders.prepare', 'orders.serve', 'orders.cancel', 'payments.collect',
            'calls.handle', 'tables.view', 'tables.manage', 'tables.clean', 'tables.release', 'bill.request',
            'table_requests.respond', 'takeaway.respond', 'products.price', 'products.availability', 'products.edit', 'products.delete', 'products.create', 'catalog.manage',
            'promotions.view', 'promotions.manage', 'loyalty.view', 'loyalty.adjust',
            'stats.view', 'audit.view', 'staff.manage',
            'ai.manage', 'stock.view', 'stock.manage',
            'presence.view', 'presence.manage',
        ],
        'server' => [
            'orders.view.own', 'orders.serve', 'calls.handle', 'tables.view.own', 'tables.clean', 'bill.request',
        ],
        'cashier' => [
            'orders.view.all', 'payments.collect', 'tables.view', 'tables.release', 'tables.clean', 'bill.request',
            'takeaway.respond',
        ],
        'kitchen' => [
            'orders.view.all', 'orders.prepare', 'products.availability',
        ],
    ];

    public const STAFF_ROLES = ['admin', 'manager', 'server', 'cashier', 'kitchen'];

    public const ROLE_LABELS = [
        'admin' => 'Administrateur', 'manager' => 'Manager', 'server' => 'Serveur',
        'cashier' => 'Caissier', 'kitchen' => 'Cuisine',
    ];

    /** @return string[] */
    public static function forRole(string $role): array
    {
        if ($role === 'admin') {
            return self::ALL;
        }
        return self::MATRIX[$role] ?? [];
    }

    public static function has(string $role, string $permission): bool
    {
        return in_array($permission, self::forRole($role), true);
    }
}
