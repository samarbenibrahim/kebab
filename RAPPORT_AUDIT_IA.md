# Audit avant le module « SOUCOFFE Intelligent »

Date : 2 octobre 2026. Audit en lecture seule : aucun fichier ni aucune donnée n'a été modifié pendant cette phase.

## 1. Architecture actuelle

```
Navigateur (client / équipe)
  pages HTML statiques + Tailwind (CDN) + css/soucoffe.css + js/*.js
        │  fetch JSON, en-tête X-Auth-Token
        ▼
API PHP 8.3 sans framework  — api/index.php (routeur manuel)
  controllers/ → services/ → repositories/ ; middleware/Auth.php ; config/Permissions.php
        │  PDO, requêtes préparées
        ▼
MariaDB « soucoffe » (compte soucoffe_app) — schéma par migrations numérotées database/migrations/000→019
```

- **Serveurs** : `php -S 0.0.0.0:8000 api/index.php` (API) et `php -S 0.0.0.0:8080 scripts/lan_router.php` (site sur le Wi-Fi ; refuse `api/`, `database/`, `scripts/`, `.php`, `.sql`, `.vbs`).
- **Démarrage** : `scripts/start-backend.vbs`, `scripts/start-lan.vbs` (MariaDB + API + site). Pas de démarrage automatique.
- **PWA** : `manifest.json` + icônes `images/brand/`. Pas de service worker (pas de mode hors ligne).
- **Notifications** : aucune notification push ; les écrans interrogent l'API à intervalle (cuisine 4 s, admin 5 s, demandes à emporter 6 s, suivi client 8 s).
- **Cache** : aucun cache serveur. Cache navigateur `localStorage` (panier, catalogue, historique local des commandes).
- **Configuration** : `api/config/database.php` (identifiants en dur, prototype local), `api/config/Permissions.php`.

## 2. Fonctionnalités existantes

Client : page QR, identification sans mot de passe, accueil, menu, page cafés, fiche produit avec options, petit-déjeuner à composer, panier intelligent, commande, suivi en direct, appel serveur, addition, changement de table, demande à emporter, fidélité, favoris, recherche tolérante aux fautes, assistant « Suggérez-moi » (règles côté navigateur, `js/recommendations.js` + `SoucoffeAssistant`), suggestions selon l'heure, « vus récemment », mode sombre.

Équipe : tableau de bord, commandes, produits, plan de salle, statistiques (`/stats/summary`), employés, promotions + suggestions de promotions (`/promotions/suggestions`), fidélité, historique (audit), caisse, cuisine (colonnes + ruptures), serveur, pile de notifications.

## 3. Tables existantes (22)

| Domaine | Tables |
|---|---|
| Carte | `categories` (10), `products` (43, suppression douce `deleted_at`), `option_groups` (17), `options` (60), `product_option_groups` (103) |
| Commandes | `orders` (8 lignes, 7 visibles), `order_items`, `order_item_options`, `order_status_history` |
| Clients | `clients`, `auth_sessions`, `table_change_requests`, `takeaway_requests`, `waiter_calls` |
| Salle | `restaurant_tables` (13), `server_tables` |
| Équipe | `staff` (5), `audit_log` |
| Marketing | `promotions` (0), `loyalty_accounts`, `loyalty_transactions` |
| Technique | `schema_migrations` |

Relations principales : `orders.client_id → clients`, `order_items.order_id → orders`, `order_items.product_id → products`, `order_item_options → order_items / options`, `products.category_id → categories`, `clients.loyalty_account_id → loyalty_accounts`, `promotions → categories / products / staff`.

