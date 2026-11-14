// SOUCOFFE — touches visuelles du restaurant (additif).
// 1. Suivi de commande : une cloche de service se soulève au fil des étapes
//    (lit les étapes déjà affichées dans #tracking-steps, ne touche ni à l'API
//    ni aux données).
// 2. Panier : en-tête de ticket (« Ticket · Table N » + heure).
// Si ce fichier manque ou échoue, les pages fonctionnent exactement comme avant.
(function () {
    var CUP =
        '<svg viewBox="0 0 64 64" aria-hidden="true">' +
        '<g class="cl-steam"><path d="M24 14c-3-3 3-5 0-9"/><path d="M32 12c-3-3 3-5 0-9"/><path d="M40 14c-3-3 3-5 0-9"/></g>' +
        '<g class="cl-food"><ellipse cx="32" cy="45" rx="15" ry="4.5"/><circle cx="25" cy="41.5" r="3.2"/><circle cx="32" cy="40" r="3.6"/><circle cx="39" cy="41.5" r="3.2"/></g>' +
        '<g class="cl-dome"><path class="cl-dome-body" d="M10 46a22 21 0 0 1 44 0z"/><path class="cl-dome-shine" d="M18 38a15 14 0 0 1 9-10"/><circle class="cl-knob" cx="32" cy="22" r="3"/></g>' +
        '<path class="cl-plate" d="M5 48h54"/><path class="cl-base" d="M20 53h24"/>' +
        '</svg>';
    var TEXT = [
        ['Commande envoyée', 'Votre commande part en cuisine…'],
        ['Commande reçue', 'L’équipe a bien reçu votre commande.'],
        ['En préparation', 'En cuisine et à la cafétéria, tout se prépare.'],
        ['C’est prêt !', 'Votre commande arrive à table.'],
        ['Servi', 'Bon appétit !']
    ];

    function paintCup() {
        var steps = document.getElementById('tracking-steps');
        if (!steps) return;
        var box = document.getElementById('sc-cupfill');
        var all = steps.querySelectorAll('.sc-tstep');
        if (!all.length) { if (box) box.hidden = true; return; } // annulée ou pas encore rendue
        var done = steps.querySelectorAll('.sc-tstep.is-done').length;
        var current = steps.querySelector('.sc-tstep.is-current') ? 1 : 0;
        var idx = Math.min(4, done); // étape atteinte (0 = envoyée … 4 = servie)
        var ratio = Math.min(1, (done + current * 0.5) / all.length);
        if (!box) {
            box = document.createElement('div');
            box.id = 'sc-cupfill';
            box.className = 'sc-cupfill sc-cloche';
            box.setAttribute('aria-live', 'polite');
            box.innerHTML = CUP + '<div class="min-w-0 flex-1"><b></b><small></small><div class="cup-meter"><i></i></div></div>';
            steps.parentElement.insertBefore(box, steps);
        }
        box.hidden = false;
        box.querySelector('.cup-meter i').style.width = Math.round(Math.max(0.08, ratio) * 100) + '%';
        box.querySelector('b').textContent = TEXT[idx][0];
        box.querySelector('small').textContent = TEXT[idx][1];
        box.classList.toggle('is-hot', idx === 2);
        box.classList.toggle('is-ready', idx >= 3);
    }

    function receiptHead() {
        var card = document.querySelector('.sc-receipt');
        if (!card || card.querySelector('.sc-receipt-head')) return;
        var h2 = card.querySelector('h2');
        if (!h2) return;
        var table = '';
        try { table = localStorage.getItem('soucoffe_table_number') || ''; } catch (e) { /* rien */ }
        var now = new Date();
        var head = document.createElement('div');
        head.className = 'sc-receipt-head';
        head.innerHTML = '<span class="sc-receipt-brand"><img src="../images/brand/logo.png?v=kebab2" alt="" aria-hidden="true"/>Ticket' + (table ? ' · Table ' + String(table).replace(/[<>&"]/g, '') : '') + '</span><span>' +
            now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</span>';
        h2.insertAdjacentElement('afterend', head);
    }

    document.addEventListener('DOMContentLoaded', function () {
        receiptHead();
        var steps = document.getElementById('tracking-steps');
        if (steps) {
            paintCup();
            new MutationObserver(paintCup).observe(steps, { childList: true });
        }
    });
})();
