<?php
// Défense en profondeur (§38) : même si le gestionnaire global attrape déjà
// tout, aucune erreur/avertissement PHP ne doit jamais atterrir dans une
// réponse HTTP (repli au cas où une extension serait mal configurée en prod).
ini_set('display_errors', '0');
error_reporting(E_ALL);

/**
 * Front controller minimal (pas de framework, routage manuel volontairement
 * simple — §4 "ne pas créer une architecture artificiellement compliquée").
 *
 * PUBLIC
 *   GET  /api/categories, /api/products, /api/products/{id}, /api/promotions/active
 *   POST /api/auth/login            connexion du personnel
 *   POST /api/clients               identification d'un client
 *
 * Tout le reste exige l'en-tête X-Auth-Token (session ouverte par l'une des deux
 * routes ci-dessus). Les droits sont des PERMISSIONS par rôle (api/config/Permissions.php) :
 * admin (tout), manager, serveur, caissier, cuisine ; le client n'a que ses propres données.
 *
 *   Commandes    POST /orders, /orders/preview (client) · GET /orders, /orders/{id}, /orders/{id}/eta, /waiting-time ·
 *                PATCH /orders/{id}/status (orders.prepare | orders.serve) · /payment (client: en ligne ;
 *                personnel: payments.collect) · /cancel (client propriétaire | orders.cancel)
 *   Produits     POST /products (products.create) · PATCH /products/{id} (products.price | .availability | .edit selon le champ) · DELETE (products.delete)
 *   À emporter   POST /takeaway-requests · GET /takeaway-requests/mine · PATCH .../{id}/cancel (client) ·
 *                GET /takeaway-requests · PATCH .../{id}/respond (takeaway.respond)
 *   Appels       POST /waiter-calls (client) · GET, PATCH .../acknowledge (calls.handle)
 *   Tables       GET/POST /tables, DELETE /tables/{n} (tables.manage), POST /tables/bill-request (client),
 *                POST /tables/{n}/bill|release|clean, PATCH /tables/{n}/payment
 *   Promotions   GET /promotions(+/suggestions) (promotions.view) · POST/PATCH/DELETE (promotions.manage)
 *   Fidélité     GET /loyalty/me (client) · GET /loyalty, /loyalty/{id} (loyalty.view) · POST /loyalty/{id}/adjust
 *   Direction    GET /stats/summary (stats.view) · GET /audit (audit.view)
 *   Personnel    GET|POST /staff, PATCH|DELETE /staff/{id}, PUT /staff/{id}/tables (staff.manage) · GET|PUT /staff/me/tables (serveur)
 *   Clients      GET|PATCH /clients/me · PATCH /clients/me/table · POST /table-change-requests ·
 *                GET /table-change-requests/mine · PATCH .../{id}/cancel · GET /table-change-requests,
 *                PATCH .../{id}/respond, GET /tables/occupied (table_requests.respond)
 *   Menus        GET /menus (public) · GET /admin/menus, POST /menus, PATCH|DELETE /menus/{id},
 *                POST /categories, PATCH|DELETE /categories/{id} (catalog.manage)
 *   Infos        GET /restaurant-info (public), PUT /restaurant-info (catalog.manage)
 *   Choix        GET /admin/option-groups, POST /option-groups, PATCH|DELETE /option-groups/{id} (catalog.manage)
 *   Groupe       GET /group, POST /group/items, DELETE /group/items/{id}, POST /group/send (client)
 *   Session      POST /auth/logout · GET /auth/me
 *   Présence     POST /presence/heartbeat (client) · GET /admin/presence(+/{id}), GET /admin/notifications,
 *                PATCH /admin/notifications/{id}|read-all (presence.view) · GET|PUT /admin/presence-settings (presence.manage)
 */
