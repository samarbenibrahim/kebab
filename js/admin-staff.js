// SOUCOFFE - Admin : comptes du personnel, demandes de changement de table.
//
//  - Vue « Serveurs » : ajouter / modifier / supprimer un serveur (identifiant,
//    nom, mot de passe, compte actif) et voir ou fixer les tables qu'il sert.
//  - Panneau « Demandes de changement de table » : un client prévient l'admin,
//    l'admin répond par une table disponible (ou refuse) ; le client applique
//    ensuite cette table depuis son profil.
//  - Déconnexion de l'admin.
// Tout passe par l'API (rôle admin exigé côté serveur) ; ici, présentation seule.
(function () {
    var POLL_MS = 5000;

    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name, cls, filled) { return window.iconHtml ? window.iconHtml(name, cls, filled) : ''; }
    function toast(m) { if (window.showToast) window.showToast(m); }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }

    window.adminLogout = function () { Auth.logoutStaff(); return false; };

    // ------------------------------------------------------------------
    // Vue « Employés » : admin, manager, serveur, caissier, cuisine
    // ------------------------------------------------------------------
    var staffList = [];
    var deleteArmed = {}; // id -> true pendant 4 s après le 1er clic sur « Supprimer »
    var ROLE_ICON = { admin: 'admin_panel_settings', manager: 'manage_accounts', server: 'badge', cashier: 'payments', kitchen: 'restaurant' };
    var ROLE_LABEL = { admin: 'Administrateur', manager: 'Manager', server: 'Serveur', cashier: 'Caissier', kitchen: 'Cuisine' };

    function me() { var s = Auth.staff(); return s ? s.user : null; }

    // Règles miroir de l'API : l'admin gère tout (sauf supprimer un admin) ; le manager
    // gère serveurs, caissiers et cuisine, et modifie son propre compte.
    function canEdit(s) {
        var u = me();
        if (!u) return false;
        if (u.role === 'admin') return true;
        return s.id === u.id || ['server', 'cashier', 'kitchen'].indexOf(s.role) !== -1;
    }
    function canDelete(s) {
        var u = me();
        if (!u || s.role === 'admin' || s.id === u.id) return false;
        return u.role === 'admin' || ['server', 'cashier', 'kitchen'].indexOf(s.role) !== -1;
    }
    function creatableRoles() {
        var u = me();
        return u && u.role === 'admin' ? ['manager', 'server', 'cashier', 'kitchen'] : ['server', 'cashier', 'kitchen'];
    }

    function parseTables(text) {
        var seen = {}, out = [];
        String(text || '').split(/[,;\s]+/).forEach(function (t) {
            t = t.trim();
            if (t && !seen[t]) { seen[t] = true; out.push(t); }
        });
        return out;
    }

    function badge(text, cls) {
        return '<span class="text-xs px-2 py-0.5 rounded-full ' + cls + '">' + esc(text) + '</span>';
    }

    function staffCard(s) {
        var badges = badge(s.roleLabel || ROLE_LABEL[s.role] || s.role, s.role === 'admin' ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant');
        if (!s.active) badges += ' ' + badge('Désactivé', 'bg-error-container text-on-error-container');
        else if (s.sessions > 0) badges += ' ' + badge('Connecté', 'bg-secondary-container text-on-secondary-container');

        var tablesHtml;
        if (s.role !== 'server') tablesHtml = '<span class="text-on-surface-variant">—</span>';
        else if (s.tables.length) tablesHtml = s.tables.map(function (t) {
            return '<span class="inline-block px-2 py-0.5 rounded-full bg-surface-container text-on-surface text-xs font-label-md">' + esc(t) + '</span>';
        }).join(' ');
        else tablesHtml = '<span class="text-error text-xs">' + ic('warning') + ' Aucune table déclarée</span>';

        var actions = '';
        if (canEdit(s)) {
            actions += '<button onclick="return openStaffModal(' + s.id + ')" class="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-xs hover:bg-surface-variant">' + ic('edit') + ' Modifier</button>';
        }
        if (canDelete(s)) {
            var armed = !!deleteArmed[s.id];
            actions += '<button onclick="return deleteStaffAccount(' + s.id + ')" class="inline-flex items-center gap-1 px-3 py-2 rounded-lg font-label-md text-xs ' +
                (armed ? 'bg-error text-on-error' : 'bg-error-container text-on-error-container hover:opacity-90') + '">' +
                ic('delete') + (armed ? ' Confirmer ?' : ' Supprimer') + '</button>';
        }

        return '<div class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] flex flex-col md:flex-row md:items-center gap-3">' +
            '<div class="flex items-center gap-3 min-w-0 flex-1">' +
            '<span class="w-11 h-11 rounded-full bg-secondary-container text-primary flex items-center justify-center text-[26px] shrink-0">' + ic(ROLE_ICON[s.role] || 'badge') + '</span>' +
            '<div class="min-w-0"><div class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="font-title-lg text-title-lg text-on-surface">' + esc(s.displayName) + '</span>' + badges + '</div>' +
            '<div class="font-label-md text-xs text-on-surface-variant">@' + esc(s.username) + '</div></div></div>' +
            '<div class="md:w-64 text-sm"><div class="font-label-md text-xs text-on-surface-variant mb-1">Tables servies</div>' + tablesHtml + '</div>' +
            '<div class="flex gap-2 shrink-0">' + actions + '</div></div>';
    }

    function paintServers() {
        var host = document.getElementById('servers-list');
        if (!host) return;
        if (!staffList.length) { host.innerHTML = '<p class="sc-admin-empty text-on-surface-variant">Aucun compte.</p>'; return; }
        var html = staffList.map(staffCard).join('');
        if (host.__html === html) return;
        host.__html = html;
        host.innerHTML = html;
        if (window.renderIcons) window.renderIcons();
    }

    window.renderServersView = function () {
        var host = document.getElementById('servers-list');
        if (!host) return;
        Auth.api('/staff').then(function (r) {
            staffList = r.content || [];
            paintServers();
        }).catch(function (err) {
            host.innerHTML = '<p class="text-error">Impossible de charger les comptes : ' + esc(errText(err)) + '</p>';
        });
    };

    window.deleteStaffAccount = function (id) {
        if (!deleteArmed[id]) {
            deleteArmed[id] = true;
            paintServers();
            setTimeout(function () { delete deleteArmed[id]; paintServers(); }, 4000);
            return false;
        }
        delete deleteArmed[id];
        Auth.api('/staff/' + id, Auth.json('DELETE')).then(function () {
            toast('Compte supprimé');
            window.renderServersView();
        }).catch(function (err) { toast('Suppression impossible : ' + errText(err)); window.renderServersView(); });
        return false;
    };

    // ---- Fenêtre ajout / modification ----
    var modal = null;
    var editingId = null;

    function field(id, label, html) {
        return '<div><label class="block font-label-md text-xs text-on-surface-variant mb-1" for="' + id + '">' + label + '</label>' + html + '</div>';
    }
    var INPUT = 'w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none';

    function buildModal() {
        modal = document.createElement('div');
        modal.id = 'admin-staff-modal';
        modal.className = 'hidden fixed inset-0 z-[60] items-end md:items-center justify-center p-0 md:p-4 bg-black/40';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML =
            '<div class="bg-surface-container-lowest w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-5 shadow-xl max-h-[92vh] overflow-y-auto">' +
            '<div class="flex items-start justify-between mb-4"><h3 id="staff-modal-title" class="font-title-lg text-title-lg text-primary">Employé</h3>' +
            '<button type="button" onclick="return closeStaffModal()" aria-label="Fermer" class="text-on-surface-variant hover:text-primary"><span class="material-symbols-outlined">close</span></button></div>' +
            '<form id="staff-form" class="space-y-3" autocomplete="off" novalidate>' +
            '<div id="staff-role-wrap">' + field('staff-role', 'Rôle *', '<select id="staff-role" onchange="staffRoleChanged()" class="' + INPUT + '"></select>') +
            '<p id="staff-role-hint" class="text-xs text-on-surface-variant mt-1"></p></div>' +
            field('staff-display', 'Nom affiché *', '<input id="staff-display" type="text" maxlength="100" class="' + INPUT + '" placeholder="Ex : Karim B."/>') +
            field('staff-username', 'Identifiant de connexion *', '<input id="staff-username" type="text" maxlength="30" autocapitalize="none" spellcheck="false" class="' + INPUT + '" placeholder="ex : karim (minuscules, chiffres, . _ -)"/>') +
            field('staff-password', '<span id="staff-password-label">Mot de passe *</span>', '<input id="staff-password" type="password" maxlength="72" autocomplete="new-password" class="' + INPUT + '" placeholder="8 caractères minimum"/>') +
            '<div id="staff-tables-wrap">' + field('staff-tables', 'Tables servies (séparées par des virgules)', '<input id="staff-tables" type="text" class="' + INPUT + '" placeholder="Ex : 1, 2, 3"/>') +
            '<p class="text-xs text-on-surface-variant mt-1">Le serveur peut aussi les renseigner lui-même à sa connexion. Une table n\'a qu\'un seul serveur.</p></div>' +
            '<label id="staff-active-wrap" class="flex items-center gap-2 text-sm text-on-surface"><input id="staff-active" type="checkbox" class="accent-primary w-4 h-4"/> Compte actif (décoché : connexion impossible)</label>' +
            '<p id="staff-error" role="alert" class="hidden text-error text-sm"></p>' +
            '<div class="flex gap-2 pt-2"><button type="button" onclick="return closeStaffModal()" class="flex-1 py-3 rounded-lg border-[1.5px] border-outline-variant text-on-surface font-label-md text-label-md hover:bg-surface-container">Annuler</button>' +
            '<button type="submit" id="staff-save" class="flex-1 py-3 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary disabled:opacity-60">Enregistrer</button></div>' +
            '</form></div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) { if (e.target === modal) window.closeStaffModal(); });
        document.getElementById('staff-form').addEventListener('submit', function (e) { e.preventDefault(); saveStaff(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') window.closeStaffModal(); });
    }

    var ROLE_HINT = {
        manager: 'Statistiques, historique, produits et prix, promotions, fidélité, tables, employés (sauf admin et managers).',
        server: 'Voit et sert SES tables, acquitte les appels, demande l\'addition. Ne prépare ni n\'encaisse.',
        cashier: 'Encaisse (espèces, carte), libère les tables. Ne prépare ni ne modifie les produits.',
        kitchen: 'Prépare les commandes et déclare les ruptures de stock. Ne modifie aucun prix.'
    };

    window.staffRoleChanged = function () {
        var role = document.getElementById('staff-role').value;
        document.getElementById('staff-tables-wrap').classList.toggle('hidden', role !== 'server');
        document.getElementById('staff-role-hint').textContent = ROLE_HINT[role] || '';
    };

    function showStaffError(msg) {
        var el = document.getElementById('staff-error');
        el.textContent = msg || '';
        el.classList.toggle('hidden', !msg);
    }

    window.openStaffModal = function (id) {
        if (!modal) buildModal();
        editingId = id || null;
        var s = null;
        for (var i = 0; i < staffList.length; i++) if (staffList[i].id === id) s = staffList[i];
        var isAdmin = !!s && s.role === 'admin';
        var isSelf = !!s && me() && s.id === me().id;
        document.getElementById('staff-modal-title').textContent = s ? 'Modifier ' + s.displayName : 'Ajouter un employé';
        document.getElementById('staff-display').value = s ? s.displayName : '';
        var user = document.getElementById('staff-username');
        user.value = s ? s.username : '';
        user.disabled = !!s;
        var pw = document.getElementById('staff-password');
        pw.value = '';
        document.getElementById('staff-password-label').textContent = s ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *';
        // Rôle : choisi à la création ; modifiable ensuite (sauf admin et soi-même).
        var roleSel = document.getElementById('staff-role');
        var roles = creatableRoles();
        roleSel.innerHTML = roles.map(function (r) { return '<option value="' + r + '">' + ROLE_LABEL[r] + '</option>'; }).join('');
        if (s && roles.indexOf(s.role) !== -1) roleSel.value = s.role;
        document.getElementById('staff-role-wrap').classList.toggle('hidden', isAdmin || isSelf);
        window.staffRoleChanged();
        document.getElementById('staff-tables').value = s ? s.tables.join(', ') : '';
        if (isAdmin || isSelf) document.getElementById('staff-tables-wrap').classList.add('hidden');
        document.getElementById('staff-active').checked = s ? s.active : true;
        document.getElementById('staff-active-wrap').classList.toggle('hidden', !s || isAdmin || isSelf);
        document.getElementById('staff-save').disabled = false;
        showStaffError('');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (window.renderIcons) window.renderIcons();
        document.getElementById(s ? 'staff-display' : 'staff-username').focus();
        return false;
    };

    window.closeStaffModal = function () {
        if (!modal) return false;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        return false;
    };

    function saveStaff() {
        var display = document.getElementById('staff-display').value.trim();
        var username = document.getElementById('staff-username').value.trim().toLowerCase();
        var password = document.getElementById('staff-password').value;
        var role = document.getElementById('staff-role').value;
        var tables = parseTables(document.getElementById('staff-tables').value);
        var btn = document.getElementById('staff-save');
        var creating = editingId === null;
        var target = null;
        for (var i = 0; i < staffList.length; i++) if (staffList[i].id === editingId) target = staffList[i];
        var isAdmin = !!target && target.role === 'admin';
        var isSelf = !!target && me() && target.id === me().id;
        var roleEditable = creating || !(isAdmin || isSelf);
        var finalRole = roleEditable ? role : (target ? target.role : role);

        if (!display) return showStaffError('Indiquez le nom affiché.');
        if (creating && !username) return showStaffError('Indiquez l\'identifiant de connexion.');
        if (creating && password.length < 8) return showStaffError('Le mot de passe doit faire au moins 8 caractères.');
        if (!creating && password && password.length < 8) return showStaffError('Le nouveau mot de passe doit faire au moins 8 caractères.');
        showStaffError('');
        btn.disabled = true;

        var request;
        if (creating) {
            request = Auth.api('/staff', Auth.json('POST', { username: username, displayName: display, password: password, role: role }));
        } else {
            var patch = { displayName: display };
            if (password) patch.password = password;
            if (!isAdmin && !isSelf) {
                patch.active = document.getElementById('staff-active').checked;
                if (role !== target.role) patch.role = role;
            }
            request = Auth.api('/staff/' + editingId, Auth.json('PATCH', patch));
        }
        request.then(function (saved) {
            var id = creating ? saved.id : editingId;
            if (finalRole !== 'server') return null;
            // Les tables : remplacées seulement si la liste a changé (ou à la création si renseignée).
            var before = target && target.role === 'server' ? target.tables.join('|') : '';
            if ((creating && tables.length === 0) || (!creating && tables.join('|') === before)) return null;
            return Auth.api('/staff/' + id + '/tables', Auth.json('PUT', { tables: tables })).catch(function (err) {
                err.message = 'Compte enregistré, mais tables non modifiées : ' + err.message;
                throw err;
            });
        }).then(function () {
            window.closeStaffModal();
            toast(creating ? 'Employé ajouté' : 'Modifications enregistrées');
            window.renderServersView();
        }).catch(function (err) {
            btn.disabled = false;
            showStaffError(errText(err));
            window.renderServersView();
        });
    }

    // ------------------------------------------------------------------
    // Demandes de changement de table (panneau flottant)
    // ------------------------------------------------------------------
    var requests = [];
    var occupied = {};
    var requestsSig = null;
    var firstRequestsPass = true;

    function stack() {
        if (window.adminNotifyStack) return window.adminNotifyStack();
        var s = document.getElementById('admin-notify');
        if (!s) {
            s = document.createElement('div');
            s.id = 'admin-notify';
            s.className = 'fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] flex flex-col gap-3';
            document.body.appendChild(s);
        }
        return s;
    }

    function hintFor(table) {
        table = String(table || '').trim();
        if (!table) return '';
        var o = occupied[table];
        if (!o) return '<span class="text-on-surface-variant">Table ' + esc(table) + ' : aucune occupation connue (libre).</span>';
        var parts = [];
        if (o.clients) parts.push(o.clients + ' client(s)');
        if (o.orders) parts.push(o.orders + ' commande(s) en cours');
        return '<span class="text-error">' + ic('warning') + ' Table ' + esc(table) + ' occupée (' + esc(parts.join(', ')) + ')' +
            (o.server ? ' — serveur : ' + esc(o.server) : '') + '.</span>';
    }

    function updateHints() {
        document.querySelectorAll('#table-requests-panel [data-req]').forEach(function (card) {
            var input = card.querySelector('[data-table-input]');
            var hint = card.querySelector('[data-hint]');
            if (input && hint) hint.innerHTML = hintFor(input.value);
        });
    }

    function renderRequests() {
        var panel = document.getElementById('table-requests-panel');
        if (!requests.length) { if (panel) panel.remove(); requestsSig = ''; return; }
        var sig = requests.map(function (r) { return r.id; }).join(',');
        if (panel && sig === requestsSig) { updateHints(); return; } // ne pas écraser une saisie en cours
        requestsSig = sig;
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'table-requests-panel';
            panel.className = 'bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant p-3 max-h-[70vh] overflow-y-auto';
            stack().insertBefore(panel, stack().firstChild);
        }
        panel.innerHTML = '<div class="font-label-md text-label-md text-primary mb-2">' + ic('swap_horiz') + ' Changements de table (' + requests.length + ')</div>' +
            '<div class="flex flex-col gap-3">' + requests.map(function (r) {
                return '<div data-req="' + r.id + '" class="bg-secondary-container rounded-lg p-3 space-y-2">' +
                    '<div class="text-sm text-on-secondary-container"><span class="font-label-md">' + esc(r.clientName) + '</span> · ' + esc(r.partySize) + ' pers.<br>' +
                    'Table actuelle : <b>' + esc(r.currentTable) + '</b>' + (r.requestedTable ? ' → souhaitée : <b>' + esc(r.requestedTable) + '</b>' : '') + '</div>' +
                    (r.reason ? '<div class="text-xs text-on-secondary-container italic">« ' + esc(r.reason) + ' »</div>' : '') +
                    '<input data-table-input oninput="updateTableRequestHint(' + r.id + ')" type="text" maxlength="20" value="' + esc(r.requestedTable || '') + '" placeholder="Table disponible à attribuer" ' +
                    'class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none"/>' +
                    '<div data-hint class="text-xs">' + hintFor(r.requestedTable) + '</div>' +
                    '<input data-msg-input type="text" maxlength="255" placeholder="Message au client (facultatif)" ' +
                    'class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none"/>' +
                    '<p data-err role="alert" class="hidden text-error text-xs"></p>' +
                    '<div class="flex gap-2">' +
                    '<button onclick="respondTableRequest(' + r.id + ', \'approve\')" class="flex-1 bg-primary text-on-primary font-label-md text-xs py-2 rounded-lg hover:opacity-90">' + ic('check') + ' Accepter</button>' +
                    '<button onclick="respondTableRequest(' + r.id + ', \'reject\')" class="flex-1 bg-error-container text-on-error-container font-label-md text-xs py-2 rounded-lg hover:opacity-90">' + ic('close') + ' Refuser</button>' +
                    '</div></div>';
            }).join('') + '</div>';
    }

    window.updateTableRequestHint = function (id) {
        var card = document.querySelector('#table-requests-panel [data-req="' + id + '"]');
        if (!card) return;
        card.querySelector('[data-hint]').innerHTML = hintFor(card.querySelector('[data-table-input]').value);
    };

    window.respondTableRequest = function (id, decision) {
        var card = document.querySelector('#table-requests-panel [data-req="' + id + '"]');
        if (!card) return;
        var err = card.querySelector('[data-err]');
        var table = card.querySelector('[data-table-input]').value.trim();
        var message = card.querySelector('[data-msg-input]').value.trim();
        err.classList.add('hidden');
        if (decision === 'approve' && !table) {
            err.textContent = 'Indiquez la table disponible à attribuer.';
            err.classList.remove('hidden');
            return;
        }
        var body = { decision: decision };
        if (decision === 'approve') body.tableNumber = table;
        if (message) body.message = message;
        card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        Auth.api('/table-change-requests/' + id + '/respond', Auth.json('PATCH', body)).then(function () {
            toast(decision === 'approve' ? 'Table ' + table + ' attribuée' : 'Demande refusée');
            requestsSig = null;
            syncRequests();
        }).catch(function (e) {
            err.textContent = errText(e);
            err.classList.remove('hidden');
            card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
            if (e.status === 409) { requestsSig = null; syncRequests(); }
        });
    };

    function syncRequests() {
        Promise.all([Auth.api('/table-change-requests?status=pending'), Auth.api('/tables/occupied')]).then(function (res) {
            requests = res[0].content || [];
            occupied = {};
            (res[1].content || []).forEach(function (o) { occupied[o.table_number] = o; });
            var freshIds = requests.map(function (r) { return r.id; });
            if (!firstRequestsPass && requestsSig !== null && freshIds.join(',') !== requestsSig && freshIds.length && window.adminAlert) window.adminAlert();
            firstRequestsPass = false;
            renderRequests();
            if (window.renderIcons) window.renderIcons();
        }).catch(function () { /* API injoignable : on garde l'affichage actuel */ });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var s = Auth.staff();
        document.querySelectorAll('[data-admin-name]').forEach(function (n) { n.textContent = s ? s.user.displayName : ''; });
        syncRequests();
        setInterval(syncRequests, POLL_MS);
        // Vue Serveurs ouverte : rafraîchie régulièrement (connexions, tables déclarées par les serveurs).
        setInterval(function () {
            var v = document.getElementById('view-servers');
            if (v && !v.classList.contains('hidden') && !(modal && !modal.classList.contains('hidden'))) window.renderServersView();
        }, 10000);
    });
})();
