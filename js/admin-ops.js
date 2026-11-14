// SOUCOFFE - Admin : Salle (plan des tables), Promotions, Fidélité, Historique
// (audit), statistiques calculées par le serveur, et menus selon les permissions.
// Présentation seule : chaque appel est contrôlé par l'API (403 sans la permission).
(function () {
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name, cls, filled) { return window.iconHtml ? window.iconHtml(name, cls, filled) : ''; }
    function toast(m) { if (window.showToast) window.showToast(m); else if (window.Floor) Floor.toast(m); }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }
    function money(v) { return (parseFloat(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function can(p) { return Auth.can(p); }
    function view(id) { var v = $('view-' + id); return v && !v.classList.contains('hidden'); }
    function setHtml(el, html) {
        if (!el || el.__html === html) return;
        el.__html = html;
        el.innerHTML = html;
        if (window.renderIcons) window.renderIcons();
    }
    var INPUT = 'w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none';
    var BTN = 'inline-flex items-center gap-1 px-3 py-2 rounded-lg font-label-md text-xs transition-colors ';
    var BTN_PRIMARY = BTN + 'bg-primary-container text-on-primary hover:bg-primary';
    var BTN_SOFT = BTN + 'bg-surface-container text-on-surface hover:bg-surface-variant';
    var BTN_DANGER = BTN + 'bg-error-container text-on-error-container hover:opacity-90';

    function overlay(id) {
        var m = document.createElement('div');
        m.id = id;
        m.className = 'hidden fixed inset-0 z-[60] items-end md:items-center justify-center p-0 md:p-4 bg-black/40';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        m.addEventListener('click', function (e) { if (e.target === m) closeOverlay(m); });
        document.body.appendChild(m);
        return m;
    }
    function openOverlay(m) { m.classList.remove('hidden'); m.classList.add('flex'); if (window.renderIcons) window.renderIcons(); }
    function closeOverlay(m) { if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') document.querySelectorAll('[id^="ops-modal-"]').forEach(closeOverlay);
    });
    function panel(inner) {
        return '<div class="bg-surface-container-lowest w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-5 shadow-xl max-h-[92vh] overflow-y-auto">' + inner + '</div>';
    }

    // ------------------------------------------------------------------
    // Menus selon les permissions
    // ------------------------------------------------------------------
    var NAV_PERMS = { tables: 'tables.view', stats: 'stats.view', servers: 'staff.manage', promotions: 'promotions.view', loyalty: 'loyalty.view', audit: 'audit.view' };
    function applyPermissions() {
        Object.keys(NAV_PERMS).forEach(function (v) {
            var nav = $('nav-' + v);
            if (nav && nav.parentElement) nav.parentElement.classList.toggle('hidden', !can(NAV_PERMS[v]));
        });
        var s = Auth.staff();
        document.querySelectorAll('[data-admin-role]').forEach(function (n) { n.textContent = s ? (s.user.roleLabel || s.user.role) : ''; });
    }

    // ------------------------------------------------------------------
    // Salle : plan des tables
    // ------------------------------------------------------------------
    var floorTables = [];
    function paintFloorSummary() {
        var host = $('floor-summary');
        if (!host) return;
        var attention = floorTables.filter(function (t) { return t.status !== 'free'; }).length;
        var due = floorTables.reduce(function (sum, t) { return sum + (t.unpaidTotal || 0); }, 0);
        var bills = floorTables.filter(function (t) { return t.status === 'bill'; }).length;
        var cleaning = floorTables.filter(function (t) { return t.status === 'cleaning'; }).length;
        function tile(icon, label, value, accent) {
            // Petit téléphone : icône au-dessus, montant plus petit (jamais hors de sa colonne).
            return '<div class="bg-surface-container-lowest rounded-xl p-3 sm:p-4 flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">' +
                '<span class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ' + (accent ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant') + '">' + ic(icon) + '</span>' +
                '<span class="min-w-0 max-w-full"><span class="block font-headline-sm text-[19px] sm:text-headline-sm text-on-surface leading-tight sm:leading-none whitespace-nowrap">' + value + '</span>' +
                '<span class="block font-label-md text-xs text-on-surface-variant mt-0.5">' + label + '</span></span></div>';
        }
        setHtml(host, '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
            tile('table_restaurant', 'Tables à traiter', attention) +
            tile('receipt_long', 'Additions demandées', bills) +
            tile('cleaning_services', 'À nettoyer', cleaning) +
            tile('payments', 'À encaisser', esc(money(due)), true) + '</div>');
    }
    function paintFloor() {
        paintFloorSummary();
        setHtml($('floor-legend'), Floor.legendHtml(floorTables));
        Floor.render($('tables-list'), floorTables);
    }
    window.renderFloorView = function () {
        var addBox = $('floor-add');
        if (addBox) addBox.classList.toggle('hidden', !can('tables.manage'));
        Auth.api('/tables').then(function (r) { floorTables = r.content || []; paintFloor(); })
            .catch(function (e) { setHtml($('tables-list'), '<p class="text-error">Impossible de charger le plan : ' + esc(errText(e)) + '</p>'); });
    };
    window.toggleFloorAddForm = function () {
        var form = $('floor-add-form');
        if (!form) return false;
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) $('floor-new-number').focus();
        return false;
    };
    window.addFloorTable = function () {
        var n = $('floor-new-number').value.trim();
        var seats = parseInt($('floor-new-seats').value, 10);
        if (!n) { toast('Indiquez le numéro de la table'); return false; }
        var body = { tableNumber: n };
        if (seats) body.seats = seats;
        Auth.api('/tables', Auth.json('POST', body)).then(function () {
            $('floor-new-number').value = '';
            $('floor-new-seats').value = '';
            $('floor-add-form').classList.add('hidden');
            toast('Table ajoutée');
            window.renderFloorView();
        }).catch(function (e) { toast('Impossible : ' + errText(e)); });
        return false;
    };

    // ------------------------------------------------------------------
    // Promotions
    // ------------------------------------------------------------------
    var promos = [];
    var promoDeleteArmed = {};
    var catalog = { categories: null, products: null };
    var promoModal = null;
    var editingPromo = null;
    var DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

    function loadCatalogLists() {
        if (catalog.categories) return Promise.resolve();
        return Promise.all([Auth.api('/categories'), Auth.api('/products?limit=100')]).then(function (r) {
            catalog.categories = Array.isArray(r[0]) ? r[0] : (r[0].content || []);
            catalog.products = r[1].content || [];
        });
    }

    function promoCard(p) {
        var state = !p.active ? ['Désactivée', 'bg-error-container text-on-error-container']
            : p.activeNow ? ['En vigueur maintenant', 'bg-secondary-container text-on-secondary-container']
            : ['Programmée', 'bg-surface-container text-on-surface-variant'];
        var armed = !!promoDeleteArmed[p.id];
        var actions = '';
        if (can('promotions.manage')) {
            actions = '<button onclick="return togglePromotion(' + p.id + ',' + (!p.active) + ')" class="' + BTN_SOFT + '">' + (p.active ? 'Désactiver' : 'Activer') + '</button>' +
                '<button onclick="return openPromotionModal(' + p.id + ')" class="' + BTN_SOFT + '">' + ic('edit') + ' Modifier</button>' +
                '<button onclick="return deletePromotion(' + p.id + ')" class="' + BTN + (armed ? 'bg-error text-on-error' : 'bg-error-container text-on-error-container hover:opacity-90') + '">' + ic('delete') + (armed ? ' Confirmer ?' : ' Supprimer') + '</button>';
        }
        return '<div class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] flex flex-col md:flex-row md:items-center gap-3">' +
            '<span class="w-11 h-11 rounded-full bg-secondary-container text-primary flex items-center justify-center text-[26px] shrink-0">' + ic('local_offer') + '</span>' +
            '<div class="min-w-0 flex-1"><div class="font-title-lg text-title-lg text-on-surface">' + esc(p.name) + ' <span class="text-xs px-2 py-0.5 rounded-full ' + state[1] + '">' + state[0] + '</span></div>' +
            '<div class="text-sm text-on-surface-variant">' + esc(p.summary) + '</div>' +
            (p.description ? '<div class="text-xs text-on-surface-variant">' + esc(p.description) + '</div>' : '') + '</div>' +
            '<div class="flex flex-wrap gap-2 shrink-0">' + actions + '</div></div>';
    }

    function paintPromos(suggestions) {
        var html = '';
        if (suggestions) {
            html += '<div class="sc-suggest bg-surface-container-lowest text-on-surface border border-outline-variant rounded-xl p-4 space-y-3">' +
                '<div class="font-title-lg text-title-lg flex items-center gap-2">' + ic('auto_awesome') + ' Suggestions intelligentes</div>';
            if (suggestions.note) html += '<p class="text-sm text-on-surface-variant">' + esc(suggestions.note) + '</p>';
            (suggestions.content || []).forEach(function (s, i) {
                html += '<div class="flex flex-col md:flex-row md:items-center gap-2 bg-surface-container-low text-on-surface rounded-lg p-3">' +
                    '<div class="flex-1"><div class="font-label-md text-sm">' + esc(s.title) + '</div><div class="text-xs text-on-surface-variant">' + esc(s.reason) + '</div></div>' +
                    (can('promotions.manage') ? '<button onclick="return createSuggestedPromotion(' + i + ')" class="' + BTN_PRIMARY + '">' + ic('add') + ' Créer</button>' : '') + '</div>';
            });
            if (!(suggestions.content || []).length && !suggestions.note) html += '<p class="text-sm">Aucune suggestion pour le moment : vos heures et vos produits se comportent normalement.</p>';
            html += '</div>';
            window.__promoSuggestions = suggestions.content || [];
        }
        html += promos.length ? '<div class="flex flex-col gap-3">' + promos.map(promoCard).join('') + '</div>'
            : '<p class="sc-admin-empty text-on-surface-variant">Aucune promotion. Créez-en une : elle s’applique automatiquement aux commandes, selon vos règles.</p>';
        setHtml($('promotions-content'), html);
    }

    window.renderPromotionsView = function () {
        var addBtn = $('promo-add-btn');
        if (addBtn) addBtn.classList.toggle('hidden', !can('promotions.manage'));
        Promise.all([Auth.api('/promotions'), Auth.api('/promotions/suggestions')]).then(function (r) {
            promos = r[0].content || [];
            paintPromos(r[1]);
        }).catch(function (e) { setHtml($('promotions-content'), '<p class="text-error">Impossible de charger les promotions : ' + esc(errText(e)) + '</p>'); });
    };

    window.togglePromotion = function (id, active) {
        Auth.api('/promotions/' + id, Auth.json('PATCH', { active: active })).then(function () {
            toast(active ? 'Promotion activée' : 'Promotion désactivée');
            window.renderPromotionsView();
        }).catch(function (e) { toast('Impossible : ' + errText(e)); });
        return false;
    };
    window.deletePromotion = function (id) {
        if (!promoDeleteArmed[id]) {
            promoDeleteArmed[id] = true;
            paintPromos();
            setTimeout(function () { delete promoDeleteArmed[id]; window.renderPromotionsView(); }, 4000);
            return false;
        }
        delete promoDeleteArmed[id];
        Auth.api('/promotions/' + id, Auth.json('DELETE')).then(function () { toast('Promotion supprimée'); window.renderPromotionsView(); })
            .catch(function (e) { toast('Impossible : ' + errText(e)); });
        return false;
    };
    window.createSuggestedPromotion = function (i) {
        var s = (window.__promoSuggestions || [])[i];
        if (!s) return false;
        Auth.api('/promotions', Auth.json('POST', s.draft)).then(function () { toast('Promotion créée'); window.renderPromotionsView(); })
            .catch(function (e) { toast('Impossible : ' + errText(e)); });
        return false;
    };

    function promoModalBuild() {
        promoModal = overlay('ops-modal-promo');
        promoModal.innerHTML = panel(
            '<div class="flex items-start justify-between mb-4"><h3 id="promo-title" class="font-title-lg text-title-lg text-primary">Promotion</h3>' +
            '<button type="button" onclick="return closePromotionModal()" aria-label="Fermer" class="text-on-surface-variant hover:text-primary"><span class="material-symbols-outlined">close</span></button></div>' +
            '<form id="promo-form" class="space-y-3" novalidate autocomplete="off">' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-name">Nom *</label><input id="promo-name" maxlength="100" class="' + INPUT + '" placeholder="Ex : Happy hour"/></div>' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-desc">Description</label><input id="promo-desc" maxlength="255" class="' + INPUT + '"/></div>' +
            '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-kind">Type</label><select id="promo-kind" class="' + INPUT + '"><option value="percent">Pourcentage (%)</option><option value="fixed">Montant fixe (€)</option></select></div>' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-value">Valeur *</label><input id="promo-value" type="number" step="0.5" min="0" class="' + INPUT + '"/></div></div>' +
            '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-scope">S’applique à</label><select id="promo-scope" onchange="promoScopeChanged()" class="' + INPUT + '"><option value="order">Toute la commande</option><option value="category">Une catégorie</option><option value="product">Un produit</option></select></div>' +
            '<div id="promo-target-wrap" class="hidden"><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-target">Cible</label><select id="promo-target" class="' + INPUT + '"></select></div></div>' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-min">Commande minimum (€)</label><input id="promo-min" type="number" step="0.5" min="0" value="0" class="' + INPUT + '"/></div>' +
            '<div><span class="block font-label-md text-xs text-on-surface-variant mb-1">Jours</span><div class="flex flex-wrap gap-2" id="promo-days">' +
            DAYS.map(function (d, i) { return '<label class="inline-flex items-center gap-1 text-sm text-on-surface"><input type="checkbox" value="' + i + '" checked class="accent-primary w-4 h-4"/>' + d + '</label>'; }).join('') + '</div></div>' +
            '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-start">Heure de début</label><input id="promo-start" type="time" class="' + INPUT + '"/></div>' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-end">Heure de fin</label><input id="promo-end" type="time" class="' + INPUT + '"/></div></div>' +
            '<p class="text-xs text-on-surface-variant">Heures vides = toute la journée. Une plage comme 22:00 → 02:00 est acceptée.</p>' +
            '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-from">Du (date)</label><input id="promo-from" type="date" class="' + INPUT + '"/></div>' +
            '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="promo-to">Au (date)</label><input id="promo-to" type="date" class="' + INPUT + '"/></div></div>' +
            '<label class="flex items-center gap-2 text-sm text-on-surface"><input id="promo-active" type="checkbox" checked class="accent-primary w-4 h-4"/> Promotion active</label>' +
            '<p id="promo-error" role="alert" class="hidden text-error text-sm"></p>' +
            '<div class="flex gap-2 pt-2"><button type="button" onclick="return closePromotionModal()" class="flex-1 py-3 rounded-lg border-[1.5px] border-outline-variant text-on-surface font-label-md text-label-md hover:bg-surface-container">Annuler</button>' +
            '<button type="submit" id="promo-save" class="flex-1 py-3 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary disabled:opacity-60">Enregistrer</button></div></form>');
        $('promo-form').addEventListener('submit', function (e) { e.preventDefault(); savePromotion(); });
    }

    window.promoScopeChanged = function () {
        var scope = $('promo-scope').value;
        var wrap = $('promo-target-wrap');
        wrap.classList.toggle('hidden', scope === 'order');
        var sel = $('promo-target');
        var list = scope === 'category' ? (catalog.categories || []) : (catalog.products || []);
        sel.innerHTML = list.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
    };

    window.openPromotionModal = function (id) {
        loadCatalogLists().then(function () {
            if (!promoModal) promoModalBuild();
            editingPromo = id || null;
            var p = null;
            for (var i = 0; i < promos.length; i++) if (promos[i].id === id) p = promos[i];
            $('promo-title').textContent = p ? 'Modifier la promotion' : 'Nouvelle promotion';
            $('promo-name').value = p ? p.name : '';
            $('promo-desc').value = p && p.description ? p.description : '';
            $('promo-kind').value = p ? p.kind : 'percent';
            $('promo-value').value = p ? p.value : '';
            $('promo-scope').value = p ? p.scope : 'order';
            window.promoScopeChanged();
            if (p && p.scope === 'category') $('promo-target').value = p.categoryId;
            if (p && p.scope === 'product') $('promo-target').value = p.productId;
            $('promo-min').value = p ? p.minOrder : 0;
            document.querySelectorAll('#promo-days input').forEach(function (c) { c.checked = !p || p.days.indexOf(parseInt(c.value, 10)) !== -1; });
            $('promo-start').value = p && p.startTime ? p.startTime : '';
            $('promo-end').value = p && p.endTime ? p.endTime : '';
            $('promo-from').value = p && p.startDate ? p.startDate : '';
            $('promo-to').value = p && p.endDate ? p.endDate : '';
            $('promo-active').checked = p ? p.active : true;
            $('promo-error').classList.add('hidden');
            $('promo-save').disabled = false;
            openOverlay(promoModal);
        });
        return false;
    };
    window.closePromotionModal = function () { closeOverlay(promoModal); return false; };

    function savePromotion() {
        var err = $('promo-error');
        var scope = $('promo-scope').value;
        var days = [];
        document.querySelectorAll('#promo-days input').forEach(function (c) { if (c.checked) days.push(parseInt(c.value, 10)); });
        var body = {
            name: $('promo-name').value.trim(), description: $('promo-desc').value.trim() || null,
            kind: $('promo-kind').value, value: parseFloat($('promo-value').value), scope: scope,
            minOrder: parseFloat($('promo-min').value) || 0, days: days,
            startTime: $('promo-start').value || null, endTime: $('promo-end').value || null,
            startDate: $('promo-from').value || null, endDate: $('promo-to').value || null,
            active: $('promo-active').checked
        };
        if (scope === 'category') body.categoryId = parseInt($('promo-target').value, 10);
        if (scope === 'product') body.productId = parseInt($('promo-target').value, 10);
        if (!body.name) { err.textContent = 'Indiquez un nom.'; err.classList.remove('hidden'); return; }
        if (!(body.value > 0)) { err.textContent = 'Indiquez une valeur supérieure à 0.'; err.classList.remove('hidden'); return; }
        if (!days.length) { err.textContent = 'Choisissez au moins un jour.'; err.classList.remove('hidden'); return; }
        err.classList.add('hidden');
        $('promo-save').disabled = true;
        var req = editingPromo ? Auth.api('/promotions/' + editingPromo, Auth.json('PATCH', body)) : Auth.api('/promotions', Auth.json('POST', body));
        req.then(function () {
            closeOverlay(promoModal);
            toast(editingPromo ? 'Promotion modifiée' : 'Promotion créée');
            window.renderPromotionsView();
        }).catch(function (e) { err.textContent = errText(e); err.classList.remove('hidden'); $('promo-save').disabled = false; });
    }

    // ------------------------------------------------------------------
    // Fidélité
    // ------------------------------------------------------------------
    var loyaltyModal = null;
    function tierBadge(t) {
        var cls = t === 'Or' ? 'bg-tertiary-container text-on-tertiary-container' : t === 'Argent' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant';
        return '<span class="text-xs px-2 py-0.5 rounded-full ' + cls + '">' + esc(t) + '</span>';
    }
    window.renderLoyaltyView = function (q) {
        var term = typeof q === 'string' ? q : (($('loyalty-search') || {}).value || '');
        Auth.api('/loyalty' + (term.trim() ? '?q=' + encodeURIComponent(term.trim()) : '')).then(function (r) {
            var list = r.content || [];
            setHtml($('loyalty-content'), list.length ? '<div class="flex flex-col gap-2">' + list.map(function (a) {
                return '<button onclick="return openLoyaltyModal(' + a.id + ')" class="text-left bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] flex items-center gap-3 hover:bg-surface-container transition-colors">' +
                    '<span class="w-11 h-11 rounded-full bg-secondary-container text-primary flex items-center justify-center text-[26px] shrink-0">' + ic('loyalty') + '</span>' +
                    '<span class="flex-1 min-w-0"><span class="font-title-lg text-title-lg text-on-surface block truncate">' + esc(a.name) + ' ' + tierBadge(a.tier) + '</span>' +
                    '<span class="text-xs text-on-surface-variant">Tél. ' + esc(a.phone) + ' · ' + a.lifetimePoints + ' points cumulés</span></span>' +
                    '<span class="text-right"><span class="font-title-lg text-title-lg text-primary block">' + a.points + ' pts</span><span class="text-xs text-on-surface-variant">= ' + esc(money(a.redeemValue)) + '</span></span></button>';
            }).join('') + '</div>' : '<p class="sc-admin-empty text-on-surface-variant">Aucun compte fidélité. Un compte est créé quand un client renseigne son téléphone à l’identification.</p>');
        }).catch(function (e) { setHtml($('loyalty-content'), '<p class="text-error">Impossible de charger : ' + esc(errText(e)) + '</p>'); });
    };
    var TYPE_LABEL = { earn: 'Gain', redeem: 'Utilisation', refund: 'Restitution', adjust: 'Ajustement' };
    window.openLoyaltyModal = function (id) {
        Auth.api('/loyalty/' + id).then(function (r) {
            if (!loyaltyModal) loyaltyModal = overlay('ops-modal-loyalty');
            var a = r.account;
            loyaltyModal.innerHTML = panel(
                '<div class="flex items-start justify-between mb-3"><div><h3 class="font-title-lg text-title-lg text-primary">' + esc(a.name) + ' ' + tierBadge(a.tier) + '</h3>' +
                '<p class="text-xs text-on-surface-variant">Tél. ' + esc(a.phone) + ' · palier x' + a.tierMultiplier + (a.nextTier ? ' · ' + a.pointsToNextTier + ' pts avant ' + esc(a.nextTier) : '') + '</p></div>' +
                '<button type="button" onclick="return closeLoyaltyModal()" aria-label="Fermer" class="text-on-surface-variant hover:text-primary"><span class="material-symbols-outlined">close</span></button></div>' +
                '<div class="grid grid-cols-2 gap-3 mb-3"><div class="bg-surface-container rounded-lg p-3"><div class="text-xs text-on-surface-variant">Solde</div><div class="font-headline-sm text-headline-sm text-primary">' + a.points + ' pts</div></div>' +
                '<div class="bg-surface-container rounded-lg p-3"><div class="text-xs text-on-surface-variant">Valeur</div><div class="font-headline-sm text-headline-sm text-primary">' + esc(money(a.redeemValue)) + '</div></div></div>' +
                (can('loyalty.adjust') ? '<form id="loyalty-adjust" class="space-y-2 mb-3" novalidate><div class="grid grid-cols-3 gap-2"><input id="loyalty-points" type="number" step="10" placeholder="± points" class="' + INPUT + '"/><input id="loyalty-note" maxlength="255" placeholder="Motif (obligatoire)" class="col-span-2 ' + INPUT + '"/></div>' +
                    '<p id="loyalty-error" role="alert" class="hidden text-error text-sm"></p><button type="submit" class="' + BTN_PRIMARY + '">Ajuster le solde</button></form>' : '') +
                '<div class="font-label-md text-xs text-on-surface-variant mb-1">Historique</div><div class="divide-y divide-outline-variant/40 text-sm">' +
                (r.history.length ? r.history.map(function (h) {
                    return '<div class="flex justify-between gap-3 py-1.5"><span>' + esc(TYPE_LABEL[h.type] || h.type) + (h.note ? ' <span class="text-on-surface-variant text-xs">— ' + esc(h.note) + '</span>' : '') +
                        '</span><span class="font-label-md ' + (h.points < 0 ? 'text-error' : 'text-primary') + '">' + (h.points > 0 ? '+' : '') + h.points + '</span></div>';
                }).join('') : '<p class="text-on-surface-variant py-2">Aucun mouvement.</p>') + '</div>');
            var form = $('loyalty-adjust');
            if (form) form.addEventListener('submit', function (e) {
                e.preventDefault();
                var pts = parseInt($('loyalty-points').value, 10), note = $('loyalty-note').value.trim(), err = $('loyalty-error');
                if (!pts || !note) { err.textContent = 'Indiquez un nombre de points non nul et un motif.'; err.classList.remove('hidden'); return; }
                Auth.api('/loyalty/' + id + '/adjust', Auth.json('POST', { points: pts, note: note })).then(function () {
                    toast('Solde ajusté'); window.openLoyaltyModal(id); window.renderLoyaltyView();
                }).catch(function (x) { err.textContent = errText(x); err.classList.remove('hidden'); });
            });
            openOverlay(loyaltyModal);
        }).catch(function (e) { toast('Impossible : ' + errText(e)); });
        return false;
    };
    window.closeLoyaltyModal = function () { closeOverlay(loyaltyModal); return false; };

    // ------------------------------------------------------------------
    // Historique (audit)
    // ------------------------------------------------------------------
    var AUDIT_LABEL = {
        'auth.login': 'Connexion', 'auth.login_failed': 'Connexion échouée', 'auth.login_blocked': 'Connexion bloquée (verrouillage)', 'auth.logout': 'Déconnexion',
        'staff.create': 'Employé créé', 'staff.update': 'Employé modifié', 'staff.delete': 'Employé supprimé', 'staff.tables': 'Tables du serveur modifiées',
        'product.price': 'Prix modifié', 'product.update': 'Produit modifié', 'product.delete': 'Produit supprimé',
        'order.create': 'Commande créée', 'order.status': 'Statut de commande', 'order.payment': 'Paiement', 'order.cancel': 'Commande annulée',
        'table.create': 'Table ajoutée', 'table.delete': 'Table retirée', 'table.bill_requested': 'Addition demandée', 'table.payment': 'Table encaissée',
        'table.release': 'Table libérée', 'table.clean': 'Table nettoyée',
        'promotion.create': 'Promotion créée', 'promotion.update': 'Promotion modifiée', 'promotion.delete': 'Promotion supprimée',
        'loyalty.adjust': 'Ajustement de points', 'client.register': 'Client identifié', 'client.table_change': 'Changement de table',
        'table_request.respond': 'Réponse à un changement de table'
    };
    var ROLE_LABEL = { admin: 'Admin', manager: 'Manager', server: 'Serveur', cashier: 'Caissier', kitchen: 'Cuisine', client: 'Client' };
    var auditState = { page: 0, size: 25 };

    function detailText(d) {
        if (!d) return '';
        return Object.keys(d).map(function (k) {
            var v = d[k];
            if (v && typeof v === 'object') v = Object.keys(v).map(function (x) { return x + ' ' + v[x]; }).join(' → ');
            return k + ' : ' + v;
        }).join(' · ');
    }

    window.renderAuditView = function (resetPage) {
        if (resetPage === true) auditState.page = 0;
        var q = ['limit=' + auditState.size, 'page=' + auditState.page];
        var v = function (id) { var e = $(id); return e ? e.value.trim() : ''; };
        if (v('audit-action')) q.push('action=' + encodeURIComponent(v('audit-action')));
        if (v('audit-actor')) q.push('actor=' + encodeURIComponent(v('audit-actor')));
        if (v('audit-from')) q.push('from=' + v('audit-from'));
        if (v('audit-to')) q.push('to=' + v('audit-to'));
        Auth.api('/audit?' + q.join('&')).then(function (r) {
            var rows = r.content || [];
            var pages = Math.max(1, Math.ceil(r.totalElements / r.size));
            var html = rows.length ? '<div class="sc-audit overflow-x-auto"><table class="w-full text-sm bg-surface-container-lowest rounded-xl"><thead><tr class="text-left text-on-surface-variant font-label-md text-xs">' +
                '<th class="p-3">Date</th><th class="p-3">Qui</th><th class="p-3">Action</th><th class="p-3">Objet</th><th class="p-3">Détails</th></tr></thead><tbody class="divide-y divide-outline-variant/40">' +
                rows.map(function (a) {
                    return '<tr class="align-top"><td data-label="Date" class="p-3 whitespace-nowrap text-on-surface-variant">' + esc(a.at) + '</td>' +
                        '<td data-label="Qui" class="p-3"><span class="font-label-md">' + esc(a.actorName || 'Système') + '</span><br><span class="text-xs px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">' + esc(ROLE_LABEL[a.actorRole] || (a.actorType === 'system' ? 'Système' : a.actorType)) + '</span></td>' +
                        '<td data-label="Action" class="p-3"><span class="font-label-md">' + esc(AUDIT_LABEL[a.action] || a.action) + '</span><br><span class="text-xs text-on-surface-variant">' + esc(a.action) + '</span></td>' +
                        '<td data-label="Objet" class="p-3 whitespace-nowrap">' + esc(a.entity) + (a.entityId ? ' #' + esc(a.entityId) : '') + '</td>' +
                        '<td data-label="Détails" class="p-3 text-on-surface-variant break-words max-w-md">' + esc(detailText(a.details)) + '</td></tr>';
                }).join('') + '</tbody></table></div>' : '<p class="sc-admin-empty text-on-surface-variant">Aucune entrée pour ces critères.</p>';
            html += '<div class="flex items-center justify-between pt-3 text-sm text-on-surface-variant"><span>' + r.totalElements + ' entrée(s)</span><span class="flex items-center gap-2">' +
                '<button onclick="return auditPage(-1)" ' + (auditState.page <= 0 ? 'disabled ' : '') + 'class="' + BTN_SOFT + ' disabled:opacity-40" aria-label="Page précédente">' + ic('chevron_left') + '</button>' +
                'Page ' + (auditState.page + 1) + ' / ' + pages +
                '<button onclick="return auditPage(1)" ' + (auditState.page + 1 >= pages ? 'disabled ' : '') + 'class="' + BTN_SOFT + ' disabled:opacity-40" aria-label="Page suivante">' + ic('chevron_right') + '</button></span></div>';
            setHtml($('audit-content'), html);
        }).catch(function (e) { setHtml($('audit-content'), '<p class="text-error">Impossible de charger le journal : ' + esc(errText(e)) + '</p>'); });
    };
    window.auditPage = function (d) { auditState.page = Math.max(0, auditState.page + d); window.renderAuditView(); return false; };

    // ------------------------------------------------------------------
    // Statistiques calculées par le serveur (stats.view)
    // ------------------------------------------------------------------
    var statsDays = 30;
    window.renderServerStats = function (days) {
        var host = $('server-stats');
        if (!host) return;
        if (!can('stats.view')) { host.innerHTML = ''; return; }
        if (typeof days === 'number') statsDays = days;
        Auth.api('/stats/summary?days=' + statsDays).then(function (s) {
            var m = s.byPaymentMethod;
            var card = function (label, value, sub) {
                return '<div class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)]"><div class="font-label-md text-xs text-on-surface-variant">' + label + '</div>' +
                    '<div class="font-headline-sm text-headline-sm text-primary">' + value + '</div>' + (sub ? '<div class="text-xs text-on-surface-variant">' + sub + '</div>' : '') + '</div>';
            };
            var periods = [7, 30, 90].map(function (d) {
                return '<button onclick="return renderServerStats(' + d + ')" class="' + BTN + (d === s.days ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface hover:bg-surface-variant') + '">' + d + ' jours</button>';
            }).join('');
            setHtml(host,
                '<div class="flex items-center justify-between gap-3 flex-wrap"><h3 class="font-title-lg text-title-lg text-primary">' + ic('trending_up') + ' Chiffres du serveur (' + s.days + ' derniers jours)</h3><div class="flex gap-2">' + periods + '</div></div>' +
                '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
                card('Encaissé', esc(money(s.revenue)), s.paidOrders + ' commande(s) payée(s)') +
                card('Commandes', s.orders, s.cancelledOrders + ' annulée(s)') +
                card('Panier moyen', esc(money(s.averageBasket)), 'ventes brutes ' + esc(money(s.grossSales))) +
                card('Remises accordées', esc(money(s.discountsGiven)), 'promotions + points fidélité') + '</div>' +
                '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
                card(ic('payments') + ' Espèces', esc(money(m.cash.amount)), m.cash.orders + ' commande(s)') +
                card(ic('credit_card') + ' Carte', esc(money(m.card.amount)), m.card.orders + ' commande(s)') +
                card(ic('payments') + ' En ligne', esc(money(m.online.amount)), m.online.orders + ' commande(s)') + '</div>' +
                '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
                '<div class="bg-surface-container-lowest rounded-xl p-4"><div class="font-label-md text-xs text-on-surface-variant mb-2">Top produits</div>' +
                (s.topProducts.length ? s.topProducts.map(function (p, i) { return '<div class="flex justify-between text-sm py-0.5"><span>' + (i + 1) + '. ' + esc(p.name) + '</span><span class="font-label-md">' + p.quantity + '×</span></div>'; }).join('') : '<p class="text-sm text-on-surface-variant">Aucune vente.</p>') + '</div>' +
                '<div class="bg-surface-container-lowest rounded-xl p-4"><div class="font-label-md text-xs text-on-surface-variant mb-2">Cuisine et fidélité</div>' +
                '<div class="text-sm py-0.5">Préparation moyenne : <b>' + s.kitchen.avgPrepMinutes + ' min</b> <span class="text-xs text-on-surface-variant">(' + esc(s.kitchen.basis) + ')</span></div>' +
                '<div class="text-sm py-0.5">File actuelle : <b>' + s.kitchen.queue + '</b> commande(s), ' + s.kitchen.parallel + ' en parallèle</div>' +
                '<div class="text-sm py-0.5">Points gagnés : <b>' + s.loyalty.pointsEarned + '</b> · utilisés : <b>' + s.loyalty.pointsRedeemed + '</b></div></div></div>');
        }).catch(function (e) { setHtml(host, '<p class="text-error">Statistiques indisponibles : ' + esc(errText(e)) + '</p>'); });
        return false;
    };

    // ------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        applyPermissions();
        document.addEventListener('soucoffe:permissions', applyPermissions);
        Floor.onChange(function () { if (view('tables')) window.renderFloorView(); });
        setInterval(function () {
            if (view('tables')) window.renderFloorView();
            if (view('loyalty') && !(loyaltyModal && loyaltyModal.classList.contains('flex'))) window.renderLoyaltyView();
        }, 6000);
    });
})();
