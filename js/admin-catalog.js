// SOUCOFFE - Admin : menus (cartes : Café, Kebab, …) et catégories (api/services/CatalogService.php).
//
// Vue « Menus et catégories » (permission catalog.manage : admin, manager) :
//   - créer un menu (nom, accroche), le renommer, l'activer / désactiver, le supprimer s'il est vide ;
//   - créer une catégorie dans un menu, la renommer, la déplacer vers un autre menu, changer son ordre,
//     la supprimer si aucun produit ne l'utilise.
// Le serveur reste l'autorité (refus 403 / 409 affichés tels quels). Après chaque changement, le
// catalogue est rechargé : Produits, ajout de produit et pages de menu voient les nouvelles catégories.
(function () {
    var menus = [];
    var INPUT = 'bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none';
    var BTN = 'h-9 px-3 rounded-lg font-label-md text-xs inline-flex items-center gap-1 transition-colors ';
    var BTN_PRIMARY = BTN + 'bg-primary-container text-on-primary hover:bg-primary';
    var BTN_SOFT = BTN + 'bg-surface-container text-on-surface hover:bg-surface-variant';
    var BTN_DANGER = BTN + 'bg-error-container text-on-error-container hover:opacity-90';
    var armed = {};

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n) { return window.iconHtml ? window.iconHtml(n) : ''; }
    function toast(m) { if (window.showToast) window.showToast(m); }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }
    function can() { return Auth.can('catalog.manage'); }

    function refreshAll() {
        return Auth.api('/admin/menus').then(function (r) {
            menus = r.content || [];
            render();
            if (window.loadCatalog) window.loadCatalog(true);
        });
    }

    function call(method, path, body, okMsg) {
        return Auth.api(path, Auth.json(method, body)).then(function () {
            if (okMsg) toast(okMsg);
            return refreshAll();
        }).catch(function (e) { toast(errText(e)); throw e; });
    }

    function menuOptions(selected) {
        return menus.map(function (m) {
            return '<option value="' + m.id + '"' + (m.id === selected ? ' selected' : '') + '>Menu ' + esc(m.name) + '</option>';
        }).join('');
    }

    function categoryRow(c, menu) {
        var del = armed['c' + c.id];
        return '<li class="flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-outline-variant last:border-0">' +
            '<div class="flex items-center gap-2 flex-1 min-w-0">' +
            '<input data-cat-name="' + c.id + '" value="' + esc(c.name) + '" maxlength="100" aria-label="Nom de la catégorie" class="' + INPUT + ' flex-1 min-w-0"/>' +
            '<span class="text-xs text-on-surface-variant whitespace-nowrap">' + c.products + ' produit(s)</span>' +
            '</div>' +
            '<div class="flex flex-wrap items-center gap-2">' +
            '<label class="text-xs text-on-surface-variant inline-flex items-center gap-1">Ordre <input data-cat-sort="' + c.id + '" type="number" min="0" max="10000" value="' + c.sortOrder + '" class="' + INPUT + ' w-20"/></label>' +
            '<select data-cat-menu="' + c.id + '" aria-label="Menu de la catégorie" class="' + INPUT + '">' + menuOptions(menu.id) + '</select>' +
            '<button onclick="return catalogSaveCategory(' + c.id + ')" class="' + BTN_SOFT + '">' + ic('check') + ' Enregistrer</button>' +
            (c.deletable ? '<button onclick="return catalogDeleteCategory(' + c.id + ')" class="' + BTN_DANGER + '">' + ic('delete') + (del ? ' Confirmer ?' : ' Supprimer') + '</button>' : '') +
            '</div></li>';
    }

    function menuCard(m) {
        var del = armed['m' + m.id];
        var page = window.scMenuUrl ? window.scMenuUrl(m.slug) : '#';
        return '<div class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] space-y-3' + (m.active ? '' : ' opacity-80') + '">' +
            '<div class="flex flex-col md:flex-row md:items-end gap-2">' +
            '<label class="flex-1 min-w-0 text-xs text-on-surface-variant font-label-md">Nom du menu' +
            '<input data-menu-name="' + m.id + '" value="' + esc(m.name) + '" maxlength="80" class="' + INPUT + ' w-full mt-1"/></label>' +
            '<label class="flex-[2] min-w-0 text-xs text-on-surface-variant font-label-md">Accroche (sous le titre de la page)' +
            '<input data-menu-tagline="' + m.id + '" value="' + esc(m.tagline || '') + '" maxlength="160" class="' + INPUT + ' w-full mt-1"/></label>' +
            '</div>' +
            '<div class="flex flex-wrap items-center gap-2">' +
            '<span class="text-xs px-2 py-0.5 rounded-full ' + (m.active ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant') + '">' + (m.active ? 'Visible' : 'Masqué') + '</span>' +
            (m.core ? '<span class="text-xs px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">Menu principal</span>' : '') +
            '<span class="flex-1"></span>' +
            '<a href="' + page + '" target="_blank" rel="noopener" class="' + BTN_SOFT + '">' + ic('visibility') + ' Voir la page</a>' +
            '<button onclick="return catalogSaveMenu(' + m.id + ')" class="' + BTN_PRIMARY + '">' + ic('check') + ' Enregistrer</button>' +
            (m.core ? '' : '<button onclick="return catalogToggleMenu(' + m.id + ')" class="' + BTN_SOFT + '">' + ic(m.active ? 'visibility_off' : 'visibility') + (m.active ? ' Masquer' : ' Rendre visible') + '</button>') +
            (!m.core && !m.categories.length ? '<button onclick="return catalogDeleteMenu(' + m.id + ')" class="' + BTN_DANGER + '">' + ic('delete') + (del ? ' Confirmer ?' : ' Supprimer') + '</button>' : '') +
            '</div>' +
            '<div><div class="font-label-md text-sm text-primary mb-1">Catégories (' + m.categories.length + ')</div>' +
            (m.categories.length ? '<ul>' + m.categories.map(function (c) { return categoryRow(c, m); }).join('') + '</ul>'
                : '<p class="text-sm text-on-surface-variant">Aucune catégorie dans ce menu.</p>') +
            '</div></div>';
    }

    function render() {
        var el = $('catalog-content');
        if (!el) return;
        el.innerHTML =
            '<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">' +
            '<form onsubmit="return catalogCreateMenu(event)" class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] space-y-2">' +
            '<div class="font-label-md text-sm text-primary inline-flex items-center gap-1">' + ic('restaurant_menu') + ' Nouveau menu</div>' +
            '<input id="cat-new-menu-name" maxlength="80" required placeholder="Nom du menu (ex. Pizza)" class="' + INPUT + ' w-full"/>' +
            '<input id="cat-new-menu-tagline" maxlength="160" placeholder="Accroche (facultatif)" class="' + INPUT + ' w-full"/>' +
            '<button type="submit" class="' + BTN_PRIMARY + '">' + ic('add') + ' Créer le menu</button></form>' +
            '<form onsubmit="return catalogCreateCategory(event)" class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] space-y-2">' +
            '<div class="font-label-md text-sm text-primary inline-flex items-center gap-1">' + ic('tag') + ' Nouvelle catégorie</div>' +
            '<input id="cat-new-cat-name" maxlength="100" required placeholder="Nom de la catégorie (ex. Bowls)" class="' + INPUT + ' w-full"/>' +
            '<select id="cat-new-cat-menu" aria-label="Menu de la nouvelle catégorie" class="' + INPUT + ' w-full">' + menuOptions(menus.length ? menus[0].id : 0) + '</select>' +
            '<button type="submit" class="' + BTN_PRIMARY + '">' + ic('add') + ' Créer la catégorie</button></form>' +
            '</div>' +
            menus.map(menuCard).join('');
        if (window.renderIcons) window.renderIcons();
    }

    window.renderCatalogView = function () {
        var el = $('catalog-content');
        if (!el) return;
        if (!can()) { el.innerHTML = '<p class="text-sm text-on-surface-variant">Votre rôle ne permet pas de gérer les menus.</p>'; return; }
        el.innerHTML = '<p class="text-sm text-on-surface-variant">Chargement…</p>';
        refreshAll().catch(function (e) { el.innerHTML = '<p class="text-sm text-error">Chargement impossible : ' + esc(errText(e)) + '</p>'; });
        // Groupes de choix (Pain, sauces…) : js/admin-choices.js.
        if (window.renderChoiceGroups) window.renderChoiceGroups($('catalog-choice-groups'));
        // Adresse, horaires, contact affichés sur l'accueil : js/admin-restaurant.js.
        if (window.renderRestaurantInfoAdmin) window.renderRestaurantInfoAdmin($('catalog-restaurant-info'));
    };

    window.catalogCreateMenu = function (e) {
        if (e) e.preventDefault();
        var name = $('cat-new-menu-name').value.trim();
        if (!name) return false;
        var body = { name: name };
        var tag = $('cat-new-menu-tagline').value.trim();
        if (tag) body.tagline = tag;
        call('POST', '/menus', body, 'Menu créé : ' + name).catch(function () {});
        return false;
    };
    window.catalogCreateCategory = function (e) {
        if (e) e.preventDefault();
        var name = $('cat-new-cat-name').value.trim();
        if (!name) return false;
        call('POST', '/categories', { name: name, menuId: parseInt($('cat-new-cat-menu').value, 10) }, 'Catégorie créée : ' + name).catch(function () {});
        return false;
    };
    window.catalogSaveMenu = function (id) {
        var name = document.querySelector('[data-menu-name="' + id + '"]').value.trim();
        var tag = document.querySelector('[data-menu-tagline="' + id + '"]').value.trim();
        call('PATCH', '/menus/' + id, { name: name, tagline: tag || null }, 'Menu enregistré').catch(function () {});
        return false;
    };
    window.catalogToggleMenu = function (id) {
        var m = menus.filter(function (x) { return x.id === id; })[0];
        if (m) call('PATCH', '/menus/' + id, { active: !m.active }, m.active ? 'Menu masqué' : 'Menu visible').catch(function () {});
        return false;
    };
    window.catalogDeleteMenu = function (id) {
        if (!armed['m' + id]) { armed['m' + id] = true; render(); setTimeout(function () { delete armed['m' + id]; render(); }, 4000); return false; }
        delete armed['m' + id];
        call('DELETE', '/menus/' + id, undefined, 'Menu supprimé').catch(function () {});
        return false;
    };
    window.catalogSaveCategory = function (id) {
        var body = {
            name: document.querySelector('[data-cat-name="' + id + '"]').value.trim(),
            menuId: parseInt(document.querySelector('[data-cat-menu="' + id + '"]').value, 10),
            sortOrder: parseInt(document.querySelector('[data-cat-sort="' + id + '"]').value, 10) || 0
        };
        call('PATCH', '/categories/' + id, body, 'Catégorie enregistrée').catch(function () {});
        return false;
    };
    window.catalogDeleteCategory = function (id) {
        if (!armed['c' + id]) { armed['c' + id] = true; render(); setTimeout(function () { delete armed['c' + id]; render(); }, 4000); return false; }
        delete armed['c' + id];
        call('DELETE', '/categories/' + id, undefined, 'Catégorie supprimée').catch(function () {});
        return false;
    };

    function applyPermission() {
        var nav = $('nav-catalog');
        if (nav) nav.classList.toggle('hidden', !can());
    }
    document.addEventListener('DOMContentLoaded', applyPermission);
    document.addEventListener('soucoffe:permissions', applyPermission);
})();
