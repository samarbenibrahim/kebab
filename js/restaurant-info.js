// Kebab — Accueil : « Horaires et accès » + galerie.
// 1. Lit GET /api/restaurant-info (saisi dans l'admin) et affiche horaires,
//    « Ouvert maintenant », adresse, itinéraire, téléphone et e-mail. Un champ
//    vide n'est jamais affiché ; sans aucune info, la section reste masquée.
// 2. Galerie : agrandit une photo au clic (Échap, flèches, swipe pour naviguer).
// Si ce fichier échoue, le reste de l'accueil fonctionne comme avant.
(function () {
    var API = window.SOUCOFFE_API_BASE || 'http://localhost:8000/api';
    function $(id) { return document.getElementById(id); }
    function show(el, on) { if (el) el.classList.toggle('hidden', !on); }
    function locale() { return window.SOUCOFFE_LANG === 'fr' ? 'fr-FR' : (document.documentElement.lang || 'it'); }
    function toMin(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1]); }

    // 0 = lundi … 6 = dimanche (comme dans l'admin).
    function dayName(d) {
        var ref = new Date(2024, 0, 1 + d); // 1er janvier 2024 = lundi
        var s = ref.toLocaleDateString(locale(), { weekday: 'long' });
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    function todayIndex(now) { return (now.getDay() + 6) % 7; }

    // État d'ouverture à l'instant donné ; gère les créneaux qui passent minuit.
    function openState(hours, now) {
        var t = now.getHours() * 60 + now.getMinutes();
        var d = todayIndex(now);
        var prev = (d + 6) % 7;
        var hit = null;
        (hours[prev].slots || []).forEach(function (s) {
            if (!hours[prev].closed && toMin(s.to) < toMin(s.from) && t < toMin(s.to)) hit = s;
        });
        (hours[d].slots || []).forEach(function (s) {
            if (hours[d].closed) return;
            var a = toMin(s.from), b = toMin(s.to);
            if (b <= a ? (t >= a) : (t >= a && t < b)) hit = s;
        });
        return hit;
    }

    function render(info) {
        var any = false;
        var hasSlots = info.hours.some(function (h) { return !h.closed && h.slots && h.slots.length; });
        // Horaires
        if (hasSlots) {
            any = true;
            var today = todayIndex(new Date());
            $('sc-hours-list').innerHTML = info.hours.map(function (h, d) {
                var val = h.closed || !h.slots.length ? '<span class="is-closed">Fermé</span>'
                    : '<span translate="no">' + h.slots.map(function (s) { return s.from + ' – ' + s.to; }).join(' · ') + '</span>';
                return '<li' + (d === today ? ' class="is-today"' : '') + '><b translate="no">' + dayName(d) + '</b>' + val + '</li>';
            }).join('');
            var note = $('sc-hours-note');
            note.textContent = info.hoursNote || '';
            show(note, !!info.hoursNote);
            show($('sc-info-hours'), true);
            var open = openState(info.hours, new Date());
            var badge = $('sc-open-badge');
            badge.className = 'sc-open-badge ' + (open ? 'is-open' : 'is-shut');
            badge.innerHTML = open ? '<i></i><span>Ouvert maintenant</span> <small translate="no">· ' + open.from + ' – ' + open.to + '</small>'
                : '<i></i><span>Fermé pour le moment</span>';
            document.querySelectorAll('[data-ri-open-label]').forEach(function (el) {
                el.textContent = open ? 'Ouvert maintenant' : 'Horaires et accès';
            });
        }
        // Adresse
        var addr = [info.address, info.city].filter(Boolean).join(', ');
        if (addr || info.mapsUrl) {
            any = true;
            $('sc-info-address').textContent = addr;
            var maps = $('sc-info-maps');
            var url = info.mapsUrl || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Kebab ' + addr));
            if (/^https:\/\//i.test(url)) { maps.href = url; show(maps, true); }
            show($('sc-info-place'), true);
            var fa = $('sc-footer-address');
            if (fa && addr) { fa.textContent = addr; show(fa, true); }
        }
        // Contact
        if (info.phone || info.email) {
            any = true;
            var tel = $('sc-info-phone');
            if (info.phone) {
                tel.href = 'tel:' + info.phone.replace(/[^0-9+]/g, '');
                tel.querySelector('[translate]').textContent = info.phone;
                show(tel, true);
                var fp = $('sc-footer-phone');
                if (fp) { fp.href = tel.href; fp.textContent = info.phone; show(fp, true); }
            }
            var mail = $('sc-info-email');
            if (info.email) {
                mail.href = 'mailto:' + info.email;
                mail.querySelector('[translate]').textContent = info.email;
                show(mail, true);
            }
            show($('sc-info-contact'), true);
        }
        show($('sc-infos'), any);
        document.querySelectorAll('[data-ri-show]').forEach(function (el) { show(el, any); });
        if (window.renderIcons) window.renderIcons();
    }

    function load() {
        if (!$('sc-infos')) return;
        fetch(API + '/restaurant-info').then(function (r) { return r.ok ? r.json() : null; })
            .then(function (info) { if (info && info.hours) render(info); })
            .catch(function () { /* serveur injoignable : la section reste masquée */ });
    }

    // ---- Galerie : visionneuse ----
    function gallery() {
        var items = Array.prototype.slice.call(document.querySelectorAll('[data-gal]'));
        if (!items.length) return;
        var box = document.createElement('div');
        box.className = 'sc-lightbox';
        box.hidden = true;
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.innerHTML = '<button type="button" class="sc-lb-close" aria-label="Fermer"><span class="material-symbols-outlined">close</span></button>' +
            '<button type="button" class="sc-lb-nav sc-lb-prev" aria-label="Image précédente"><span class="material-symbols-outlined">chevron_left</span></button>' +
            '<figure><img alt=""/><figcaption></figcaption></figure>' +
            '<button type="button" class="sc-lb-nav sc-lb-next" aria-label="Image suivante"><span class="material-symbols-outlined">chevron_right</span></button>';
        document.body.appendChild(box);
        var img = box.querySelector('img'), cap = box.querySelector('figcaption');
        var cur = 0, lastFocus = null;
        function go(i) {
            cur = (i + items.length) % items.length;
            var src = items[cur].querySelector('img');
            img.src = src.getAttribute('src');
            img.alt = src.alt;
            cap.textContent = items[cur].querySelector('span').textContent;
        }
        function open(i) {
            lastFocus = document.activeElement;
            go(i);
            box.hidden = false;
            document.documentElement.classList.add('sc-lb-open');
            box.querySelector('.sc-lb-close').focus();
        }
        function close() {
            box.hidden = true;
            document.documentElement.classList.remove('sc-lb-open');
            if (lastFocus) lastFocus.focus();
        }
        items.forEach(function (it, i) { it.addEventListener('click', function () { open(i); }); });
        box.querySelector('.sc-lb-close').addEventListener('click', close);
        box.querySelector('.sc-lb-prev').addEventListener('click', function () { go(cur - 1); });
        box.querySelector('.sc-lb-next').addEventListener('click', function () { go(cur + 1); });
        box.addEventListener('click', function (e) { if (e.target === box) close(); });
        document.addEventListener('keydown', function (e) {
            if (box.hidden) return;
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') go(cur - 1);
            else if (e.key === 'ArrowRight') go(cur + 1);
        });
        var x0 = null;
        box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
        box.addEventListener('touchend', function (e) {
            if (x0 === null) return;
            var dx = e.changedTouches[0].clientX - x0;
            if (Math.abs(dx) > 45) go(cur + (dx < 0 ? 1 : -1));
            x0 = null;
        });
        if (window.renderIcons) window.renderIcons();
    }

    // ---- Restaurant intelligent : les tuiles ouvrent la vraie fonction ----
    // (commande express et allergies : js/smart-client.js ; suggestions :
    // assistant de l'accueil). Sans le script, le lien de repli s'applique.
    function smartTiles() {
        var actions = {
            voice: function () { return window.scOpenVoiceOrder && (window.scOpenVoiceOrder(), true); },
            diet: function () { return window.scOpenDietProfile && (window.scOpenDietProfile(), true); },
            assistant: function () {
                var input = $('assistant-input');
                if (!input) return false;
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }, 450);
                return true;
            }
        };
        document.querySelectorAll('[data-smart]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                var run = actions[el.getAttribute('data-smart')];
                if (run && run()) e.preventDefault();
            });
        });
    }

    document.addEventListener('DOMContentLoaded', function () { load(); gallery(); smartTiles(); });
    window.scRestaurantOpenState = openState; // pour les tests
})();