**Pas de table de stock** (seulement la disponibilité `products.available`). **Pas de remboursements** dans le système (le paiement n'a que `pending` / `paid` ; une annulation se fait via `cancelled_at`).

## 4. Volume et qualité des données

- 7 commandes non supprimées, du 20 au 28 septembre 2026, sur 3 jours distincts. 0 servie au sens du statut final, 0 annulée.
- 15 changements de statut enregistrés (base des temps de préparation).
- Conséquence : **aucun modèle de machine learning n'est justifiable aujourd'hui**. Les modules utiliseront des règles et des statistiques simples, avec un indicateur de fiabilité, et signaleront quand les données sont insuffisantes.

## 5. Routes API existantes (~60)

Public : `GET /categories`, `GET /products`, `GET /products/{id}`, `GET /promotions/active`, `POST /auth/login`, `POST /clients`.
Session : `POST /auth/logout`, `GET /auth/me`.
Commandes : `POST /orders`, `POST /orders/preview`, `GET /orders`, `GET /orders/{id}`, `GET /orders/{id}/eta`, `GET /waiting-time`, `PATCH /orders/{id}/status|payment|cancel`.
Produits : `PATCH|DELETE /products/{id}`.
Clients : `GET|PATCH /clients/me`, `PATCH /clients/me/table`, `/table-change-requests…`, `/takeaway-requests…`, `GET /loyalty/me`, `POST /tables/bill-request`, `POST|GET /waiter-calls`, `PATCH /waiter-calls/{id}/acknowledge`.
Salle : `GET|POST /tables`, `DELETE /tables/{n}`, `POST /tables/{n}/bill|release|clean`, `PATCH /tables/{n}/payment`, `GET /tables/occupied`.
Direction : `/promotions` (+ `/suggestions`), `/loyalty…`, `GET /stats/summary`, `GET /audit`, `/staff…`.

## 6. Sécurité en place

- Jeton opaque de 64 caractères, seul son hash SHA-256 est stocké ; sessions de 12 h.
- Mots de passe hachés (`password_hash` / `password_verify`), verrouillage après échecs.
- Permissions par rôle vérifiées **côté serveur** à chaque route (`Auth::requirePermission`), 26 permissions, 5 rôles.
- Prix toujours recalculés par le serveur ; idempotence des commandes (clé unique).
- Journal d'audit des actions sensibles.
- Requêtes préparées partout ; erreurs PHP jamais renvoyées au client.

## 7. Tests existants

Pas de dossier de tests dans le projet. Les tests sont des bancs d'essai navigateur (Edge sans fenêtre) dans le dossier temporaire de session : parcours complet (34 vérifications), en-tête mobile (32), audit responsive (102 écrans). Ils seront relancés après chaque étape.

## 8. Risques identifiés

| Risque | Mesure |
|---|---|
| Casser l'API existante en ajoutant des routes | Toutes les nouvelles routes sous le préfixe `/ai/…`, dans un fichier séparé chargé à la demande ; une erreur dans le module ne touche que `/ai/…` |
| Ralentir les pages | Calculs mis en cache en base (TTL), appels du module en arrière-plan, jamais bloquants |
| Dépendance au module | Interrupteur `ai.enabled` ; si désactivé ou en panne, l'interface masque les blocs et garde l'existant |
| Prévisions trompeuses avec 7 commandes | Toujours étiquetées « Prévision », avec fourchette, taille d'échantillon et niveau de fiabilité |
| Stock modifié automatiquement | Interdit : le stock réel n'est changé que par une saisie humaine (inventaire, livraison) ; la consommation est une **estimation calculée**, jamais écrite |
| Promotions créées par l'IA | Interdit : le module propose un brouillon ; seule la création manuelle existante l'enregistre |
| `database/import_products.php` | Ne jamais lancer (écrase les prix) |

## 9. Fichiers qui seront modifiés (ajouts uniquement)

- `api/index.php` : une branche de routage `/ai/…` (avant la réponse 404).
- `api/config/Permissions.php` : 3 permissions **ajoutées** (`ai.manage`, `stock.view`, `stock.manage`), données à l'administrateur (automatique) et au manager. Aucune permission retirée.
- `js/admin.js` : la vue `intelligence` ajoutée à la liste des vues.
- `06-Admin-Dashboard/code.html` : un lien de menu, un conteneur de vue, un script.
- `12-Cuisine/code.html` et `home/home.html` : un script ajouté chacun.
- `css/soucoffe.css` : un bloc de styles ajouté en fin de fichier.

## 10. Fichiers à ne pas toucher

`api/config/database.php`, `api/middleware/Auth.php`, `api/services/OrderService.php`, `PromotionService.php`, `LoyaltyService.php`, `api/repositories/*`, `database/migrations/000→019`, `database/import_products.php` (à ne jamais exécuter), `scripts/lan_router.php`, `js/cart.js`, `js/auth.js`, `04-Panier`, `05-Suivi-Commande`, les données des tables existantes.

## 11. Nouveaux éléments prévus (additifs)

- Migration `020_intelligence.sql` : nouvelles tables `ai_settings`, `ai_cache`, `ai_interactions`, `stock_items`, `stock_movements`, `stock_recipes`. Aucune table existante modifiée.
- Dossier `api/ai/` : routes, services (assistant client, recommandations, BI, prévisions, anomalies, cuisine, stock, assistant manager, suggestions de promotions).
- Scripts `js/ai-client.js`, `js/ai-admin.js`, `js/ai-kitchen.js`.
- Sauvegarde complète avant modification : `Downloads/soucoffe_backups/` (hors du dossier servi sur le Wi-Fi).
