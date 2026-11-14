// SOUCOFFE - Admin dashboard: view switching + real-data rendering.
// Depends on Cart/Orders (js/cart.js) and PRODUCTS/ProductOverrides (js/products.js).
// Sees every order of the SQL backend (synced into the local history every 5 s,
// see syncFromServer) plus any older local-only orders of this browser.
(function () {
    var VIEWS = ['dashboard', 'orders', 'products', 'catalog', 'tables', 'stats', 'servers', 'presence', 'promotions', 'loyalty', 'audit', 'intelligence'];
    var currentView = 'dashboard';

    // ---- Filter/sort state (kept in memory, reset on page reload) ----
    var dashboardScope = 'all'; // 'all' | 'today'
    var ordersStatusFilter = 'all';
    var ordersSearchTerm = '';
    var productsSearchTerm = '';
    var productsCategoryFilter = 'all';
    var productsSort = 'name';
    var productsRuptureOnly = false;
    var editingProductId = null;
    var editingTag = 'none';
    var adminModalHideTimeout = null;

    var URGENT_MINUTES = 8;
    var SALES_VELOCITY_THRESHOLD = 5; // "sold fast today" heuristic: >= N units of one product today
    var ALERTS_KEY = 'soucoffe_admin_alerts_enabled';
    var knownOrderIds = null; // populated on first load so we don't alert for pre-existing orders

    function alertsEnabled() {
        try { return localStorage.getItem(ALERTS_KEY) === '1'; } catch (e) { return false; }
    }

    // Short two-tone chime via Web Audio (no audio asset to load/host).
    function playAdminAlertSound() {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            [880, 1180].forEach(function (freq, i) {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                var start = ctx.currentTime + i * 0.14;
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.24);
            });
            setTimeout(function () { ctx.close(); }, 600);
        } catch (e) { /* Web Audio unavailable: stay silent, notification still fires */ }
    }

    function notifyNewOrder(order) {
        if (!alertsEnabled()) return;
        playAdminAlertSound();
        if (window.Notification && Notification.permission === 'granted') {
            try {
                new Notification('Nouvelle commande — ' + order.id, {
                    body: 'Table ' + order.table + ' • ' + orderSummary(order) + ' • ' + fmt(order.total),
                    tag: order.id
                });
            } catch (e) { /* some browsers restrict Notification outside a service worker */ }
        }
    }

    // Same-browser only: this fires when another tab/window on THIS device
    // (e.g. the customer-facing kiosk tab) places an order — there is no
    // server, so a different device will never trigger this.
    function checkForNewOrders() {
        var all = Orders.getAll();
        if (!knownOrderIds) {
            knownOrderIds = {};
            all.forEach(function (o) { knownOrderIds[o.id] = true; });
            return;
        }
        all.forEach(function (o) {
            if (!knownOrderIds[o.id]) {
                knownOrderIds[o.id] = true;
                notifyNewOrder(o);
            }
        });
    }

    window.toggleAdminAlerts = function () {
        var enabling = !alertsEnabled();
        try { localStorage.setItem(ALERTS_KEY, enabling ? '1' : '0'); } catch (e) { /* ignore */ }
        if (enabling) {
            playAdminAlertSound(); // user gesture unlocks audio + gives audible confirmation
            if (window.Notification && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }
        renderAlertsToggle();
        return false;
    };

    function renderAlertsToggle() {
        var btn = document.getElementById('admin-alerts-toggle');
        if (!btn) return;
        var on = alertsEnabled();
        btn.classList.toggle('bg-primary-container', on);
        btn.classList.toggle('text-on-primary', on);
        btn.classList.toggle('border-outline-variant', !on);
        btn.classList.toggle('text-tertiary', !on);
        var label = document.getElementById('admin-alerts-label');
        if (label) label.textContent = on ? 'Alertes activées' : 'Activer les alertes';
    }

    // Icône SVG réelle (js/icons.js) sous forme de chaîne HTML.
    function ic(name, cls, filled) {
        return window.iconHtml ? window.iconHtml(name, cls, filled) : '';
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function fmt(n) {
        return (n || 0).toFixed(2).replace('.', ',') + ' €';
    }

    function baseProductId(cartItemId) {
        return String(cartItemId).split('|')[0];
    }

    function timeAgo(ts) {
        var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
        if (mins < 1) return "à l'instant";
        if (mins < 60) return 'il y a ' + mins + ' min';
        return 'il y a ' + Math.round(mins / 60) + 'h';
    }

    function isSameDay(ts, ref) {
        var a = new Date(ts), b = new Date(ref);
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    // Shared empty-state markup (same visual language as the client-side pages'
    // .sc-empty-state pattern from css/soucoffe.css) instead of a bare paragraph.
    function emptyStateHtml(icon, message) {
        return '<div class="sc-empty-state col-span-full">' +
            '<div class="sc-empty-icon"><span class="material-symbols-outlined">' + icon + '</span></div>' +
            '<p class="font-body-md text-body-md text-on-surface-variant">' + escapeHtml(message) + '</p></div>';
    }

    function orderSummary(order) {
        return (order.items || []).map(function (i) { return i.qty + 'x ' + i.name; }).join(', ');
    }

    // Commentaires saisis par le client sur chaque article (champ item.note,
    // copié du panier vers la commande) — jusqu'ici jamais affichés côté admin.
    function orderNotes(order) {
        return (order.items || []).filter(function (i) { return i.note && String(i.note).trim(); })
            .map(function (i) { return { name: i.name, note: String(i.note).trim() }; });
    }

    // Détail article par article (quantité, nom avec options, prix de ligne,
    // commentaire du client) pour la vue Commandes.
    function orderNoteHtml(order) {
        return order.note && String(order.note).trim()
            ? '<div class="text-xs text-tertiary bg-surface-container rounded px-2 py-1">' + ic('chat_bubble') + ' Note de commande : ' + escapeHtml(String(order.note).trim()) + '</div>'
            : '';
    }

    function orderDetailsHtml(order) {
        var items = order.items || [];
        if (!items.length) return orderNoteHtml(order);
        return '<div class="mt-2 flex flex-col gap-1.5">' + orderNoteHtml(order) + items.map(function (i) {
            return '<div class="font-body-md text-sm text-on-surface">' +
                '<div class="flex justify-between gap-3"><span><span class="font-label-md">' + (i.qty || 1) + '×</span> ' + escapeHtml(i.name) + '</span>' +
                '<span class="text-on-surface-variant whitespace-nowrap">' + fmt((i.qty || 1) * (i.price || 0)) + '</span></div>' +
                (i.note && String(i.note).trim()
                    ? '<div class="mt-0.5 text-xs text-tertiary bg-surface-container rounded px-2 py-1">' + ic('chat_bubble') + ' ' + escapeHtml(String(i.note).trim()) + '</div>'
                    : '') +
                '</div>';
        }).join('') + '</div>';
    }

    function statusBadgeClasses(status) {
        if (status === 'En préparation') return 'bg-secondary-container text-on-secondary-container';
        if (status === 'Prête') return 'bg-green-100 text-green-800';
        if (status === 'Servie') return 'bg-surface-variant text-on-surface-variant';
        return 'bg-error-container text-on-error-container'; // 'Nouvelle'
    }

    function statusBorderClass(status) {
        if (status === 'En préparation') return 'border-secondary-container';
        if (status === 'Prête') return 'border-green-200';
        if (status === 'Servie') return 'border-outline-variant';
        return 'border-error-container'; // 'Nouvelle'
    }

    function isUrgent(order) {
        return !order.cancelledAt && order.status === 'Nouvelle' && (Date.now() - order.createdAt) / 60000 >= URGENT_MINUTES;
    }

    // Commandes annulées par le client : visibles dans la liste, mais exclues
    // de tous les chiffres (CA, panier moyen, top produits, délais…).
    function activeOrders() {
        return Orders.getAll().filter(function (o) { return !o.cancelledAt; });
    }

    // ---- Stats (optionally scoped to "today" only) ----
    function computeStats(scope) {
        var all = activeOrders(); // newest first
        var orders = scope === 'today' ? all.filter(function (o) { return isSameDay(o.createdAt, Date.now()); }) : all;
        var totalRevenue = 0;
        var productQty = {};
        var productQtyById = {};
        var categoryRevenue = {};
        orders.forEach(function (o) {
            totalRevenue += o.total || 0;
            (o.items || []).forEach(function (item) {
                var pid = baseProductId(item.id);
                var product = getProductById(pid);
                var name = product ? product.name : item.name;
                productQty[name] = (productQty[name] || 0) + item.qty;
                productQtyById[pid] = (productQtyById[pid] || 0) + item.qty;
                var cat = product ? product.category : 'Offres';
                categoryRevenue[cat] = (categoryRevenue[cat] || 0) + item.qty * item.price;
            });
        });
        var topProducts = Object.keys(productQty).map(function (name) {
            return { name: name, qty: productQty[name] };
        }).sort(function (a, b) { return b.qty - a.qty; });
        var byCategory = Object.keys(categoryRevenue).map(function (cat) {
            return { category: cat, revenue: categoryRevenue[cat] };
        }).sort(function (a, b) { return b.revenue - a.revenue; });

        return {
            orders: orders,
            orderCount: orders.length,
            totalRevenue: totalRevenue,
            avgBasket: orders.length ? totalRevenue / orders.length : 0,
            topProducts: topProducts,
            productQtyById: productQtyById,
            byCategory: byCategory,
            pendingCount: all.filter(function (o) { return o.status === 'Nouvelle'; }).length
        };
    }

    var DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

    function prepMinutes(order) {
        var ts = order.statusTimestamps;
        if (!ts) return null;
        var readyAt = ts['Prête'] || ts['Servie']; // fall back if it skipped straight to Servie
        if (!readyAt || !order.createdAt) return null;
        return Math.max(0, (readyAt - order.createdAt) / 60000);
    }

    // Time-of-day / day-of-week patterns and same-day sales velocity — always
    // computed over the full history (not scope-limited) since a single day
    // rarely has enough volume to reveal a real peak-hour pattern.
    function computeOperationalInsights() {
        var all = activeOrders();
        var hourCounts = new Array(24).fill(0);
        var dayCounts = new Array(7).fill(0);
        var prepSamples = [];
        all.forEach(function (o) {
            var d = new Date(o.createdAt);
            hourCounts[d.getHours()] += 1;
            dayCounts[d.getDay()] += 1;
            var mins = prepMinutes(o);
            // Même règle que le serveur (WaitingTimeService) : on ignore les durées
            // aberrantes (< 30 s ou > 90 min = commande oubliée puis clôturée).
            if (mins !== null && mins >= 0.5 && mins <= 90) prepSamples.push(mins);
        });
        var peakHourIdx = hourCounts.indexOf(Math.max.apply(null, hourCounts));
        var peakDayIdx = dayCounts.indexOf(Math.max.apply(null, dayCounts));
        var avgPrep = prepSamples.length ? prepSamples.reduce(function (a, b) { return a + b; }, 0) / prepSamples.length : null;

        var todayQtyById = computeStats('today').productQtyById;
        var salesVelocity = Object.keys(todayQtyById)
            .filter(function (id) { return todayQtyById[id] >= SALES_VELOCITY_THRESHOLD; })
            .map(function (id) { return { id: id, qty: todayQtyById[id], product: getProductById(id) }; })
            .filter(function (row) { return row.product; })
            .sort(function (a, b) { return b.qty - a.qty; });

        return {
            sampleSize: all.length,
            hourCounts: hourCounts,
            dayCounts: dayCounts,
            peakHour: all.length ? peakHourIdx : null,
            peakHourCount: hourCounts[peakHourIdx],
            peakDay: all.length ? DAY_NAMES[peakDayIdx] : null,
            peakDayCount: dayCounts[peakDayIdx],
            avgPrepMinutes: avgPrep,
            prepSampleSize: prepSamples.length,
            salesVelocity: salesVelocity
        };
    }

    // ---- Dashboard ----
    window.setDashboardScope = function (scope) {
        dashboardScope = scope;
        renderDashboard();
        return false;
    };
    window.toggleDashboardScope = function () {
        return setDashboardScope(dashboardScope === 'today' ? 'all' : 'today');
    };

    window.exportOrdersReport = function () {
        var orders = Orders.getAll();
        var rows = [['Commande', 'Date', 'Table', 'Client', 'Personnes', 'Statut', 'Articles', 'Commentaires', 'Total (€)']];
        orders.forEach(function (o) {
            rows.push([
                o.id,
                new Date(o.createdAt).toLocaleString('fr-FR'),
                o.table || '',
                o.name || '',
                o.partySize || 1,
                o.cancelledAt ? 'Annulée' : o.status,
                orderSummary(o).replace(/,/g, ';'),
                (o.note && String(o.note).trim() ? 'Commande : ' + String(o.note).trim() + (orderNotes(o).length ? ' | ' : '') : '') +
                    orderNotes(o).map(function (n) { return n.name + ' : ' + n.note; }).join(' | '),
                (o.total || 0).toFixed(2)
            ]);
        });
        // Neutralise l'injection de formule CSV (OWASP) : une note de commande
        // saisie par un client (ex. "=cmd|'/c calc'!A0") ne doit jamais pouvoir
        // s'exécuter comme formule si le fichier est ouvert dans Excel/Sheets.
        function csvSafeCell(value) {
            var s = String(value);
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replace(/"/g, '""') + '"';
        }
        var csv = rows.map(function (r) {
            return r.map(csvSafeCell).join(',');
        }).join('\r\n');
        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'soucoffe-commandes-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return false;
    };

    function renderDashboard() {
        var stats = computeStats(dashboardScope);

        var scopeLabel = document.getElementById('dashboard-scope-label');
        if (scopeLabel) scopeLabel.textContent = dashboardScope === 'today' ? "Aujourd'hui" : 'Toutes les dates';

        var salesEl = document.getElementById('stat-sales');
        if (salesEl) salesEl.textContent = fmt(stats.totalRevenue);
        var ordersEl = document.getElementById('stat-orders');
        if (ordersEl) ordersEl.textContent = stats.orderCount;
        var avgEl = document.getElementById('stat-avg-basket');
        if (avgEl) avgEl.textContent = fmt(stats.avgBasket);

        var topNameEl = document.getElementById('stat-top-product-name');
        var topCaptionEl = document.getElementById('stat-top-product-caption');
        if (topNameEl) {
            if (stats.topProducts.length) {
                topNameEl.textContent = stats.topProducts[0].name;
                if (topCaptionEl) topCaptionEl.textContent = stats.topProducts[0].qty + ' vendu(s) au total';
            } else {
                topNameEl.textContent = '—';
                if (topCaptionEl) topCaptionEl.textContent = 'Pas encore de commande';
            }
        }

        // Ventes par heure: 7 buckets of 2h starting at 8h, from real order timestamps.
        var buckets = [0, 0, 0, 0, 0, 0, 0];
        stats.orders.forEach(function (o) {
            var hour = new Date(o.createdAt).getHours();
            var idx = Math.min(6, Math.max(0, Math.floor((hour - 8) / 2)));
            buckets[idx] += o.total || 0;
        });
        var max = Math.max.apply(null, buckets);
        var maxLabelEl = document.getElementById('chart-max-label');
        if (maxLabelEl) maxLabelEl.textContent = fmt(max);
        buckets.forEach(function (val, i) {
            var bar = document.getElementById('chart-bar-' + i);
            var tip = document.getElementById('chart-tooltip-' + i);
            if (bar) bar.style.height = (max > 0 ? Math.max(4, (val / max) * 100) : 4) + '%';
            if (bar) bar.classList.toggle('is-peak', max > 0 && val === max);
            if (tip) tip.textContent = fmt(val);
        });

        var feedEl = document.getElementById('order-feed');
        if (feedEl) {
            var recent = stats.orders.slice(0, 5);
            feedEl.innerHTML = recent.length ? recent.map(function (o, i) {
                return '<div style="animation-delay:' + (i * 50) + 'ms" class="sc-card-enter sc-admin-row bg-surface p-3 rounded-lg border-l-4 ' + statusBorderClass(o.status) + ' shadow-sm flex flex-col gap-1.5">' +
                    '<div class="flex flex-wrap justify-between items-start gap-2">' +
                    '<span class="font-label-md text-sm font-semibold text-on-surface">' + escapeHtml(o.id) + '</span>' +
                    '<span class="px-2 py-0.5 rounded ' + statusBadgeClasses(o.status) + ' font-label-md text-xs whitespace-nowrap">' + escapeHtml(o.status) + '</span>' +
                    '</div>' +
                    '<div class="font-body-md text-xs text-on-surface-variant truncate">' + escapeHtml(orderSummary(o)) + '</div>' +
                    orderNoteHtml(o) +
                    orderNotes(o).map(function (n) {
                        return '<div class="text-xs text-tertiary bg-surface-container rounded px-2 py-1">' + ic('chat_bubble') + ' ' + escapeHtml(n.note) + '</div>';
                    }).join('') +
                    '<div class="flex flex-wrap justify-between items-center gap-2 mt-0.5 pt-1.5 border-t border-outline-variant">' +
                    '<span class="text-xs text-outline flex items-center gap-1"><span class="material-symbols-outlined" style="font-size: 13px;">schedule</span> ' + timeAgo(o.createdAt) + '</span>' +
                    '<span class="font-label-md text-sm font-semibold text-primary">' + fmt(o.total) + '</span>' +
                    '</div></div>';
            }).join('') : emptyStateHtml('receipt_long', 'Aucune commande pour l\'instant.');
        }

        // Smart alert: orders still waiting to be started, one click away from Orders.
        var alertEl = document.getElementById('pending-alert');
        if (alertEl) {
            if (stats.pendingCount > 0) {
                alertEl.classList.remove('hidden');
                alertEl.innerHTML = '<button onclick="return goToPendingOrders()" class="sc-card-enter w-full flex items-center gap-3 bg-error-container text-on-error-container px-4 py-3 rounded-xl hover:opacity-90 transition-opacity text-left">' +
                    '<span class="material-symbols-outlined">notification_important</span>' +
                    '<span class="font-label-md text-label-md flex-1">' + stats.pendingCount + ' commande(s) en attente de préparation</span>' +
                    '<span class="material-symbols-outlined">arrow_forward</span></button>';
            } else {
                alertEl.classList.add('hidden');
                alertEl.innerHTML = '';
            }
        }

        // Smart alert: products out of stock, one click away from Products.
        var stockEl = document.getElementById('stock-alert');
        if (stockEl) {
            var ruptureCount = PRODUCTS.filter(function (p) { return !isProductAvailable(p); }).length;
            if (ruptureCount > 0) {
                stockEl.classList.remove('hidden');
                stockEl.innerHTML = '<button onclick="return goToRuptureProducts()" class="sc-card-enter w-full flex items-center gap-3 bg-secondary-container text-on-secondary-container px-4 py-3 rounded-xl hover:opacity-90 transition-opacity text-left">' +
                    '<span class="material-symbols-outlined">production_quantity_limits</span>' +
                    '<span class="font-label-md text-label-md flex-1">' + ruptureCount + ' produit(s) en rupture de stock</span>' +
                    '<span class="material-symbols-outlined">arrow_forward</span></button>';
            } else {
                stockEl.classList.add('hidden');
                stockEl.innerHTML = '';
            }
        }

        // Smart alert: products selling fast today (heuristic, no real stock count exists).
        var velocityEl = document.getElementById('velocity-alert');
        if (velocityEl) {
            var velocity = computeOperationalInsights().salesVelocity;
            if (velocity.length > 0) {
                velocityEl.classList.remove('hidden');
                velocityEl.innerHTML = '<button onclick="return goToProductsView()" class="sc-card-enter w-full flex items-center gap-3 bg-tertiary-container text-on-tertiary-container px-4 py-3 rounded-xl hover:opacity-90 transition-opacity text-left">' +
                    '<span class="material-symbols-outlined">bolt</span>' +
                    '<span class="font-label-md text-label-md flex-1">' + velocity.length + ' produit(s) se vendent vite aujourd\'hui (' + escapeHtml(velocity[0].product.name) + (velocity.length > 1 ? ' + ' + (velocity.length - 1) + ' autre(s)' : '') + ') — pensez à vérifier le stock</span>' +
                    '<span class="material-symbols-outlined">arrow_forward</span></button>';
            } else {
                velocityEl.classList.add('hidden');
                velocityEl.innerHTML = '';
            }
        }
    }

    window.goToPendingOrders = function () {
        ordersStatusFilter = 'Nouvelle';
        showAdminView('orders');
        return false;
    };
    window.goToProductsView = function () {
        showAdminView('products');
        return false;
    };
    window.goToRuptureProducts = function () {
        productsRuptureOnly = true;
        showAdminView('products');
        return false;
    };

    // ---- Orders view ----
    window.setOrdersStatusFilter = function (status) {
        ordersStatusFilter = status;
        renderOrdersView();
        return false;
    };
    window.setOrdersSearch = function (value) {
        ordersSearchTerm = (value || '').toLowerCase();
        renderOrdersView();
    };

    function renderOrdersToolbar(allOrders) {
        var toolbarEl = document.getElementById('orders-toolbar');
        if (!toolbarEl) return;
        var counts = { all: allOrders.length };
        Orders.STATUSES.forEach(function (s) { counts[s] = 0; });
        allOrders.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });
        var tabs = [{ key: 'all', label: 'Toutes' }].concat(Orders.STATUSES.map(function (s) { return { key: s, label: s }; }));
        var tabsHtml = tabs.map(function (t) {
            var active = ordersStatusFilter === t.key;
            return '<button onclick="return setOrdersStatusFilter(\'' + t.key + '\')" class="px-3 py-1.5 rounded-full font-label-md text-xs whitespace-nowrap transition-colors ' +
                (active ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-variant') +
                '">' + escapeHtml(t.label) + ' (' + (counts[t.key] || 0) + ')</button>';
        }).join('');
        toolbarEl.innerHTML = '<div class="flex flex-wrap gap-2">' + tabsHtml + '</div>' +
            '<div class="relative w-full md:w-64">' +
            '<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">search</span>' +
            '<input type="text" value="' + escapeHtml(ordersSearchTerm) + '" oninput="setOrdersSearch(this.value)" placeholder="Rechercher (n°, table, client)" class="w-full pl-9 pr-3 py-2 bg-surface-container-lowest border border-outline-variant rounded-lg font-body-md text-sm text-on-surface focus:ring-2 focus:ring-primary"/>' +
            '</div>';
    }

    function renderOrdersView() {
        var listEl = document.getElementById('orders-list');
        if (!listEl) return;
        var allOrders = Orders.getAll();
        renderOrdersToolbar(allOrders);

        var orders = allOrders.filter(function (o) {
            if (ordersStatusFilter !== 'all' && o.status !== ordersStatusFilter) return false;
            if (!ordersSearchTerm) return true;
            var haystack = (o.id + ' ' + o.table + ' ' + o.name).toLowerCase();
            return haystack.indexOf(ordersSearchTerm) !== -1;
        });

        if (!allOrders.length) {
            listEl.innerHTML = emptyStateHtml('receipt_long', 'Aucune commande pour l\'instant.');
            return;
        }
        if (!orders.length) {
            listEl.innerHTML = emptyStateHtml('search_off', 'Aucune commande ne correspond à ce filtre.');
            return;
        }
        listEl.innerHTML = orders.map(function (o, i) {
            var options = Orders.STATUSES.map(function (s) {
                return '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + s + '</option>';
            }).join('');
            var urgent = isUrgent(o);
            var prepMins = prepMinutes(o);
            return '<div style="animation-delay:' + (Math.min(i, 10) * 40) + 'ms" class="sc-card-enter sc-admin-row bg-surface-container-lowest rounded-xl p-md shadow-[0_2px_10px_rgba(62,36,21,0.05)] flex flex-col md:flex-row md:items-center gap-4' + (urgent ? ' ring-2 ring-error' : '') + '">' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-3 flex-wrap">' +
                '<span class="font-title-lg text-title-lg text-primary">' + escapeHtml(o.id) + '</span>' +
                (urgent ? '<span class="flex items-center gap-1 text-error font-label-md text-xs px-2 py-0.5 rounded-full bg-error-container"><span class="material-symbols-outlined" style="font-size:14px;">schedule</span> En attente</span>' : '') +
                (prepMins !== null ? '<span class="flex items-center gap-1 text-on-surface-variant font-label-md text-xs px-2 py-0.5 rounded-full bg-surface-container"><span class="material-symbols-outlined" style="font-size:14px;">schedule</span> Préparée en ' + Math.round(prepMins) + ' min</span>' : '') +
                '<span class="font-label-md text-label-md text-on-surface-variant">Table ' + escapeHtml(o.table) + ' • ' + escapeHtml(o.name) + ' • ' + (o.partySize || 1) + ' pers.</span>' +
                '</div>' +
                orderDetailsHtml(o) +
                '<div class="text-xs text-outline mt-1">' + timeAgo(o.createdAt) + '</div>' +
                '</div>' +
                '<div class="flex flex-wrap items-center gap-2 sm:gap-3">' +
                '<span class="font-title-lg text-title-lg text-primary whitespace-nowrap">' + fmt(o.total) + '</span>' +
                (o.cancelledAt
                    ? '<span class="flex items-center gap-1 text-error font-label-md text-xs px-2 py-1 rounded-full bg-error-container whitespace-nowrap">' + ic('cancel') + ' Annulée</span>'
                    : (o.paymentStatus === 'paid'
                        ? '<span class="flex items-center gap-1 text-tertiary font-label-md text-xs px-2 py-1 rounded-full bg-surface-container whitespace-nowrap">' + ic('check_circle') + ' Payée' + (o.paymentMethod === 'cash' ? ' (espèces)' : o.paymentMethod === 'card' ? ' (carte)' : o.paymentMethod === 'online' ? ' (en ligne)' : '') + '</span>'
                        : (Auth.can('payments.collect')
                            ? '<button onclick="markOrderPaid(\'' + o.id + '\', \'cash\')" class="font-label-md text-xs px-3 py-2 rounded-lg border border-outline-variant text-on-surface hover:bg-surface-container transition-colors whitespace-nowrap">Espèces</button>' +
                              '<button onclick="markOrderPaid(\'' + o.id + '\', \'card\')" class="font-label-md text-xs px-3 py-2 rounded-lg border border-outline-variant text-on-surface hover:bg-surface-container transition-colors whitespace-nowrap">Carte</button>'
                            : ''))) +
                '<select ' + (o.cancelledAt ? 'disabled ' : '') + 'onchange="setOrderStatus(\'' + o.id + '\', this.value)" class="w-full sm:w-auto bg-surface-container-high border border-outline-variant rounded-lg px-3 py-2 font-label-md text-sm text-on-surface focus:ring-2 focus:ring-primary disabled:opacity-50">' + options + '</select>' +
                '</div></div>';
        }).join('');
    }

    function adminErrorText(err) {
        return err && err.status ? err.message : 'serveur injoignable';
    }

    // Commande SQL (serverId) : le SERVEUR décide. Le statut ne change que si
    // le serveur accepte la transition (ordre strict Nouvelle → En préparation
    // → Prête → Servie) ; sinon message clair et la liste revient au vrai
    // statut. Commande locale ancienne (sans serverId) : comportement d'origine.
    window.setOrderStatus = function (id, status) {
        var order = Orders.getAll().filter(function (o) { return o.id === id; })[0];
        if (order && typeof order.serverId === 'number') {
            Orders.updateServerStatus(order.serverId, status).then(function (so) {
                Orders.importServerOrders([so]);
                refreshAdminViews();
            }).catch(function (err) {
                if (window.showToast) window.showToast('Statut refusé : ' + adminErrorText(err));
                refreshAdminViews();
            });
            return;
        }
        Orders.updateStatus(id, status);
        renderOrdersView();
        renderDashboard();
    };

    // Paiement en espèces. Commande SQL : enregistré côté serveur, puis reflété
    // ici. Commande locale ancienne : l'argent a réellement été reçu par le
    // staff, la mise à jour locale suffit (Orders.markPaidLocally).
    window.markOrderPaid = function (id, method) {
        method = method || 'cash';
        var order = Orders.getAll().filter(function (o) { return o.id === id; })[0];
        if (order && typeof order.serverId === 'number') {
            Orders.payServer(order.serverId, method).then(function (so) {
                Orders.importServerOrders([so]);
                refreshAdminViews();
            }).catch(function (err) {
                if (window.showToast) window.showToast('Paiement non enregistré : ' + adminErrorText(err));
                syncFromServer();
            });
            return;
        }
        Orders.markPaidLocally(id, method);
        renderOrdersView();
        renderDashboard();
    };

    // ---- Products view ----
    window.setProductsSearch = function (value) {
        productsSearchTerm = (value || '').toLowerCase();
        renderProductsView();
    };
    window.setProductsCategory = function (value) {
        productsCategoryFilter = value;
        renderProductsView();
        return false;
    };
    window.setProductsSort = function (value) {
        productsSort = value;
        renderProductsView();
        return false;
    };
    window.toggleProductsRuptureOnly = function () {
        productsRuptureOnly = !productsRuptureOnly;
        renderProductsView();
        return false;
    };

    function productCategories() {
        var seen = {}, list = [];
        PRODUCTS.forEach(function (p) { if (!seen[p.category]) { seen[p.category] = true; list.push(p.category); } });
        return list;
    }

    function renderProductsToolbar() {
        var toolbarEl = document.getElementById('products-toolbar');
        if (!toolbarEl) return;
        var available = PRODUCTS.filter(isProductAvailable).length;
        var rupture = PRODUCTS.length - available;
        var catOptions = ['<option value="all">Toutes catégories</option>'].concat(
            productCategories().map(function (c) {
                return '<option value="' + escapeHtml(c) + '"' + (productsCategoryFilter === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
            })
        ).join('');
        toolbarEl.innerHTML =
            '<div class="relative flex-1 min-w-[200px]">' +
            '<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">search</span>' +
            '<input type="text" value="' + escapeHtml(productsSearchTerm) + '" oninput="setProductsSearch(this.value)" placeholder="Rechercher un produit" class="w-full pl-9 pr-3 py-2 bg-surface-container-lowest border border-outline-variant rounded-lg font-body-md text-sm text-on-surface focus:ring-2 focus:ring-primary"/>' +
            '</div>' +
            '<select onchange="setProductsCategory(this.value)" class="bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 font-label-md text-sm text-on-surface focus:ring-2 focus:ring-primary">' + catOptions + '</select>' +
            '<select onchange="setProductsSort(this.value)" class="bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 font-label-md text-sm text-on-surface focus:ring-2 focus:ring-primary">' +
            '<option value="name"' + (productsSort === 'name' ? ' selected' : '') + '>Trier: Nom</option>' +
            '<option value="price-asc"' + (productsSort === 'price-asc' ? ' selected' : '') + '>Trier: Prix croissant</option>' +
            '<option value="price-desc"' + (productsSort === 'price-desc' ? ' selected' : '') + '>Trier: Prix décroissant</option>' +
            '<option value="sales"' + (productsSort === 'sales' ? ' selected' : '') + '>Trier: Meilleures ventes</option>' +
            '</select>' +
            '<button onclick="return toggleProductsRuptureOnly()" class="flex items-center gap-2 px-3 py-2 rounded-lg font-label-md text-xs transition-colors ' +
            (productsRuptureOnly ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface-variant hover:bg-surface-variant') +
            '"><span class="material-symbols-outlined text-base">production_quantity_limits</span>' + rupture + ' en rupture</button>' +
            '<span class="font-label-md text-xs text-on-surface-variant flex items-center gap-1 px-1">' + available + ' disponible(s) / ' + PRODUCTS.length + '</span>';
    }

    function renderProductsView() {
        var listEl = document.getElementById('products-list');
        if (!listEl) return;
        renderProductsToolbar();

        var stats = computeStats('all');
        var bestSellerId = stats.topProducts.length ? Object.keys(stats.productQtyById).sort(function (a, b) {
            return stats.productQtyById[b] - stats.productQtyById[a];
        })[0] : null;
        var velocityIds = {};
        computeOperationalInsights().salesVelocity.forEach(function (row) { velocityIds[row.id] = true; });

        var list = PRODUCTS.filter(function (p) {
            if (productsCategoryFilter !== 'all' && p.category !== productsCategoryFilter) return false;
            if (productsRuptureOnly && isProductAvailable(p)) return false;
            if (productsSearchTerm && p.name.toLowerCase().indexOf(productsSearchTerm) === -1) return false;
            return true;
        });

        if (productsSort === 'price-asc') list.sort(function (a, b) { return getEffectivePrice(a) - getEffectivePrice(b); });
        else if (productsSort === 'price-desc') list.sort(function (a, b) { return getEffectivePrice(b) - getEffectivePrice(a); });
        else if (productsSort === 'sales') list.sort(function (a, b) { return (stats.productQtyById[b.id] || 0) - (stats.productQtyById[a.id] || 0); });
        else list.sort(function (a, b) { return a.name.localeCompare(b.name); });

        if (!list.length) {
            listEl.innerHTML = emptyStateHtml('search_off', 'Aucun produit ne correspond à ce filtre.');
            return;
        }

        listEl.innerHTML = list.map(function (p, i) {
            var available = isProductAvailable(p);
            var price = getEffectivePrice(p);
            var img = getEffectiveImage(p);
            var tags = getEffectiveTags(p);
            var thumb = img
                ? '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(p.name) + '" class="w-14 h-14 rounded-lg object-cover shrink-0"/>'
                : '<div class="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center text-2xl" style="background:' + ((CATEGORY_STYLE[p.category] || CATEGORY_STYLE['default']).gradient) + '">' + window.productIconHtml(p) + '</div>';
            var badges = '';
            if (p.id === bestSellerId && stats.productQtyById[bestSellerId]) badges += '<span class="text-xs px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container">' + ic('star', '', true) + ' Meilleure vente</span>';
            if (velocityIds[p.id]) badges += '<span class="text-xs px-2 py-0.5 rounded-full bg-tertiary-container text-on-tertiary-container">' + ic('bolt') + ' Vente rapide</span>';
            if (tags.indexOf('popular') !== -1) badges += '<span class="text-xs px-2 py-0.5 rounded-full bg-primary-container text-on-primary">' + ic('local_fire_department') + ' Populaire</span>';
            if (tags.indexOf('new') !== -1) badges += '<span class="text-xs px-2 py-0.5 rounded-full bg-surface-variant text-on-surface-variant">' + ic('auto_awesome') + ' Nouveau</span>';
            badges += available
                ? '<span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Disponible</span>'
                : '<span class="text-xs px-2 py-0.5 rounded-full bg-error-container text-on-error-container">Rupture</span>';

            return '<div style="animation-delay:' + (Math.min(i, 10) * 30) + 'ms" class="sc-card-enter sc-admin-row bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] flex flex-col sm:flex-row sm:items-center gap-3' + (available ? '' : ' opacity-70') + '">' +
                '<div class="flex items-center gap-3 min-w-0">' +
                thumb +
                '<div class="flex-1 min-w-0">' +
                '<div class="font-title-lg text-title-lg text-on-surface truncate">' + escapeHtml(p.name) + '</div>' +
                '<div class="font-label-md text-xs text-on-surface-variant mb-1">' + escapeHtml(p.category) + '</div>' +
                '<div class="flex flex-wrap gap-1">' + badges + '</div>' +
                '</div></div>' +
                '<div class="flex items-center justify-between sm:flex-col sm:items-end gap-2 sm:shrink-0">' +
                '<span class="font-title-lg text-title-lg text-primary whitespace-nowrap">' + price.toFixed(2).replace('.', ',') + ' €</span>' +
                '<button onclick="return openAdminProductEdit(\'' + p.id + '\')" class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-variant text-on-surface font-label-md text-xs transition-colors">' +
                '<span class="material-symbols-outlined text-base">edit</span> Modifier</button>' +
                // Photos multiples et choix proposés au client (js/admin-choices.js, enregistrés en base).
                (typeof p.apiId === 'number' && window.openProductExtras && Auth.can('products.edit')
                    ? '<button onclick="return openProductExtras(' + p.apiId + ')" class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-variant text-on-surface font-label-md text-xs transition-colors">' +
                      '<span class="material-symbols-outlined text-base">add_a_photo</span> Photos et choix</button>' : '') +
                '</div></div>';
        }).join('');
    }

    // ---- Product edit modal ----
    window.openAdminProductEdit = function (id) {
        var p = getProductById(id);
        var modal = document.getElementById('admin-product-modal');
        if (!p || !modal) return false;
        editingProductId = id;
        var img = getEffectiveImage(p);
        var tags = getEffectiveTags(p);
        var tag = tags.indexOf('popular') !== -1 ? 'popular' : (tags.indexOf('new') !== -1 ? 'new' : 'none');

        var isUploadedImg = img && img.indexOf('data:') === 0;
        document.getElementById('admin-edit-name').textContent = p.name;
        document.getElementById('admin-edit-category').textContent = p.category;
        document.getElementById('admin-edit-image-url').value = isUploadedImg ? '' : (img || '');
        document.getElementById('admin-edit-image-url').disabled = isUploadedImg;
        document.getElementById('admin-edit-image-data').value = isUploadedImg ? img : '';
        document.getElementById('admin-edit-image-file').value = '';
        updateAdminImageStatus(isUploadedImg ? 'Image actuelle : importée depuis un appareil.' : '');
        document.getElementById('admin-edit-price').value = getEffectivePrice(p).toFixed(2);
        document.getElementById('admin-edit-available').checked = isProductAvailable(p);
        // Chaque champ n'est modifiable que si le rôle a la permission (l'API refuse de toute façon).
        var priceInput = document.getElementById('admin-edit-price');
        var availInput = document.getElementById('admin-edit-available');
        priceInput.disabled = !Auth.can('products.price') || typeof p.apiId !== 'number';
        availInput.disabled = !Auth.can('products.availability') || typeof p.apiId !== 'number';
        var delBtn = document.getElementById('admin-product-delete');
        if (delBtn) { delBtn.classList.toggle('hidden', !Auth.can('products.delete') || typeof p.apiId !== 'number'); delBtn.textContent = 'Supprimer le produit'; delete delBtn.dataset.armed; }
        var note = document.getElementById('admin-edit-perm-note');
        if (note) {
            var locked = [];
            if (priceInput.disabled) locked.push('le prix');
            if (availInput.disabled) locked.push('la disponibilité');
            note.textContent = locked.length ? 'Votre rôle ne permet pas de modifier ' + locked.join(' ni ') + '.' : '';
            note.classList.toggle('hidden', !locked.length);
        }
        updateAdminEditPreview(img, p);
        editingTag = tag;
        renderAdminEditTagButtons();

        if (adminModalHideTimeout) { clearTimeout(adminModalHideTimeout); adminModalHideTimeout = null; }
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { modal.classList.add('sc-modal-visible'); });
        });
        return false;
    };

    var TAG_CHOICES = [
        { key: 'none', label: 'Aucune' },
        { key: 'popular', label: ic('local_fire_department') + ' Populaire' },
        { key: 'new', label: ic('auto_awesome') + ' Nouveau' }
    ];

    function renderAdminEditTagButtons() {
        var el = document.getElementById('admin-edit-tag-buttons');
        if (!el) return;
        el.innerHTML = TAG_CHOICES.map(function (t) {
            var active = t.key === editingTag;
            return '<button type="button" onclick="return selectAdminEditTag(\'' + t.key + '\')" class="flex-1 py-2 rounded-lg border text-sm font-label-md transition-colors ' +
                (active ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant text-on-surface hover:border-primary') +
                '">' + t.label + '</button>';
        }).join('');
    }

    window.selectAdminEditTag = function (key) {
        editingTag = key;
        renderAdminEditTagButtons();
        return false;
    };

    window.updateAdminEditPreviewFromInput = function (value) {
        var p = getProductById(editingProductId);
        if (p) updateAdminEditPreview(value, p);
    };

    function updateAdminEditPreview(img, p) {
        var preview = document.getElementById('admin-edit-image-preview');
        if (!preview) return;
        if (img) {
            preview.style.background = '';
            preview.innerHTML = '<img src="' + escapeHtml(img) + '" alt="" class="w-full h-full object-cover"/>';
        } else {
            var style = CATEGORY_STYLE[p.category] || CATEGORY_STYLE['default'];
            preview.style.background = style.gradient;
            preview.innerHTML = '<span class="text-4xl">' + window.productIconHtml(p) + '</span>';
        }
    }

    function updateAdminImageStatus(message, isError) {
        var el = document.getElementById('admin-edit-image-status');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('text-error', !!isError);
        el.classList.toggle('text-on-surface-variant', !isError);
    }

    var MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // guard against choking the canvas on huge originals
    var MAX_IMAGE_DIMENSION = 900; // downscale so localStorage stays light

    // Read the picked file locally and downscale it on a canvas to a data URL.
    // On save it is sent to the API (imageData, permission products.edit) and
    // stored in images/products/; without that permission it stays local
    // (ProductOverrides.img), same as a pasted image URL would be.
    window.handleAdminImageUpload = function (inputEl) {
        var file = inputEl.files && inputEl.files[0];
        if (!file) return;
        if (file.type.indexOf('image/') !== 0) {
            updateAdminImageStatus('Ce fichier n\'est pas une image.', true);
            inputEl.value = '';
            return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            updateAdminImageStatus('Fichier trop volumineux (max 20 Mo).', true);
            inputEl.value = '';
            return;
        }
        updateAdminImageStatus('Traitement de l\'image…');
        var reader = new FileReader();
        reader.onerror = function () { updateAdminImageStatus('Impossible de lire ce fichier.', true); };
        reader.onload = function (e) {
            var img = new Image();
            img.onerror = function () { updateAdminImageStatus('Image invalide ou corrompue.', true); };
            img.onload = function () {
                var scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
                var w = Math.max(1, Math.round(img.width * scale));
                var h = Math.max(1, Math.round(img.height * scale));
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                var dataUrl = canvas.toDataURL('image/jpeg', 0.82);

                document.getElementById('admin-edit-image-data').value = dataUrl;
                var urlInput = document.getElementById('admin-edit-image-url');
                urlInput.value = '';
                urlInput.disabled = true;

                var p = getProductById(editingProductId);
                if (p) updateAdminEditPreview(dataUrl, p);
                updateAdminImageStatus('Image importée (' + Math.round(dataUrl.length / 1024) + ' Ko après compression).');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    window.removeAdminUploadedImage = function () {
        document.getElementById('admin-edit-image-data').value = '';
        document.getElementById('admin-edit-image-file').value = '';
        var urlInput = document.getElementById('admin-edit-image-url');
        urlInput.disabled = false;
        updateAdminImageStatus('');
        var p = getProductById(editingProductId);
        if (p) updateAdminEditPreview(urlInput.value.trim(), p);
        return false;
    };

    window.closeAdminProductEdit = function () {
        var modal = document.getElementById('admin-product-modal');
        if (modal) {
            modal.classList.remove('sc-modal-visible');
            document.body.style.overflow = '';
            adminModalHideTimeout = setTimeout(function () {
                modal.classList.add('hidden');
                adminModalHideTimeout = null;
            }, 250);
        }
        editingProductId = null;
        return false;
    };

    window.saveAdminProductEdit = function () {
        if (!editingProductId) return false;
        var p = getProductById(editingProductId);
        var uploadedImg = document.getElementById('admin-edit-image-data').value;
        var imgVal = uploadedImg || document.getElementById('admin-edit-image-url').value.trim();
        var priceInput = document.getElementById('admin-edit-price');
        var availInput = document.getElementById('admin-edit-available');
        var priceVal = parseFloat(priceInput.value);
        // Prix et disponibilité vivent en base : envoyés à l'API (permission par champ).
        // L'image et la mise en avant restent des réglages d'affichage locaux.
        var body = {};
        // Avec la permission products.edit, la photo est enregistrée en base (visible sur tous les appareils) ;
        // sinon elle reste un réglage d'affichage local, comme avant.
        var photoOnServer = !!(p && typeof p.apiId === 'number' && Auth.can('products.edit'));
        if (p && typeof p.apiId === 'number') {
            if (!priceInput.disabled && !isNaN(priceVal) && priceVal > 0 && Math.abs(priceVal - p.price) > 0.0005) body.basePrice = Math.round(priceVal * 1000) / 1000;
            if (!availInput.disabled && availInput.checked !== (p.available !== false)) body.available = availInput.checked;
        }
        if (photoOnServer && imgVal !== (p.img || '')) {
            if (imgVal.indexOf('data:') === 0) body.imageData = imgVal;
            else body.imageUrl = imgVal || null;
        }
        // Étiquette « Populaire » / « Nouveau » : enregistrée en base (visible par tous les clients)
        // avec la permission products.edit ; sinon réglage d'affichage local, comme avant.
        var newBadge = editingTag === 'popular' || editingTag === 'new' ? editingTag : null;
        var currentBadge = (p.tags || []).indexOf('popular') !== -1 ? 'popular' : ((p.tags || []).indexOf('new') !== -1 ? 'new' : null);
        if (photoOnServer && newBadge !== currentBadge) body.badge = newBadge;
        ProductOverrides.set(editingProductId, { img: photoOnServer ? '' : imgVal, tags: photoOnServer ? undefined : (editingTag === 'none' ? [] : [editingTag]) });
        var finish = function () { closeAdminProductEdit(); renderProductsView(); renderDashboard(); };
        if (!Object.keys(body).length) { finish(); return false; }
        Auth.api('/products/' + p.apiId, Auth.json('PATCH', body)).then(function () {
            return window.loadCatalog(true);
        }).then(function () {
            if (window.showToast) window.showToast('Produit enregistré');
            finish();
        }).catch(function (err) {
            if (photoOnServer) ProductOverrides.set(editingProductId, { img: imgVal });
            updateAdminImageStatus('Non enregistré : ' + adminErrorText(err));
        });
        return false;
    };

    // Suppression logique d'un produit (permission products.delete) : double clic de confirmation.
    window.deleteAdminProduct = function () {
        var p = editingProductId ? getProductById(editingProductId) : null;
        var btn = document.getElementById('admin-product-delete');
        if (!p || typeof p.apiId !== 'number' || !btn) return false;
        if (!btn.dataset.armed) {
            btn.dataset.armed = '1';
            btn.textContent = 'Confirmer la suppression ?';
            return false;
        }
        Auth.api('/products/' + p.apiId, Auth.json('DELETE')).then(function () {
            return window.loadCatalog(true);
        }).then(function () {
            if (window.showToast) window.showToast('Produit supprimé');
            closeAdminProductEdit(); renderProductsView(); renderDashboard();
        }).catch(function (err) { updateAdminImageStatus('Suppression impossible : ' + adminErrorText(err)); });
        return false;
    };

    window.resetAdminProductEdit = function () {
        if (!editingProductId) return false;
        ProductOverrides.set(editingProductId, { img: '', tags: undefined });
        closeAdminProductEdit();
        renderProductsView();
        renderDashboard();
        return false;
    };

    // ---- Stats view ----
    function renderStatsView() {
        var contentEl = document.getElementById('stats-content');
        if (!contentEl) return;
        var stats = computeStats('all');
        if (!stats.orders.length) {
            contentEl.innerHTML = emptyStateHtml('query_stats', 'Pas encore de commandes à analyser.');
            return;
        }
        var maxCatRevenue = stats.byCategory.length ? stats.byCategory[0].revenue : 1;
        var catHtml = stats.byCategory.map(function (c) {
            var pct = maxCatRevenue > 0 ? (c.revenue / maxCatRevenue) * 100 : 0;
            return '<div class="mb-3">' +
                '<div class="flex justify-between font-label-md text-sm text-on-surface mb-1"><span>' + escapeHtml(c.category) + '</span><span>' + fmt(c.revenue) + '</span></div>' +
                '<div class="w-full h-2 bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-primary-container" style="width:' + pct + '%"></div></div>' +
                '</div>';
        }).join('');
        var topHtml = stats.topProducts.slice(0, 5).map(function (p, i) {
            return '<div class="flex justify-between items-center py-2 border-b border-outline-variant last:border-0">' +
                '<span class="font-body-md text-sm text-on-surface">' + (i + 1) + '. ' + escapeHtml(p.name) + '</span>' +
                '<span class="font-label-md text-xs text-on-surface-variant">' + p.qty + ' vendu(s)</span></div>';
        }).join('');
        var ruptureList = PRODUCTS.filter(function (p) { return !isProductAvailable(p); });
        var ruptureHtml = ruptureList.length
            ? ruptureList.map(function (p) {
                return '<div class="flex justify-between items-center py-2 border-b border-outline-variant last:border-0">' +
                    '<span class="font-body-md text-sm text-on-surface">' + escapeHtml(p.name) + '</span>' +
                    '<span class="font-label-md text-xs text-error">Rupture</span></div>';
            }).join('')
            : '<p class="font-body-md text-sm text-on-surface-variant py-2">Tous les produits sont disponibles.</p>';

        var insights = computeOperationalInsights();
        var HOUR_LABELS = ['0h', '1h', '2h', '3h', '4h', '5h', '6h', '7h', '8h', '9h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h', '22h', '23h'];
        var maxHourCount = Math.max.apply(null, insights.hourCounts) || 1;
        var hourBarsHtml = insights.hourCounts.map(function (count, h) {
            var pct = Math.max(4, (count / maxHourCount) * 100);
            var isPeak = h === insights.peakHour && count > 0;
            return '<div class="flex-1 flex flex-col items-center gap-1 group relative" title="' + HOUR_LABELS[h] + ' — ' + count + ' commande(s)">' +
                '<div class="w-full rounded-t-sm ' + (isPeak ? 'bg-primary-container' : 'bg-surface-variant') + '" style="height:' + pct + '%"></div>' +
                (h % 3 === 0 ? '<span class="text-[9px] text-outline">' + HOUR_LABELS[h] + '</span>' : '') +
                '</div>';
        }).join('');
        var maxDayCount = Math.max.apply(null, insights.dayCounts) || 1;
        var dayBarsHtml = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(function (label, idx) {
            var dayIdx = idx === 6 ? 0 : idx + 1; // dayCounts is JS getDay() order (0=Sunday)
            var count = insights.dayCounts[dayIdx];
            var pct = Math.max(4, (count / maxDayCount) * 100);
            var isPeak = DAY_NAMES[dayIdx] === insights.peakDay && count > 0;
            return '<div class="flex-1 flex flex-col items-center gap-1" title="' + label + ' — ' + count + ' commande(s)">' +
                '<div class="w-full rounded-t-sm ' + (isPeak ? 'bg-tertiary-container' : 'bg-surface-variant') + '" style="height:' + pct + '%"></div>' +
                '<span class="text-[9px] text-outline">' + label + '</span></div>';
        }).join('');

        var insightsHtml = '<div class="grid grid-cols-1 md:grid-cols-3 gap-gutter mb-2">' +
            '<div class="bg-surface p-3 rounded-lg"><div class="font-label-md text-xs text-on-surface-variant mb-1">Heure de pointe</div>' +
            '<div class="font-headline-sm text-headline-sm text-primary">' + (insights.peakHour !== null ? HOUR_LABELS[insights.peakHour] : '—') + '</div>' +
            '<div class="font-body-md text-xs text-on-surface-variant">' + (insights.peakHour !== null ? insights.peakHourCount + ' commande(s) à cette heure' : 'Pas assez de données') + '</div></div>' +
            '<div class="bg-surface p-3 rounded-lg"><div class="font-label-md text-xs text-on-surface-variant mb-1">Jour de pointe</div>' +
            '<div class="font-headline-sm text-headline-sm text-primary">' + (insights.peakDay || '—') + '</div>' +
            '<div class="font-body-md text-xs text-on-surface-variant">' + (insights.peakDay ? insights.peakDayCount + ' commande(s) ce jour-là' : 'Pas assez de données') + '</div></div>' +
            '<div class="bg-surface p-3 rounded-lg"><div class="font-label-md text-xs text-on-surface-variant mb-1">Préparation moyenne</div>' +
            '<div class="font-headline-sm text-headline-sm text-primary">' + (insights.avgPrepMinutes !== null ? Math.round(insights.avgPrepMinutes) + ' min' : '—') + '</div>' +
            '<div class="font-body-md text-xs text-on-surface-variant">' + (insights.avgPrepMinutes !== null ? 'sur ' + insights.prepSampleSize + ' commande(s) préparée(s)' : 'Pas encore de durée fiable (préparations de 30 s à 90 min)') + '</div></div>' +
            '</div>' +
            '<div class="mb-4"><div class="font-label-md text-xs text-on-surface-variant mb-2">Commandes par heure (historique complet, ' + insights.sampleSize + ' commande(s))</div>' +
            '<div class="h-20 flex items-end gap-0.5">' + hourBarsHtml + '</div></div>' +
            '<div><div class="font-label-md text-xs text-on-surface-variant mb-2">Commandes par jour de la semaine</div>' +
            '<div class="h-16 flex items-end gap-2">' + dayBarsHtml + '</div></div>';

        contentEl.innerHTML =
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">' +
            '<div style="animation-delay:0ms" class="sc-card-enter bg-surface-container-lowest rounded-xl p-md shadow-[0_2px_10px_rgba(62,36,21,0.05)] md:col-span-2"><h3 class="font-title-lg text-title-lg text-primary mb-3">Heures de pointe &amp; performance</h3>' + insightsHtml + '</div>' +
            '<div style="animation-delay:60ms" class="sc-card-enter bg-surface-container-lowest rounded-xl p-md shadow-[0_2px_10px_rgba(62,36,21,0.05)]"><h3 class="font-title-lg text-title-lg text-primary mb-3">Ventes par catégorie</h3>' + catHtml + '</div>' +
            '<div style="animation-delay:120ms" class="sc-card-enter bg-surface-container-lowest rounded-xl p-md shadow-[0_2px_10px_rgba(62,36,21,0.05)]"><h3 class="font-title-lg text-title-lg text-primary mb-3">Top produits</h3>' + topHtml + '</div>' +
            '<div style="animation-delay:180ms" class="sc-card-enter bg-surface-container-lowest rounded-xl p-md shadow-[0_2px_10px_rgba(62,36,21,0.05)] md:col-span-2"><h3 class="font-title-lg text-title-lg text-primary mb-3">Ruptures de stock</h3>' + ruptureHtml + '</div>' +
            '</div>';
    }

    var RENDERERS = {
        dashboard: renderDashboard,
        orders: renderOrdersView,
        products: renderProductsView,
        tables: function () { if (window.renderFloorView) window.renderFloorView(); },
        stats: function () { renderStatsView(); if (window.renderServerStats) window.renderServerStats(); },
        servers: function () { if (window.renderServersView) window.renderServersView(); },
        presence: function () { if (window.refreshPresenceView) window.refreshPresenceView(); },
        catalog: function () { if (window.renderCatalogView) window.renderCatalogView(); },
        promotions: function () { if (window.renderPromotionsView) window.renderPromotionsView(); },
        loyalty: function () { if (window.renderLoyaltyView) window.renderLoyaltyView(); },
        audit: function () { if (window.renderAuditView) window.renderAuditView(true); },
        // Module « SOUCOFFE Intelligent » (js/ai-admin.js) : absent = vue vide, rien d'autre ne change.
        intelligence: function () { if (window.renderIntelligenceView) window.renderIntelligenceView(); }
    };

    window.showAdminView = function (view) {
        currentView = view;
        VIEWS.forEach(function (v) {
            var el = document.getElementById('view-' + v);
            if (el) el.classList.toggle('hidden', v !== view);
            var nav = document.getElementById('nav-' + v);
            if (nav) {
                nav.classList.toggle('text-primary', v === view);
                nav.classList.toggle('font-bold', v === view);
                nav.classList.toggle('bg-secondary-container', v === view);
                nav.classList.toggle('text-on-surface-variant', v !== view);
                nav.classList.toggle('border-primary', v === view);
                nav.classList.toggle('border-transparent', v !== view);
            }
        });
        if (RENDERERS[view]) RENDERERS[view]();
        if (window.renderIcons) renderIcons();
        // Below lg the sidebar is an overlay drawer (see toggleAdminSidenav): close it after navigating.
        if (window.innerWidth < 1024) setAdminSidenav(false);
        var main = document.querySelector('main');
        if (main) main.scrollTop = 0;
        return false;
    };

    // Below lg the sidenav has no base "flex" utility (only lg:flex), so merely
    // removing "hidden" would leave it display:block and break the flex-col /
    // mt-auto layout inside (the bottom-anchored avatar+button would drift up).
    // Setting display explicitly guarantees the drawer lays out like the
    // desktop sidebar while it's open as an overlay. A dimmed backdrop closes it
    // on tap outside; Escape closes it too.
    function setAdminSidenav(open) {
        var sidenav = document.getElementById('admin-sidenav');
        if (!sidenav) return;
        var backdrop = document.getElementById('admin-sidenav-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'admin-sidenav-backdrop';
            backdrop.className = 'sc-drawer-backdrop';
            backdrop.addEventListener('click', function () { setAdminSidenav(false); });
            document.body.appendChild(backdrop);
        }
        sidenav.classList.toggle('hidden', !open);
        sidenav.style.display = open ? 'flex' : '';
        backdrop.classList.toggle('is-open', open);
        document.body.classList.toggle('sc-drawer-open', open);
    }
    window.toggleAdminSidenav = function () {
        var sidenav = document.getElementById('admin-sidenav');
        if (sidenav) setAdminSidenav(sidenav.classList.contains('hidden'));
        return false;
    };
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && window.innerWidth < 1024) setAdminSidenav(false);
    });
    window.addEventListener('resize', function () {
        // Retour en large : la barre latérale redevient statique, sans voile.
        if (window.innerWidth >= 1024) {
            var b = document.getElementById('admin-sidenav-backdrop');
            if (b) b.classList.remove('is-open');
            document.body.classList.remove('sc-drawer-open');
            var s = document.getElementById('admin-sidenav');
            if (s) s.style.display = '';
        }
    });

    // Smart live sync: if an order or product change happens in another tab of
    // this same browser (e.g. a customer placing an order while the admin is
    // open elsewhere), reflect it here immediately without a manual reload.
    function refreshAdminViews() {
        renderDashboard();
        if (RENDERERS[currentView] && currentView !== 'dashboard') RENDERERS[currentView]();
        if (window.renderIcons) renderIcons();
    }

    window.addEventListener('storage', function (e) {
        if (e.key && e.key.indexOf('soucoffe_') !== 0) return;
        checkForNewOrders();
        renderDashboard();
        if (RENDERERS[currentView] && currentView !== 'dashboard') RENDERERS[currentView]();
    });

    // Synchronisation avec les commandes SQL : toutes les commandes du
    // serveur (de n'importe quel appareil) sont fusionnées dans l'historique
    // que l'admin lit déjà, au chargement puis toutes les 5 s. Le serveur est
    // la vérité pour le statut/paiement ; les commandes locales anciennes
    // (sans serverId) restent visibles. Serveur injoignable : silencieux,
    // l'admin continue avec ce qu'il a.
    // ---- Appels serveur en attente (Waiter, js/cart.js) ----
    var knownWaiterCallIds = null;

    // Pile de notifications en bas à droite : appels serveur + demandes de changement de table (js/admin-staff.js).
    function notifyStack() {
        var s = document.getElementById('admin-notify');
        if (!s) {
            s = document.createElement('div');
            s.id = 'admin-notify';
            s.className = 'fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] flex flex-col gap-3';
            document.body.appendChild(s);
        }
        return s;
    }
    window.adminNotifyStack = notifyStack;
    window.adminAlert = function () { if (alertsEnabled()) playAdminAlertSound(); };

    function renderWaiterPanel(calls) {
        var panel = document.getElementById('waiter-calls-panel');
        if (!calls.length) { if (panel) panel.remove(); return; }
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'waiter-calls-panel';
            panel.className = 'bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant p-3';
            notifyStack().appendChild(panel);
        }
        panel.innerHTML = '<div class="font-label-md text-label-md text-error mb-2">' + ic('room_service') + ' Appels serveur (' + calls.length + ')</div>' +
            '<div class="flex flex-col gap-2">' + calls.map(function (c) {
                var t = Date.parse(String(c.created_at).replace(' ', 'T'));
                return '<div class="flex items-center justify-between gap-2 bg-error-container rounded-lg px-3 py-2">' +
                    '<div class="min-w-0"><div class="font-label-md text-sm text-on-error-container">Table ' + escapeHtml(c.table_number) + '</div>' +
                    '<div class="text-xs text-on-error-container truncate">' + escapeHtml(c.guest_name || 'Client') + (isNaN(t) ? '' : ' ' + ic('circle', 'text-[5px] mx-1', true) + ' ' + timeAgo(t)) + '</div></div>' +
                    '<button onclick="ackWaiterCall(' + c.id + ')" class="shrink-0 bg-primary text-on-primary font-label-md text-xs px-3 py-1.5 rounded-lg hover:opacity-90">' + ic('check') + ' Vu</button></div>';
            }).join('') + '</div>';
    }

    function syncWaiterCalls() {
        if (!window.Waiter) return;
        Waiter.list('pending').then(function (calls) {
            var firstPass = knownWaiterCallIds === null;
            if (firstPass) knownWaiterCallIds = {};
            var fresh = calls.filter(function (c) { return !knownWaiterCallIds[c.id]; });
            calls.forEach(function (c) { knownWaiterCallIds[c.id] = true; });
            if (!firstPass && fresh.length && alertsEnabled()) playAdminAlertSound();
            renderWaiterPanel(calls);
        }).catch(function () { /* serveur injoignable : on garde l'affichage actuel */ });
    }

    window.ackWaiterCall = function (id) {
        Waiter.acknowledge(id).then(syncWaiterCalls).catch(function (err) {
            if (window.showToast) window.showToast('Acquittement impossible : ' + adminErrorText(err));
        });
    };

    var serverSynced = false;
    function syncFromServer() {
        syncWaiterCalls();
        if (!Orders.fetchServerOrders) return;
        Orders.fetchServerOrders().then(function (list) {
            var changed = Orders.importServerOrders(list);
            if (!serverSynced) {
                // Première synchro : les commandes déjà présentes ne déclenchent pas d'alerte.
                serverSynced = true;
                knownOrderIds = {};
                Orders.getAll().forEach(function (o) { knownOrderIds[o.id] = true; });
            } else if (changed) {
                checkForNewOrders();
            }
            if (changed) refreshAdminViews();
        }).catch(function (err) {
            console.info('[SOUCOFFE] Synchronisation admin/serveur indisponible : ' + err.message);
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        checkForNewOrders(); // just populates knownOrderIds on first load, no alert fires yet
        renderDashboard();
        renderAlertsToggle();
        // Catalogue API d'abord (l'import associe product_id -> slug), puis synchro périodique.
        Promise.resolve(window.loadCatalog ? window.loadCatalog() : null).then(function () {
            syncFromServer();
            setInterval(syncFromServer, 5000);
        });
        var todayEl = document.getElementById('admin-today');
        if (todayEl) {
            var today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            todayEl.textContent = today.charAt(0).toUpperCase() + today.slice(1);
        }
    });
})();
