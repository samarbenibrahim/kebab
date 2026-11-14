// SOUCOFFE - Demandes « à emporter » côté équipe (admin, manager, caissier).
//
// Panneau flottant « À emporter » dans la même pile que les appels serveur et
// les changements de table (#admin-notify) : client, table, commande, cafés en
// gobelet, message du client ; réponses rapides + message libre ; Accepter /
// Refuser. Le client voit la réponse sur son suivi (js/takeaway.js).
// API : GET /takeaway-requests?status=pending · PATCH /takeaway-requests/{id}/respond
(function () {
    var POLL_MS = 5000;
    var QUICK = ['Prêt au comptoir dans 5 min', 'Nous vous l’apportons à table', 'Prêt dans 10 min', 'Impossible pour le moment'];
    var requests = [];
    var sig = null;
    var firstPass = true;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(name) { return window.iconHtml ? window.iconHtml(name) : ''; }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }

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

    // Son discret si la page n'a pas déjà son alerte (page caisse).
    function ding() {
        if (window.adminAlert) { window.adminAlert(); return; }
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            var ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
            o.type = 'sine'; o.frequency.value = 988;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
            o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.5);
        } catch (e) { /* pas de son */ }
    }

    function ago(iso) {
        var t = Date.parse(String(iso || '').replace(' ', 'T'));
        if (isNaN(t)) return '';
        var m = Math.max(0, Math.round((Date.now() - t) / 60000));
        return m < 1 ? 'à l’instant' : m < 60 ? 'il y a ' + m + ' min' : 'il y a ' + Math.floor(m / 60) + ' h';
    }

    function render() {
        var panel = document.getElementById('takeaway-panel');
        if (!requests.length) { if (panel) panel.remove(); sig = ''; return; }
        var newSig = requests.map(function (r) { return r.id; }).join(',');
        if (panel && newSig === sig) return; // ne pas écraser une saisie en cours
        sig = newSig;
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'takeaway-panel';
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', 'Demandes à emporter');
            panel.className = 'sc-tk-panel bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant p-3 max-h-[70vh] overflow-y-auto';
            stack().insertBefore(panel, stack().firstChild);
        }
        panel.innerHTML = '<div class="font-label-md text-label-md text-primary mb-2 flex items-center gap-1.5">' + ic('sc_takeaway_cup') + ' À emporter (' + requests.length + ')</div>' +
            '<div class="flex flex-col gap-3">' + requests.map(function (r) {
                return '<div data-tk="' + r.id + '" class="sc-tk-card space-y-2">' +
                    '<div class="text-sm text-on-surface"><span class="font-label-md">' + esc(r.guestName) + '</span> · Table <b>' + esc(r.tableNumber) + '</b>' +
                    '<br><span class="text-xs text-on-surface-variant">' + esc(r.orderRef) + ' · ' + esc(r.orderStatus || '') + ' · ' + esc(ago(r.createdAt)) + '</span></div>' +
                    '<div class="flex flex-wrap gap-1">' + (r.items || []).map(function (i) {
                        return '<span class="text-xs px-2 py-0.5 rounded-full bg-surface-container text-on-surface">' + (i.quantity > 1 ? i.quantity + '× ' : '') + esc(i.name) + '</span>';
                    }).join('') + '</div>' +
                    (r.message ? '<div class="text-xs text-on-surface italic">« ' + esc(r.message) + ' »</div>' : '') +
                    '<div class="sc-tk-quick">' + QUICK.map(function (q, qi) {
                        return '<button type="button" onclick="takeawayQuick(' + r.id + ',' + qi + ')">' + esc(q) + '</button>';
                    }).join('') + '</div>' +
                    '<input data-tk-msg type="text" maxlength="255" placeholder="Réponse au client (facultatif)" aria-label="Réponse au client" ' +
                    'class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none"/>' +
                    '<p data-tk-err role="alert" class="hidden text-error text-xs"></p>' +
                    '<div class="flex gap-2">' +
                    '<button onclick="takeawayRespond(' + r.id + ', \'accept\')" class="flex-1 bg-primary text-on-primary font-label-md text-xs py-2 rounded-lg hover:opacity-90">' + ic('check') + ' Accepter</button>' +
                    '<button onclick="takeawayRespond(' + r.id + ', \'decline\')" class="flex-1 bg-error-container text-on-error-container font-label-md text-xs py-2 rounded-lg hover:opacity-90">' + ic('close') + ' Refuser</button>' +
                    '</div></div>';
            }).join('') + '</div>';
        if (window.renderIcons) window.renderIcons();
    }

    window.takeawayQuick = function (id, qi) {
        var input = document.querySelector('#takeaway-panel [data-tk="' + id + '"] [data-tk-msg]');
        if (input) { input.value = QUICK[qi]; input.focus(); }
    };

    window.takeawayRespond = function (id, decision) {
        var card = document.querySelector('#takeaway-panel [data-tk="' + id + '"]');
        if (!card) return;
        var err = card.querySelector('[data-tk-err]');
        var message = card.querySelector('[data-tk-msg]').value.trim();
        var body = { decision: decision };
        if (message) body.message = message;
        err.classList.add('hidden');
        card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        Auth.api('/takeaway-requests/' + id + '/respond', Auth.json('PATCH', body)).then(function () {
            sig = null;
            sync();
        }).catch(function (e) {
            err.textContent = errText(e);
            err.classList.remove('hidden');
            card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
            if (e.status === 409) { sig = null; sync(); }
        });
    };

    function sync() {
        return Auth.api('/takeaway-requests?status=pending').then(function (r) {
            var fresh = r.content || [];
            var before = requests.map(function (x) { return x.id; });
            var arrived = fresh.some(function (x) { return before.indexOf(x.id) === -1; });
            requests = fresh;
            if (!firstPass && arrived) ding();
            firstPass = false;
            render();
        }).catch(function () { /* API injoignable ou pas la permission : rien à afficher */ });
    }
    window.syncTakeawayRequests = sync;

    // ---- Pile de notifications sur téléphone : barre repliable ----
    // Les panneaux (à emporter, appels serveur, changements de table) sont
    // pensés pour un grand écran ; sur téléphone ils masqueraient tout le
    // tableau de bord. En dessous de 768 px (CSS), la pile devient une barre
    // « Notifications (n) » en bas de l'écran, repliée par défaut, qui
    // s'ouvre d'un geste et clignote quand une nouvelle demande arrive.
    var COLLAPSE_KEY = 'soucoffe_notify_collapsed';
    function notifyCount(stackEl) {
        var n = 0;
        Array.prototype.forEach.call(stackEl.children, function (panel) {
            if (panel.classList.contains('sc-notify-toggle')) return;
            var m = (panel.textContent || '').match(/\((\d+)\)/);
            n += m ? parseInt(m[1], 10) : 1;
        });
        return n;
    }
    function enhanceStack(stackEl) {
        if (stackEl.__scEnhanced) return;
        stackEl.__scEnhanced = true;
        var collapsed = true;
        try { collapsed = sessionStorage.getItem(COLLAPSE_KEY) !== '0'; } catch (e) { /* défaut : replié */ }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-notify-toggle';
        btn.setAttribute('aria-controls', 'admin-notify');
        stackEl.insertBefore(btn, stackEl.firstChild);
        var last = 0;
        function update(fromUser) {
            // Le bouton doit rester en tête de pile (les panneaux s'insèrent aussi en tête).
            if (stackEl.firstChild !== btn) stackEl.insertBefore(btn, stackEl.firstChild);
            var n = notifyCount(stackEl);
            stackEl.classList.toggle('is-empty', n === 0);
            stackEl.classList.toggle('is-collapsed', collapsed);
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            var label = n + ' notification' + (n > 1 ? 's' : '') + ' en attente';
            var html = ic('notifications') + '<span>' + label + '</span><span class="sc-notify-chev">' + ic(collapsed ? 'chevron_left' : 'chevron_right') + '</span>';
            if (btn.__html !== html) { btn.__html = html; btn.innerHTML = html; }
            if (!fromUser && n > last) { btn.classList.remove('has-new'); void btn.offsetWidth; btn.classList.add('has-new'); }
            last = n;
        }
        btn.addEventListener('click', function () {
            collapsed = !collapsed;
            try { sessionStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) { /* rien */ }
            update(true);
        });
        new MutationObserver(function (muts) {
            // Ignore les changements du bouton lui-même (évite une boucle).
            if (muts.every(function (m) { return btn.contains(m.target); })) return;
            update(false);
        }).observe(stackEl, { childList: true, subtree: true, characterData: true });
        update(true);
    }
    function watchForStack() {
        var s = document.getElementById('admin-notify');
        if (s) { enhanceStack(s); return; }
        var obs = new MutationObserver(function () {
            var st = document.getElementById('admin-notify');
            if (st) { obs.disconnect(); enhanceStack(st); }
        });
        obs.observe(document.body, { childList: true });
    }
    document.addEventListener('DOMContentLoaded', watchForStack);

    // Démarre dès que la permission est connue. Une session ouverte avant
    // l'ajout de la permission la reçoit au rafraîchissement /auth/me
    // (événement soucoffe:permissions émis par js/auth.js).
    var timer = null;
    function start() {
        if (timer || !window.Auth || !Auth.staff() || !Auth.can('takeaway.respond')) return;
        sync();
        timer = setInterval(function () { if (!document.hidden) sync(); }, POLL_MS);
    }
    document.addEventListener('DOMContentLoaded', start);
    document.addEventListener('soucoffe:permissions', start);
})();
