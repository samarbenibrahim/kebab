// SOUCOFFE - Shared cart & favorites (localStorage-backed).
// Phase 3.5 : une commande n'existe que si le serveur l'a créée
// (Orders.createServerOrder -> POST /api/orders). Le panier, les favoris et
// l'historique restent en localStorage ; aucune commande locale de secours.
(function () {
    var CART_KEY = 'soucoffe_cart';
    var FAV_KEY = 'soucoffe_favorites';
    var GUEST_KEY = 'soucoffe_guest_name';
    var TABLE_KEY = 'soucoffe_table_number';
    var PARTY_KEY = 'soucoffe_party_size';
    var ORDER_KEY = 'soucoffe_last_order';
    var HISTORY_KEY = 'soucoffe_order_history';
    var ORDER_STATUSES = ['Nouvelle', 'En préparation', 'Prête', 'Servie'];
    var ORDERS_API_URL = (window.SOUCOFFE_API_BASE || 'http://localhost:8000/api') + '/orders';
    var ORDERS_API_TIMEOUT_MS = 6000;

    function read(key) {
        try {
            var raw = JSON.parse(localStorage.getItem(key));
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            return [];
        }
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* storage unavailable, fail silently */ }
    }

    function parsePrice(value) {
        if (typeof value === 'number') return value;
        var n = parseFloat(String(value).replace(',', '.').replace(/[^0-9.]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    var ORDER_NOTE_KEY = 'soucoffe_order_note';
    var REDEEM_KEY = 'soucoffe_redeem_points';
    var lastBadgeCount = null;
    var orderSubmitInFlight = false; // protection double envoi (un seul POST en vol)

    // ---- Aller-retours API génériques (résout le JSON, rejette avec le message serveur) ----
    function apiJson(url, opts) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, ORDERS_API_TIMEOUT_MS);
        opts = opts || {};
        opts.signal = controller.signal;
        return fetch(url, opts).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (body) {
                if (!res.ok) {
                    var e = new Error((body && (body.error || body.message)) || ('HTTP ' + res.status));
                    e.status = res.status;
                    throw e;
                }
                return body;
            });
        }).finally(function () { clearTimeout(timer); });
    }

    function parseServerDate(s) {
        var t = Date.parse(String(s).replace(' ', 'T'));
        return isNaN(t) ? null : t;
    }

    // Champs pilotés par le serveur, appliqués sur une commande locale.
    function applyServerFields(order, so) {
        order.status = so.status;
        order.total = parseFloat(so.total);
        order.name = so.guest_name;
        order.table = so.table_number;
        order.partySize = so.party_size;
        order.note = so.note || '';
        order.serverId = so.id;
        order.serverOrderId = so.id;
        var ts = order.statusTimestamps || {};
        (so.statusHistory || []).forEach(function (h) {
            var t = parseServerDate(h.created_at);
            if (t !== null) ts[h.new_status] = t;
        });
        order.statusTimestamps = ts;
        order.paymentStatus = so.payment_status || 'pending';
        order.paymentMethod = so.payment_method || null;
        order.paidAt = so.paid_at ? parseServerDate(so.paid_at) : null;
        order.cancelledAt = so.cancelled_at ? parseServerDate(so.cancelled_at) : null;
        order.discount = parseFloat(so.discount_total) || 0;
        order.promotionName = so.promotion_name || null;
        order.loyaltyPointsUsed = parseInt(so.loyalty_points_used, 10) || 0;
        order.loyaltyDiscount = parseFloat(so.loyalty_discount) || 0;
        order.pointsEarned = parseInt(so.points_earned, 10) || 0;
    }

    // Commande créée depuis un autre appareil : reconstruite depuis le serveur
    // (id d'article = slug du produit + libellés d'options, comme côté panier,
    // pour que l'admin et le rachat retrouvent le produit).
    function buildLocalOrderFromServer(so) {
        var idStr = String(so.id);
        while (idStr.length < 6) idStr = '0' + idStr;
        var order = {
            id: 'SOU-' + idStr,
            createdAt: parseServerDate(so.created_at) || Date.now(),
            items: (so.items || []).map(function (it) {
                var optNames = (it.options || []).map(function (o) { return o.option_name; });
                var product = (window.PRODUCTS || []).filter(function (p) { return p.apiId === it.product_id; })[0];
                return {
                    id: (product ? product.id : String(it.product_id)) + (optNames.length ? '|' + optNames.join('|') : ''),
                    name: it.product_name + (optNames.length ? ' (' + optNames.join(', ') + ')' : ''),
                    price: parseFloat(it.unit_price), qty: it.quantity, note: it.note || '', img: product ? ((typeof window.getEffectiveImage === 'function' ? window.getEffectiveImage(product) : product.img) || '') : '',
                    productId: it.product_id, apiProductId: it.product_id,
                    optionIds: (it.options || []).map(function (o) { return o.option_id; }),
                    serverItemId: it.id
                };
            })
        };
        applyServerFields(order, so);
        if (!order.statusTimestamps[ORDER_STATUSES[0]]) order.statusTimestamps[ORDER_STATUSES[0]] = order.createdAt;
        return order;
    }

    // ---- Idempotence de création de commande ----
    var PENDING_ORDER_KEY = 'soucoffe_pending_order';
    var PENDING_ORDER_TTL_MS = 30 * 60 * 1000;

    function newIdempotencyKey() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }

    // Retourne la clé de la tentative en cours pour CE contenu (la crée sinon).
    function pendingIdempotencyKey(payloadStr) {
        try {
            var p = JSON.parse(localStorage.getItem(PENDING_ORDER_KEY));
            if (p && p.fp === payloadStr && Date.now() - p.at < PENDING_ORDER_TTL_MS) return p.key;
        } catch (e) { /* stockage illisible : nouvelle clé */ }
        var key = newIdempotencyKey();
        try { localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ key: key, fp: payloadStr, at: Date.now() })); } catch (e) { /* ignore */ }
        return key;
    }

    function clearPendingOrder() {
        try { localStorage.removeItem(PENDING_ORDER_KEY); } catch (e) { /* ignore */ }
    }

    function showToast(message) {
        var container = document.getElementById('sc-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'sc-toast-container';
            document.body.appendChild(container);
        }
        var toast = document.createElement('div');
        toast.className = 'sc-toast';
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(function () {
            toast.classList.add('sc-toast-leaving');
            setTimeout(function () { toast.remove(); }, 260);
        }, 2200);
    }

    // ---- Phase 3.5 : modèle canonique du panier -------------------------
    // Article : { id (identifiant d'affichage/UI, ex. "cappuccino|L|Lait: Peu"),
    //   productId (id numérique MariaDB, canonique pour l'API), name, price
    //   (affichage seulement), img, note, qty, optionIds (vrais id SQL),
    //   apiProductId (alias historique de productId, conservé pour les
    //   lecteurs existants), issue (null | 'reconfigure' | 'unavailable_online') }
    function toId(v) {
        return (typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v) ? v : null;
    }

    function cleanOptionIds(list) {
        var out = [];
        (Array.isArray(list) ? list : []).forEach(function (v) {
            var id = toId(v);
            if (id !== null && out.indexOf(id) === -1) out.push(id);
        });
        return out;
    }

    // Retrouve les optionId SQL d'un ancien article dont l'id d'affichage est
    // "slug|L|Lait: Peu|Extra shot". Chaque segment doit correspondre à UNE
    // seule option des groupes SQL du produit ("Groupe: libellé" est cherché
    // dans le groupe nommé ; un libellé seul dans tous les groupes). Le
    // moindre segment absent ou ambigu => null : on ne devine jamais.
    function resolveLegacyOptionIds(product, segments) {
        var groups = product && product.apiOptionGroups;
        if (!Array.isArray(groups) || !segments.length) return null;
        var ids = [];
        for (var s = 0; s < segments.length; s++) {
            var m = /^([^:]+):\s*(.+)$/.exec(segments[s]);
            var wantedGroup = m ? m[1].trim() : null;
            var wantedLabel = m ? m[2].trim() : segments[s].trim();
            var matches = [];
            groups.forEach(function (g) {
                if (wantedGroup !== null && g.name !== wantedGroup) return;
                g.options.forEach(function (o) { if (o.label === wantedLabel) matches.push(o.id); });
            });
            if (matches.length !== 1) return null;
            ids.push(matches[0]);
        }
        return cleanOptionIds(ids);
    }

    // Ancien format -> format canonique, sans jamais deviner ni supprimer :
    // - productId retrouvé seulement si certain (champ existant, ou slug
    //   correspondant à un produit du catalogue API) ;
    // - ancien article personnalisé (options = libellés seulement) : converti
    //   quand chaque libellé correspond sans ambiguïté à une option SQL du
    //   produit (resolveLegacyOptionIds) ; sinon conservé et marqué
    //   'reconfigure'.
    function normalizeCartItem(item) {
        var out = {};
        Object.keys(item).forEach(function (k) { out[k] = item[k]; });
        var parts = String(item.id).split('|');
        var customized = parts.length > 1;
        var product = null;
        var productId = toId(item.productId);
        if (productId === null) productId = toId(item.apiProductId);
        if (typeof window.getProductById === 'function') {
            product = window.getProductById(parts[0]) || null;
            if (productId === null && product && (!customized || toId(product.apiId) !== null)) {
                productId = toId(product.apiId);
            }
        }
        out.productId = productId;
        out.apiProductId = productId;
        out.optionIds = cleanOptionIds(item.optionIds);
        if (customized && out.optionIds.length === 0 && productId !== null && product && product.apiId === productId) {
            var resolved = resolveLegacyOptionIds(product, parts.slice(1));
            if (resolved && resolved.length) out.optionIds = resolved;
        }
        if (customized && out.optionIds.length === 0) out.issue = 'reconfigure';
        else if (productId === null) out.issue = 'unavailable_online';
        else out.issue = null;
        return out;
    }

    // Validation UX avant POST (le serveur reste l'autorité). Retourne une
    // liste de messages ; vide = article envoyable.
    function validateCartItem(item) {
        var label = '« ' + item.name + ' »';
        if (item.issue === 'reconfigure') {
            return [label + ' doit être reconfiguré : retirez-le puis ajoutez-le de nouveau depuis le menu.'];
        }
        if (item.issue === 'unavailable_online' || toId(item.productId) === null) {
            var offline = window.SOUCOFFE_CATALOG_SOURCE === 'local';
            return [offline
                ? label + ' : le catalogue en ligne est indisponible, impossible de vérifier cet article pour le moment.'
                : label + " n'est pas disponible à la commande en ligne : retirez-le du panier."];
        }
        var problems = [];
        var qty = item.qty;
        if (typeof qty !== 'number' || Math.floor(qty) !== qty || qty < 1 || qty > 50) {
            problems.push(label + ' : quantité invalide (1 à 50).');
        }
        if (item.note && String(item.note).length > 255) {
            problems.push(label + ' : commentaire trop long (255 caractères maximum).');
        }
        var product = (window.PRODUCTS || []).filter(function (p) { return p.apiId === item.productId; })[0];
        if (product) {
            if (typeof window.isProductAvailable === 'function' && !window.isProductAvailable(product)) {
                problems.push(label + " n'est plus disponible.");
            }
            var groups = product.apiOptionGroups;
            if (Array.isArray(groups)) {
                var known = {};
                groups.forEach(function (g) {
                    var count = 0;
                    g.options.forEach(function (o) {
                        known[o.id] = true;
                        if (item.optionIds.indexOf(o.id) !== -1) count++;
                    });
                    if (g.isRequired && count < Math.max(1, g.minSelect || 0)) {
                        problems.push(label + " : choisissez une option pour « " + g.name + " » (ouvrez la fiche du produit).");
                    } else if (g.maxSelect !== null && count > g.maxSelect) {
                        problems.push(label + " : trop d'options choisies pour « " + g.name + " ».");
                    }
                });
                item.optionIds.forEach(function (id) {
                    if (!known[id]) problems.push(label + " : une option ne correspond pas à ce produit, reconfigurez l'article.");
                });
            }
        }
        return problems;
    }

    var Cart = {
        get: function () {
            return read(CART_KEY);
        },
        // Normalise le panier stocké (voir normalizeCartItem). N'enlève jamais
        // d'article et ne vide jamais le stockage ; n'écrit que si quelque
        // chose a réellement changé.
        normalize: function () {
            var before = read(CART_KEY);
            var after = before.map(normalizeCartItem);
            if (JSON.stringify(before) !== JSON.stringify(after)) write(CART_KEY, after);
            return after;
        },
        validateItem: validateCartItem,
        add: function (item) {
            var items = read(CART_KEY);
            var id = item.id || item.name;
            var existing = null;
            for (var i = 0; i < items.length; i++) {
                if (items[i].id === id) { existing = items[i]; break; }
            }
            if (existing) {
                existing.qty += item.qty || 1;
            } else {
                items.push(normalizeCartItem({
                    id: id,
                    name: item.name,
                    price: parsePrice(item.price),
                    img: item.img || '',
                    note: item.note || '',
                    qty: item.qty || 1,
                    productId: item.productId,
                    apiProductId: item.apiProductId,
                    optionIds: item.optionIds
                }));
            }
            write(CART_KEY, items);
            Cart.updateBadges();
            showToast('Ajouté au panier — ' + item.name);
            // Retour tactile discret sur téléphone (jamais si « moins d'animations »).
            try {
                if (navigator.vibrate && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate(12);
            } catch (e) { /* non pris en charge */ }
            return items;
        },
        remove: function (id) {
            var items = read(CART_KEY).filter(function (i) { return i.id !== id; });
            write(CART_KEY, items);
            Cart.updateBadges();
            return items;
        },
        setQty: function (id, qty) {
            var items = read(CART_KEY);
            if (qty <= 0) {
                items = items.filter(function (i) { return i.id !== id; });
            } else {
                for (var i = 0; i < items.length; i++) {
                    if (items[i].id === id) { items[i].qty = qty; break; }
                }
            }
            write(CART_KEY, items);
            Cart.updateBadges();
            return items;
        },
        setNote: function (id, note) {
            var items = read(CART_KEY);
            for (var i = 0; i < items.length; i++) {
                if (items[i].id === id) { items[i].note = note; break; }
            }
            write(CART_KEY, items);
            return items;
        },
        count: function () {
            return read(CART_KEY).reduce(function (sum, i) { return sum + i.qty; }, 0);
        },
        total: function () {
            return read(CART_KEY).reduce(function (sum, i) { return sum + i.qty * i.price; }, 0);
        },
        clear: function () {
            write(CART_KEY, []);
            try { localStorage.removeItem(ORDER_NOTE_KEY); localStorage.removeItem(REDEEM_KEY); } catch (e) { /* ignore */ }
            Cart.updateBadges();
        },
        // Produit du catalogue correspondant à une ligne du panier : par le slug
        // (id « slug|options ») ou, à défaut, par l'id SQL (commande rachetée).
        productFor: function (item) {
            if (!item) return null;
            var slug = String(item.id || '').split('|')[0];
            var p = typeof window.getProductById === 'function' ? window.getProductById(slug) : null;
            if (p) return p;
            var sqlId = toId(item.productId);
            if (sqlId === null) sqlId = toId(item.apiProductId);
            if (sqlId === null) return null;
            return (window.PRODUCTS || []).filter(function (x) { return x.apiId === sqlId; })[0] || null;
        },
        // Image d'une ligne : la sienne, sinon celle du produit (lignes ajoutées
        // depuis la fiche ou rachetées depuis l'historique), sinon aucune.
        imageFor: function (item) {
            if (item && item.img) return item.img;
            var p = Cart.productFor(item);
            if (!p) return '';
            return (typeof window.getEffectiveImage === 'function' ? window.getEffectiveImage(p) : p.img) || '';
        },
        // Complète en place les images manquantes des lignes déjà enregistrées
        // (paniers créés avant ce correctif) ; n'écrit que si quelque chose change.
        backfillImages: function () {
            var items = read(CART_KEY), changed = false;
            items.forEach(function (i) {
                if (!i.img) { var img = Cart.imageFor(i); if (img) { i.img = img; changed = true; } }
            });
            if (changed) write(CART_KEY, items);
            return changed;
        },
        // Remplace tout le panier d'un coup (ex. « Tout à emporter »), en
        // fusionnant les lignes devenues identiques ; aucune notification.
        replaceAll: function (items) {
            var merged = [];
            items.forEach(function (it) {
                var same = merged.filter(function (m) { return m.id === it.id; })[0];
                if (same) same.qty += it.qty || 1; else merged.push(it);
            });
            write(CART_KEY, merged);
            Cart.updateBadges();
            return merged;
        },
        // « Annuler » après une suppression : la ligne revient telle quelle, à sa place.
        restoreAt: function (item, index) {
            var items = read(CART_KEY);
            if (items.some(function (i) { return i.id === item.id; })) return items;
            items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
            write(CART_KEY, items);
            Cart.updateBadges();
            return items;
        },
        // Points de fidélité que le client veut utiliser sur cette commande (le serveur valide).
        getRedeemPoints: function () {
            try { return parseInt(localStorage.getItem(REDEEM_KEY), 10) || 0; } catch (e) { return 0; }
        },
        setRedeemPoints: function (n) {
            try { if (n > 0) localStorage.setItem(REDEEM_KEY, String(n)); else localStorage.removeItem(REDEEM_KEY); } catch (e) { /* ignore */ }
        },
        // Note valable pour toute la commande (en plus des commentaires par article).
        getOrderNote: function () {
            try { return localStorage.getItem(ORDER_NOTE_KEY) || ''; } catch (e) { return ''; }
        },
        setOrderNote: function (text) {
            try {
                var v = String(text || '').slice(0, 255);
                if (v.trim()) localStorage.setItem(ORDER_NOTE_KEY, v); else localStorage.removeItem(ORDER_NOTE_KEY);
            } catch (e) { /* ignore */ }
        },
        updateBadges: function () {
            var count = Cart.count();
            var increased = lastBadgeCount !== null && count > lastBadgeCount;
            lastBadgeCount = count;
            document.querySelectorAll('[data-cart-badge]').forEach(function (el) {
                el.textContent = count;
                el.style.display = count > 0 ? '' : 'none';
                if (increased) {
                    el.classList.remove('sc-badge-pulse');
                    void el.offsetWidth; // restart animation if it's already mid-pulse
                    el.classList.add('sc-badge-pulse');
                }
            });
            // Barre panier flottante (facultative — n'agit que si la page a
            // ce bloc, ex. Menu/Cafés) : évite d'avoir à quitter la page pour
            // vérifier le panier pendant qu'on parcourt le menu.
            if (window.refreshInCartMarks) window.refreshInCartMarks();
            var bar = document.getElementById('cart-float-bar');
            if (bar) {
                if (count > 0) {
                    bar.classList.remove('hidden');
                    var countEl = document.getElementById('cart-float-count');
                    var totalEl = document.getElementById('cart-float-total');
                    if (countEl) countEl.textContent = count + (count > 1 ? ' articles' : ' article');
                    if (totalEl) totalEl.textContent = Cart.total().toFixed(2).replace('.', ',') + ' €';
                } else {
                    bar.classList.add('hidden');
                }
            }
        }
    };

    var Favorites = {
        list: function () {
            return read(FAV_KEY);
        },
        has: function (id) {
            return read(FAV_KEY).indexOf(id) !== -1;
        },
        toggle: function (id) {
            var favs = read(FAV_KEY);
            var idx = favs.indexOf(id);
            if (idx === -1) favs.push(id); else favs.splice(idx, 1);
            write(FAV_KEY, favs);
            return favs.indexOf(id) !== -1;
        }
    };

    var Guest = {
        getName: function () {
            try {
                var name = localStorage.getItem(GUEST_KEY);
                return name && name.trim() ? name.trim() : 'Client';
            } catch (e) {
                return 'Client';
            }
        },
        setName: function (name) {
            try {
                if (name && name.trim()) localStorage.setItem(GUEST_KEY, name.trim());
            } catch (e) { /* storage unavailable, fail silently */ }
        }
    };

    var Table = {
        getNumber: function () {
            try {
                var n = localStorage.getItem(TABLE_KEY);
                return n && n.trim() ? n.trim() : '—';
            } catch (e) {
                return '—';
            }
        },
        setNumber: function (n) {
            try {
                if (n && String(n).trim()) localStorage.setItem(TABLE_KEY, String(n).trim());
            } catch (e) { /* storage unavailable, fail silently */ }
        }
    };

    var PartySize = {
        getCount: function () {
            try {
                var n = parseInt(localStorage.getItem(PARTY_KEY), 10);
                return n && n > 0 ? n : 1;
            } catch (e) {
                return 1;
            }
        },
        setCount: function (n) {
            try {
                var v = parseInt(n, 10);
                if (v && v > 0) localStorage.setItem(PARTY_KEY, String(v));
            } catch (e) { /* storage unavailable, fail silently */ }
        }
    };

    // Corps envoyé à l'API pour créer OU prévisualiser une commande. Ni prix ni
    // total : le serveur recalcule tout (articles, promotion, points de fidélité).
    function buildOrderPayload(items) {
        var payload = {
            items: items.map(function (i) {
                var out = {
                    productId: i.productId,
                    quantity: i.qty,
                    options: i.optionIds.map(function (id) { return { optionId: id }; })
                };
                if (i.note && String(i.note).trim()) out.note = String(i.note).trim();
                return out;
            })
        };
        var note = (function () { try { return localStorage.getItem(ORDER_NOTE_KEY) || ''; } catch (e) { return ''; } })().trim();
        if (note) payload.note = note;
        var redeem = (function () { try { return parseInt(localStorage.getItem(REDEEM_KEY), 10) || 0; } catch (e) { return 0; } })();
        if (redeem > 0) payload.redeemPoints = redeem;
        return payload;
    }

    var Orders = {
        STATUSES: ORDER_STATUSES,
        // HISTORIQUE (avant le serveur) : ne plus utiliser pour confirmer une
        // commande — voir createServerOrder. Conservé uniquement parce que des
        // commandes locales anciennes existent dans soucoffe_order_history.
        create: function (items, total) {
            var order = {
                id: 'SOU-' + String(Date.now()).slice(-6),
                items: items,
                total: total,
                name: Guest.getName(),
                table: Table.getNumber(),
                partySize: PartySize.getCount(),
                status: ORDER_STATUSES[0],
                createdAt: Date.now(),
                statusTimestamps: {} // first-time-reached timestamp per status, for prep-time tracking
            };
            order.statusTimestamps[ORDER_STATUSES[0]] = order.createdAt;
            try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (e) { /* fail silently */ }
            var history = read(HISTORY_KEY);
            history.push(order);
            write(HISTORY_KEY, history);
            return order;
        },
        // Validation UX complète avant tout POST (le serveur revalide de toute
        // façon). Retourne une liste de messages ; vide = commande envoyable.
        validateCart: function (items) {
            var problems = [];
            if (!items.length) problems.push('Votre panier est vide.');
            var table = Table.getNumber();
            if (table === '—' || !String(table).trim()) {
                problems.push('Indiquez votre numéro de table (icône crayon à côté de « Table »).');
            } else if (String(table).length > 20) {
                problems.push('Numéro de table trop long (20 caractères maximum).');
            }
            var party = PartySize.getCount();
            if (!(party >= 1 && party <= 50)) problems.push('Nombre de personnes invalide (1 à 50).');
            if (Cart.getOrderNote().length > 255) problems.push('La note de commande est trop longue (255 caractères maximum).');
            if (!Guest.getName()) problems.push('Indiquez votre nom.');
            items.forEach(function (i) {
                validateCartItem(i).forEach(function (m) { problems.push(m); });
            });
            return problems;
        },
        // Phase 3.5 : SEUL chemin de création d'une commande. Résout avec la
        // commande créée par le serveur (POST /api/orders, 201) ; rejette avec
        // une Error portant `code` ('VALIDATION' | 'NETWORK' | 'TIMEOUT' |
        // 'SERVER' | 'BUSY') et un message affichable. JAMAIS de commande
        // locale de secours : si le serveur n'a pas créé la commande, elle
        // n'existe pas et le panier reste intact.
        // Limite documentée : l'API n'a pas de clé d'idempotence. La protection
        // contre le double envoi est côté navigateur uniquement (un seul POST
        // en vol) ; un délai dépassé laisse le résultat incertain (voir TIMEOUT).
        createServerOrder: function (rawItems) {
            function fail(code, message) {
                var e = new Error(message);
                e.code = code;
                return Promise.reject(e);
            }
            if (orderSubmitInFlight) return fail('BUSY', 'Une commande est déjà en cours d’envoi.');

            var items = rawItems.map(normalizeCartItem);
            var problems = Orders.validateCart(items);
            if (problems.length) return fail('VALIDATION', problems.join('\n'));

            // Le prix/total n'est volontairement JAMAIS envoyé : le serveur
            // recalcule tout depuis SQL. Contrat réel de l'API : options par
            // article = [{optionId}] (un champ "optionIds" serait ignoré).
            var payload = buildOrderPayload(items);

            // Clé d'idempotence : la même tentative (même contenu) réutilise la
            // même clé tant que son résultat est incertain (réseau coupé,
            // délai dépassé) — le serveur renvoie alors la commande déjà créée
            // au lieu d'en créer une seconde.
            var payloadStr = JSON.stringify(payload);
            var idemKey = pendingIdempotencyKey(payloadStr);

            orderSubmitInFlight = true;
            var controller = new AbortController();
            var timer = setTimeout(function () { controller.abort(); }, ORDERS_API_TIMEOUT_MS);
            return fetch(ORDERS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
                body: payloadStr,
                signal: controller.signal
            }).then(function (res) {
                if (res.ok) { clearPendingOrder(); return res.json(); }
                if (res.status < 500) clearPendingOrder(); // refus définitif : rien n'a été créé
                return res.json().catch(function () { return null; }).then(function (body) {
                    var msg = body && body.error;
                    if (msg) {
                        msg = msg.replace(/items\[(\d+)\]/g, function (m, n) {
                            return items[n] ? '« ' + items[n].name + ' »' : m;
                        });
                    }
                    var e = new Error(msg || ('Le serveur a refusé la commande (HTTP ' + res.status + ').'));
                    e.code = 'SERVER';
                    throw e;
                });
            }).catch(function (err) {
                if (err && err.code) throw err;
                var e;
                if (err && err.name === 'AbortError') {
                    e = new Error("Le serveur n'a pas répondu à temps. Réessayez : si la commande avait été enregistrée, elle ne sera pas dupliquée.");
                    e.code = 'TIMEOUT';
                } else {
                    e = new Error('Impossible de joindre le serveur. Votre panier est conservé : réessayez dans un instant.');
                    e.code = 'NETWORK';
                }
                throw e;
            }).finally(function () {
                clearTimeout(timer);
                orderSubmitInFlight = false;
            });
        },
        // Aperçu calculé par le SERVEUR (promotion, points, total, attente estimée) : rien n'est créé.
        preview: function (rawItems) {
            var items = rawItems.map(normalizeCartItem);
            if (Orders.validateCart(items).length) return Promise.reject(new Error('Panier incomplet'));
            return apiJson(ORDERS_API_URL + '/preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildOrderPayload(items))
            });
        },
        // Miroir local d'une commande RÉELLEMENT créée côté serveur (POST
        // /api/orders a répondu 201) — alimente soucoffe_last_order /
        // soucoffe_order_history pour le suivi et l'admin. `id` reste le
        // libellé d'affichage 'SOU-######' (l'admin compare des chaînes) ;
        // l'id SQL réel est dans serverId / serverOrderId. Prix, total, statut
        // et dates viennent du serveur ; le nom d'affichage (avec options) et
        // l'id d'article restent ceux du panier (admin.js résout
        // item.id.split('|')[0] vers un produit).
        recordServerOrder: function (serverOrder, cartItems) {
            var serverItems = serverOrder.items || [];
            var localItems = cartItems.map(function (li, idx) {
                var copy = {};
                Object.keys(li).forEach(function (k) { copy[k] = li[k]; });
                var si = serverItems[idx];
                if (si) {
                    copy.price = parseFloat(si.unit_price);
                    copy.productId = si.product_id;
                    copy.apiProductId = si.product_id;
                    copy.serverItemId = si.id;
                }
                return copy;
            });
            var statusTimestamps = {};
            (serverOrder.statusHistory || []).forEach(function (h) {
                var t = Date.parse(String(h.created_at).replace(' ', 'T'));
                if (!statusTimestamps[h.new_status]) statusTimestamps[h.new_status] = isNaN(t) ? Date.now() : t;
            });
            var idStr = String(serverOrder.id);
            while (idStr.length < 6) idStr = '0' + idStr;
            var order = {
                id: 'SOU-' + idStr,
                serverId: serverOrder.id,
                serverOrderId: serverOrder.id,
                items: localItems,
                total: parseFloat(serverOrder.total),
                name: serverOrder.guest_name,
                table: serverOrder.table_number,
                partySize: serverOrder.party_size,
                note: serverOrder.note || '',
                status: serverOrder.status,
                createdAt: Date.parse(String(serverOrder.created_at).replace(' ', 'T')) || Date.now(),
                statusTimestamps: statusTimestamps
            };
            try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (e) { /* fail silently */ }
            var history = read(HISTORY_KEY);
            history.push(order);
            write(HISTORY_KEY, history);
            return order;
        },
        // Phase 4 : synchronise au mieux le statut d'une commande qui existe
        // réellement côté serveur (serverId connu). Toujours "best effort" :
        // n'appelle jamais l'admin en retour, ne rejette jamais bruyamment,
        // et ne modifie rien en local elle-même — Orders.updateStatus reste
        // seul responsable de l'état local, exactement comme avant cette
        // phase (le tableau de bord garde son comportement libre existant,
        // même quand le serveur refuserait la même transition car non
        // linéaire — §Phase 3). Sert uniquement à tenir la base à jour
        // quand la transition demandée est aussi valide côté serveur.
        syncServerStatus: function (serverId, status) {
            fetch(ORDERS_API_URL.replace(/\/orders$/, '/orders/' + serverId + '/status'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: status })
            }).then(function (res) {
                if (!res.ok) {
                    return res.json().catch(function () { return null; }).then(function (body) {
                        console.info('[SOUCOFFE] Synchronisation statut serveur refusée pour #' + serverId + ' : ' + ((body && (body.error || body.message)) || ('HTTP ' + res.status)));
                    });
                }
            }).catch(function (err) {
                console.info('[SOUCOFFE] Synchronisation statut serveur impossible pour #' + serverId + ' : ' + err.message);
            });
        },
        // Paiement en ligne (simulé) : tente un vrai PATCH serveur. Rejette
        // toujours si ça échoue ou si serverId est absent — contrairement au
        // statut, un paiement simulé qui échoue ne doit JAMAIS être affiché
        // comme réussi : rien de réel ne le garantit sans confirmation
        // serveur (à la différence du cash, où l'argent a physiquement
        // changé de main — voir markPaidLocally ci-dessous).
        tryPayOnline: function (serverId) {
            if (typeof serverId !== 'number') return Promise.reject(new Error('Commande non connectée au serveur'));
            return fetch(ORDERS_API_URL.replace(/\/orders$/, '/orders/' + serverId + '/payment'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'online' })
            }).then(function (res) {
                if (!res.ok) {
                    return res.json().catch(function () { return null; }).then(function (body) {
                        throw new Error((body && (body.error || body.message)) || ('HTTP ' + res.status));
                    });
                }
                return res.json();
            });
        },
        // Miroir local d'un paiement RÉELLEMENT confirmé par le serveur
        // (réponse de tryPayOnline ou d'un PATCH .../payment réussi).
        recordPayment: function (id, serverOrder) {
            function apply(order) {
                order.paymentStatus = serverOrder.payment_status;
                order.paymentMethod = serverOrder.payment_method;
                order.paidAt = serverOrder.paid_at ? Date.parse(String(serverOrder.paid_at).replace(' ', 'T')) : null;
            }
            var history = read(HISTORY_KEY);
            for (var i = 0; i < history.length; i++) {
                if (history[i].id === id) { apply(history[i]); break; }
            }
            write(HISTORY_KEY, history);
            try {
                var last = JSON.parse(localStorage.getItem(ORDER_KEY));
                if (last && last.id === id) { apply(last); localStorage.setItem(ORDER_KEY, JSON.stringify(last)); }
            } catch (e) { /* fail silently */ }
        },
        // Marquage "payé en espèces" côté admin : met à jour l'état local
        // immédiatement et TOUJOURS, y compris sans serverId — l'argent a
        // réellement été reçu par le staff, ce n'est pas une simulation ; le
        // local est alors la seule source de vérité disponible pour cette
        // commande (même logique que updateStatus aujourd'hui).
        markPaidLocally: function (id, method) {
            function apply(order) {
                order.paymentStatus = 'paid';
                order.paymentMethod = method;
                order.paidAt = Date.now();
            }
            var history = read(HISTORY_KEY);
            for (var i = 0; i < history.length; i++) {
                if (history[i].id === id) { apply(history[i]); break; }
            }
            write(HISTORY_KEY, history);
            try {
                var last = JSON.parse(localStorage.getItem(ORDER_KEY));
                if (last && last.id === id) { apply(last); localStorage.setItem(ORDER_KEY, JSON.stringify(last)); }
            } catch (e) { /* fail silently */ }
        },
        // Réplique best-effort vers le serveur (même motif que
        // syncServerStatus) — utilisée uniquement depuis le marquage
        // "espèces" de l'admin quand un serverId existe ; jamais bloquant.
        syncServerPayment: function (serverId, method) {
            fetch(ORDERS_API_URL.replace(/\/orders$/, '/orders/' + serverId + '/payment'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: method })
            }).then(function (res) {
                if (!res.ok) {
                    return res.json().catch(function () { return null; }).then(function (body) {
                        console.info('[SOUCOFFE] Synchronisation paiement serveur refusée pour #' + serverId + ' : ' + ((body && (body.error || body.message)) || ('HTTP ' + res.status)));
                    });
                }
            }).catch(function (err) {
                console.info('[SOUCOFFE] Synchronisation paiement serveur impossible pour #' + serverId + ' : ' + err.message);
            });
        },
        // ---- Lecture/écriture des commandes SQL (utilisé par l'admin) ----
        // Toutes les commandes du serveur, pagination comprise (max 1000).
        fetchServerOrders: function () {
            var all = [];
            function page(n) {
                return apiJson(ORDERS_API_URL + '?limit=100&page=' + n).then(function (r) {
                    var chunk = r.content || [];
                    all = all.concat(chunk);
                    if (chunk.length && all.length < r.totalElements && n < 9) return page(n + 1);
                    return all;
                });
            }
            return page(0);
        },
        // Fusionne des commandes serveur dans l'historique local : met à jour
        // celles déjà connues (statut, paiement, annulation… — le serveur est
        // la vérité), ajoute les autres (autres appareils). Ne supprime jamais
        // rien. Retourne true si l'historique a changé.
        importServerOrders: function (serverOrders) {
            var history = read(HISTORY_KEY);
            var indexBySid = {};
            history.forEach(function (o, i) { if (typeof o.serverId === 'number') indexBySid[o.serverId] = i; });
            var changed = false;
            serverOrders.forEach(function (so) {
                var idx = indexBySid[so.id];
                if (idx === undefined) {
                    history.push(buildLocalOrderFromServer(so));
                    indexBySid[so.id] = history.length - 1;
                    changed = true;
                } else {
                    var before = JSON.stringify(history[idx]);
                    applyServerFields(history[idx], so);
                    if (JSON.stringify(history[idx]) !== before) changed = true;
                }
            });
            if (changed) {
                history.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
                write(HISTORY_KEY, history);
            }
            // Garde aussi la "dernière commande" (lue par le suivi) alignée.
            try {
                var last = JSON.parse(localStorage.getItem(ORDER_KEY));
                if (last && typeof last.serverId === 'number') {
                    var match = serverOrders.filter(function (so) { return so.id === last.serverId; })[0];
                    if (match) {
                        var beforeLast = JSON.stringify(last);
                        applyServerFields(last, match);
                        if (JSON.stringify(last) !== beforeLast) localStorage.setItem(ORDER_KEY, JSON.stringify(last));
                    }
                }
            } catch (e) { /* fail silently */ }
            return changed;
        },
        // Remet dans le panier tous les articles d'une commande passée (mêmes
        // options/quantités/notes). Retourne le nombre d'articles ajoutés.
        reorderToCart: function (orderId) {
            var order = read(HISTORY_KEY).filter(function (o) { return o.id === orderId; })[0];
            if (!order || !order.items) return 0;
            order.items.forEach(function (item) {
                Cart.add({
                    id: item.id, name: item.name, price: item.price, img: item.img || Cart.imageFor(item), note: item.note, qty: item.qty || 1,
                    productId: toId(item.productId) !== null ? item.productId : item.apiProductId,
                    optionIds: item.optionIds
                });
            });
            return order.items.length;
        },
        // Annulation (tant que "Nouvelle", non payée) : le serveur décide.
        cancelServer: function (serverId) {
            return apiJson(ORDERS_API_URL + '/' + serverId + '/cancel', { method: 'PATCH' });
        },
        // Ancienne commande locale (sans serverId) : annulation locale seulement.
        markCancelledLocally: function (id) {
            var history = read(HISTORY_KEY);
            history.forEach(function (o) { if (o.id === id) o.cancelledAt = Date.now(); });
            write(HISTORY_KEY, history);
            try {
                var last = JSON.parse(localStorage.getItem(ORDER_KEY));
                if (last && last.id === id) { last.cancelledAt = Date.now(); localStorage.setItem(ORDER_KEY, JSON.stringify(last)); }
            } catch (e) { /* fail silently */ }
        },
        // Changement de statut D'ABORD côté serveur (règle linéaire stricte),
        // résolu avec la commande serveur ; rejette avec le message du serveur
        // si la transition est refusée.
        updateServerStatus: function (serverId, status) {
            return apiJson(ORDERS_API_URL + '/' + serverId + '/status', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status })
            });
        },
        payServer: function (serverId, method) {
            return apiJson(ORDERS_API_URL + '/' + serverId + '/payment', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: method })
            });
        },
        getLast: function () {
            try {
                return JSON.parse(localStorage.getItem(ORDER_KEY)) || null;
            } catch (e) {
                return null;
            }
        },
        getAll: function () {
            return read(HISTORY_KEY).slice().reverse();
        },
        updateStatus: function (id, status) {
            var history = read(HISTORY_KEY);
            for (var i = 0; i < history.length; i++) {
                if (history[i].id === id) {
                    history[i].status = status;
                    if (!history[i].statusTimestamps) history[i].statusTimestamps = {};
                    if (!history[i].statusTimestamps[status]) history[i].statusTimestamps[status] = Date.now();
                    break;
                }
            }
            write(HISTORY_KEY, history);
            // Keep the "last order" snapshot (used by 05-Suivi-Commande) in sync too.
            try {
                var last = JSON.parse(localStorage.getItem(ORDER_KEY));
                if (last && last.id === id) {
                    last.status = status;
                    if (!last.statusTimestamps) last.statusTimestamps = {};
                    if (!last.statusTimestamps[status]) last.statusTimestamps[status] = Date.now();
                    localStorage.setItem(ORDER_KEY, JSON.stringify(last));
                }
            } catch (e) { /* fail silently */ }
            return history;
        }
    };

    // ---- Appels serveur ("Appeler le serveur") ----
    var WAITER_API_URL = ORDERS_API_URL.replace(/\/orders$/, '/waiter-calls');
    var Waiter = {
        // Envoie l'appel au serveur SQL. Rejette (message clair) en cas d'échec :
        // jamais de "serveur prévenu" affiché sans enregistrement réel.
        call: function () {
            return apiJson(WAITER_API_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tableNumber: String(Table.getNumber()), guestName: Guest.getName() })
            });
        },
        list: function (status) {
            return apiJson(WAITER_API_URL + (status ? '?status=' + encodeURIComponent(status) : '')).then(function (r) { return r.content || []; });
        },
        acknowledge: function (id) {
            return apiJson(WAITER_API_URL + '/' + id + '/acknowledge', { method: 'PATCH' });
        }
    };

    // Gestionnaire partagé du bouton "Appeler le serveur" (Panier, Suivi) :
    // markup attendu = un bouton onclick="callWaiter(this)" + un <p id="waiter-call-msg">.
    window.callWaiter = function (btn) {
        var msgEl = document.getElementById('waiter-call-msg');
        function say(text, isError) {
            if (!msgEl) return;
            msgEl.textContent = text;
            msgEl.classList.remove('hidden');
            msgEl.classList.toggle('text-error', !!isError);
            msgEl.classList.toggle('text-on-surface-variant', !isError);
        }
        if (Table.getNumber() === '—') {
            say('Indiquez d’abord votre numéro de table (icône crayon sur la page Panier).', true);
            return;
        }
        var original = btn ? btn.innerHTML : '';
        if (btn) btn.disabled = true;
        Waiter.call().then(function () {
            say('Le serveur a été prévenu, il arrive.', false);
            showToast('Serveur prévenu');
            if (btn) btn.innerHTML = window.iconHtml('check') + ' Serveur prévenu';
            setTimeout(function () { if (btn) { btn.innerHTML = original; btn.disabled = false; } }, 30000);
        }).catch(function (err) {
            say(err && err.status ? err.message : 'Serveur injoignable : votre appel n’a pas été envoyé. Réessayez.', true);
            if (btn) { btn.innerHTML = original; btn.disabled = false; }
        });
    };

    function applyGuestName() {
        var name = Guest.getName();
        document.querySelectorAll('[data-guest-name]').forEach(function (el) {
            el.textContent = name;
        });
    }

    function applyTableNumber() {
        var n = Table.getNumber();
        document.querySelectorAll('[data-table-number]').forEach(function (el) {
            el.textContent = n;
        });
    }

    function applyPartySize() {
        var n = PartySize.getCount();
        document.querySelectorAll('[data-party-size]').forEach(function (el) {
            el.textContent = n;
        });
    }

    // Reusable "Ajouter" button handler: reads data-name/data-price/data-img
    // off the clicked button, adds the item to the shared cart, and gives a
    // brief visual confirmation before restoring the button's original label.
    window.addToCartFromButton = function (btn) {
        var name = btn.getAttribute('data-name');
        var id = btn.getAttribute('data-id') || name;
        var price = btn.getAttribute('data-price');
        var img = btn.getAttribute('data-img') || '';
        var apiIdAttr = btn.getAttribute('data-api-id');
        if (!name) return;
        // Toujours passer par la fiche du produit : quantité, commentaire, et
        // les options (taille, lait, sucre, extras) quand le produit en a —
        // jamais un ajout silencieux sans que le client ait pu choisir.
        if (typeof window.openProductModal === 'function' && window.getProductById && window.getProductById(id)) {
            window.openProductModal(id);
            return;
        }
        Cart.add({
            id: id, name: name, price: price, img: img, qty: 1,
            productId: apiIdAttr !== null ? parseInt(apiIdAttr, 10) : null,
            optionIds: []
        });

        btn.disabled = true;
        if (btn.hasAttribute('data-icon-only')) {
            // Compact round icon buttons: pulse instead of swapping their label.
            btn.classList.add('scale-90', 'bg-green-500/70');
            setTimeout(function () {
                btn.classList.remove('scale-90', 'bg-green-500/70');
                btn.disabled = false;
            }, 700);
        } else {
            var original = btn.innerHTML;
            btn.classList.add('opacity-90');
            btn.innerHTML = window.iconHtml('check') + ' Ajouté';
            setTimeout(function () {
                btn.innerHTML = original;
                btn.classList.remove('opacity-90');
                btn.disabled = false;
            }, 1100);
        }
    };

    // Bouton loupe de l'en-tête mobile : amène le curseur dans la barre de
    // recherche visible de la page (celle-ci n'était pas reliée au bouton).
    window.focusSearch = function () {
        var inputs = Array.prototype.filter.call(document.querySelectorAll('input[type="text"]'), function (el) {
            return el.offsetParent !== null;
        });
        if (inputs.length) {
            inputs[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
            inputs[0].focus();
        }
    };

    // Shared header search box: works from any page, always redirects to the
    // Menu pre-filtered to whatever was typed (Enter to go).
    window.headerSearch = function (value, event) {
        if (event && event.key && event.key !== 'Enter') return;
        var term = (value || '').trim();
        window.location.href = '../02-Menu-Principal/code.html' + (term ? '?search=' + encodeURIComponent(term) : '');
    };

    window.Cart = Cart;
    window.showToast = showToast;
    window.Favorites = Favorites;
    window.Guest = Guest;
    window.Table = Table;
    window.PartySize = PartySize;
    window.Orders = Orders;
    window.Waiter = Waiter;
    window.applyTableNumber = applyTableNumber;
    // Identité mise à jour par js/auth.js (session, changement de table accordé) : en-têtes rafraîchis.
    document.addEventListener('soucoffe:identity', function () {
        applyGuestName();
        applyTableNumber();
        applyPartySize();
    });
    document.addEventListener('DOMContentLoaded', function () {
        Cart.updateBadges();
        applyGuestName();
        applyTableNumber();
        applyPartySize();
    });
})();

