// SOUCOFFE - Admin : photos multiples et choix proposés aux clients (migration 024).
//
//  - SCChoices.PhotoManager : jusqu'à 6 photos par produit (importées depuis l'appareil,
//    compressées ici à 900 px en JPEG, ou liens) ; la 1re est la photo principale.
//  - SCChoices.ChoicePicker : cocher / ordonner les groupes de choix d'un produit
//    (Pain, Sauce, Taille…) ; « Nouveau groupe » directement depuis la fiche.
//  - Éditeur de groupe de choix (nom, 1 ou plusieurs choix, obligatoire, maximum,
//    libellés et suppléments en euros) — API /option-groups (permission catalog.manage).
//  - openProductExtras(id) : « Photos et choix » d'un produit existant (PATCH /products/{id}).
//  - renderChoiceGroups(el) : section « Groupes de choix » de la vue Menus et catégories.
// Le serveur reste l'autorité : ses refus (400 / 403 / 409) sont affichés tels quels.
(function () {
    var MAX_PHOTOS = 6;
    var MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
    var MAX_IMAGE_DIMENSION = 900;
    var INPUT = 'w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none';
    var BTN = 'h-9 px-3 rounded-lg font-label-md text-xs inline-flex items-center justify-center gap-1 transition-colors ';
    var BTN_PRIMARY = BTN + 'bg-primary-container text-on-primary hover:bg-primary';
    var BTN_SOFT = BTN + 'bg-surface-container text-on-surface hover:bg-surface-variant';
    var groupsCache = null;

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n) { return window.iconHtml ? window.iconHtml(n) : ''; }
    function toast(m) { if (window.showToast) window.showToast(m); }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }
    function euro(v) { return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function T(s) { return window.scT ? window.scT(s) : s; }
    function icons() { if (window.renderIcons) window.renderIcons(); }

    function loadGroups(force) {
        if (groupsCache && !force) return Promise.resolve(groupsCache);
        return Auth.api('/admin/option-groups').then(function (r) { groupsCache = r.content || []; return groupsCache; });
    }

    function ruleText(g) {
        if (!g.multiple) return g.required ? 'Obligatoire · 1 choix' : 'Facultatif · 1 choix';
        return (g.required ? 'Obligatoire' : 'Facultatif') + ' · ' + (g.max ? 'jusqu’à ' + g.max : 'plusieurs choix');
    }
    function optionsText(g) {
        // Chaque choix traduit séparément (liste affichée avec translate="no").
        return g.options.map(function (o) { return T(o.label) + (o.priceDelta ? ' +' + euro(o.priceDelta) : ''); }).join(' · ');
    }

    // ------------------------------------------------------------------
    // Photos
    // ------------------------------------------------------------------
    function compress(file) {
        return new Promise(function (resolve, reject) {
            if (!file || file.type.indexOf('image/') !== 0) { reject(new Error('Ce fichier n\'est pas une image.')); return; }
            if (file.size > MAX_UPLOAD_BYTES) { reject(new Error('Fichier trop volumineux (max 20 Mo).')); return; }
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('Impossible de lire ce fichier.')); };
            reader.onload = function (e) {
                var img = new Image();
                img.onerror = function () { reject(new Error('Image invalide ou corrompue.')); };
                img.onload = function () {
                    var scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.82));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    var managers = {};
    function PhotoManager(el, urls) {
        this.el = el;
        this.id = 'pm' + Math.random().toString(36).slice(2, 8);
        this.items = (urls || []).filter(Boolean).slice(0, MAX_PHOTOS);
        managers[this.id] = this;
        this.render();
    }
    PhotoManager.prototype.get = function () { return this.items.slice(); };
    PhotoManager.prototype.status = function (msg, isError) {
        var s = $(this.id + '-status');
        if (s) { s.textContent = msg || ''; s.className = 'text-xs mt-1 min-h-[1rem] ' + (isError ? 'text-error' : 'text-on-surface-variant'); }
    };
    PhotoManager.prototype.render = function () {
        var id = this.id, n = this.items.length;
        var tiles = this.items.map(function (src, i) {
            return '<div class="sc-ph-tile' + (i === 0 ? ' is-main' : '') + '">' +
                '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.classList.add(\'is-broken\')"/>' +
                (i === 0 ? '<span class="sc-ph-badge">Principale</span>' : '<button type="button" class="sc-ph-btn sc-ph-main" title="Mettre en photo principale" aria-label="Mettre en photo principale" onclick="return scPhotoMain(\'' + id + '\',' + i + ')">' + ic('star') + '</button>') +
                '<button type="button" class="sc-ph-btn sc-ph-del" title="Retirer" aria-label="Retirer cette photo" onclick="return scPhotoRemove(\'' + id + '\',' + i + ')">' + ic('close') + '</button>' +
                '</div>';
        }).join('');
        var add = n < MAX_PHOTOS
            ? '<label class="sc-ph-tile sc-ph-add">' + ic('add_a_photo') + '<span>Ajouter des photos</span>' +
              '<input type="file" accept="image/*" multiple class="hidden" onchange="scPhotoFiles(\'' + id + '\', this)"/></label>'
            : '';
        this.el.innerHTML =
            '<div class="flex items-center justify-between mb-1"><span class="block font-label-md text-label-md text-on-surface-variant">Photos</span>' +
            '<span class="text-xs text-on-surface-variant">' + n + '/' + MAX_PHOTOS + ' · la 1re est la photo principale</span></div>' +
            '<div class="sc-ph-grid">' + tiles + add + '</div>' +
            '<div class="flex gap-2 mt-2"><input id="' + id + '-url" type="text" placeholder="Ou coller un lien d\'image (https://…)" class="' + INPUT + '"/>' +
            '<button type="button" class="' + BTN_SOFT + ' shrink-0" onclick="return scPhotoUrl(\'' + id + '\')">' + ic('link') + ' Ajouter</button></div>' +
            '<p id="' + id + '-status" class="text-xs text-on-surface-variant mt-1 min-h-[1rem]"></p>';
        icons();
    };
    window.scPhotoRemove = function (id, i) { var m = managers[id]; m.items.splice(i, 1); m.render(); return false; };
    window.scPhotoMain = function (id, i) { var m = managers[id]; var x = m.items.splice(i, 1)[0]; m.items.unshift(x); m.render(); return false; };
    window.scPhotoUrl = function (id) {
        var m = managers[id], v = ($(id + '-url').value || '').trim();
        if (!v) return false;
        if (!/^https?:\/\/\S+$/i.test(v) && !/^\.\.\/images\/[\w\/.-]+\.(jpe?g|png|webp|gif)$/i.test(v)) { m.status('Lien invalide : il doit commencer par https://', true); return false; }
        if (m.items.length >= MAX_PHOTOS) { m.status(MAX_PHOTOS + ' photos maximum.', true); return false; }
        m.items.push(v); m.render(); return false;
    };
    window.scPhotoFiles = function (id, input) {
        var m = managers[id];
        var files = Array.prototype.slice.call(input.files || [], 0, MAX_PHOTOS - m.items.length);
        if (!files.length) return;
        m.status('Traitement de ' + files.length + ' photo(s)…');
        var done = 0, errors = [];
        files.forEach(function (f) {
            compress(f).then(function (data) { m.items.push(data); }).catch(function (e) { errors.push(e.message); }).then(function () {
                done++;
                if (done === files.length) {
                    m.items = m.items.slice(0, MAX_PHOTOS);
                    m.render();
                    m.status(errors.length ? errors[0] : files.length + ' photo(s) prête(s).', !!errors.length);
                }
            });
        });
    };

    // ------------------------------------------------------------------
    // Choix (groupes d'options) d'un produit
    // ------------------------------------------------------------------
    var pickers = {};
    function ChoicePicker(el, selectedIds) {
        this.el = el;
        this.id = 'cp' + Math.random().toString(36).slice(2, 8);
        this.selected = (selectedIds || []).slice();
        this.groups = [];
        pickers[this.id] = this;
        var self = this;
        el.innerHTML = '<p class="text-xs text-on-surface-variant">Chargement des choix…</p>';
        loadGroups(true).then(function (g) { self.groups = g; self.render(); })
            .catch(function (e) { el.innerHTML = '<p class="text-xs text-error">Choix indisponibles : ' + esc(errText(e)) + '</p>'; });
    }
    ChoicePicker.prototype.get = function () { return this.selected.slice(); };
    ChoicePicker.prototype.set = function (ids) { this.selected = (ids || []).slice(); if (this.groups.length) this.render(); };
    ChoicePicker.prototype.render = function () {
        var self = this, id = this.id;
        var byId = {};
        this.groups.forEach(function (g) { byId[g.id] = g; });
        this.selected = this.selected.filter(function (x) { return byId[x]; });
        var ordered = this.selected.map(function (x) { return byId[x]; }).concat(this.groups.filter(function (g) { return self.selected.indexOf(g.id) === -1; }));
        var rows = ordered.map(function (g) {
            var pos = self.selected.indexOf(g.id), on = pos !== -1;
            return '<li class="sc-cp-row' + (on ? ' is-on' : '') + '">' +
                '<label class="sc-cp-main"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="scPickToggle(\'' + id + '\',' + g.id + ')"/>' +
                '<span class="min-w-0"><strong>' + esc(g.name) + '</strong> <em>' + esc(ruleText(g)) + '</em>' +
                '<small translate="no">' + esc(optionsText(g)) + '</small></span></label>' +
                (on ? '<span class="sc-cp-order"><button type="button" aria-label="Monter" onclick="return scPickMove(\'' + id + '\',' + g.id + ',-1)"' + (pos === 0 ? ' disabled' : '') + '>' + ic('arrow_upward') + '</button>' +
                    '<button type="button" aria-label="Descendre" onclick="return scPickMove(\'' + id + '\',' + g.id + ',1)"' + (pos === self.selected.length - 1 ? ' disabled' : '') + '>' + ic('arrow_downward') + '</button></span>' : '') +
                '<button type="button" class="sc-cp-edit" aria-label="Modifier le groupe ' + esc(g.name) + '" title="Modifier le groupe" onclick="return scPickEdit(\'' + id + '\',' + g.id + ')">' + ic('edit') + '</button>' +
                '</li>';
        }).join('');
        this.el.innerHTML =
            '<div class="flex items-center justify-between mb-1 gap-2"><span class="block font-label-md text-label-md text-on-surface-variant">Choix proposés au client</span>' +
            '<button type="button" class="' + BTN_SOFT + '" onclick="return scPickNew(\'' + id + '\')">' + ic('add') + ' Nouveau groupe</button></div>' +
            '<p class="text-xs text-on-surface-variant mb-2">' + (this.selected.length ? this.selected.length + ' groupe(s) coché(s), dans l\'ordre affiché au client.' : 'Aucun choix : le produit s\'ajoute directement au panier.') + '</p>' +
            '<ul class="sc-cp-list">' + rows + '</ul>';
        icons();
    };
    window.scPickToggle = function (id, gid) {
        var p = pickers[id], i = p.selected.indexOf(gid);
        if (i === -1) p.selected.push(gid); else p.selected.splice(i, 1);
        p.render();
    };
    window.scPickMove = function (id, gid, d) {
        var p = pickers[id], i = p.selected.indexOf(gid), j = i + d;
        if (i < 0 || j < 0 || j >= p.selected.length) return false;
        p.selected[i] = p.selected[j]; p.selected[j] = gid;
        p.render();
        return false;
    };
    window.scPickNew = function (id) {
        openGroupEditor(null, function (g) {
            var p = pickers[id];
            loadGroups(true).then(function (list) { p.groups = list; p.selected.push(g.id); p.render(); });
        });
        return false;
    };
    window.scPickEdit = function (id, gid) {
        var p = pickers[id];
        var g = p.groups.filter(function (x) { return x.id === gid; })[0];
        openGroupEditor(g, function () { loadGroups(true).then(function (list) { p.groups = list; p.render(); }); });
        return false;
    };

    // ------------------------------------------------------------------
    // Éditeur de groupe de choix
    // ------------------------------------------------------------------
    var editing = null, onSavedCb = null;
    function overlay(id, z) {
        var m = $(id);
        if (!m) {
            m = document.createElement('div');
            m.id = id;
            m.className = 'hidden fixed inset-0 ' + z + ' items-end md:items-center justify-center p-0 md:p-4 bg-black/50';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-modal', 'true');
            m.addEventListener('click', function (e) { if (e.target === m) hide(id); });
            document.body.appendChild(m);
        }
        return m;
    }
    function show(m) { m.classList.remove('hidden'); m.classList.add('flex'); document.body.style.overflow = 'hidden'; icons(); }
    function hide(id) {
        var m = $(id);
        if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
        if (!document.querySelector('[role="dialog"].flex')) document.body.style.overflow = '';
        return false;
    }
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if ($('sc-group-editor') && $('sc-group-editor').classList.contains('flex')) hide('sc-group-editor');
        else if ($('sc-product-extras') && $('sc-product-extras').classList.contains('flex')) hide('sc-product-extras');
    });

    function optionRow(o) {
        return '<div class="sc-ge-opt" data-opt-id="' + (o.id || '') + '">' +
            '<input data-opt-label maxlength="80" value="' + esc(o.label || '') + '" placeholder="Ex. Pain complet" aria-label="Libellé du choix" class="' + INPUT + '"/>' +
            '<label class="sc-ge-price"><span>+</span><input data-opt-price type="number" min="0" max="100" step="0.01" inputmode="decimal" value="' + (o.priceDelta ? Number(o.priceDelta).toFixed(2) : '0') + '" aria-label="Supplément en euros" class="' + INPUT + '"/><span>€</span></label>' +
            '<button type="button" class="sc-ge-del" aria-label="Retirer ce choix"' + (o.ordered ? ' disabled title="Déjà commandé : conservé pour l\'historique"' : '') + ' onclick="this.parentNode.remove()">' + ic('delete') + '</button>' +
            '</div>';
    }

    function openGroupEditor(group, onSaved) {
        editing = group || null;
        onSavedCb = onSaved || null;
        var g = group || { name: '', multiple: false, required: true, max: null, options: [{ label: '', priceDelta: 0 }, { label: '', priceDelta: 0 }] };
        var m = overlay('sc-group-editor', 'z-[80]');
        m.setAttribute('aria-labelledby', 'sc-ge-title');
        m.innerHTML = '<div class="bg-surface-container-lowest w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-5 shadow-xl max-h-[92vh] overflow-y-auto">' +
            '<div class="flex items-start justify-between gap-3 mb-3"><div><h3 id="sc-ge-title" class="font-title-lg text-title-lg text-primary">' + (group ? 'Modifier le groupe de choix' : 'Nouveau groupe de choix') + '</h3>' +
            '<p class="text-xs text-on-surface-variant">Ex. « Pain » : Pain turc, Piadina, Pain complet (+0,50 €).</p></div>' +
            '<button type="button" onclick="return scGroupClose()" aria-label="Fermer" class="w-9 h-9 rounded-lg inline-flex items-center justify-center text-on-surface-variant hover:bg-surface-variant">' + ic('close') + '</button></div>' +
            '<label class="block mb-3"><span class="block font-label-md text-label-md text-on-surface-variant mb-1">Nom du groupe *</span><input id="sc-ge-name" maxlength="60" value="' + esc(g.name) + '" class="' + INPUT + '" placeholder="Ex. Pain, Sauce, Cuisson"/></label>' +
            '<div class="sc-ge-type mb-3" role="radiogroup" aria-label="Type de choix">' +
            '<label><input type="radio" name="sc-ge-type" value="single"' + (!g.multiple ? ' checked' : '') + ' onchange="scGroupType()"/><span><strong>Un seul choix</strong><small>Ex. le pain</small></span></label>' +
            '<label><input type="radio" name="sc-ge-type" value="multiple"' + (g.multiple ? ' checked' : '') + ' onchange="scGroupType()"/><span><strong>Plusieurs choix</strong><small>Ex. les sauces</small></span></label></div>' +
            '<div class="flex flex-wrap items-center gap-4 mb-3">' +
            '<label class="inline-flex items-center gap-2 text-sm text-on-surface"><input id="sc-ge-required" type="checkbox"' + (g.required ? ' checked' : '') + '/> Obligatoire</label>' +
            '<label id="sc-ge-max-wrap" class="inline-flex items-center gap-2 text-sm text-on-surface' + (g.multiple ? '' : ' hidden') + '">Maximum <input id="sc-ge-max" type="number" min="1" max="20" value="' + (g.max || '') + '" placeholder="∞" class="' + INPUT + ' !w-20"/></label></div>' +
            '<span class="block font-label-md text-label-md text-on-surface-variant mb-1">Choix (supplément 0 = inclus)</span>' +
            '<div id="sc-ge-options" class="space-y-2 mb-2">' + g.options.map(optionRow).join('') + '</div>' +
            '<button type="button" class="' + BTN_SOFT + ' mb-4" onclick="return scGroupAddOption()">' + ic('add') + ' Ajouter un choix</button>' +
            (group && group.products && group.products.length ? '<p class="text-xs text-on-surface-variant mb-3">Utilisé par : ' + esc(group.products.join(', ')) + '</p>' : '') +
            '<p id="sc-ge-error" class="hidden text-sm text-error mb-3"></p>' +
            '<div class="flex flex-wrap gap-2">' +
            '<button type="button" id="sc-ge-save" class="' + BTN_PRIMARY + ' flex-1 !h-11" onclick="return scGroupSave()">' + ic('check') + ' Enregistrer</button>' +
            (group ? '<button type="button" id="sc-ge-delete" class="' + BTN + 'text-error hover:bg-error-container !h-11" onclick="return scGroupDelete()">' + ic('delete') + ' Supprimer</button>' : '') +
            '<button type="button" class="' + BTN_SOFT + ' !h-11" onclick="return scGroupClose()">Annuler</button></div></div>';
        show(m);
        $('sc-ge-name').focus();
    }
    window.scGroupClose = function () { return hide('sc-group-editor'); };
    window.scGroupType = function () {
        var multi = document.querySelector('input[name="sc-ge-type"]:checked').value === 'multiple';
        $('sc-ge-max-wrap').classList.toggle('hidden', !multi);
    };
    window.scGroupAddOption = function () {
        var box = $('sc-ge-options');
        box.insertAdjacentHTML('beforeend', optionRow({ label: '', priceDelta: 0 }));
        icons();
        var inputs = box.querySelectorAll('[data-opt-label]');
        inputs[inputs.length - 1].focus();
        return false;
    };
    function geError(msg) { var e = $('sc-ge-error'); e.textContent = msg; e.classList.remove('hidden'); }
    window.scGroupSave = function () {
        $('sc-ge-error').classList.add('hidden');
        var name = $('sc-ge-name').value.trim();
        if (!name) { geError('Indiquez le nom du groupe.'); return false; }
        var multiple = document.querySelector('input[name="sc-ge-type"]:checked').value === 'multiple';
        var max = parseInt($('sc-ge-max').value, 10);
        var options = [];
        var bad = false;
        Array.prototype.forEach.call(document.querySelectorAll('#sc-ge-options .sc-ge-opt'), function (row) {
            var label = row.querySelector('[data-opt-label]').value.trim();
            var price = parseFloat(String(row.querySelector('[data-opt-price]').value || '0').replace(',', '.'));
            if (!label) return;
            if (isNaN(price) || price < 0 || price > 100) bad = true;
            var o = { label: label, priceDelta: Math.round((price || 0) * 100) / 100 };
            var oid = parseInt(row.getAttribute('data-opt-id'), 10);
            if (oid) o.id = oid;
            options.push(o);
        });
        if (bad) { geError('Supplément invalide : entre 0 et 100 €.'); return false; }
        if (!options.length) { geError('Ajoutez au moins un choix.'); return false; }
        var body = { name: name, multiple: multiple, required: $('sc-ge-required').checked, max: multiple && max > 0 ? max : null, options: options };
        var btn = $('sc-ge-save');
        btn.disabled = true;
        Auth.api(editing ? '/option-groups/' + editing.id : '/option-groups', Auth.json(editing ? 'PATCH' : 'POST', body)).then(function (g) {
            hide('sc-group-editor');
            toast(editing ? 'Groupe de choix enregistré' : 'Groupe de choix créé : ' + g.name);
            groupsCache = null;
            if (window.loadCatalog) window.loadCatalog(true);
            if (onSavedCb) onSavedCb(g);
        }).catch(function (e) { geError('Non enregistré : ' + errText(e)); }).then(function () { btn.disabled = false; });
        return false;
    };
    window.scGroupDelete = function () {
        var btn = $('sc-ge-delete');
        if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.lastChild.textContent = ' Confirmer ?'; return false; }
        Auth.api('/option-groups/' + editing.id, Auth.json('DELETE')).then(function () {
            hide('sc-group-editor');
            toast('Groupe de choix supprimé');
            groupsCache = null;
            if (onSavedCb) onSavedCb(null);
        }).catch(function (e) { geError(errText(e)); });
        return false;
    };

    // ------------------------------------------------------------------
    // « Photos et choix » d'un produit existant
    // ------------------------------------------------------------------
    var extras = { id: null, photos: null, picker: null };
    window.openProductExtras = function (apiId) {
        if (typeof apiId !== 'number') { toast('Produit non enregistré en base'); return false; }
        var m = overlay('sc-product-extras', 'z-[70]');
        m.setAttribute('aria-labelledby', 'sc-px-title');
        Auth.api('/products/' + apiId).then(function (p) {
            extras.id = apiId;
            m.innerHTML = '<div class="bg-surface-container-lowest w-full md:max-w-xl rounded-t-2xl md:rounded-2xl p-5 shadow-xl max-h-[92vh] overflow-y-auto">' +
                '<div class="flex items-start justify-between gap-3 mb-3"><div><h3 id="sc-px-title" class="font-title-lg text-title-lg text-primary">' + esc(p.name) + '</h3>' +
                '<p class="text-xs text-on-surface-variant">Photos et choix : visibles aussitôt sur tous les téléphones.</p></div>' +
                '<button type="button" onclick="return scExtrasClose()" aria-label="Fermer" class="w-9 h-9 rounded-lg inline-flex items-center justify-center text-on-surface-variant hover:bg-surface-variant">' + ic('close') + '</button></div>' +
                '<div id="sc-px-photos" class="mb-4"></div><div id="sc-px-choices" class="mb-4"></div>' +
                '<p id="sc-px-error" class="hidden text-sm text-error mb-3"></p>' +
                '<div class="flex gap-2"><button type="button" id="sc-px-save" class="' + BTN_PRIMARY + ' flex-1 !h-11" onclick="return scExtrasSave()">' + ic('check') + ' Enregistrer</button>' +
                '<button type="button" class="' + BTN_SOFT + ' !h-11" onclick="return scExtrasClose()">Annuler</button></div></div>';
            extras.photos = new PhotoManager($('sc-px-photos'), [p.imageUrl].concat(p.images || []).filter(Boolean));
            extras.picker = Auth.can('catalog.manage') ? new ChoicePicker($('sc-px-choices'), (p.optionGroups || []).map(function (g) { return g.id; })) : null;
            if (!extras.picker) $('sc-px-choices').innerHTML = '';
            show(m);
        }).catch(function (e) { toast('Produit indisponible : ' + errText(e)); });
        return false;
    };
    window.scExtrasClose = function () { return hide('sc-product-extras'); };
    window.scExtrasSave = function () {
        var body = { images: extras.photos.get() };
        if (extras.picker) body.optionGroupIds = extras.picker.get();
        var btn = $('sc-px-save');
        btn.disabled = true;
        Auth.api('/products/' + extras.id, Auth.json('PATCH', body)).then(function (p) {
            // Photo enregistrée en base : l'ancien réglage local (navigateur) n'a plus lieu d'être.
            if (window.ProductOverrides && p.slug) window.ProductOverrides.set(p.slug, { img: '' });
            return window.loadCatalog(true).then(function () { return p; });
        }).then(function (p) {
            hide('sc-product-extras');
            toast('Enregistré : ' + p.name);
            if (window.showAdminView) window.showAdminView('products');
        }).catch(function (e) {
            var el = $('sc-px-error');
            el.textContent = 'Non enregistré : ' + errText(e);
            el.classList.remove('hidden');
        }).then(function () { btn.disabled = false; });
        return false;
    };

    // ------------------------------------------------------------------
    // Section « Groupes de choix » (vue Menus et catégories)
    // ------------------------------------------------------------------
    window.renderChoiceGroups = function (el) {
        if (!el) return;
        loadGroups(true).then(function (list) {
            el.innerHTML = '<div class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)]">' +
                '<div class="flex flex-wrap items-center justify-between gap-2 mb-2"><div>' +
                '<div class="font-label-md text-sm text-primary inline-flex items-center gap-1">' + ic('tune') + ' Groupes de choix</div>' +
                '<p class="text-xs text-on-surface-variant">Pain, sauces, cuisson… Cochez-les ensuite sur chaque produit (Produits > Photos et choix).</p></div>' +
                '<button type="button" class="' + BTN_PRIMARY + '" onclick="return scGroupNewFromCatalog()">' + ic('add') + ' Nouveau groupe</button></div>' +
                '<ul class="sc-cg-list">' + list.map(function (g) {
                    return '<li><button type="button" onclick="return scGroupEditFromCatalog(' + g.id + ')" class="sc-cg-item">' +
                        '<span class="min-w-0"><strong>' + esc(g.name) + '</strong> <em>' + esc(ruleText(g)) + '</em><small translate="no">' + esc(optionsText(g)) + '</small></span>' +
                        '<span class="sc-cg-count">' + g.products.length + ' produit(s)</span></button></li>';
                }).join('') + '</ul></div>';
            icons();
        }).catch(function (e) { el.innerHTML = '<p class="text-sm text-error">Groupes de choix indisponibles : ' + esc(errText(e)) + '</p>'; });
    };
    function refreshSection() { groupsCache = null; window.renderChoiceGroups($('catalog-choice-groups')); }
    window.scGroupNewFromCatalog = function () { openGroupEditor(null, refreshSection); return false; };
    window.scGroupEditFromCatalog = function (id) {
        var g = (groupsCache || []).filter(function (x) { return x.id === id; })[0];
        if (g) openGroupEditor(g, refreshSection);
        return false;
    };

    window.SCChoices = { PhotoManager: PhotoManager, ChoicePicker: ChoicePicker, loadGroups: loadGroups, openGroupEditor: openGroupEditor };
})();
