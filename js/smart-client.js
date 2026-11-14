// SOUCOFFE - Fonctions intelligentes côté client (2026-11-01).
//
//  1. Profil allergies / régime : le client coche ses allergènes et son régime une
//     fois (gardé sur SON téléphone uniquement, jamais envoyé). Chaque carte du menu
//     est alors marquée (compatible / contient… / non renseigné) ou masquée, et la
//     fiche produit affiche un avertissement clair.
//  2. Commande en parlant ou en écrivant : « 2 kebabs sans oignon sauce piquante et
//     un coca » → articles reconnus avec leurs choix, vérifiés par le client avant
//     l'ajout au panier (micro du navigateur si disponible, sinon le micro du
//     clavier du téléphone fonctionne dans le champ texte). 5 langues.
//  3. Fiche produit : « Passez en menu » quand le produit existe en formule
//     (« Sandwich kebab » → « Menu sandwich kebab »), avec la différence de prix.
// Le serveur reste l'autorité : prix et choix sont revalidés à la commande.
(function () {
    var PROFILE_KEY = 'soucoffe_diet_profile';
    var ALLERGENS = ['Gluten', 'Lait', 'Œufs', 'Soja', 'Fruits à coque', 'Arachides', 'Sésame', 'Moutarde',
        'Poisson', 'Crustacés', 'Mollusques', 'Céleri', 'Sulfites', 'Lupin'];
    var DIETS = [['vegetarien', 'Végétarien'], ['vegan', 'Vegan'], ['sans-gluten', 'Sans gluten']];
    var SPEECH_LANG = { it: 'it-IT', fr: 'fr-FR', en: 'en-GB', de: 'de-DE', es: 'es-ES' };

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n, filled) { return window.iconHtml ? window.iconHtml(n, '', filled) : ''; }
    function euro(v) { return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
    function T(s) { return window.scT ? window.scT(s) : s; }
    function lang() { try { return localStorage.getItem('soucoffe_lang') || 'it'; } catch (e) { return 'it'; } }
    function products() { return (window.PRODUCTS || []).filter(function (p) { return p && p.available !== false; }); }

    // ------------------------------------------------------------------
    // 1. Profil allergies / régime
    // ------------------------------------------------------------------
    function profile() {
        try {
            var p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
            if (p && Array.isArray(p.allergens) && Array.isArray(p.diets)) return p;
        } catch (e) { /* profil absent ou illisible */ }
        return { allergens: [], diets: [], hide: false };
    }
    function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* stockage indisponible */ } }
    function profileActive(p) { return p.allergens.length > 0 || p.diets.length > 0; }

    // ok : compatible d'après les informations du restaurant ; bad : contient un allergène
    // coché ; unknown : informations manquantes (allergènes non renseignés, régime non indiqué).
    function verdict(prod, prof) {
        if (!profileActive(prof)) return null;
        var conflicts = [], missing = [];
        if (prof.allergens.length) {
            if (!Array.isArray(prod.allergens)) missing.push('allergènes');
            else prof.allergens.forEach(function (a) { if (prod.allergens.indexOf(a) !== -1) conflicts.push(a); });
        }
        var tags = prod.dietaryTags || [];
        prof.diets.forEach(function (d) {
            var ok = tags.indexOf(d) !== -1 || (d === 'vegetarien' && tags.indexOf('vegan') !== -1);
            if (d === 'sans-gluten' && Array.isArray(prod.allergens) && prod.allergens.indexOf('Gluten') !== -1) { conflicts.push('Gluten'); return; }
            if (!ok) missing.push(DIETS.filter(function (x) { return x[0] === d; })[0][1]);
        });
        return { level: conflicts.length ? 'bad' : (missing.length ? 'unknown' : 'ok'), conflicts: conflicts, missing: missing };
    }
    window.scDietVerdict = function (prod) { return verdict(prod, profile()); };

    function decorateCards() {
        var prof = profile();
        var active = profileActive(prof);
        Array.prototype.forEach.call(document.querySelectorAll('article[data-product-id]'), function (card) {
            var prod = window.getProductById && window.getProductById(card.getAttribute('data-product-id'));
            var flag = card.querySelector('.sc-diet-flag');
            var v = active && prod ? verdict(prod, prof) : null;
            card.classList.toggle('sc-diet-hidden', !!(v && prof.hide && v.level === 'bad'));
            if (!v) { if (flag) flag.remove(); return; }
            var html = v.level === 'ok' ? ic('check') + '<span>Compatible</span>'
                : v.level === 'bad' ? ic('warning') + '<span>Contient : ' + esc(v.conflicts.join(', ')) + '</span>'
                : ic('help') + '<span>À vérifier</span>';
            var cls = 'sc-diet-flag is-' + v.level;
            if (!flag) {
                flag = document.createElement('span');
                var media = card.querySelector('.sc-pcard-media') || card;
                media.appendChild(flag);
            }
            if (flag.className !== cls || flag.__h !== html) { flag.className = cls; flag.innerHTML = html; flag.__h = html; }
        });
        var count = $('sc-diet-count');
        var n = prof.allergens.length + prof.diets.length;
        if (count) { count.textContent = n; count.hidden = !n; }
    }

    function openSheet(id, html, labelledBy) {
        var m = $(id);
        if (!m) {
            m = document.createElement('div');
            m.id = id;
            m.className = 'sc-sheet';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-modal', 'true');
            m.addEventListener('click', function (e) { if (e.target === m) closeSheet(id); });
            document.body.appendChild(m);
        }
        if (labelledBy) m.setAttribute('aria-labelledby', labelledBy);
        m.innerHTML = '<div class="sc-sheet-panel">' + html + '</div>';
        m.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        if (window.renderIcons) window.renderIcons();
        return m;
    }
    function closeSheet(id) {
        var m = $(id);
        if (m) m.classList.remove('is-open');
        if (!document.querySelector('.sc-sheet.is-open')) document.body.style.overflow = '';
        if (recog) { try { recog.abort(); } catch (e) { /* rien */ } }
        return false;
    }
    window.scCloseSheet = closeSheet;
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') Array.prototype.forEach.call(document.querySelectorAll('.sc-sheet.is-open'), function (m) { closeSheet(m.id); });
    });

    window.scOpenDietProfile = function () {
        var p = profile();
        var chip = function (key, label, on, attr) {
            return '<button type="button" class="sc-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" ' + attr + '="' + esc(key) + '" onclick="this.classList.toggle(\'is-on\');this.setAttribute(\'aria-pressed\',this.classList.contains(\'is-on\'))">' +
                ic('check') + '<span>' + esc(label) + '</span></button>';
        };
        openSheet('sc-diet-sheet',
            '<div class="sc-sheet-head"><div><p class="sc-sheet-kicker">' + ic('allergy') + ' Profil personnel</p>' +
            '<h3 id="sc-diet-title" class="sc-sheet-title">Mes allergies et mon régime</h3>' +
            '<p class="sc-sheet-sub">Gardé uniquement sur ce téléphone. Le menu signale ce qui vous convient.</p></div>' +
            '<button type="button" class="sc-sheet-x" aria-label="Fermer" onclick="return scCloseSheet(\'sc-diet-sheet\')">' + ic('close') + '</button></div>' +
            '<p class="sc-sheet-label">Je suis allergique à</p><div class="sc-chips">' + ALLERGENS.map(function (a) { return chip(a, a, p.allergens.indexOf(a) !== -1, 'data-allergen'); }).join('') + '</div>' +
            '<p class="sc-sheet-label">Mon régime</p><div class="sc-chips">' + DIETS.map(function (d) { return chip(d[0], d[1], p.diets.indexOf(d[0]) !== -1, 'data-diet'); }).join('') + '</div>' +
            '<p class="sc-sheet-label">Plats qui ne me conviennent pas</p>' +
            '<div class="sc-seg" role="radiogroup">' +
            '<label><input type="radio" name="sc-diet-mode" value="flag"' + (p.hide ? '' : ' checked') + '/><span>' + ic('warning') + ' Les signaler</span></label>' +
            '<label><input type="radio" name="sc-diet-mode" value="hide"' + (p.hide ? ' checked' : '') + '/><span>' + ic('visibility_off') + ' Les masquer</span></label></div>' +
            '<p class="sc-sheet-note">' + ic('info') + ' Informations indicatives fournies par le restaurant. En cas d\'allergie sévère, confirmez toujours avec le personnel.</p>' +
            '<div class="sc-sheet-actions"><button type="button" class="sc-btn-ghost" onclick="return scDietClear()">Tout effacer</button>' +
            '<button type="button" class="sc-btn-main" onclick="return scDietSave()">' + ic('check') + ' Enregistrer</button></div>', 'sc-diet-title');
        return false;
    };
    window.scDietSave = function () {
        var pick = function (attr) {
            return Array.prototype.map.call(document.querySelectorAll('#sc-diet-sheet [' + attr + '].is-on'), function (b) { return b.getAttribute(attr); });
        };
        var mode = document.querySelector('#sc-diet-sheet input[name="sc-diet-mode"]:checked');
        var p = { allergens: pick('data-allergen'), diets: pick('data-diet'), hide: !!(mode && mode.value === 'hide') };
        saveProfile(p);
        closeSheet('sc-diet-sheet');
        decorateCards();
        if (window.showToast) window.showToast(profileActive(p) ? 'Profil enregistré : le menu est adapté' : 'Profil effacé');
        return false;
    };
    window.scDietClear = function () {
        saveProfile({ allergens: [], diets: [], hide: false });
        closeSheet('sc-diet-sheet');
        decorateCards();
        if (window.showToast) window.showToast('Profil effacé');
        return false;
    };

    // ------------------------------------------------------------------
    // 2. Commande en parlant ou en écrivant
    // ------------------------------------------------------------------
    var STOP = ' de du des la le les l d un une et au aux a avec en pour sur svp stp merci je voudrais veux prendre prends mettez moi nous on il y ' +
        'please i would like want get have and with the a an of for some ' +
        'per favore vorrei voglio prendo un una uno il lo la gli le di del della con e ' +
        'bitte ich mochte hatte gern ein eine einen und mit der die das ' +
        'por favor quiero quisiera un una el la los las de del con y ';
    var STOPS = {};
    STOP.split(/\s+/).forEach(function (w) { if (w) STOPS[w] = 1; });
    var NUM = {
        un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
        one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10,
        uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
        ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
        dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10
    };

    function norm(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/œ/g, 'oe').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
    }
    function stem(w) { return w.length > 4 ? w.replace(/(es|en|er|s|i|e|n)$/, '') : w; }
    // « sans / without / senza / ohne / sin / no » : un seul mot, pour reconnaître « Sans oignon » dans toutes les langues.
    var NEG = { sans: 1, without: 1, senza: 1, ohne: 1, sin: 1, no: 1 };
    function tokens(s) { return norm(s).split(' ').map(function (w) { return NEG[w] ? 'sans' : w; }).filter(function (w) { return w && !STOPS[w]; }); }
    function lev(a, b) {
        if (Math.abs(a.length - b.length) > 2) return 3;
        var prev = [], cur, i, j;
        for (j = 0; j <= b.length; j++) prev[j] = j;
        for (i = 1; i <= a.length; i++) {
            cur = [i];
            for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
        return prev[b.length];
    }
    function sameWord(a, b) {
        if (a === b || stem(a) === stem(b)) return true;
        return a.length >= 5 && b.length >= 5 && lev(stem(a), stem(b)) <= 1;
    }
    function covers(segToks, wordToks) {
        return wordToks.length > 0 && wordToks.every(function (w) { return segToks.some(function (s) { return sameWord(s, w); }); });
    }
    function variants(label, prefix) {
        var out = [(prefix ? prefix + ' ' : '') + label], t = T(label), tp = prefix ? T(prefix) : '';
        if ((t && t !== label) || (tp && tp !== prefix)) out.push((tp ? tp + ' ' : '') + (t || label));
        return out;
    }

    // Toutes les options d'un produit, à plat (avec leur groupe), pour la reconnaissance.
    function flatOptions(p) {
        var o = window.productOptionsFor ? window.productOptionsFor(p) : {};
        var out = [];
        (o.service || []).forEach(function (x) { out.push({ id: x.optionId, label: x.label, kind: 'service' }); });
        (o.sizes || []).forEach(function (x) { out.push({ id: x.optionId, label: x.label, kind: 'size' }); });
        (o.levels || []).forEach(function (l) { l.steps.forEach(function (st) { out.push({ id: st.optionId, label: st.label, prefix: l.label, kind: 'level', group: l.key }); }); });
        (o.groups || []).forEach(function (g, gi) { g.options.forEach(function (x) { out.push({ id: x.optionId, label: x.label, kind: 'group', group: gi }); }); });
        (o.extras || []).forEach(function (x) { out.push({ id: x.optionId, label: x.label, kind: 'extra' }); });
        return out.filter(function (x) { return typeof x.id === 'number'; });
    }

    // Score d'un produit pour un morceau de phrase : mots du nom retrouvés (dans la langue
    // affichée ou en français), part du nom couverte, et position du 1er mot retrouvé.
    function scoreProduct(p, segToks) {
        var best = { score: 0, matched: 0, pos: 99, first: false };
        variants(p.name).forEach(function (name) {
            var nt = tokens(name);
            if (!nt.length) return;
            var pos = 99, first = false;
            var hit = nt.filter(function (w, wi) {
                for (var i = 0; i < segToks.length; i++) if (sameWord(segToks[i], w)) { pos = Math.min(pos, i); if (wi === 0) first = true; return true; }
                return false;
            }).length;
            var sc = hit / nt.length;
            if (hit > best.matched || (hit === best.matched && sc > best.score)) best = { score: sc, matched: hit, pos: pos, first: first };
        });
        return best;
    }

    // Taille dite en mots (« grand », « large », « piccolo »…) ou « taille L ».
    var SIZE_WORDS = {
        S: ['petit', 'petite', 'petits', 'petites', 'small', 'piccolo', 'piccola', 'piccoli', 'piccole', 'klein', 'kleine', 'kleiner', 'kleinen', 'pequeno', 'pequena', 'pequenos', 'pequenas'],
        M: ['moyen', 'moyenne', 'moyens', 'medium', 'medio', 'media', 'medi', 'mittel', 'mittlere', 'mittleren', 'mediano', 'mediana', 'medianos'],
        L: ['grand', 'grande', 'grands', 'grandes', 'large', 'big', 'grandi', 'gross', 'grosse', 'grosser', 'grossen']
    };
    function sizeFromText(seg) {
        var n = ' ' + norm(seg) + ' ';
        var m = /(taille|size|misura|grosse|tamano|formato) (s|m|l)\b/.exec(n);
        if (m) return m[2].toUpperCase();
        for (var k in SIZE_WORDS) if (SIZE_WORDS[k].some(function (w) { return n.indexOf(' ' + w + ' ') !== -1; })) return k;
        return null;
    }

    function matchOptions(p, seg, segToks) {
        var chosen = [];
        flatOptions(p).forEach(function (o) {
            variants(o.label, o.prefix).forEach(function (v) {
                var vt = tokens(v);
                if (o.kind === 'size') {
                    if (sizeFromText(seg) === String(o.label).toUpperCase()) chosen.push(o.id);
                    return;
                }
                if (vt.length && covers(segToks, vt)) chosen.push(o.id);
            });
        });
        return chosen.filter(function (x, i, a) { return a.indexOf(x) === i; });
    }

    function parseOrder(text) {
        var segs = norm(text).replace(/\b(et|and|e|und|y|puis|poi|then|dann|luego|plus|avec un|avec une)\b/g, ' | ')
            .split(/\|/).map(function (s) { return s.trim(); }).filter(Boolean);
        var all = products();
        var lines = [], unknown = [];
        segs.forEach(function (seg) {
            var raw = seg.split(' ');
            var qty = 0;
            raw.forEach(function (w) { if (!qty && /^\d{1,2}$/.test(w)) qty = parseInt(w, 10); else if (!qty && NUM[w] && raw.length > 1) qty = NUM[w]; });
            var segToks = tokens(seg).filter(function (w) { return !/^\d+$/.test(w) && !NUM[w]; });
            if (!segToks.length) return;
            // « … et sauce piquante » (sans quantité) : un choix du plat précédent plutôt qu'un nouvel article.
            var prev = lines[lines.length - 1];
            if (prev && !qty) {
                var asOption = matchOptions(prev.product, seg, segToks);
                if (asOption.length) { prev.optionIds = prev.optionIds.concat(asOption).filter(function (x, i, a) { return a.indexOf(x) === i; }); return; }
            }
            var scored = all.map(function (p) { var s = scoreProduct(p, segToks); s.p = p; return s; })
                .filter(function (x) { return x.matched >= 1 && (x.score >= 0.5 || x.first); })
                .sort(function (a, b) { return b.matched - a.matched || a.pos - b.pos || b.score - a.score || a.p.name.length - b.p.name.length; });
            if (!scored.length) {
                // Que des choix (« sans oignon ») : ils complètent l'article précédent.
                var last = lines[lines.length - 1];
                var extra = last ? matchOptions(last.product, seg, segToks) : [];
                if (extra.length) { last.optionIds = last.optionIds.concat(extra).filter(function (x, i, a) { return a.indexOf(x) === i; }); }
                else unknown.push(seg);
                return;
            }
            var top = scored[0];
            // Plusieurs produits aussi probables (« un kebab ») : le client choisit dans une liste.
            var optionNames = flatOptions(top.p).map(function (o) { return norm(o.label); });
            var alts = scored.filter(function (x) { return x.matched === top.matched && x.pos === top.pos && x.score >= top.score - 0.2 && optionNames.indexOf(norm(x.p.name)) === -1; }).slice(0, 5).map(function (x) { return x.p; });
            lines.push({ product: top.p, qty: Math.min(Math.max(qty || 1, 1), 20), optionIds: matchOptions(top.p, seg, segToks), alternatives: alts.length > 1 ? alts : [] });
        });
        return { lines: lines, unknown: unknown };
    }
    window.scParseOrder = parseOrder;

    // Ligne de panier identique à celle de la fiche produit (confirmModalAdd).
    function buildCartItem(p, chosenIds, qty) {
        var o = window.productOptionsFor ? window.productOptionsFor(p) : {};
        var has = function (x) { return x && chosenIds.indexOf(x.optionId) !== -1; };
        var parts = [], ids = [], unit = window.getEffectivePrice ? window.getEffectivePrice(p) : p.price;
        if (o.service && o.service.length) {
            var svc = o.service.filter(has)[0] || o.service[0];
            parts.push(svc.label); ids.push(svc.optionId);
        }
        if (o.sizes) {
            var size = o.sizes.filter(has)[0] || o.sizes.filter(function (s) { return s.label === 'M'; })[0] || o.sizes[0];
            parts.push(size.label); ids.push(size.optionId); unit += size.delta || 0;
        }
        (o.levels || []).forEach(function (l) {
            var st = l.steps.filter(has)[0] || l.steps[Math.min(2, l.steps.length - 1)];
            parts.push(l.label + ': ' + st.label); ids.push(st.optionId);
        });
        (o.groups || []).forEach(function (g) {
            var sel = g.options.filter(has);
            if (!g.multiple && sel.length > 1) sel = sel.slice(0, 1);
            if (g.multiple && g.max && sel.length > g.max) sel = sel.slice(0, g.max);
            if (!sel.length && g.required) sel = [g.options[window.scSmartDefaultIndex ? window.scSmartDefaultIndex(g, p) : 0]];
            if (!sel.length) return;
            parts.push(g.name + ': ' + sel.map(function (x) { return x.label; }).join(', '));
            sel.forEach(function (x) { ids.push(x.optionId); unit += x.price || 0; });
        });
        (o.extras || []).filter(has).forEach(function (x) { parts.push(x.label); ids.push(x.optionId); unit += x.price || 0; });
        return {
            id: p.id + (parts.length ? '|' + parts.join('|') : ''), name: p.name + (parts.length ? ' (' + parts.join(', ') + ')' : ''),
            price: unit, qty: qty, img: (window.getEffectiveImage ? window.getEffectiveImage(p) : p.img) || '',
            productId: typeof p.apiId === 'number' ? p.apiId : null, optionIds: ids.filter(function (x) { return typeof x === 'number'; }), parts: parts
        };
    }
    window.scBuildCartItem = buildCartItem;

    var parsed = null, recog = null;
    function speechSupported() { return !!(window.isSecureContext && (window.SpeechRecognition || window.webkitSpeechRecognition)); }

    window.scOpenVoiceOrder = function () {
        var mic = speechSupported();
        openSheet('sc-voice-sheet',
            '<div class="sc-sheet-head"><div><p class="sc-sheet-kicker">' + ic('auto_awesome') + ' Commande express</p>' +
            '<h3 id="sc-voice-title" class="sc-sheet-title">Dites ou écrivez votre commande</h3>' +
            '<p class="sc-sheet-sub">Ex. « 2 sandwichs kebab sans oignon sauce piquante et un coca »</p></div>' +
            '<button type="button" class="sc-sheet-x" aria-label="Fermer" onclick="return scCloseSheet(\'sc-voice-sheet\')">' + ic('close') + '</button></div>' +
            (mic ? '<button type="button" id="sc-mic" class="sc-mic" onclick="return scVoiceListen()" aria-label="Parler">' + ic('mic', true) + '<span id="sc-mic-label">Appuyez et parlez</span></button>' : '') +
            '<div class="sc-voice-input"><textarea id="sc-voice-text" rows="2" maxlength="400" placeholder="Votre commande, en toutes lettres…" oninput="scVoiceDebounce()"></textarea>' +
            '<button type="button" class="sc-btn-main" onclick="return scVoiceAnalyze()">' + ic('auto_awesome') + ' Analyser</button></div>' +
            (mic ? '' : '<p class="sc-sheet-note">' + ic('mic') + ' Astuce : touchez le micro du clavier de votre téléphone pour dicter dans le champ.</p>') +
            '<div id="sc-voice-result" aria-live="polite"></div>', 'sc-voice-title');
        var ta = $('sc-voice-text');
        if (ta && !mic) ta.focus();
        return false;
    };

    var debounce = null;
    window.scVoiceDebounce = function () { clearTimeout(debounce); debounce = setTimeout(window.scVoiceAnalyze, 700); };

    window.scVoiceListen = function () {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return false;
        if (recog) { try { recog.stop(); } catch (e) { /* rien */ } return false; }
        recog = new SR();
        recog.lang = SPEECH_LANG[lang()] || 'it-IT';
        recog.interimResults = true;
        recog.maxAlternatives = 1;
        var btn = $('sc-mic'), label = $('sc-mic-label');
        btn.classList.add('is-listening');
        label.textContent = T('Je vous écoute…');
        recog.onresult = function (e) {
            var txt = '';
            for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
            $('sc-voice-text').value = txt;
            if (e.results[e.results.length - 1].isFinal) window.scVoiceAnalyze();
        };
        recog.onerror = function (e) {
            label.textContent = T(e.error === 'not-allowed' ? 'Micro refusé : écrivez votre commande' : 'Je n\'ai pas compris, réessayez');
        };
        recog.onend = function () {
            recog = null;
            if (btn) btn.classList.remove('is-listening');
            if (label && label.textContent === T('Je vous écoute…')) label.textContent = T('Appuyez et parlez');
        };
        try { recog.start(); } catch (e) { recog = null; btn.classList.remove('is-listening'); }
        return false;
    };

    // « Pain: Pain turc, Piadina » traduit morceau par morceau.
    function trPart(s) {
        var i = s.indexOf(': ');
        if (i < 0) return T(s);
        return T(s.slice(0, i)) + ': ' + s.slice(i + 2).split(', ').map(T).join(', ');
    }

    function renderParsed() {
        var el = $('sc-voice-result');
        if (!el || !parsed) return;
        if (!parsed.lines.length) {
            el.innerHTML = parsed.unknown.length ? '<p class="sc-voice-empty">' + ic('help') + ' Aucun article reconnu. Essayez avec le nom affiché sur le menu.</p>' : '';
            return;
        }
        var total = 0;
        var rows = parsed.lines.map(function (l, i) {
            var item = buildCartItem(l.product, l.optionIds, l.qty);
            total += item.price * l.qty;
            var v = verdict(l.product, profile());
            return '<li class="sc-voice-line">' +
                '<div class="sc-voice-main">' +
                (l.alternatives.length
                    ? '<select aria-label="Choisir le produit" onchange="scVoiceSwap(' + i + ', this.value)">' + l.alternatives.map(function (p) {
                        return '<option value="' + esc(p.id) + '"' + (p.id === l.product.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
                    }).join('') + '</select>'
                    : '<strong>' + esc(l.product.name) + '</strong>') +
                (item.parts.length ? '<small translate="no">' + esc(item.parts.map(trPart).join(' · ')) + '</small>' : '') +
                (v && v.level === 'bad' ? '<small class="is-warn">' + ic('warning') + ' Contient : ' + esc(v.conflicts.join(', ')) + '</small>' : '') +
                '</div>' +
                '<div class="sc-voice-qty"><button type="button" aria-label="Moins" onclick="scVoiceQty(' + i + ',-1)">' + ic('remove') + '</button><b>' + l.qty + '</b>' +
                '<button type="button" aria-label="Plus" onclick="scVoiceQty(' + i + ',1)">' + ic('add') + '</button></div>' +
                '<span class="sc-voice-price">' + euro(item.price * l.qty) + '</span>' +
                '<button type="button" class="sc-voice-del" aria-label="Retirer" onclick="scVoiceRemove(' + i + ')">' + ic('close') + '</button></li>';
        }).join('');
        el.innerHTML = '<p class="sc-sheet-label">' + ic('check') + ' Compris</p><ul class="sc-voice-list">' + rows + '</ul>' +
            (parsed.unknown.length ? '<p class="sc-voice-unknown">' + ic('help') + ' Pas compris : « ' + esc(parsed.unknown.join(' », « ')) + ' »</p>' : '') +
            '<div class="sc-sheet-actions"><span class="sc-voice-total">' + euro(total) + '</span>' +
            '<button type="button" class="sc-btn-main" onclick="return scVoiceAdd()">' + ic('shopping_cart') + ' Ajouter au panier</button></div>';
        if (window.renderIcons) window.renderIcons();
    }
    window.scVoiceAnalyze = function () {
        var t = $('sc-voice-text');
        if (!t) return false;
        parsed = t.value.trim() ? parseOrder(t.value) : null;
        if (!parsed) { $('sc-voice-result').innerHTML = ''; return false; }
        renderParsed();
        return false;
    };
    window.scVoiceQty = function (i, d) { var l = parsed.lines[i]; l.qty = Math.min(20, Math.max(1, l.qty + d)); renderParsed(); };
    window.scVoiceRemove = function (i) { parsed.lines.splice(i, 1); renderParsed(); };
    window.scVoiceSwap = function (i, id) {
        var l = parsed.lines[i], p = window.getProductById(id);
        if (!p) return;
        var keep = l.optionIds;
        l.product = p;
        var ok = flatOptions(p).map(function (o) { return o.id; });
        l.optionIds = keep.filter(function (x) { return ok.indexOf(x) !== -1; });
        renderParsed();
    };
    window.scVoiceAdd = function () {
        if (!parsed || !parsed.lines.length || !window.Cart) return false;
        var n = 0;
        parsed.lines.forEach(function (l) {
            var it = buildCartItem(l.product, l.optionIds, l.qty);
            delete it.parts;
            Cart.add(it);
            n += l.qty;
        });
        closeSheet('sc-voice-sheet');
        parsed = null;
        if (window.showToast) window.showToast(n + ' article(s) ajouté(s) au panier');
        if (window.cartRerender) window.cartRerender();
        return false;
    };

    // ------------------------------------------------------------------
    // 3. Fiche produit : alerte allergies + « Passez en menu »
    // ------------------------------------------------------------------
    function menuVersion(p) {
        if (/^menu /i.test(p.name)) return null;
        var target = norm('menu ' + p.name);
        return products().filter(function (x) { return norm(x.name) === target; })[0] || null;
    }
    window.scMenuVersion = menuVersion;

    window.scSmartModal = function (p) {
        var anchor = $('modal-diet');
        if (!anchor) return;
        var box = $('modal-smart');
        if (!box) {
            box = document.createElement('div');
            box.id = 'modal-smart';
            anchor.parentNode.insertBefore(box, anchor.nextSibling);
        }
        var html = '';
        var v = verdict(p, profile());
        if (v && v.level === 'bad') html += '<div class="sc-msmart is-bad" role="alert">' + ic('warning') + '<span><strong>Attention : contient ' + esc(v.conflicts.join(', ')) + '</strong><small>D\'après votre profil allergies. Demandez conseil au personnel.</small></span></div>';
        else if (v && v.level === 'unknown') html += '<div class="sc-msmart is-unknown">' + ic('help') + '<span><strong>À vérifier avec le personnel</strong><small>Informations non renseignées : ' + esc(v.missing.join(', ')) + '.</small></span></div>';
        else if (v && v.level === 'ok') html += '<div class="sc-msmart is-ok">' + ic('check') + '<span><strong>Compatible avec votre profil</strong><small>D\'après les informations du restaurant.</small></span></div>';
        var m = menuVersion(p);
        if (m) {
            var diff = (window.getEffectivePrice ? window.getEffectivePrice(m) : m.price) - (window.getEffectivePrice ? window.getEffectivePrice(p) : p.price);
            html += '<button type="button" class="sc-msmart is-upsell" onclick="scSwitchToMenu(\'' + esc(m.id) + '\')">' + ic('upgrade') +
                '<span><strong>Passez en menu' + (diff > 0 ? ' pour +' + euro(diff) : '') + '</strong><small>' + esc(m.desc || m.name) + '</small></span>' + ic('arrow_forward') + '</button>';
        }
        box.innerHTML = html;
        box.className = html ? 'mb-4 flex flex-col gap-2' : '';
    };
    window.scSwitchToMenu = function (id) {
        if (window.closeProductModal) window.closeProductModal();
        setTimeout(function () { if (window.openProductModal) window.openProductModal(id); }, 280);
    };

    // ------------------------------------------------------------------
    // Barre « Commande express » + « Mes allergies » (pages de menu)
    // ------------------------------------------------------------------
    function mountBar() {
        var grid = $('product-grid');
        if (!grid || $('sc-smartbar')) return;
        var bar = document.createElement('div');
        bar.id = 'sc-smartbar';
        bar.className = 'sc-smartbar';
        bar.innerHTML =
            '<button type="button" class="sc-smartbar-btn is-voice" onclick="return scOpenVoiceOrder()">' + ic('mic', true) + '<span><strong>Commande express</strong><small>Dites ou écrivez</small></span></button>' +
            '<button type="button" class="sc-smartbar-btn is-diet" onclick="return scOpenDietProfile()">' + ic('allergy') + '<span><strong>Mes allergies</strong><small>Menu adapté</small></span><em id="sc-diet-count" hidden>0</em></button>';
        // Au-dessus du titre de la grille (« Notre carte », « Au menu ») : visible dès l'arrivée sur la page.
        var heading = $('product-grid-heading');
        var host = heading;
        while (host && host.parentNode && !host.parentNode.contains(grid)) host = host.parentNode;
        if (host && host.parentNode && host !== grid) host.parentNode.insertBefore(bar, host);
        else grid.parentNode.insertBefore(bar, grid);
        if (window.renderIcons) window.renderIcons();
    }

    function start() {
        mountBar();
        decorateCards();
        var pending = false;
        new MutationObserver(function () {
            if (pending) return;
            pending = true;
            requestAnimationFrame(function () { pending = false; decorateCards(); });
        }).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