require __DIR__ . '/helpers/Logger.php';
require __DIR__ . '/helpers/JsonResponse.php';
require __DIR__ . '/helpers/Audit.php';
require __DIR__ . '/exception/ApiExceptions.php';
require __DIR__ . '/exception/GlobalExceptionHandler.php';
require __DIR__ . '/middleware/Cors.php';
require __DIR__ . '/config/Permissions.php';
require __DIR__ . '/middleware/Auth.php';
require __DIR__ . '/config/database.php';
require __DIR__ . '/validators/RequestValidator.php';
require __DIR__ . '/repositories/CategoryRepository.php';
require __DIR__ . '/repositories/ProductRepository.php';
require __DIR__ . '/repositories/OrderRepository.php';
require __DIR__ . '/repositories/WaiterCallRepository.php';
require __DIR__ . '/repositories/AuthRepository.php';
require __DIR__ . '/repositories/ClientRepository.php';
require __DIR__ . '/repositories/TakeawayRepository.php';
require __DIR__ . '/services/ProductService.php';
require __DIR__ . '/services/PromotionService.php';
require __DIR__ . '/services/LoyaltyService.php';
require __DIR__ . '/services/WaitingTimeService.php';
require __DIR__ . '/services/TableService.php';
require __DIR__ . '/services/StatsService.php';
require __DIR__ . '/services/OrderService.php';
require __DIR__ . '/services/WaiterCallService.php';
require __DIR__ . '/services/AuthService.php';
require __DIR__ . '/services/ClientService.php';
require __DIR__ . '/services/TakeawayService.php';
require __DIR__ . '/services/PresenceService.php';
require __DIR__ . '/services/CatalogService.php';
require __DIR__ . '/services/OptionGroupService.php';
require __DIR__ . '/services/GroupOrderService.php';
require __DIR__ . '/services/RestaurantInfoService.php';
require __DIR__ . '/controllers/CategoryController.php';
require __DIR__ . '/controllers/ProductController.php';
require __DIR__ . '/controllers/OrderController.php';
require __DIR__ . '/controllers/WaiterCallController.php';
require __DIR__ . '/controllers/AuthController.php';
require __DIR__ . '/controllers/ClientController.php';
require __DIR__ . '/controllers/TableController.php';
require __DIR__ . '/controllers/ManagementController.php';
require __DIR__ . '/controllers/TakeawayController.php';
require __DIR__ . '/controllers/PresenceController.php';
require __DIR__ . '/controllers/CatalogController.php';
require __DIR__ . '/controllers/GroupController.php';
require __DIR__ . '/controllers/RestaurantInfoController.php';

register_global_exception_handler();
apply_cors_headers();

$pdo = get_pdo_connection();
// Fin de chaque requête : seules les anomalies (5xx, lenteur) sont consignées ; coût nul sinon.
register_shutdown_function(static function () use ($pdo): void {
    PresenceService::recordRequestEnd($pdo, (float) ($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true)));
});
$productRepository = new ProductRepository($pdo);
$productService = new ProductService($productRepository, new CategoryRepository($pdo), $pdo);
$promotionService = new PromotionService($pdo);
$loyaltyService = new LoyaltyService($pdo);
$tableService = new TableService($pdo);
$orderService = new OrderService($pdo, $productService, new OrderRepository($pdo), $promotionService, $loyaltyService, $tableService);
$clientRepository = new ClientRepository($pdo);
$authService = new AuthService($pdo, new AuthRepository($pdo), $clientRepository, $loyaltyService, $tableService);
$clientService = new ClientService($pdo, $clientRepository, $tableService);
$waiterService = new WaiterCallService(new WaiterCallRepository($pdo));

$orders = new OrderController($orderService, $pdo);
$waiter = new WaiterCallController($waiterService, $pdo);
$auth = new AuthController($authService);
$clients = new ClientController($authService, $clientService);
$tables = new TableController($tableService, $orderService, $pdo);
$takeaway = new TakeawayController(new TakeawayService($pdo, new TakeawayRepository($pdo)));
$mgmt = new ManagementController($promotionService, $loyaltyService, new StatsService($pdo), $pdo);
$presence = new PresenceController(new PresenceService($pdo));
$catalog = new CatalogController(new CatalogService($pdo));
$group = new GroupController(new GroupOrderService($pdo, $orderService), new OptionGroupService($pdo));
$restaurantInfo = new RestaurantInfoController(new RestaurantInfoService(__DIR__ . '/data/restaurant-info.json'), $pdo);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = preg_replace('#^/api#', '', rtrim($path, '/'));
$method = $_SERVER['REQUEST_METHOD'];
$body = static fn(): string => file_get_contents('php://input');

// Gardes d'accès (401 sans session, 403 sans le bon rôle / la bonne permission).
$anyone = static fn(): array => Auth::require($pdo, array_merge(Permissions::STAFF_ROLES, ['client']));
$staff = static fn(): array => Auth::require($pdo, Permissions::STAFF_ROLES);
$client = static fn(): array => Auth::require($pdo, ['client']);
$perm = static fn($p): array => Auth::requirePermission($pdo, $p);