// ---- Confort d'affichage partagé (toutes les pages qui chargent ce script) ----
// En-tête collant mesuré (--sc-header-h, utilisé par les pastilles collantes
// du menu), bouton « haut de page » et bandeau de connexion quand l'API ne
// répond plus (signal émis par le fetch de js/auth.js) ou que le téléphone
// perd le réseau. Styles : fin de css/soucoffe.css.
(function () {
    var root = document.documentElement;
    var isStaff = root.getAttribute('data-role') === 'staff';

    function stickyHeader() {
        var list = document.querySelectorAll('body > header.sticky');
        for (var i = 0; i < list.length; i++) {
            if (list[i].offsetParent !== null || getComputedStyle(list[i]).display !== 'none') {
                if (list[i].getBoundingClientRect().height > 0) return list[i];
            }
        }
        return null;
    }
    function measureHeader() {
        var h = stickyHeader();
        root.style.setProperty('--sc-header-h', (h ? Math.round(h.getBoundingClientRect().height) : 0) + 'px');
    }

    // Pastilles de catégories : ombre légère une fois collées sous l'en-tête.
    function watchStickyPills() {
        var pills = document.getElementById('category-pills');
        var section = pills && pills.parentElement;
        if (!section) return;
        // Simple bascule de classe à chaque défilement (sans rAF : léger, et
        // fiable même quand le navigateur espace ses images).
        function update() {
            var top = parseFloat(getComputedStyle(root).getPropertyValue('--sc-header-h')) || 0;
            section.classList.toggle('is-stuck', section.getBoundingClientRect().top <= top + 1 && window.scrollY > 0);
        }
        window.addEventListener('scroll', update, { passive: true });
        update();
    }

    function backToTop() {
        if (isStaff || !document.querySelector('main')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-totop';
        btn.setAttribute('aria-label', 'Revenir en haut de la page');
        btn.innerHTML = window.iconHtml ? window.iconHtml('arrow_forward') : '↑';
        btn.addEventListener('click', function () {
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        });
        document.body.appendChild(btn);
        function update() { btn.classList.toggle('is-visible', window.scrollY > window.innerHeight * 1.5); }
        window.addEventListener('scroll', update, { passive: true });
        update();
    }

    // Bandeau de connexion : apparaît après un échec réseau, sonde l'API toutes
    // les 5 s tant qu'elle ne répond pas, puis confirme le retour 2,5 s.
    var bar = null, down = false, probeTimer = null, hideTimer = null;
    function netBar(text, ok) {
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'sc-netbar';
            bar.setAttribute('role', 'status');
            bar.setAttribute('aria-live', 'polite');
            bar.innerHTML = '<i></i><span></span>';
            document.body.appendChild(bar);
        }
        bar.querySelector('span').textContent = text;
        bar.classList.toggle('is-ok', !!ok);
        void bar.offsetWidth;
        bar.classList.add('is-visible');
    }
    function probe() {
        if (!window.SOUCOFFE_API_BASE) return;
        fetch(window.SOUCOFFE_API_BASE + '/promotions/active', { cache: 'no-store' }).catch(function () { /* signal déjà émis */ });
    }
    function setDown(isDown, reason) {
        clearTimeout(hideTimer);
        if (isDown) {
            if (!down) {
                down = true;
                netBar(reason === 'offline' ? 'Vous êtes hors ligne — reconnexion automatique…' : 'Connexion au serveur perdue — nouvelle tentative…');
            }
            if (!probeTimer) probeTimer = setInterval(probe, 5000);
            return;
        }
        if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
        if (!down) return;
        down = false;
        netBar('Connexion rétablie', true);
        hideTimer = setTimeout(function () { if (bar) bar.classList.remove('is-visible'); }, 2500);
    }
    document.addEventListener('soucoffe:net', function (e) {
        var ok = e.detail && e.detail.ok;
        if (!ok && navigator.onLine === false) setDown(true, 'offline');
        else setDown(!ok);
    });
    window.addEventListener('offline', function () { setDown(true, 'offline'); });
    window.addEventListener('online', function () { probe(); });

    // Vidéos décoratives [data-autoplay-visible] : lues seulement quand elles
    // sont à l'écran (économie de données et de batterie sur téléphone),
    // jamais si l'utilisateur a demandé moins d'animations (l'affiche reste).
    function autoplayVisibleVideos() {
        var vids = document.querySelectorAll('video[data-autoplay-visible]');
        if (!vids.length) return;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        vids.forEach(function (v) {
            v.muted = true; // requis par les navigateurs mobiles pour la lecture automatique
            if (reduced) { v.removeAttribute('autoplay'); try { v.pause(); } catch (e) { /* rien */ } }
        });
        if (reduced) return;
        function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () { /* lecture refusée : l'affiche reste */ }); }
        // Après une transition de page, l'attribut autoplay n'est pas toujours
        // honoré : on relance la lecture dès que la vidéo est prête ou que la
        // page redevient visible, tant qu'elle est à l'écran.
        vids.forEach(function (v) {
            v.__scVisible = false;
            v.addEventListener('canplay', function () { if (v.__scVisible && v.paused) play(v); });
        });
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) vids.forEach(function (v) { if (v.__scVisible && v.paused) play(v); });
        });
        window.addEventListener('pageshow', function () { vids.forEach(function (v) { if (v.__scVisible && v.paused) play(v); }); });
        if (!('IntersectionObserver' in window)) { vids.forEach(play); return; }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                e.target.__scVisible = e.isIntersecting;
                if (e.isIntersecting) { if (e.target.preload === 'none') e.target.preload = 'auto'; play(e.target); }
                else { try { e.target.pause(); } catch (err) { /* rien */ } }
            });
        }, { threshold: 0.25 });
        vids.forEach(function (v) { io.observe(v); });
    }

    // Onglet « Commande » de la barre du bas : pastille verte tant qu'une
    // commande est en cours (ni servie, ni annulée).
    function orderDot() {
        var last = window.Orders && Orders.getLast && Orders.getLast();
        var active = !!(last && !last.cancelledAt && last.status && last.status !== 'Servie');
        document.querySelectorAll('nav.fixed a[href*="05-Suivi-Commande"]').forEach(function (a) {
            var dot = a.querySelector('.sc-nav-dot');
            if (active && !dot) {
                dot = document.createElement('span');
                dot.className = 'sc-nav-dot';
                dot.setAttribute('aria-hidden', 'true');
                a.appendChild(dot);
                a.setAttribute('aria-label', 'Commande en cours : suivre');
            } else if (!active && dot) {
                dot.remove();
                a.removeAttribute('aria-label');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        measureHeader();
        watchStickyPills();
        backToTop();
        orderDot();
        setInterval(orderDot, 10000);
        window.addEventListener('storage', function (e) { if (!e.key || /order/.test(e.key)) orderDot(); });
        autoplayVisibleVideos();
        if (navigator.onLine === false) setDown(true, 'offline');
    });
    window.addEventListener('resize', measureHeader);
    window.addEventListener('load', measureHeader);
})();
