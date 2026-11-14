// SOUCOFFE - Admin : ajout d'un produit au catalogue (POST /api/products).
//
// Bouton « Ajouter un produit » de la vue Produits, visible avec la
// permission products.create (admin, manager ; l'API refuse sinon).
// Le produit est enregistré EN BASE : il apparaît aussitôt dans le Menu et
// Cafés de tous les appareils. Jusqu'à 6 photos (js/admin-choices.js : compressées ici,
// 900 px max, JPEG, puis enregistrées par le serveur dans images/products/), la 1re étant
// la photo principale. Les choix proposés au client (Pain, Sauce, Taille…) sont cochés ici ;
// à la sélection d'une catégorie, ceux de ses produits sont cochés d'avance.
(function () {
    var ALLERGENS = ['Gluten', 'Lait', 'Œufs', 'Soja', 'Fruits à coque', 'Arachides', 'Sésame', 'Moutarde',
        'Poisson', 'Crustacés', 'Mollusques', 'Céleri', 'Sulfites', 'Lupin'];
    var DIETARY = [['vegetarien', 'Végétarien'], ['vegan', 'Vegan'], ['sans-gluten', 'Sans gluten']];
    var INPUT = 'w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none';
    var LABEL = 'block font-label-md text-label-md text-on-surface-variant mb-1';
    var categories = [];
    var saving = false;
    var photos = null, picker = null;

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name) { return window.iconHtml ? window.iconHtml(name) : ''; }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }

    function modal() {
        var m = $('product-create-modal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'product-create-modal';
        m.className = 'hidden fixed inset-0 z-[60] items-end md:items-center justify-center p-0 md:p-4 bg-black/40';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        m.setAttribute('aria-labelledby', 'pc-title');
        m.addEventListener('click', function (e) { if (e.target === m) close(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.classList.contains('hidden')) close(); });
        document.body.appendChild(m);
        return m;
    }
    function close() {
        var m = $('product-create-modal');
        if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
        document.body.style.overflow = '';
        return false;
    }
    window.closeProductCreate = close;

    function form() {
        // Catégories regroupées par menu (Café, Kebab, …), dans l'ordre de l'API.
        var groups = [], byMenu = {};
        categories.forEach(function (c) {
            var key = c.menuName || 'Café';
            if (!byMenu[key]) { byMenu[key] = []; groups.push(key); }
            byMenu[key].push('<option value="' + c.id + '">' + esc(c.name) + '</option>');
        });
        var cats = groups.length > 1
            ? groups.map(function (g) { return '<optgroup label="Menu ' + esc(g) + '">' + byMenu[g].join('') + '</optgroup>'; }).join('')
            : (byMenu[groups[0]] || []).join('');
        var allergens = ALLERGENS.map(function (a) {
            return '<label class="inline-flex items-center gap-1.5 text-sm text-on-surface"><input type="checkbox" data-allergen="' + esc(a) + '"/> ' + esc(a) + '</label>';
        }).join('');
        var dietary = DIETARY.map(function (d) {
            return '<label class="inline-flex items-center gap-1.5 text-sm text-on-surface"><input type="checkbox" data-diet="' + d[0] + '"/> ' + d[1] + '</label>';
        }).join('');
        return '<div class="bg-surface-container-lowest w-full md:max-w-xl rounded-t-2xl md:rounded-2xl p-5 shadow-xl max-h-[92vh] overflow-y-auto">' +
            '<div class="flex items-start justify-between gap-3 mb-4"><div><h3 id="pc-title" class="font-title-lg text-title-lg text-primary">Nouveau produit</h3>' +
            '<p class="font-label-md text-xs text-on-surface-variant">Visible aussitôt dans les menus des clients, sur tous les appareils.</p></div>' +
            '<button onclick="return closeProductCreate()" aria-label="Fermer" class="w-9 h-9 rounded-lg inline-flex items-center justify-center text-on-surface-variant hover:bg-surface-variant">' + ic('close') + '</button></div>' +

            '<label class="block mb-3"><span class="' + LABEL + '">Nom *</span><input id="pc-name" maxlength="150" class="' + INPUT + '" placeholder="Ex. Kebab poulet crudités"/></label>' +
            '<div class="grid grid-cols-2 gap-3 mb-1">' +
            '<label class="block"><span class="' + LABEL + '">Catégorie *</span><select id="pc-category" onchange="productCreateCategoryChanged()" class="' + INPUT + '"><option value="">Choisir…</option>' + cats + '</select></label>' +
            '<label class="block"><span class="' + LABEL + '">Prix (€) *</span><input id="pc-price" type="number" min="0.01" max="1000" step="0.01" inputmode="decimal" class="' + INPUT + '" placeholder="0,00"/></label>' +
            '</div>' +
            '<p id="pc-options" class="text-xs text-on-surface-variant mb-3 min-h-[1rem]"></p>' +

            '<label class="block mb-3"><span class="' + LABEL + '">Description</span><textarea id="pc-desc" rows="2" maxlength="1000" class="' + INPUT + '" placeholder="Courte description affichée au client"></textarea></label>' +

            '<div id="pc-photos" class="mb-3"></div>' +
            '<div id="pc-choices" class="mb-3"></div>' +


            '<div class="grid grid-cols-2 gap-3 mb-3">' +
            '<label class="block"><span class="' + LABEL + '">Emoji (si pas d\'image)</span><input id="pc-emoji" maxlength="4" class="' + INPUT + '" placeholder="☕"/></label>' +
            '<label class="block"><span class="' + LABEL + '">Calories (kcal)</span><input id="pc-calories" type="number" min="0" max="3000" step="1" inputmode="numeric" class="' + INPUT + '"/></label>' +
            '</div>' +

            '<details class="mb-3"><summary class="cursor-pointer font-label-md text-sm text-primary">Allergènes et régime</summary>' +
            '<p class="text-xs text-on-surface-variant mt-2 mb-1">Allergènes (rien de coché = non renseigné)</p>' +
            '<div class="flex flex-wrap gap-x-4 gap-y-1.5 mb-2">' + allergens + '</div>' +
            '<label class="inline-flex items-center gap-1.5 text-sm text-on-surface mb-3"><input id="pc-no-allergen" type="checkbox"/> Aucun allergène</label>' +
            '<p class="text-xs text-on-surface-variant mb-1">Régime</p><div class="flex flex-wrap gap-x-4 gap-y-1.5">' + dietary + '</div>' +
            '</details>' +

            '<label class="inline-flex items-center gap-2 text-sm text-on-surface mb-4"><input id="pc-available" type="checkbox" checked/> Disponible à la commande</label>' +
            '<p id="pc-error" class="hidden text-sm text-error mb-3"></p>' +
            '<div class="flex gap-2">' +
            '<button id="pc-save" onclick="return saveProductCreate()" class="flex-1 h-11 rounded-lg bg-primary-container text-on-primary font-label-md text-sm hover:bg-primary inline-flex items-center justify-center gap-1.5">' + ic('add') + ' Ajouter le produit</button>' +
            '<button onclick="return closeProductCreate()" class="h-11 px-4 rounded-lg bg-surface-container text-on-surface font-label-md text-sm hover:bg-surface-variant">Annuler</button>' +
            '</div></div>';
    }

    // Choix cochés d'avance : groupes communs à tous les produits de la catégorie (même règle que le serveur).
    // Modifiables ensuite dans la liste « Choix proposés au client ».
    window.productCreateCategoryChanged = function () {
        var id = parseInt($('pc-category').value, 10);
        var el = $('pc-options');
        if (!id) { el.textContent = ''; return; }
        var cat = categories.filter(function (c) { return c.id === id; })[0];
        var list = (window.PRODUCTS || []).filter(function (p) { return cat && p.category === cat.name && Array.isArray(p.apiOptionGroups); });
        var common = list.length ? list[0].apiOptionGroups.filter(function (g) {
            return list.every(function (p) { return p.apiOptionGroups.some(function (x) { return x.id === g.id; }); });
        }) : [];
        if (picker) picker.set(common.map(function (g) { return g.id; }));
        el.textContent = common.length ? 'Choix habituels de la catégorie cochés : ' + common.map(function (g) { return g.name; }).join(', ') + '.' : '';
    };

    function showError(msg) {
        var el = $('pc-error');
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    window.saveProductCreate = function () {
        if (saving) return false;
        $('pc-error').classList.add('hidden');
        var name = $('pc-name').value.trim();
        var categoryId = parseInt($('pc-category').value, 10);
        var price = parseFloat(String($('pc-price').value).replace(',', '.'));
        if (!name) { showError('Indiquez le nom du produit.'); $('pc-name').focus(); return false; }
        if (!categoryId) { showError('Choisissez une catégorie.'); $('pc-category').focus(); return false; }
        if (isNaN(price) || price <= 0 || price > 1000) { showError('Indiquez un prix entre 0,01 et 1000 €.'); $('pc-price').focus(); return false; }

        var body = { name: name, categoryId: categoryId, basePrice: Math.round(price * 1000) / 1000, available: $('pc-available').checked };
        var desc = $('pc-desc').value.trim();
        if (desc) body.description = desc;
        var emoji = $('pc-emoji').value.trim();
        if (emoji) body.emoji = emoji;
        var cal = $('pc-calories').value.trim();
        if (cal !== '') body.calories = parseInt(cal, 10);
        var list = photos ? photos.get() : [];
        if (list.length) body.images = list;
        if (picker) body.optionGroupIds = picker.get();
        var allergens = Array.prototype.map.call(document.querySelectorAll('#product-create-modal [data-allergen]:checked'), function (x) { return x.getAttribute('data-allergen'); });
        if (allergens.length) body.allergens = allergens;
        else if ($('pc-no-allergen').checked) body.allergens = [];
        body.dietaryTags = Array.prototype.map.call(document.querySelectorAll('#product-create-modal [data-diet]:checked'), function (x) { return x.getAttribute('data-diet'); });

        saving = true;
        var btn = $('pc-save');
        btn.disabled = true;
        btn.classList.add('opacity-60');
        Auth.api('/products', Auth.json('POST', body)).then(function (p) {
            return window.loadCatalog(true).then(function () { return p; });
        }).then(function (p) {
            close();
            if (window.showToast) window.showToast('Produit ajouté : ' + p.name);
            if (window.showAdminView) window.showAdminView('products');
        }).catch(function (e) {
            showError('Non enregistré : ' + errText(e));
        }).then(function () {
            saving = false;
            btn.disabled = false;
            btn.classList.remove('opacity-60');
        });
        return false;
    };

    window.openProductCreate = function () {
        var m = modal();
        var open = function () {
            m.innerHTML = form();
            photos = window.SCChoices ? new SCChoices.PhotoManager($('pc-photos'), []) : null;
            picker = window.SCChoices && Auth.can('catalog.manage') ? new SCChoices.ChoicePicker($('pc-choices'), []) : null;
            m.classList.remove('hidden');
            m.classList.add('flex');
            document.body.style.overflow = 'hidden';
            if (window.renderIcons) window.renderIcons();
            $('pc-name').focus();
        };
        // Toujours relu : une catégorie créée dans « Menus et catégories » apparaît aussitôt.
        Auth.api('/categories').then(function (list) {
            categories = (list || []).slice(); // déjà triées par menu puis par ordre (API)
            open();
        }).catch(function (e) { if (window.showToast) window.showToast('Catégories indisponibles : ' + errText(e)); });
        return false;
    };

    function applyPermission() {
        var btn = $('product-add-btn');
        if (btn) btn.classList.toggle('hidden', !Auth.can('products.create'));
    }
    document.addEventListener('DOMContentLoaded', applyPermission);
    document.addEventListener('soucoffe:permissions', applyPermission);
})();