try {
    // ---- Public ----
    if ($method === 'GET' && $path === '/categories') {
        (new CategoryController($productService))->index();
    } elseif ($method === 'GET' && $path === '/products') {
        (new ProductController($productService))->index($_GET);
    } elseif ($method === 'GET' && preg_match('#^/products/([^/]+)$#', $path, $m)) {
        (new ProductController($productService))->show($m[1]);
    } elseif ($method === 'GET' && $path === '/menus') {
        $catalog->menus(false);
    } elseif ($method === 'GET' && $path === '/restaurant-info') {
        $restaurantInfo->show();
    } elseif ($method === 'PUT' && $path === '/restaurant-info') {
        $restaurantInfo->update($body(), $perm('catalog.manage'));
    } elseif ($method === 'GET' && $path === '/promotions/active') {
        $mgmt->promotionsActive();
    } elseif ($method === 'POST' && $path === '/auth/login') {
        $auth->login($body());
    } elseif ($method === 'POST' && $path === '/clients') {
        $clients->register($body());

    // ---- Session ----
    } elseif ($method === 'POST' && $path === '/auth/logout') {
        $auth->logout($anyone());
    } elseif ($method === 'GET' && $path === '/auth/me') {
        $auth->me($anyone());

    // ---- Produits (personnel : permission par champ, vérifiée dans le service) ----
    } elseif ($method === 'POST' && $path === '/products') {
        (new ProductController($productService))->create($body(), $perm('products.create'));
    } elseif ($method === 'PATCH' && preg_match('#^/products/([^/]+)$#', $path, $m)) {
        (new ProductController($productService))->update($m[1], $body(), $staff());
    } elseif ($method === 'DELETE' && preg_match('#^/products/([^/]+)$#', $path, $m)) {
        (new ProductController($productService))->delete($m[1], $perm('products.delete'));

    // ---- Commandes ----
    } elseif ($method === 'POST' && $path === '/orders') {
        $orders->create($body(), $client());
    } elseif ($method === 'POST' && $path === '/orders/preview') {
        $orders->preview($body(), $client());
    } elseif ($method === 'GET' && $path === '/orders') {
        $orders->index($_GET, $anyone());
    } elseif ($method === 'GET' && $path === '/waiting-time') {
        $orders->waitingTime($_GET, $anyone());
    } elseif ($method === 'GET' && preg_match('#^/orders/([^/]+)/eta$#', $path, $m)) {
        $orders->eta($m[1], $anyone());
    } elseif ($method === 'GET' && preg_match('#^/orders/([^/]+)$#', $path, $m)) {
        $orders->show($m[1], $anyone());
    } elseif ($method === 'PATCH' && preg_match('#^/orders/([^/]+)/status$#', $path, $m)) {
        $orders->updateStatus($m[1], $body(), $staff());
    } elseif ($method === 'PATCH' && preg_match('#^/orders/([^/]+)/payment$#', $path, $m)) {
        $orders->pay($m[1], $body(), $anyone());
    } elseif ($method === 'PATCH' && preg_match('#^/orders/([^/]+)/cancel$#', $path, $m)) {
        $orders->cancel($m[1], $anyone());

    // ---- Commande de groupe à table ----
    } elseif ($method === 'GET' && $path === '/group') {
        $group->current($client());
    } elseif ($method === 'POST' && $path === '/group/items') {
        $group->add($body(), $client());
    } elseif ($method === 'DELETE' && preg_match('#^/group/items/([^/]+)$#', $path, $m)) {
        $group->remove($m[1], $client());
    } elseif ($method === 'POST' && $path === '/group/send') {
        $group->send($body(), $client());

    // ---- Groupes de choix (admin) ----
    } elseif ($method === 'GET' && $path === '/admin/option-groups') {
        $perm('catalog.manage');
        $group->optionGroups();
    } elseif ($method === 'POST' && $path === '/option-groups') {
        $group->createOptionGroup($body(), $perm('catalog.manage'));
    } elseif ($method === 'PATCH' && preg_match('#^/option-groups/([^/]+)$#', $path, $m)) {
        $group->updateOptionGroup($m[1], $body(), $perm('catalog.manage'));
    } elseif ($method === 'DELETE' && preg_match('#^/option-groups/([^/]+)$#', $path, $m)) {
        $group->deleteOptionGroup($m[1], $perm('catalog.manage'));

    // ---- Appels serveur ----
    } elseif ($method === 'POST' && $path === '/waiter-calls') {
        $waiter->create($client());
    } elseif ($method === 'GET' && $path === '/waiter-calls') {
        $waiter->index($_GET, $perm('calls.handle'));
    } elseif ($method === 'PATCH' && preg_match('#^/waiter-calls/([^/]+)/acknowledge$#', $path, $m)) {
        $waiter->acknowledge($m[1], $perm('calls.handle'));

    // ---- Espace client ----
    } elseif ($method === 'GET' && $path === '/clients/me') {
        $clients->me($client());
    } elseif ($method === 'PATCH' && $path === '/clients/me') {
        $clients->updateMe($body(), $client());
    } elseif ($method === 'PATCH' && $path === '/clients/me/table') {
        $clients->applyTable($body(), $client());
    } elseif ($method === 'POST' && $path === '/table-change-requests') {
        $clients->requestChange($body(), $client());
    } elseif ($method === 'GET' && $path === '/table-change-requests/mine') {
        $clients->mine($client());
    } elseif ($method === 'PATCH' && preg_match('#^/table-change-requests/([^/]+)/cancel$#', $path, $m)) {
        $clients->cancel($m[1], $client());
    } elseif ($method === 'POST' && $path === '/takeaway-requests') {
        $takeaway->create($body(), $client());
    } elseif ($method === 'GET' && $path === '/takeaway-requests/mine') {
        $takeaway->mine($client());
    } elseif ($method === 'PATCH' && preg_match('#^/takeaway-requests/([^/]+)/cancel$#', $path, $m)) {
        $takeaway->cancel($m[1], $client());
    } elseif ($method === 'GET' && $path === '/loyalty/me') {
        $mgmt->loyaltyMe($client());
    } elseif ($method === 'POST' && $path === '/tables/bill-request') {
        $tables->clientBill($client());

    // ---- Demandes « à emporter » : réponse du personnel habilité ----
    } elseif ($method === 'GET' && $path === '/takeaway-requests') {
        $perm('takeaway.respond');
        $takeaway->index($_GET);
    } elseif ($method === 'PATCH' && preg_match('#^/takeaway-requests/([^/]+)/respond$#', $path, $m)) {
        $takeaway->respond($m[1], $body(), $perm('takeaway.respond'));

    // ---- Changements de table : réponse du personnel habilité ----
    } elseif ($method === 'GET' && $path === '/table-change-requests') {
        $perm('table_requests.respond');
        $clients->index($_GET);
    } elseif ($method === 'PATCH' && preg_match('#^/table-change-requests/([^/]+)/respond$#', $path, $m)) {
        $clients->respond($m[1], $body(), $perm('table_requests.respond'));
    } elseif ($method === 'GET' && $path === '/tables/occupied') {
        $perm('table_requests.respond');
        $clients->occupied();

    // ---- Plan de salle ----
    } elseif ($method === 'GET' && $path === '/tables') {
        $tables->index($staff());
    } elseif ($method === 'POST' && $path === '/tables') {
        $tables->add($body(), $staff());
    } elseif ($method === 'DELETE' && preg_match('#^/tables/([^/]+)$#', $path, $m)) {
        $tables->remove($m[1], $staff());
    } elseif ($method === 'POST' && preg_match('#^/tables/([^/]+)/bill$#', $path, $m)) {
        $tables->staffBill($m[1], $staff());
    } elseif ($method === 'PATCH' && preg_match('#^/tables/([^/]+)/payment$#', $path, $m)) {
        $tables->payTable($m[1], $body(), $staff());
    } elseif ($method === 'POST' && preg_match('#^/tables/([^/]+)/release$#', $path, $m)) {
        $tables->release($m[1], $staff());
    } elseif ($method === 'POST' && preg_match('#^/tables/([^/]+)/clean$#', $path, $m)) {
        $tables->clean($m[1], $staff());

    // ---- Promotions / fidélité / direction ----
    } elseif ($method === 'GET' && $path === '/promotions') {
        $mgmt->promotionsList($staff());
    } elseif ($method === 'GET' && $path === '/promotions/suggestions') {
        $mgmt->promotionsSuggestions($staff());
    } elseif ($method === 'POST' && $path === '/promotions') {
        $mgmt->promotionCreate($body(), $staff());
    } elseif ($method === 'PATCH' && preg_match('#^/promotions/([^/]+)$#', $path, $m)) {
        $mgmt->promotionUpdate($m[1], $body(), $staff());
    } elseif ($method === 'DELETE' && preg_match('#^/promotions/([^/]+)$#', $path, $m)) {
        $mgmt->promotionDelete($m[1], $staff());
    } elseif ($method === 'GET' && $path === '/loyalty') {
        $mgmt->loyaltyList($_GET, $staff());
    } elseif ($method === 'GET' && preg_match('#^/loyalty/([^/]+)$#', $path, $m)) {
        $mgmt->loyaltyShow($m[1], $staff());
    } elseif ($method === 'POST' && preg_match('#^/loyalty/([^/]+)/adjust$#', $path, $m)) {
        $mgmt->loyaltyAdjust($m[1], $body(), $staff());
    } elseif ($method === 'GET' && $path === '/stats/summary') {
        $mgmt->statsSummary($_GET, $staff());
    } elseif ($method === 'GET' && $path === '/audit') {
        $mgmt->audit($_GET, $staff());

    // ---- Employés (staff.manage) ----
    } elseif ($method === 'GET' && $path === '/staff') {
        $perm('staff.manage');
        $auth->staffIndex();
    } elseif ($method === 'POST' && $path === '/staff') {
        $auth->staffCreate($body(), $perm('staff.manage'));

    // ---- Serveur connecté : ses tables ----
    } elseif ($method === 'GET' && $path === '/staff/me/tables') {
        $auth->myTables(Auth::require($pdo, ['server']));
    } elseif ($method === 'PUT' && $path === '/staff/me/tables') {
        $auth->setMyTables($body(), Auth::require($pdo, ['server']));

    // ---- Employés : un compte précis ----
    } elseif ($method === 'PATCH' && preg_match('#^/staff/([^/]+)$#', $path, $m)) {
        $auth->staffUpdate($m[1], $body(), $perm('staff.manage'));
    } elseif ($method === 'DELETE' && preg_match('#^/staff/([^/]+)$#', $path, $m)) {
        $auth->staffDelete($m[1], $perm('staff.manage'));
    } elseif ($method === 'PUT' && preg_match('#^/staff/([^/]+)/tables$#', $path, $m)) {
        $auth->staffSetTables($m[1], $body(), $perm('staff.manage'));

    // ---- Menus et catégories (catalog.manage) ----
    } elseif ($method === 'GET' && $path === '/admin/menus') {
        $perm('catalog.manage');
        $catalog->menus(true);
    } elseif ($method === 'POST' && $path === '/menus') {
        $catalog->createMenu($body(), $perm('catalog.manage'));
    } elseif ($method === 'PATCH' && preg_match('#^/menus/([^/]+)$#', $path, $m)) {
        $catalog->updateMenu($m[1], $body(), $perm('catalog.manage'));
    } elseif ($method === 'DELETE' && preg_match('#^/menus/([^/]+)$#', $path, $m)) {
        $catalog->deleteMenu($m[1], $perm('catalog.manage'));
    } elseif ($method === 'POST' && $path === '/categories') {
        $catalog->createCategory($body(), $perm('catalog.manage'));
    } elseif ($method === 'PATCH' && preg_match('#^/categories/([^/]+)$#', $path, $m)) {
        $catalog->updateCategory($m[1], $body(), $perm('catalog.manage'));
    } elseif ($method === 'DELETE' && preg_match('#^/categories/([^/]+)$#', $path, $m)) {
        $catalog->deleteCategory($m[1], $perm('catalog.manage'));

    // ---- Présence des clients (signal de l'espace client, centre de notifications admin) ----
    } elseif ($method === 'POST' && $path === '/presence/heartbeat') {
        $presence->heartbeat($body(), $client());
    } elseif ($method === 'GET' && $path === '/admin/presence') {
        $perm('presence.view');
        $presence->overview();
    } elseif ($method === 'GET' && preg_match('#^/admin/presence/(\d+)$#', $path, $m)) {
        $perm('presence.view');
        $presence->detail($m[1]);
    } elseif ($method === 'GET' && $path === '/admin/notifications') {
        $perm('presence.view');
        $presence->notifications($_GET);
    } elseif ($method === 'PATCH' && $path === '/admin/notifications/read-all') {
        $presence->readAll($perm('presence.view'));
    } elseif ($method === 'PATCH' && preg_match('#^/admin/notifications/([^/]+)$#', $path, $m)) {
        $presence->act($m[1], $body(), $perm('presence.view'));
    } elseif ($method === 'GET' && $path === '/admin/presence-settings') {
        $perm('presence.view');
        $presence->settings();
    } elseif ($method === 'PUT' && $path === '/admin/presence-settings') {
        $presence->updateSettings($body(), $perm('presence.manage'));

    // ---- Module « SOUCOFFE Intelligent » (additif, api/ai/routes.php) ----
    // Chargé seulement pour /ai/… : aucune autre route n'en dépend.
    } elseif (str_starts_with($path, '/ai/')) {
        require_once __DIR__ . '/ai/routes.php';
        ai_dispatch($pdo, $method, $path, $body, $promotionService);
    } else {
        send_error(404, "Route non trouvée : $method $path");
    }
} catch (UnauthorizedException $e) {
    send_error(401, $e->getMessage());
} catch (ForbiddenException $e) {
    send_error(403, $e->getMessage());
}
