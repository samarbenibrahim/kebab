// SOUCOFFE — Admin : « Infos du restaurant » (vue Menus et catégories).
// Adresse, téléphone, e-mail, lien de carte et horaires affichés sur l'accueil
// (section « Horaires et accès »). GET/PUT /api/restaurant-info (catalog.manage).
(function () {
    var INPUT = 'w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0 focus:outline-none';
    var BTN_PRIMARY = 'h-9 px-4 rounded-lg font-label-md text-xs inline-flex items-center justify-center gap-1 transition-colors bg-primary-container text-on-primary hover:bg-primary';
    var DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function ic(n) { return window.iconHtml ? window.iconHtml(n) : ''; }
    function errText(e) { return e && e.status ? e.message : 'serveur injoignable'; }

    function field(id, label, value, attrs) {
        return '<label class="block"><span class="block text-xs font-semibold text-on-surface-variant mb-1">' + label + '</span>' +
            '<input id="' + id + '" class="' + INPUT + '" value="' + esc(value) + '" ' + (attrs || '') + '/></label>';
    }

    function dayRow(d, day) {
        var s = day.slots || [];
        var slot = function (k, which) { return esc(s[k] && s[k][which] || ''); };
        return '<div class="sc-ri-day" data-day="' + d + '">' +
            '<strong>' + DAYS[d] + '</strong>' +
            '<label class="sc-ri-closed"><input type="checkbox" data-ri-closed=""' + (day.closed ? ' checked' : '') + '/> Fermé</label>' +
            '<span class="sc-ri-slots">' +
            '<input type="time" data-ri="0-from" value="' + slot(0, 'from') + '" aria-label="' + DAYS[d] + ' ouverture"/>–<input type="time" data-ri="0-to" value="' + slot(0, 'to') + '" aria-label="' + DAYS[d] + ' fermeture"/>' +
            '<em>et</em>' +
            '<input type="time" data-ri="1-from" value="' + slot(1, 'from') + '" aria-label="' + DAYS[d] + ' réouverture"/>–<input type="time" data-ri="1-to" value="' + slot(1, 'to') + '" aria-label="' + DAYS[d] + ' fermeture du soir"/>' +
            '</span></div>';
    }

    window.renderRestaurantInfoAdmin = function (el) {
        if (!el) return;
        Auth.api('/restaurant-info').then(function (info) {
            el.innerHTML = '<form id="ri-form" class="bg-surface-container-lowest rounded-xl p-4 shadow-[0_2px_10px_rgba(62,36,21,0.05)] space-y-4" onsubmit="return saveRestaurantInfo(event)">' +
                '<div><div class="font-label-md text-sm text-primary inline-flex items-center gap-1">' + ic('storefront') + ' Infos du restaurant</div>' +
                '<p class="text-xs text-on-surface-variant">Affichées sur l’accueil (section « Horaires et accès »). Un champ laissé vide n’est pas affiché.</p></div>' +
                '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
                field('ri-address', 'Adresse', info.address, 'maxlength="160" placeholder="Via …"') +
                field('ri-city', 'Ville', info.city, 'maxlength="80"') +
                field('ri-phone', 'Téléphone', info.phone, 'maxlength="30" inputmode="tel"') +
                field('ri-email', 'E-mail', info.email, 'maxlength="120" type="email"') +
                '</div>' +
                field('ri-maps', 'Lien Google Maps (https://…)', info.mapsUrl, 'maxlength="500" type="url"') +
                '<div><span class="block text-xs font-semibold text-on-surface-variant mb-2">Horaires d’ouverture</span>' +
                '<div class="sc-ri-days">' + info.hours.map(function (h, d) { return dayRow(d, h); }).join('') + '</div></div>' +
                field('ri-note', 'Remarque sur les horaires (facultatif)', info.hoursNote, 'maxlength="160"') +
                '<div class="flex items-center gap-3"><button type="submit" class="' + BTN_PRIMARY + '">' + ic('check') + ' Enregistrer</button>' +
                '<span id="ri-msg" class="text-xs"></span></div></form>';
            el.querySelectorAll('.sc-ri-day').forEach(syncDay);
            el.addEventListener('change', function (e) {
                var row = e.target.closest && e.target.closest('.sc-ri-day');
                if (row) syncDay(row);
            });
            if (window.renderIcons) window.renderIcons();
        }).catch(function (e) {
            el.innerHTML = '<p class="text-sm text-error">Infos du restaurant indisponibles : ' + esc(errText(e)) + '</p>';
        });
    };

    function syncDay(row) {
        var closed = row.querySelector('[data-ri-closed]').checked;
        row.classList.toggle('is-closed', closed);
        row.querySelectorAll('input[type=time]').forEach(function (i) { i.disabled = closed; });
    }

    window.saveRestaurantInfo = function (e) {
        if (e) e.preventDefault();
        var msg = $('ri-msg');
        var hours = Array.prototype.map.call(document.querySelectorAll('#ri-form .sc-ri-day'), function (row) {
            var v = function (k) { return row.querySelector('[data-ri="' + k + '"]').value; };
            return {
                closed: row.querySelector('[data-ri-closed]').checked,
                slots: [{ from: v('0-from'), to: v('0-to') }, { from: v('1-from'), to: v('1-to') }]
            };
        });
        var body = {
            address: $('ri-address').value, city: $('ri-city').value, phone: $('ri-phone').value,
            email: $('ri-email').value, mapsUrl: $('ri-maps').value, hoursNote: $('ri-note').value, hours: hours
        };
        msg.className = 'text-xs text-on-surface-variant';
        msg.textContent = 'Enregistrement…';
        Auth.api('/restaurant-info', Auth.json('PUT', body)).then(function () {
            msg.className = 'text-xs text-tertiary';
            msg.textContent = 'Enregistré : visible sur l’accueil.';
            if (window.showToast) window.showToast('Infos du restaurant enregistrées');
        }).catch(function (err) {
            msg.className = 'text-xs text-error';
            msg.textContent = 'Non enregistré : ' + errText(err);
        });
        return false;
    };
})();
