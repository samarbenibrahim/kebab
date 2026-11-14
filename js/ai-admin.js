// SOUCOFFE Intelligent — vue « Intelligence » de l'administration (additive).
// Lit l'API /ai/… ; si le module est désactivé ou injoignable, la vue l'indique
// et le reste de l'administration fonctionne exactement comme avant.
// Rien ici ne modifie une commande, un prix, une promotion ou un paiement :
// les seules écritures sont les saisies de stock et les réglages du module,
// toujours déclenchées par un clic.
(function () {
    var state = { period: '30', status: null, stock: null, promos: [] };

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n, cls) { return window.iconHtml ? window.iconHtml(n, cls) : ''; }
    function can(p) { return window.Auth && Auth.can && Auth.can(p); }
    function money(v) { return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function num(v, d) { return (Number(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: d === undefined ? 1 : d }); }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }
    function toast(msg) {
        if (window.showToast) { window.showToast(msg); return; }
        var t = document.createElement('div');
        t.className = 'sc-ai-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function () { t.remove(); }, 3500);
    }
    function icons() { if (window.renderIcons) window.renderIcons(); }
    function card(title, sub, body, extraCls) {
        return '<section class="sc-ai-card' + (extraCls ? ' ' + extraCls : '') + '">' +
            '<header class="sc-ai-card-head"><h3>' + title + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</header>' + body + '</section>';
    }
    function skeleton(id) { var el = $(id); if (el) el.innerHTML = '<div class="sc-ai-loading">Chargement…</div>'; }

    // ---------- Graphiques en barres (une série, une teinte, pic accentué) ----------
    function barsV(rows, opts) {
        // rows : [{label, value, tip, peak?, low?, high?}]
        var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.value, r.high || 0); }).concat([0.0001]));
        return '<div class="sc-ai-bars' + (opts && opts.forecast ? ' is-forecast' : '') + (rows.length > 10 ? ' is-dense' : '') + '" role="img" aria-label="' + esc(opts && opts.aria || '') + '">' +
            rows.map(function (r) {
                var h = Math.max(r.value > 0 ? 3 : 0, Math.round(100 * r.value / max));
                var whisker = (r.high !== undefined) ? '<i class="sc-ai-whisker" style="bottom:' + Math.round(100 * (r.low || 0) / max) + '%;height:' + Math.max(1, Math.round(100 * (r.high - (r.low || 0)) / max)) + '%"></i>' : '';
                return '<div class="sc-ai-bar' + (r.peak ? ' is-peak' : '') + '" tabindex="0" data-tip="' + esc(r.tip) + '">' +
                    '<div class="sc-ai-bar-track">' + whisker + '<span style="height:' + h + '%"></span></div>' +
                    '<small>' + esc(r.label) + '</small></div>';
            }).join('') + '</div>';
    }
    function barsH(rows, fmt) {
        var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([0.0001]));
        if (!rows.length) return '<p class="sc-ai-empty">Aucune donnée sur la période.</p>';
        return '<ul class="sc-ai-hbars">' + rows.map(function (r, i) {
            return '<li tabindex="0" data-tip="' + esc(r.tip || '') + '"><span class="sc-ai-hlabel">' + esc(r.label) + '</span>' +
                '<span class="sc-ai-htrack"><i style="width:' + Math.max(r.value > 0 ? 2 : 0, Math.round(100 * r.value / max)) + '%"' + (i === 0 ? ' class="is-peak"' : '') + '></i></span>' +
                '<b>' + esc(fmt(r)) + '</b></li>';
        }).join('') + '</ul>';
    }

    // Info-bulle unique pour toutes les barres (survol / focus clavier)
    function tooltip() {
        var tip = $('sc-ai-tip');
        if (!tip) { tip = document.createElement('div'); tip.id = 'sc-ai-tip'; tip.className = 'sc-ai-tip'; tip.hidden = true; document.body.appendChild(tip); }
        function show(el) {
            var t = el.getAttribute('data-tip'); if (!t) return;
            tip.textContent = t; tip.hidden = false;
            var r = el.getBoundingClientRect();
            var w = tip.offsetWidth;
            tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
            tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
        }
        function hide() { tip.hidden = true; }
        var host = $('view-intelligence');
        if (!host || host.__tipBound) return;
        host.__tipBound = true;
        host.addEventListener('mouseover', function (e) { var el = e.target.closest('[data-tip]'); if (el) show(el); });
        host.addEventListener('mouseout', function (e) { if (e.target.closest('[data-tip]')) hide(); });
        host.addEventListener('focusin', function (e) { var el = e.target.closest('[data-tip]'); if (el) show(el); });
        host.addEventListener('focusout', hide);
        window.addEventListener('scroll', hide, true);
    }

    // ---------- Squelette de la vue ----------
    function layout() {
        var v = $('view-intelligence');
        v.innerHTML =
            '<div class="sc-ai-head"><div><h2 class="font-headline-md text-headline-md text-primary">Intelligence</h2>' +
            '<p class="sc-ai-lede">Analyses, prévisions et recommandations calculées sur vos données réelles. Le module propose ; l’équipe décide.</p></div>' +
            '<div id="ai-switch" class="sc-ai-switch"></div></div>' +
            '<div id="ai-quality"></div>' +
            '<div id="ai-body" class="sc-ai-body">' +
            (can('stats.view') ?
                '<div id="ai-ask"></div>' +
                '<div class="sc-ai-periods" role="tablist" aria-label="Période">' +
                [['today', 'Aujourd’hui'], ['7', '7 jours'], ['30', '30 jours'], ['90', '90 jours']].map(function (p) {
                    return '<button type="button" role="tab" data-period="' + p[0] + '" aria-selected="' + (state.period === p[0]) + '">' + p[1] + '</button>';
                }).join('') + '</div>' +
                '<div id="ai-bi"></div><div class="sc-ai-grid2"><div id="ai-forecast"></div><div id="ai-anomalies"></div></div>' : '') +
            (can('stock.view') ? '<div id="ai-stock"></div>' : '') +
            (can('promotions.view') ? '<div id="ai-promos"></div>' : '') +
            (can('ai.manage') ? '<div id="ai-settings"></div>' : '') +
            '</div>';
        v.querySelectorAll('[data-period]').forEach(function (b) {
            b.addEventListener('click', function () {
                state.period = b.getAttribute('data-period');
                v.querySelectorAll('[data-period]').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
                loadBi();
            });
        });
        tooltip();
    }

    // ---------- Interrupteur + qualité des données ----------
    function paintSwitch() {
        var s = state.status, el = $('ai-switch');
        if (!el) return;
        var on = s && s.enabled;
        el.innerHTML = '<span class="sc-ai-pill ' + (on ? 'is-on' : 'is-off') + '">' + (on ? 'Module actif' : 'Module désactivé') + '</span>' +
            (can('ai.manage') ? '<button type="button" id="ai-toggle" class="sc-ai-btn ' + (on ? 'is-ghost' : '') + '">' + (on ? 'Désactiver' : 'Activer') + '</button>' : '');
        var b = $('ai-toggle');
        if (b) b.addEventListener('click', function () {
            b.disabled = true;
            Auth.api('/ai/settings', Auth.json('PUT', { enabled: !on })).then(function () {
                toast(on ? 'Module intelligent désactivé : le site fonctionne comme avant' : 'Module intelligent activé');
                window.renderIntelligenceView();
            }).catch(function (e) { b.disabled = false; toast('Impossible : ' + errText(e)); });
        });
    }
    function paintQuality() {
        var q = state.status && state.status.dataQuality, el = $('ai-quality');
        if (!el) return;
        if (!q) { el.innerHTML = ''; return; }
        el.innerHTML = '<div class="sc-ai-quality rel-' + esc(q.reliability) + '">' +
            '<div><b>' + num(q.orders, 0) + ' commande(s)</b> sur <b>' + num(q.activeDays, 0) + ' jour(s)</b> d’activité · fiabilité <b>' + esc(q.reliability) + '</b> · méthode : ' + esc(q.method) + '</div>' +
            '<div class="sc-ai-quality-ml">' + ic('info') + ' ' + esc(q.ml.reason) + '</div></div>';
        icons();
    }

    // ---------- Assistant manager ----------
    var EXAMPLES = ['Quels sont les produits les plus vendus aujourd’hui ?', 'Quelle est l’heure la plus chargée ?', 'Quel produit risque d’être en rupture ?',
        'Quelle est l’évolution des ventes cette semaine ?', 'Quels produits sont peu vendus ?', 'Quel est le panier moyen ?'];
    function paintAsk() {
        var el = $('ai-ask');
        if (!el) return;
        el.innerHTML = card(ic('chat_bubble') + ' Posez une question sur vos données', 'Réponses calculées uniquement à partir de la base, avec la période analysée.',
            '<form id="ai-ask-form" class="sc-ai-ask" autocomplete="off"><label class="sr-only" for="ai-ask-input">Votre question</label>' +
            '<input id="ai-ask-input" maxlength="300" placeholder="Ex : Quel est le panier moyen cette semaine ?"/>' +
            '<button type="submit" class="sc-ai-btn">' + ic('arrow_forward') + ' Demander</button></form>' +
            '<div class="sc-ai-chips">' + EXAMPLES.map(function (q) { return '<button type="button" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
            '<div id="ai-ask-answer" aria-live="polite"></div>');
        $('ai-ask-form').addEventListener('submit', function (e) { e.preventDefault(); ask($('ai-ask-input').value); });
        el.querySelectorAll('[data-q]').forEach(function (b) { b.addEventListener('click', function () { $('ai-ask-input').value = b.getAttribute('data-q'); ask(b.getAttribute('data-q')); }); });
        icons();
    }
    function ask(q) {
        q = (q || '').trim();
        var out = $('ai-ask-answer');
        if (!q) return;
        out.innerHTML = '<div class="sc-ai-loading">Analyse…</div>';
        Auth.api('/ai/ask', Auth.json('POST', { question: q })).then(function (r) {
            out.innerHTML = '<div class="sc-ai-answer' + (r.forecast ? ' is-forecast' : '') + '">' +
                (r.forecast ? '<span class="sc-ai-tag">Prévision</span>' : '') +
                '<p>' + esc(r.answer) + '</p>' +
                (r.examples ? '<ul>' + r.examples.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
                '<small>' + (r.period ? 'Période : ' + esc(r.period.label) + (r.period.from ? ' (' + esc(r.period.from) + ' → ' + esc(r.period.to) + ')' : '') + ' · ' : '') + esc(r.source) + '</small></div>';
        }).catch(function (e) { out.innerHTML = '<p class="sc-ai-error">Impossible de répondre : ' + esc(errText(e)) + '</p>'; });
    }

    // ---------- BI ----------
    function loadBi() {
        if (!$('ai-bi')) return;
        skeleton('ai-bi');
        Auth.api('/ai/bi?period=' + encodeURIComponent(state.period)).then(paintBi).catch(function (e) {
            $('ai-bi').innerHTML = '<p class="sc-ai-error">Analyse indisponible : ' + esc(errText(e)) + '</p>';
        });
    }
    function paintBi(b) {
        var k = b.kpis;
        var tiles = [
            ['Ventes', money(k.grossSales), 'hors annulations'],
            ['Encaissé', money(k.revenue), 'commandes payées'],
            ['Commandes', num(k.orders, 0), k.cancelled + ' annulée(s)'],
            ['Panier moyen', money(k.averageBasket), 'par commande'],
            ['Taux d’annulation', num(k.cancellationRate) + ' %', 'des commandes'],
            ['Préparation moyenne', k.avgPrepMinutes === null ? '—' : num(k.avgPrepMinutes) + ' min', k.prepSamples + ' mesure(s)']
        ];
        var hoursUsed = b.byHour.map(function (h, i) { return { h: i, n: h.orders, a: h.amount }; });
        var first = 7, last = 22;
        hoursUsed.forEach(function (x) { if (x.n > 0) { first = Math.min(first, x.h); last = Math.max(last, x.h); } });
        var maxH = Math.max.apply(null, hoursUsed.map(function (x) { return x.n; }));
        var hourRows = hoursUsed.slice(first, last + 1).map(function (x) {
            return { label: x.h + 'h', value: x.n, peak: maxH > 0 && x.n === maxH, tip: x.h + 'h–' + (x.h + 1) + 'h : ' + x.n + ' commande(s), ' + money(x.a) };
        });
        var maxD = Math.max.apply(null, b.byWeekday.map(function (d) { return d.orders; }));
        var dayRows = b.byWeekday.map(function (d) { return { label: d.day.slice(0, 3), value: d.orders, peak: maxD > 0 && d.orders === maxD, tip: d.day + ' : ' + d.orders + ' commande(s), ' + money(d.amount) }; });
        var svc = b.service, tot = Math.max(1, svc.onSite + svc.takeaway);
        var pay = b.payments;
        var payRows = [['Espèces', pay.cash], ['Carte', pay.card], ['En ligne', pay.online]].map(function (x) { return { label: x[0], value: x[1].amount, tip: x[1].orders + ' commande(s)' }; })
            .concat(b.unpaidOrders ? [{ label: 'Non encaissé', value: 0, tip: b.unpaidOrders + ' commande(s) en attente de paiement' }] : []);

        $('ai-bi').innerHTML =
            '<p class="sc-ai-period">Période analysée : <b>' + esc(b.period.label) + '</b> (' + esc(b.period.from) + ' → ' + esc(b.period.to) + ')' + (b.cached ? ' · calcul mis en cache' : '') + '</p>' +
            '<div class="sc-ai-kpis">' + tiles.map(function (t) { return '<div class="sc-ai-kpi"><span>' + t[0] + '</span><b>' + t[1] + '</b><small>' + esc(t[2]) + '</small></div>'; }).join('') + '</div>' +
            card(ic('auto_awesome') + ' Insights', 'Calculés sur les commandes réelles de la période.',
                '<ul class="sc-ai-insights">' + (b.insights || []).map(function (i) { return '<li class="is-' + esc(i.kind) + '">' + esc(i.text) + '<small>' + esc(i.basis) + '</small></li>'; }).join('') + '</ul>') +
            '<div class="sc-ai-grid2">' +
            card('Commandes par heure', 'Survolez une barre pour le détail.', barsV(hourRows, { aria: 'Commandes par heure' })) +
            card('Commandes par jour de la semaine', null, barsV(dayRows, { aria: 'Commandes par jour de la semaine' })) +
            card('Ventes par catégorie', null, barsH(b.byCategory.map(function (c) { return { label: c.category, value: c.amount, tip: c.quantity + ' article(s)' }; }), function (r) { return money(r.value); })) +
            card('Produits les plus vendus', null, barsH(b.byProduct.slice(0, 8).map(function (p) { return { label: p.name, value: p.quantity, tip: money(p.amount) }; }), function (r) { return r.value + ' vendu(s)'; })) +
            card('Sur place / à emporter', 'Une commande compte « à emporter » si un article est servi en gobelet.',
                barsH([{ label: 'Sur place', value: svc.onSite, tip: Math.round(100 * svc.onSite / tot) + ' %' }, { label: 'À emporter', value: svc.takeaway, tip: Math.round(100 * svc.takeaway / tot) + ' %' }], function (r) { return r.value + ' (' + Math.round(100 * r.value / tot) + ' %)'; })) +
            card('Moyens de paiement', 'Montants encaissés.', barsH(payRows, function (r) { return r.label === 'Non encaissé' ? r.tip : money(r.value); })) +
            '</div>';
        icons();
    }

    // ---------- Prévisions ----------
    function loadForecast() {
        if (!$('ai-forecast')) return;
        skeleton('ai-forecast');
        Auth.api('/ai/forecast').then(function (f) {
            var body;
            if (!f.available) {
                body = '<p class="sc-ai-empty">' + esc(f.note) + '</p>';
            } else {
                var maxO = Math.max.apply(null, f.days.map(function (d) { return d.orders; }));
                body = barsV(f.days.map(function (d) {
                    // Jour abrégé via toLocaleDateString : traduit dans la langue choisie (i18n.js).
                    var shortDay = new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
                    return { label: shortDay + ' ' + d.date.slice(8, 10), value: d.orders, low: d.low, high: d.high, peak: d.orders === maxO,
                        tip: 'Prévision ' + d.day + ' ' + d.date.slice(8, 10) + '/' + d.date.slice(5, 7) + ' : ≈ ' + num(d.orders) + ' commande(s), entre ' + d.low + ' et ' + d.high + ' · ≈ ' + money(d.amount) };
                }), { forecast: true, aria: 'Prévision des commandes sur 7 jours' }) +
                    '<p class="sc-ai-note">' + (f.tomorrowPeakHour !== null ? 'Demain, heure probablement la plus chargée : <b>' + f.tomorrowPeakHour + 'h</b>. ' : '') +
                    (f.tomorrowProducts.length ? 'Produits attendus : ' + f.tomorrowProducts.slice(0, 4).map(function (p) { return esc(p.name) + ' (≈ ' + num(p.quantity) + ')'; }).join(', ') + '.' : '') + '</p>';
            }
            $('ai-forecast').innerHTML = card('<span class="sc-ai-tag">Prévision</span> 7 prochains jours',
                'Fiabilité : <b>' + esc(f.reliability) + '</b> · ' + f.historyOrders + ' commande(s) sur ' + f.historyDays + ' jour(s). Le trait vertical montre la fourchette probable.',
                body + (f.note && f.available ? '<p class="sc-ai-warn">' + esc(f.note) + '</p>' : '') + '<details class="sc-ai-method"><summary>Méthode</summary><p>' + esc(f.method) + '</p><p>' + esc(f.ml.reason) + '</p></details>');
        }).catch(function (e) { $('ai-forecast').innerHTML = card('Prévision', null, '<p class="sc-ai-error">' + esc(errText(e)) + '</p>'); });
    }

    // ---------- Anomalies ----------
    function loadAnomalies() {
        if (!$('ai-anomalies')) return;
        skeleton('ai-anomalies');
        Auth.api('/ai/anomalies').then(function (a) {
            var body;
            if (!a.available) body = '<p class="sc-ai-empty">' + esc(a.note) + '</p>';
            else if (!a.items.length) body = '<p class="sc-ai-ok">' + ic('check_circle') + ' Aucun comportement inhabituel aujourd’hui par rapport aux 28 derniers jours.</p>';
            else body = '<ul class="sc-ai-alerts">' + a.items.map(function (i) {
                return '<li class="sev-' + (i.severity === 'forte' ? 'high' : 'mid') + '"><b>' + ic('warning') + ' ' + esc(a.message) + '</b><span>' + esc(i.text) + '</span></li>';
            }).join('') + '</ul>';
            $('ai-anomalies').innerHTML = card(ic('query_stats') + ' Comportements inhabituels', esc(a.disclaimer),
                body + '<p class="sc-ai-note">Remboursements : ' + esc(a.refunds) + '</p>');
            icons();
        }).catch(function (e) { $('ai-anomalies').innerHTML = card('Comportements inhabituels', null, '<p class="sc-ai-error">' + esc(errText(e)) + '</p>'); });
    }

    // ---------- Smart Stock ----------
    var RISK = { 'rupture': ['Rupture estimée', 'crit'], 'élevé': ['Risque de rupture', 'high'], 'moyen': ['À surveiller', 'mid'], 'faible': ['OK', 'ok'], 'inconnu': ['Inventaire à faire', 'unk'] };
    function loadStock() {
        if (!$('ai-stock')) return;
        skeleton('ai-stock');
        Promise.all([Auth.api('/ai/stock'), window.__aiProducts ? Promise.resolve(window.__aiProducts) : Auth.api('/products?limit=100').then(function (r) { return (window.__aiProducts = r.content || []); })])
            .then(function (r) { state.stock = r[0]; paintStock(r[0], r[1]); })
            .catch(function (e) { $('ai-stock').innerHTML = card('Smart Stock', null, '<p class="sc-ai-error">' + esc(errText(e)) + '</p>'); });
    }
    function paintStock(s, products) {
        var manage = can('stock.manage');
        var rows = s.items.map(function (it) {
            var r = RISK[it.risk] || [it.risk, 'unk'];
            return '<tr data-item="' + it.id + '">' +
                '<td data-label="Article"><b>' + esc(it.name) + '</b><small>' + (it.recipes.length ? it.recipes.map(function (x) { return esc(x.name) + ' ' + num(x.quantityPerUnit, 3) + ' ' + esc(it.unit); }).join(' · ') : 'Aucune recette liée') + '</small></td>' +
                '<td class="num" data-label="Stock estimé">' + (it.estimatedStock === null ? '—' : num(it.estimatedStock, 2) + ' ' + esc(it.unit)) + (it.lastCount ? '<small>inventaire ' + num(it.lastCount.quantity, 2) + ' le ' + esc(it.lastCount.at.slice(0, 16)) + '</small>' : '') + '</td>' +
                '<td class="num" data-label="Consommation">' + num(it.avgDailyConsumption, 2) + ' ' + esc(it.unit) + '/j<small>sur ' + it.consumptionWindowDays + ' j</small></td>' +
                '<td class="num" data-label="Demain">' + num(it.forecastTomorrow, 2) + ' ' + esc(it.unit) + '<small>prévision demain</small></td>' +
                '<td class="num" data-label="Autonomie">' + (it.daysLeft === null ? '—' : num(it.daysLeft) + ' j') + '<small>seuil ' + num(it.minThreshold, 2) + '</small></td>' +
                '<td data-label="État"><span class="sc-ai-risk risk-' + r[1] + '">' + esc(r[0]) + '</span></td>' +
                (manage ? '<td class="sc-ai-actions"><button type="button" data-act="count">Inventaire</button><button type="button" data-act="delivery">Livraison</button><button type="button" data-act="recipe">Recette</button><button type="button" data-act="threshold">Seuil</button><button type="button" data-act="archive" class="is-quiet">Archiver</button></td>' : '') +
                '</tr><tr class="sc-ai-inline" data-inline="' + it.id + '" hidden><td colspan="' + (manage ? 7 : 6) + '"></td></tr>';
        }).join('');
        $('ai-stock').innerHTML = card(ic('inventory_2') + ' Smart Stock', esc(s.note),
            (s.items.length ? '<div class="sc-ai-tablewrap"><table class="sc-ai-table"><thead><tr><th>Article</th><th>Stock estimé</th><th>Consommation</th><th>Demain</th><th>Autonomie</th><th>État</th>' + (manage ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
                : '<p class="sc-ai-empty">Aucun article suivi. Ajoutez par exemple « Lait » (L), « Grains de café » (kg) ou « Gobelets » (pièces), puis liez-les aux produits avec une recette.</p>') +
            (manage ? '<form id="ai-stock-add" class="sc-ai-form" autocomplete="off"><b>Ajouter un article</b>' +
                '<label>Nom<input id="ai-st-name" maxlength="100" required placeholder="Lait"/></label>' +
                '<label>Unité<input id="ai-st-unit" maxlength="20" required placeholder="L"/></label>' +
                '<label>Seuil minimum<input id="ai-st-min" type="number" min="0" step="0.1" value="0"/></label>' +
                '<label>Inventaire actuel<input id="ai-st-count" type="number" min="0" step="0.1" placeholder="facultatif"/></label>' +
                '<button type="submit" class="sc-ai-btn">' + ic('add') + ' Ajouter</button><p id="ai-st-err" class="sc-ai-error" hidden></p></form>' : ''));
        icons();
        if (!manage) return;
        $('ai-stock-add').addEventListener('submit', function (e) {
            e.preventDefault();
            var body = { name: $('ai-st-name').value.trim(), unit: $('ai-st-unit').value.trim(), minThreshold: parseFloat($('ai-st-min').value) || 0 };
            if ($('ai-st-count').value !== '') body.initialCount = parseFloat($('ai-st-count').value);
            Auth.api('/ai/stock/items', Auth.json('POST', body)).then(function () { toast('Article ajouté'); loadStock(); })
                .catch(function (er) { var el = $('ai-st-err'); el.textContent = errText(er); el.hidden = false; });
        });
        $('ai-stock').querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () { stockAction(b.getAttribute('data-act'), parseInt(b.closest('tr').getAttribute('data-item'), 10), products); });
        });
    }
    function stockAction(act, id, products) {
        var it = state.stock.items.filter(function (x) { return x.id === id; })[0];
        var row = document.querySelector('[data-inline="' + id + '"]');
        var cell = row.firstElementChild;
        if (act === 'archive') {
            cell.innerHTML = '<div class="sc-ai-inline-form">Archiver « ' + esc(it.name) + ' » ? Il ne sera plus suivi ; son historique est conservé. <button type="button" class="sc-ai-btn" data-ok>Archiver</button><button type="button" data-cancel>Annuler</button></div>';
        } else if (act === 'recipe') {
            cell.innerHTML = '<div class="sc-ai-inline-form"><label>Produit<select data-prod>' + products.map(function (p) {
                var cur = it.recipes.filter(function (r) { return r.productId === (p.id || p.apiId); })[0];
                return '<option value="' + (p.id) + '">' + esc(p.name) + (cur ? ' (' + num(cur.quantityPerUnit, 3) + ')' : '') + '</option>';
            }).join('') + '</select></label><label>' + esc(it.unit) + ' par unité vendue<input data-qty type="number" min="0" step="0.001" placeholder="0 = retirer"/></label>' +
                '<button type="button" class="sc-ai-btn" data-ok>Enregistrer</button><button type="button" data-cancel>Annuler</button><span class="sc-ai-error" data-err hidden></span></div>';
        } else {
            var label = act === 'count' ? 'Quantité constatée (' + esc(it.unit) + ')' : act === 'delivery' ? 'Quantité reçue (' + esc(it.unit) + ')' : 'Seuil minimum (' + esc(it.unit) + ')';
            cell.innerHTML = '<div class="sc-ai-inline-form"><label>' + label + '<input data-qty type="number" min="0" step="0.01" value="' + (act === 'threshold' ? it.minThreshold : '') + '"/></label>' +
                (act !== 'threshold' ? '<label>Note<input data-note maxlength="255" placeholder="facultatif"/></label>' : '') +
                '<button type="button" class="sc-ai-btn" data-ok>Enregistrer</button><button type="button" data-cancel>Annuler</button><span class="sc-ai-error" data-err hidden></span></div>';
        }
        row.hidden = false;
        var q = cell.querySelector('[data-qty]'); if (q) q.focus();
        cell.querySelector('[data-cancel]').addEventListener('click', function () { row.hidden = true; });
        cell.querySelector('[data-ok]').addEventListener('click', function () {
            var p;
            var qty = q ? parseFloat(q.value) : null;
            if (act === 'archive') p = Auth.api('/ai/stock/items/' + id, Auth.json('PATCH', { active: false }));
            else if (act === 'threshold') p = Auth.api('/ai/stock/items/' + id, Auth.json('PATCH', { minThreshold: qty }));
            else if (act === 'recipe') {
                var pid = parseInt(cell.querySelector('[data-prod]').value, 10);
                // Recette complète du produit : on garde ses autres ingrédients, on change celui-ci.
                var lines = [];
                state.stock.items.forEach(function (x) { x.recipes.forEach(function (r) { if (r.productId === pid && x.id !== id) lines.push({ stockItemId: x.id, quantity: r.quantityPerUnit }); }); });
                if (qty > 0) lines.push({ stockItemId: id, quantity: qty });
                p = Auth.api('/ai/stock/recipes', Auth.json('PUT', { productId: pid, items: lines }));
            } else p = Auth.api('/ai/stock/items/' + id + '/movements', Auth.json('POST', { type: act, quantity: qty, note: (cell.querySelector('[data-note]') || {}).value || null }));
            p.then(function () { toast('Enregistré'); loadStock(); }).catch(function (e) { var er = cell.querySelector('[data-err]'); if (er) { er.textContent = errText(e); er.hidden = false; } else toast(errText(e)); });
        });
    }

    // ---------- Idées de promotions ----------
    function loadPromos() {
        if (!$('ai-promos')) return;
        skeleton('ai-promos');
        Auth.api('/ai/promotions').then(function (r) {
            state.promos = r.content || [];
            var manage = can('promotions.manage');
            $('ai-promos').innerHTML = card(ic('local_offer') + ' Idées de promotions', 'Suggestions seulement : rien n’est créé ni activé sans votre validation.',
                (state.promos.length ? '<ul class="sc-ai-ideas">' + state.promos.map(function (s, i) {
                    return '<li><div><b>' + esc(s.title) + '</b><span>' + esc(s.reason) + '</span><small>Source : ' + esc(s.source) + '</small></div>' +
                        (manage ? '<button type="button" class="sc-ai-btn is-ghost" data-promo="' + i + '">Préparer</button>' : '') + '</li>';
                }).join('') + '</ul>' : '<p class="sc-ai-empty">' + esc(r.note || 'Aucune opportunité nette pour le moment.') + '</p>') +
                '<p class="sc-ai-note">Basé sur ' + r.basedOnOrders + ' commande(s) des 30 derniers jours.</p>');
            $('ai-promos').querySelectorAll('[data-promo]').forEach(function (b) { b.addEventListener('click', function () { preparePromo(state.promos[+b.getAttribute('data-promo')]); }); });
            icons();
        }).catch(function (e) { $('ai-promos').innerHTML = card('Idées de promotions', null, '<p class="sc-ai-error">' + esc(errText(e)) + '</p>'); });
    }
    // Ouvre le formulaire de promotion EXISTANT pré-rempli : l'admin relit et clique « Enregistrer » lui-même.
    function preparePromo(s) {
        if (!s || !window.openPromotionModal) return;
        window.openPromotionModal();
        var d = s.draft, tries = 0;
        (function fill() {
            var name = $('promo-name');
            if (!name || !name.offsetParent) { if (tries++ < 40) setTimeout(fill, 100); return; }
            name.value = d.name || s.title;
            $('promo-desc').value = 'Suggestion du module intelligent : ' + (s.reason || '').slice(0, 200);
            $('promo-kind').value = d.kind || 'percent';
            $('promo-value').value = d.value || '';
            $('promo-scope').value = d.scope || 'order';
            if (window.promoScopeChanged) window.promoScopeChanged();
            if (d.scope === 'product' && d.productId) $('promo-target').value = d.productId;
            if (d.scope === 'category' && d.categoryId) $('promo-target').value = d.categoryId;
            $('promo-min').value = d.minOrder || 0;
            if (d.days) document.querySelectorAll('#promo-days input').forEach(function (c) { c.checked = d.days.indexOf(parseInt(c.value, 10)) !== -1; });
            $('promo-start').value = d.startTime || '';
            $('promo-end').value = d.endTime || '';
        })();
    }

    // ---------- Réglages : créneaux horaires ----------
    function paintSettings() {
        var el = $('ai-settings');
        if (!el || !state.status || !state.status.timeSlots) return;
        var cats = (window.__aiCategories || []);
        var rows = state.status.timeSlots.map(function (s, i) {
            return '<div class="sc-ai-slot" data-slot="' + i + '">' +
                '<label>Nom<input data-f="label" maxlength="40" value="' + esc(s.label) + '"/></label>' +
                '<label>De<input data-f="start" type="number" min="0" max="23" value="' + s.start + '"/></label>' +
                '<label>À<input data-f="end" type="number" min="1" max="24" value="' + s.end + '"/></label>' +
                '<fieldset><legend>Catégories proposées</legend>' + cats.map(function (c) {
                    return '<label class="sc-ai-check"><input type="checkbox" value="' + esc(c) + '"' + (s.categories.indexOf(c) !== -1 ? ' checked' : '') + '/>' + esc(c) + '</label>';
                }).join('') + '</fieldset></div>';
        }).join('');
        el.innerHTML = card(ic('schedule') + ' Recommandations selon l’heure', 'Catégories mises en avant pour chaque moment de la journée (assistant client et recommandations). Créneau actuel : ' + esc(state.status.currentSlot || 'aucun') + '.',
            '<form id="ai-slots" class="sc-ai-slots">' + rows + '<div class="sc-ai-form-foot"><button type="submit" class="sc-ai-btn">Enregistrer les créneaux</button><span id="ai-slots-err" class="sc-ai-error" hidden></span></div></form>');
        icons();
        $('ai-slots').addEventListener('submit', function (e) {
            e.preventDefault();
            var slots = [];
            el.querySelectorAll('[data-slot]').forEach(function (r) {
                slots.push({
                    label: r.querySelector('[data-f="label"]').value.trim(),
                    start: parseInt(r.querySelector('[data-f="start"]').value, 10),
                    end: parseInt(r.querySelector('[data-f="end"]').value, 10),
                    categories: Array.prototype.map.call(r.querySelectorAll('fieldset input:checked'), function (c) { return c.value; })
                });
            });
            Auth.api('/ai/settings', Auth.json('PUT', { timeSlots: slots })).then(function () { toast('Créneaux enregistrés'); window.renderIntelligenceView(); })
                .catch(function (er) { var x = $('ai-slots-err'); x.textContent = errText(er); x.hidden = false; });
        });
    }

    // ---------- Point d'entrée (appelé par showAdminView('intelligence')) ----------
    window.renderIntelligenceView = function () {
        var v = $('view-intelligence');
        if (!v) return;
        layout();
        Auth.api('/ai/status').then(function (s) {
            state.status = s;
            paintSwitch();
            if (!s.enabled) {
                $('ai-quality').innerHTML = '';
                $('ai-body').innerHTML = '<div class="sc-ai-off">' + ic('block') + '<p><b>Le module intelligent est désactivé.</b> Tout le reste du site fonctionne normalement : carte, commandes, cuisine, caisse, administration.</p></div>';
                icons();
                return;
            }
            paintQuality();
            paintAsk();
            loadBi(); loadForecast(); loadAnomalies(); loadStock(); loadPromos();
            if ($('ai-settings')) {
                Auth.api('/categories').then(function (r) { window.__aiCategories = (r.content || r || []).map(function (c) { return c.name; }); paintSettings(); }).catch(function () { window.__aiCategories = []; paintSettings(); });
            }
        }).catch(function (e) {
            $('ai-body').innerHTML = '<div class="sc-ai-off">' + ic('warning') + '<p><b>Module intelligent indisponible</b> (' + esc(errText(e)) + '). Le reste de l’administration fonctionne normalement.</p></div>';
            icons();
        });
    };

    // Lien de menu visible seulement pour les rôles concernés.
    function gateNav() {
        var nav = $('nav-intelligence');
        if (nav && nav.parentElement) nav.parentElement.classList.toggle('hidden', !(can('stats.view') || can('stock.view')));
    }
    document.addEventListener('DOMContentLoaded', gateNav);
    document.addEventListener('soucoffe:permissions', gateNav);
})();
