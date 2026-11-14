// SOUCOFFE - Authentification côté navigateur.
//
// Espaces :
//   client  -> menu, panier, suivi (identification obligatoire : nom, prénom, table, personnes)
//   staff   -> personnel connecté : admin, manager, serveur, caissier, cuisine
//              (chaque rôle a sa page d'accueil et ses PERMISSIONS, voir api/config/Permissions.php)
// Chaque page déclare son espace avec <html data-role="client"> ou
// <html data-role="staff" data-allow="admin,manager"> (rôles autorisés sur la page).
// Les pages publiques (accueil, identification, connexion du personnel) n'ont pas de data-role.
//
// Le jeton de session (opaque, émis par l'API) est gardé en localStorage et
// ajouté AUTOMATIQUEMENT (en-tête X-Auth-Token) à tout appel fetch() vers
// l'API : les autres scripts n'ont rien à faire. Le serveur reste l'autorité :
// ces gardes ne servent qu'à rediriger proprement, jamais à protéger des données.
(function () {
    // Adresse de l'API : "localhost" quand la page est ouverte en fichier local
    // (file://, sur ce PC) ; sinon le même nom d'hôte que la page elle-même
    // (ex. l'IP du PC sur le réseau local, quand un téléphone ouvre le site
    // via le petit serveur de fichiers — scripts/start-lan.vbs). Partagée avec
    // les autres scripts via window.SOUCOFFE_API_BASE.
    // « localhost » coûte ~0,2 s par appel sous Windows (essai IPv6 puis repli) :
    // on vise directement 127.0.0.1, identique mais immédiat.
    var apiHost = location.protocol === 'file:' || !location.hostname || location.hostname === 'localhost' ? '127.0.0.1' : location.hostname;
    var API = 'http://' + apiHost + ':8000/api';
    window.SOUCOFFE_API_BASE = API;
    var STAFF_KEY = 'soucoffe_staff_session';
    var CLIENT_KEY = 'soucoffe_client_session';
    var IDENT_PAGE = '../01-Identification/log.html';
    var STAFF_LOGIN_PAGE = '../09-Connexion/login.html';
    var ADMIN_HOME = '../06-Admin-Dashboard/code.html';
    var HOME_BY_ROLE = {
        admin: ADMIN_HOME, manager: ADMIN_HOME,
        server: '../10-Serveur/code.html', cashier: '../11-Caisse/code.html', kitchen: '../12-Cuisine/code.html'
    };
    // Pages (dossiers) que chaque rôle a le droit d'ouvrir ; l'API reste l'autorité.
    var ROLE_PAGES = {
        admin: ['06-Admin', '07-Admin', '11-Caisse', '12-Cuisine'], manager: ['06-Admin', '07-Admin', '11-Caisse', '12-Cuisine'],
        server: ['10-Serveur'], cashier: ['11-Caisse'], kitchen: ['12-Cuisine']
    };
    // Données locales propres à UN client : effacées quand un autre client s'identifie.
    var PER_CLIENT_KEYS = [
        'soucoffe_cart', 'soucoffe_order_note', 'soucoffe_last_order',
        'soucoffe_order_history', 'soucoffe_pending_order', 'soucoffe_redeem_points'
    ];

    function readJson(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    }
    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
    }
    function remove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* stockage indisponible */ }
    }

    function pageRole() {
        return document.documentElement.getAttribute('data-role') || '';
    }

    function isStaffPage(role) {
        return role === 'staff' || role === 'admin' || role === 'server';
    }

    // Rôles autorisés sur la page courante (data-allow) ; anciens data-role=admin|server = ce seul rôle.
    function allowedRoles() {
        var attr = document.documentElement.getAttribute('data-allow');
        if (attr) return attr.split(',').map(function (r) { return r.trim(); });
        var role = pageRole();
        return role === 'admin' ? ['admin'] : role === 'server' ? ['server'] : [];
    }

    function staff() {
        var s = readJson(STAFF_KEY);
        return s && typeof s.token === 'string' && s.user ? s : null;
    }
    function client() {
        var s = readJson(CLIENT_KEY);
        return s && typeof s.token === 'string' && s.client ? s : null;
    }

    // Jeton à envoyer selon l'espace de la page : le personnel sur les pages
    // admin/serveur, le client partout ailleurs.
    function currentToken() {
        var role = pageRole();
        if (isStaffPage(role)) { var s = staff(); return s ? s.token : null; }
        var c = client();
        return c ? c.token : null;
    }

    // Redirection interne uniquement (jamais vers un autre site) : "../02-Menu/code.html" et équivalents.
    function safeNext(value) {
        return typeof value === 'string' && /^\.\.\/[0-9A-Za-z_-]+\/[0-9A-Za-z_.-]+\.html(\?[0-9A-Za-z_=&.%-]*)?$/.test(value) ? value : null;
    }

    function currentPagePath() {
        var parts = location.pathname.split('/');
        return '../' + parts[parts.length - 2] + '/' + parts[parts.length - 1] + location.search;
    }

    function redirectTo(page, extra) {
        var q = ['next=' + encodeURIComponent(currentPagePath())];
        if (extra) q.push(extra);
        location.replace(page + '?' + q.join('&'));
    }

    // ---- Identité client <-> clés locales déjà lues par le reste du site ----
    function syncIdentity(c) {
        try {
            localStorage.setItem('soucoffe_guest_name', (c.firstName + ' ' + c.lastName).trim());
            localStorage.setItem('soucoffe_table_number', String(c.tableNumber));
            localStorage.setItem('soucoffe_party_size', String(c.partySize));
        } catch (e) { /* stockage indisponible */ }
        document.dispatchEvent(new CustomEvent('soucoffe:identity'));
    }

    function apiCall(path, opts) {
        opts = opts || {};
        return fetch(API + path, opts).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (body) {
                if (!res.ok) {
                    var e = new Error((body && body.error) || ('HTTP ' + res.status));
                    e.status = res.status;
                    throw e;
                }
                return body;
            });
        }, function () {
            throw new Error('Impossible de joindre le serveur. Vérifiez que l’API est démarrée, puis réessayez.');
        });
    }

    function jsonOpts(method, body) {
        return { method: method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) };
    }

    var Auth = {
        role: pageRole,
        staff: staff,
        client: client,
        token: currentToken,
        safeNext: safeNext,
        api: apiCall,
        json: jsonOpts,
        syncIdentity: syncIdentity,
        HOME_BY_ROLE: HOME_BY_ROLE,

        // Le compte connecté possède-t-il cette permission ? (masque l'interface ; l'API refuse de toute façon)
        can: function (permission) {
            var s = staff();
            return !!(s && s.user.permissions && s.user.permissions.indexOf(permission) !== -1);
        },

        // Où envoyer ce rôle après connexion : la page demandée si son rôle y a droit, sinon son accueil.
        homeFor: function (role, next) {
            var n = safeNext(next);
            if (n && (ROLE_PAGES[role] || []).some(function (p) { return n.indexOf('/' + p) !== -1; })) return n;
            return HOME_BY_ROLE[role] || STAFF_LOGIN_PAGE;
        },

        // Connexion du personnel : l'API renvoie le rôle (admin ou serveur).
        loginStaff: function (username, password) {
            return apiCall('/auth/login', jsonOpts('POST', { username: username, password: password })).then(function (r) {
                writeJson(STAFF_KEY, { token: r.token, user: r.user });
                return r.user;
            });
        },

        // Identification d'un client (nom, prénom, table, personnes, téléphone facultatif).
        registerClient: function (data) {
            return apiCall('/clients', jsonOpts('POST', data)).then(function (r) {
                var previous = client();
                if (!previous || previous.client.id !== r.client.id) {
                    PER_CLIENT_KEYS.forEach(remove); // un autre client ne doit pas hériter du panier / des commandes du précédent
                }
                writeJson(CLIENT_KEY, { token: r.token, client: r.client });
                syncIdentity(r.client);
                return r.client;
            });
        },

        // Profil à jour + dernière demande de changement de table.
        refreshClient: function () {
            return apiCall('/clients/me').then(function (r) {
                var s = client();
                if (s) { s.client = r.client; writeJson(CLIENT_KEY, s); }
                syncIdentity(r.client);
                return r;
            });
        },

        // Fin de session (le serveur révoque le jeton ; en cas d'échec réseau la session locale part quand même).
        logoutStaff: function () {
            var done = function () { remove(STAFF_KEY); location.replace(STAFF_LOGIN_PAGE); };
            apiCall('/auth/logout', jsonOpts('POST')).then(done, done);
        },
        logoutClient: function () {
            var done = function () {
                remove(CLIENT_KEY);
                PER_CLIENT_KEYS.forEach(remove);
                ['soucoffe_guest_name', 'soucoffe_table_number', 'soucoffe_party_size'].forEach(remove);
                location.replace(IDENT_PAGE);
            };
            // Refusé (409) tant qu'il reste des commandes à régler : on ne quitte pas sa table sans payer.
            return apiCall('/auth/logout', jsonOpts('POST')).then(done, function (err) {
                if (err.status === 409) throw err;
                done();
            });
        },

        // Session expirée ou révoquée côté serveur (401) : on nettoie et on renvoie vers la bonne porte.
        expired: function () {
            var role = pageRole();
            if (isStaffPage(role)) {
                remove(STAFF_KEY);
                redirectTo(STAFF_LOGIN_PAGE, 'expired=1');
            } else if (role === 'client') {
                remove(CLIENT_KEY);
                redirectTo(IDENT_PAGE, 'expired=1');
            }
        }
    };
    window.Auth = Auth;

    // ---- fetch : jeton ajouté à chaque appel API + 401 => reconnexion ----
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : '';
        if (url.indexOf(API) !== 0) return nativeFetch(input, init);
        var token = currentToken();
        var opts = init || {};
        var headers = new Headers(opts.headers || {});
        if (token && !headers.has('X-Auth-Token')) headers.set('X-Auth-Token', token);
        opts.headers = headers;
        var t0 = Date.now();
        return nativeFetch(input, opts).then(function (res) {
            if (res.status === 401 && token) Auth.expired();
            netSignal(true);
            apiSignal(url, res.status, t0, false);
            return res;
        }, function (err) {
            // Échec réseau (API arrêtée, Wi-Fi coupé) : signalé au bandeau de
            // connexion (js/cart.js). Un abandon volontaire (délai dépassé,
            // AbortController) n'est pas une coupure.
            var aborted = !!err && err.name === 'AbortError';
            if (!aborted) netSignal(false);
            apiSignal(url, 0, t0, aborted);
            throw err;
        });
    };
    function netSignal(ok) {
        document.dispatchEvent(new CustomEvent('soucoffe:net', { detail: { ok: ok } }));
    }
    // Mesure de chaque appel API (statut, durée) : lue par js/presence.js pour
    // signaler à l'admin les erreurs 5xx et lenteurs vécues par le client.
    function apiSignal(url, status, t0, aborted) {
        document.dispatchEvent(new CustomEvent('soucoffe:api', { detail: { url: url, status: status, ms: Date.now() - t0, aborted: aborted } }));
    }

    // ---- Garde de page (synchrone : pas de contenu protégé affiché sans session) ----
    var role = pageRole();
    if (role === 'client') {
        if (!client()) {
            document.documentElement.style.visibility = 'hidden';
            redirectTo(IDENT_PAGE);
            return;
        }
        document.addEventListener('DOMContentLoaded', function () {
            // Vérifie la session auprès du serveur et resynchronise nom / table / personnes.
            Auth.refreshClient().catch(function () { /* 401 déjà géré par fetch ; réseau coupé : on laisse la page, les actions échoueront proprement */ });
        });
    } else if (isStaffPage(role)) {
        var s = staff();
        var allowed = allowedRoles();
        if (!s || allowed.indexOf(s.user.role) === -1) {
            document.documentElement.style.visibility = 'hidden';
            if (s && HOME_BY_ROLE[s.user.role]) location.replace(HOME_BY_ROLE[s.user.role]);
            else redirectTo(STAFF_LOGIN_PAGE);
            return;
        }
        document.addEventListener('DOMContentLoaded', function () {
            // Vérifie la session et rafraîchit les permissions (un admin peut les avoir changées).
            apiCall('/auth/me').then(function (r) {
                var cur = staff();
                if (cur && r.user) {
                    cur.user = r.user;
                    writeJson(STAFF_KEY, cur);
                    document.dispatchEvent(new CustomEvent('soucoffe:permissions'));
                }
            }).catch(function () { /* 401 géré par fetch */ });
        });
    }
})();
