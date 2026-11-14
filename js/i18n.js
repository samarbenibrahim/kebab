// SOUCOFFE - Traduction de l'interface (italien par défaut ; français, anglais,
// allemand, espagnol au choix).
//
// Le site est écrit en français : ce script ne touche NI au code métier, NI aux
// données, NI à l'API. Il traduit uniquement l'AFFICHAGE, à partir des
// dictionnaires js/i18n/<langue>.js (générés par scripts/i18n/build.php depuis
// scripts/i18n/*.tsv) :
//   1. texte identique à une entrée du dictionnaire -> sa traduction ;
//   2. texte construit avec des valeurs (« Il reste 12 DT… ») -> modèles {0} ;
//   3. sinon, phrases connues reconnues à l'intérieur du texte (libellés
//      assemblés par les scripts : « Connexion 18:57 · durée 6 min »).
// Tout ce qui apparaît après coup (panier, alertes, dashboard rafraîchi) est
// traduit au vol par un MutationObserver, avant l'affichage.
// Jamais traduits : saisies (input, textarea), icônes, code, éléments marqués
// translate="no" ou data-i18n-skip.
// Choix mémorisé sur l'appareil (localStorage soucoffe_lang) ; changer de
// langue recharge la page.
(function () {
    var KEY = 'soucoffe_lang';
    var DEFAULT = 'it';
    var LANGS = {
        it: { name: 'Italiano', locale: 'it-IT' },
        fr: { name: 'Français', locale: 'fr-FR' },
        en: { name: 'English', locale: 'en-GB' },
        de: { name: 'Deutsch', locale: 'de-DE' },
        es: { name: 'Español', locale: 'es-ES' }
    };
    var ORDER = ['it', 'fr', 'en', 'de', 'es'];
    var root = document.documentElement;

    function savedLang() {
        try {
            var v = localStorage.getItem(KEY);
            return LANGS[v] ? v : null;
        } catch (e) { return null; }
    }
    var lang = savedLang() || DEFAULT;
    var locale = LANGS[lang].locale;
    root.setAttribute('lang', lang);
    window.SOUCOFFE_LANG = lang;
    window.SOUCOFFE_LOCALE = locale;

    var script = document.currentScript;
    var base = script && script.src ? script.src.replace(/i18n\.js(\?.*)?$/, '') : '../js/';
    var VERSION = '1';

    var exact = Object.create(null);
    var outputs = Object.create(null);
    var patterns = [];
    var fragIndex = Object.create(null);
    var ready = lang === 'fr';
    var collect = false;
    try { collect = localStorage.getItem('soucoffe_i18n_debug') === '1'; } catch (e) { /* rien */ }
    var missing = window.__scI18nMissing = collect ? {} : null;

    // ------------------------------------------------------------------
    // Traduction d'une chaîne
    // ------------------------------------------------------------------
    var HAS_LETTER = /[A-Za-zÀ-ÿŒœ]/;
    var LETTER = /[A-Za-zÀ-ÖØ-öø-ÿŒœ]/;
    function norm(s) { return s.replace(/\s+/g, ' '); }

    var depth = 0;
    function viaPattern(core) {
        for (var i = 0; i < patterns.length; i++) {
            var p = patterns[i];
            if (core.indexOf(p.anchor) === -1) continue;
            var m = p.re.exec(core);
            if (!m) continue;
            return p.out.replace(/\{(\d)\}/g, function (_, n) {
                var v = m[+n + 1];
                if (v === undefined) return '';
                if (depth > 2) return v;
                depth++;
                try { var t = translateCore(v); return t === undefined ? v : t; } finally { depth--; }
            });
        }
        return undefined;
    }

    // Expressions avec nombre reconnues n'importe où dans un texte (« il y a 5 min » -> « 5 min fa »).
    var inline = [];
    function viaInline(core) {
        var out = core;
        for (var i = 0; i < inline.length; i++) {
            if (out.indexOf(inline[i].anchor) === -1) continue;
            out = out.replace(inline[i].re, inline[i].fn);
        }
        return out === core ? undefined : out;
    }

    function translateCore(core) {
        var out = exact[core];
        // Texte déjà traduit (copié ailleurs par un script) : on n'y touche plus.
        if (out === undefined && outputs[core]) return undefined;
        if (out === undefined) out = viaPattern(core);
        if (out === undefined) {
            var pre = viaInline(core);
            var frag = viaFragments(pre === undefined ? core : pre);
            out = frag !== undefined ? frag : pre;
            if (missing && depth === 0 && /[a-zà-ÿ]{3}/i.test(core)) missing[core] = out === undefined ? 'none' : 'partial';
        }
        return out;
    }

    // Phrases connues à l'intérieur d'un texte assemblé (bornes de mots respectées, la plus longue d'abord).
    function viaFragments(core) {
        var out = '', i = 0, n = core.length, changed = false;
        while (i < n) {
            var c = core.charAt(i);
            if (LETTER.test(c) && (i === 0 || !LETTER.test(core.charAt(i - 1)))) {
                var j = i;
                while (j < n && LETTER.test(core.charAt(j))) j++;
                var cands = fragIndex[core.slice(i, j)];
                var hit = null;
                if (cands) {
                    for (var k = 0; k < cands.length; k++) {
                        var f = cands[k];
                        if (core.substr(i, f.src.length) === f.src && !LETTER.test(core.charAt(i + f.src.length) || ' ')) { hit = f; break; }
                    }
                }
                if (hit) { out += hit.out; i += hit.src.length; changed = true; continue; }
                out += core.slice(i, j);
                i = j;
                continue;
            }
            out += c;
            i++;
        }
        return changed ? out : undefined;
    }

    function translate(s) {
        if (!ready || lang === 'fr' || !s || !HAS_LETTER.test(s)) return s;
        var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
        var out = translateCore(norm(m[2]));
        return out === undefined ? s : m[1] + out + m[3];
    }
    window.scT = translate;

    // ------------------------------------------------------------------
    // Application au DOM
    // ------------------------------------------------------------------
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, svg: 1, SVG: 1, TEMPLATE: 1 };
    var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label'];
    var doneText = new WeakMap();
    var doneAttr = new WeakMap();

    function skipped(el) {
        for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
            if (SKIP_TAGS[e.tagName]) return true;
            if (e.getAttribute('translate') === 'no' || e.hasAttribute('data-i18n-skip') || e.isContentEditable) return true;
            if (e.classList && (e.classList.contains('material-symbols-outlined') || e.hasAttribute('data-icon'))) return true;
        }
        return false;
    }

    function doText(node) {
        var v = node.nodeValue;
        if (!v || doneText.get(node) === v || !HAS_LETTER.test(v)) return;
        if (skipped(node.parentNode)) return;
        var t = translate(v);
        doneText.set(node, t);
        if (t !== v) node.nodeValue = t;
    }

    // Zone de texte : son contenu (saisi par le client) n'est jamais traduit,
    // mais ses attributs (placeholder, title…) viennent du site et le sont.
    function doAttrs(el) {
        var isField = el.tagName === 'TEXTAREA';
        if (SKIP_TAGS[el.tagName] && !isField) return;
        var list = ATTRS;
        if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) list = ATTRS.concat('value');
        var memo = null;
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var v = el.getAttribute(a);
            if (!v || !HAS_LETTER.test(v)) continue;
            memo = memo || doneAttr.get(el) || {};
            if (memo[a] === v) continue;
            if (skipped(isField ? el.parentNode : el)) return;
            var t = translate(v);
            memo[a] = t;
            if (t !== v) el.setAttribute(a, t);
        }
        if (memo) doneAttr.set(el, memo);
    }

    function walk(rootNode) {
        if (rootNode.nodeType === 3) { doText(rootNode); return; }
        if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) return;
        if (rootNode.nodeType === 1) {
            if (rootNode.tagName === 'TEXTAREA') { doAttrs(rootNode); return; }
            if (SKIP_TAGS[rootNode.tagName]) return;
            doAttrs(rootNode);
        }
        var tw = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (n.nodeType === 1 && n.tagName === 'TEXTAREA') doAttrs(n);
                return n.nodeType === 1 && SKIP_TAGS[n.tagName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        });
        var n;
        while ((n = tw.nextNode())) {
            if (n.nodeType === 3) doText(n);
            else doAttrs(n);
        }
    }

    function onMutations(records) {
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (r.type === 'childList') {
                for (var k = 0; k < r.addedNodes.length; k++) walk(r.addedNodes[k]);
            } else if (r.type === 'characterData') {
                doText(r.target);
            } else if (r.type === 'attributes') {
                doAttrs(r.target);
            }
        }
    }

    // ------------------------------------------------------------------
    // Dates, nombres et boîtes de dialogue dans la langue choisie
    // ------------------------------------------------------------------
    function patchLocale(proto, name) {
        var orig = proto[name];
        if (!orig) return;
        proto[name] = function (loc, opts) {
            if (loc === 'fr-FR' || loc === 'fr') loc = locale;
            return orig.call(this, loc, opts);
        };
    }
    function patchDialogs() {
        ['alert', 'confirm', 'prompt'].forEach(function (fn) {
            var orig = window[fn];
            if (typeof orig !== 'function') return;
            window[fn] = function (msg) {
                var args = Array.prototype.slice.call(arguments);
                if (typeof msg === 'string') args[0] = translate(msg);
                return orig.apply(window, args);
            };
        });
    }

    // ------------------------------------------------------------------
    // Démarrage (appelé par le dictionnaire js/i18n/<langue>.js)
    // ------------------------------------------------------------------
    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function edgeTrim(s) { return s.replace(/^[^A-Za-zÀ-ÿŒœ0-9]+|[^A-Za-zÀ-ÿŒœ0-9.!?…)»]+$/g, ''); }

    window.__soucoffeI18n = function (data) {
        var key;
        for (key in data.exact) {
            exact[norm(key)] = data.exact[key];
            outputs[norm(data.exact[key])] = true;
        }
        (data.patterns || []).forEach(function (p) {
            var parts = p[0].split(/\{\d\}/);
            var anchor = parts.reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
            patterns.push({ re: new RegExp('^' + parts.map(escapeRe).join('(.+?)') + '$'), out: p[1], anchor: anchor });
        });
        (data.inline || []).forEach(function (p) {
            var parts = p[0].split(/\{\d\}/);
            var anchor = parts.reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
            var out = p[1];
            inline.push({
                anchor: anchor,
                // Bornes : pas de lettre juste avant ni juste après l'expression.
                re: new RegExp('(^|[^A-Za-zÀ-ÖØ-öø-ÿŒœ])' + parts.map(escapeRe).join('(\\d+(?:[.,]\\d+)?)') + '(?![A-Za-zÀ-ÖØ-öø-ÿŒœ])', 'g'),
                fn: function () {
                    var a = arguments;
                    return a[1] + out.replace(/\{(\d)\}/g, function (_, n) { return a[+n + 2]; });
                }
            });
        });
        // Phrases utilisables à l'intérieur d'un texte : au moins 4 caractères (évite « Or », « Du », « Mar »…),
        // sauf les mots courts déclarés sûrs dans le dictionnaire (~Lun, ~dès…).
        var short = {};
        (data.short || []).forEach(function (k) { short[norm(k)] = true; });
        for (key in data.exact) {
            var src = edgeTrim(norm(key)), dst = edgeTrim(data.exact[key]);
            if ((src.length < 4 && !short[norm(key)]) || !dst || !LETTER.test(src.charAt(0))) continue;
            var first = /^[A-Za-zÀ-ÖØ-öø-ÿŒœ]+/.exec(src)[0];
            (fragIndex[first] = fragIndex[first] || []).push({ src: src, out: dst });
        }
        for (key in fragIndex) fragIndex[key].sort(function (a, b) { return b.src.length - a.src.length; });
        ready = true;
        start();
    };

    var started = false;
    function start() {
        if (started) return;
        started = true;
        patchLocale(Date.prototype, 'toLocaleString');
        patchLocale(Date.prototype, 'toLocaleDateString');
        patchLocale(Date.prototype, 'toLocaleTimeString');
        patchLocale(Number.prototype, 'toLocaleString');
        patchDialogs();
        if (lang === 'fr') return;
        walk(document);
        new MutationObserver(onMutations).observe(root, {
            childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('value')
        });
    }

    // Pas d'affichage en français le temps de charger le dictionnaire.
    if (lang !== 'fr') {
        var style = document.createElement('style');
        style.id = 'sc-i18n-pending';
        style.textContent = 'body{visibility:hidden!important}';
        document.head.appendChild(style);
        var reveal = function () { var s = document.getElementById('sc-i18n-pending'); if (s) s.remove(); };
        document.addEventListener('DOMContentLoaded', function () { if (ready) walk(document); reveal(); });
        setTimeout(reveal, 2500); // filet : jamais de page blanche si le dictionnaire manque
        document.write('<script src="' + base + 'i18n/' + lang + '.js?v=' + VERSION + '"><\/script>');
    } else {
        start();
    }

    // ------------------------------------------------------------------
    // Sélecteur de langue (à côté du bouton thème clair/sombre)
    // ------------------------------------------------------------------
    // Styles du sélecteur. Le bouton reste dans l'en-tête (règles prioritaires : les styles des
    // boutons d'en-tête du site ne l'écrasent pas) ; la liste est placée dans <body>, en position
    // fixe calculée à l'ouverture : jamais rognée, jamais hors de l'écran, quelle que soit la largeur.
    var css = '' +
        '.sc-lang{position:relative;display:inline-flex;flex-shrink:0}' +
        '.sc-lang>button.sc-lang-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:3px!important;' +
        'width:auto!important;min-width:44px!important;height:40px!important;min-height:0!important;padding:0 9px!important;border-radius:9999px!important;' +
        'border:1px solid rgba(120,90,70,.35)!important;background:transparent;color:inherit;font:600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif!important;' +
        'letter-spacing:.04em;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}' +
        '.sc-lang>button.sc-lang-btn:hover,.sc-lang.is-open>button.sc-lang-btn{background:rgba(120,90,70,.12)}' +
        '.sc-lang>button.sc-lang-btn:focus-visible{outline:2px solid #a86a3d;outline-offset:2px}' +
        '.sc-lang>button.sc-lang-btn svg{width:15px!important;height:15px!important;min-width:15px;flex-shrink:0;opacity:.85}' +
        '.sc-lang>button.sc-lang-btn span{font-size:12px!important;line-height:1!important}' +
        '@media (max-width:400px){.sc-lang>button.sc-lang-btn{min-width:38px!important;height:36px!important;padding:0 7px!important;gap:2px!important}' +
        '.sc-lang>button.sc-lang-btn svg{width:13px!important;height:13px!important;min-width:13px}.sc-lang>button.sc-lang-btn span{font-size:11px!important}}' +
        '@media (max-width:340px){.sc-lang>button.sc-lang-btn{min-width:34px!important;padding:0 6px!important}.sc-lang>button.sc-lang-btn svg{display:none!important}}' +
        '.sc-lang-menu{position:fixed;z-index:2147483000;width:max-content;min-width:168px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;' +
        'padding:6px;border-radius:14px;background:#fffaf5;color:#3e2415;border:1px solid rgba(120,90,70,.25);box-shadow:0 14px 36px rgba(40,24,14,.24);display:none}' +
        '.sc-lang-menu.is-open{display:block}' +
        '.sc-lang-menu>button{display:flex!important;width:100%!important;height:auto!important;min-height:44px;align-items:center!important;justify-content:space-between!important;gap:14px;' +
        'padding:10px 12px!important;margin:0;border:0!important;border-radius:9px!important;background:transparent;color:inherit;' +
        'font:500 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif!important;text-align:left;cursor:pointer;box-shadow:none!important}' +
        '.sc-lang-menu>button:hover,.sc-lang-menu>button:focus-visible{background:rgba(120,90,70,.12);outline:none}' +
        '.sc-lang-menu>button[aria-checked="true"]{font-weight:700!important;background:rgba(168,106,61,.14)}' +
        '.sc-lang-menu small{opacity:.6;font-weight:600;font-size:12px;letter-spacing:.04em}' +
        'html.dark .sc-lang-menu{background:#2b211b;color:#f3e7dd;border-color:rgba(243,231,221,.18)}' +
        'html.dark .sc-lang>button.sc-lang-btn{border-color:rgba(243,231,221,.3)!important}' +
        '.sc-lang.is-floating{position:fixed;top:12px;right:60px;z-index:50}' +
        '.sc-lang.is-floating>button.sc-lang-btn{background:rgba(255,250,245,.92);color:#3e2415;box-shadow:0 2px 8px rgba(40,24,14,.18)}' +
        'html.dark .sc-lang.is-floating>button.sc-lang-btn{background:rgba(43,33,27,.92);color:#f3e7dd}' +
        '.sc-lang.is-floating.no-theme{right:12px}' +
        '.sc-lang.is-onphoto>button.sc-lang-btn{color:#fff8f0;border-color:rgba(255,248,240,.4)!important}';

    var GLOBE = '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>';

    var openWrap = null;
    function closeMenu(focusBtn) {
        if (!openWrap) return;
        var w = openWrap;
        openWrap = null;
        w.classList.remove('is-open');
        w.__menu.classList.remove('is-open');
        w.__btn.setAttribute('aria-expanded', 'false');
        if (focusBtn) w.__btn.focus();
    }
    // Liste placée dans <body> en position fixe, sous le bouton (ou au-dessus s'il n'y a pas la place),
    // alignée sur son bord droit et toujours à au moins 8 px des bords de l'écran.
    function placeMenu(w) {
        var m = w.__menu, r = w.__btn.getBoundingClientRect();
        var vw = document.documentElement.clientWidth, vh = window.innerHeight;
        var mw = m.offsetWidth, mh = m.offsetHeight;
        var left = Math.min(Math.max(8, r.right - mw), vw - mw - 8);
        var top = r.bottom + 6;
        if (top + mh > vh - 8 && r.top - mh - 6 >= 8) top = r.top - mh - 6;
        m.style.left = Math.max(8, left) + 'px';
        m.style.top = Math.max(8, top) + 'px';
    }
    function openMenu(w) {
        if (openWrap && openWrap !== w) closeMenu(false);
        openWrap = w;
        w.classList.add('is-open');
        w.__menu.classList.add('is-open');
        w.__btn.setAttribute('aria-expanded', 'true');
        placeMenu(w);
        var cur = w.__menu.querySelector('[aria-checked="true"]');
        if (cur) { try { cur.focus({ preventScroll: true }); } catch (e) { cur.focus(); } }
    }

    function build() {
        var wrap = document.createElement('div');
        wrap.className = 'sc-lang';
        wrap.setAttribute('data-i18n-skip', '');
        wrap.setAttribute('translate', 'no');
        wrap.innerHTML = '<button type="button" class="sc-lang-btn" aria-haspopup="menu" aria-expanded="false" title="Lingua / Langue / Language / Sprache / Idioma" aria-label="Lingua / Langue / Language / Sprache / Idioma">' +
            GLOBE + '<span>' + lang.toUpperCase() + '</span></button>';
        var btn = wrap.firstChild;
        var menu = document.createElement('div');
        menu.className = 'sc-lang-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('data-i18n-skip', '');
        menu.setAttribute('translate', 'no');
        menu.innerHTML = ORDER.map(function (code) {
            return '<button type="button" role="menuitemradio" aria-checked="' + (code === lang) + '" data-lang="' + code + '" lang="' + code + '">' +
                LANGS[code].name + '<small>' + code.toUpperCase() + '</small></button>';
        }).join('');
        document.body.appendChild(menu);
        wrap.__btn = btn;
        wrap.__menu = menu;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (openWrap === wrap) closeMenu(false); else openMenu(wrap);
        });
        menu.addEventListener('click', function (e) { e.stopPropagation(); });
        menu.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            var items = Array.prototype.slice.call(menu.querySelectorAll('button'));
            var i = items.indexOf(document.activeElement);
            items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
        });
        menu.querySelectorAll('[data-lang]').forEach(function (b) {
            b.addEventListener('click', function () {
                var code = b.getAttribute('data-lang');
                try { localStorage.setItem(KEY, code); } catch (e) { /* stockage indisponible */ }
                if (code !== lang) location.reload();
                else closeMenu(true);
            });
        });
        return wrap;
    }

    function mount() {
        var s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
        var toggles = document.querySelectorAll('[data-theme-toggle]');
        if (toggles.length) {
            toggles.forEach(function (t) {
                var w = build();
                if (t.classList.contains('fixed')) w.classList.add('is-floating');
                t.parentNode.insertBefore(w, t);
            });
        } else {
            var top = document.querySelector('header.top');
            var w = build();
            if (top) { w.classList.add('is-onphoto'); top.appendChild(w); }
            else { w.classList.add('is-floating', 'no-theme'); document.body.appendChild(w); }
        }
        document.addEventListener('click', function () { closeMenu(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(true); });
        // Liste en position fixe : elle suit son bouton si la page défile ou change de taille (barre d'adresse
        // mobile, rotation) et ne se referme que si le bouton n'est plus visible.
        function follow(e) {
            if (!openWrap || (e && e.target === openWrap.__menu)) return;
            var r = openWrap.__btn.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight || (!r.width && !r.height)) { closeMenu(false); return; }
            placeMenu(openWrap);
        }
        window.addEventListener('resize', follow);
        window.addEventListener('scroll', follow, { passive: true, capture: true });
    }
    // Après theme.js, qui peut ajouter un bouton thème flottant au même moment.
    document.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 0); });
})();
