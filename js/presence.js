// SOUCOFFE - Signal de présence de l'espace client (pages 02 à 05).
//
// Toutes les 30 s (réglable côté admin) tant que la page est au premier plan,
// envoie à l'API : la page, si le client a réellement interagi (toucher, clic,
// défilement, clavier) depuis le dernier signal, et les incidents vécus
// depuis (appels API sans réponse, réponses 5xx, réponses lentes) mesurés par
// js/auth.js. Aucune donnée personnelle ni jeton dans le corps (le jeton
// part dans l'en-tête, comme pour tout appel API).
//   - Page en arrière-plan : un dernier signal « caché », puis pause.
//   - Réseau coupé : nouvelles tentatives espacées (30 s, 60 s, ... 5 min),
//     reprise immédiate au retour du réseau ou de la page.
//   - Module désactivé par l'admin : le script s'arrête.
(function () {
    if (document.documentElement.getAttribute('data-role') !== 'client' || !window.Auth || !Auth.client()) return;
    var URL_BEAT = window.SOUCOFFE_API_BASE + '/presence/heartbeat';
    var MIN_GAP_MS = 6000;     // le serveur refuse (429) en dessous de 5 s
    var MAX_BACKOFF_MS = 300000;
    var intervalMs = 30000;
    var slowMs = 2000;
    var timer = null, lastSent = 0, inFlight = false, failures = 0, stopped = false;
    var active = true; // l'ouverture d'une page est une interaction
    var metrics = { netFailures: 0, http5xx: 0, slow: 0, maxMs: 0 };

    var page = location.pathname.split('/').slice(-2, -1)[0] || null;
    var mobile = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 768;

    function markActive() { active = true; }
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (t) {
        window.addEventListener(t, markActive, { passive: true, capture: true });
    });
    window.addEventListener('scroll', markActive, { passive: true, capture: true });

    document.addEventListener('soucoffe:api', function (e) {
        var d = e.detail || {};
        if (!d.url || d.url.indexOf('/presence/heartbeat') !== -1) return;
        if (d.status === 0 && !d.aborted) metrics.netFailures++;
        if (d.status >= 500) metrics.http5xx++;
        if (d.aborted || d.ms >= slowMs) metrics.slow++;
        if (d.status > 0 && d.ms > metrics.maxMs) metrics.maxMs = d.ms;
    });

    function schedule(ms) {
        clearTimeout(timer);
        if (!stopped && !document.hidden) timer = setTimeout(beat, ms);
    }

    function beat(opts) {
        opts = opts || {};
        if (stopped || inFlight) return;
        var wait = MIN_GAP_MS - (Date.now() - lastSent);
        if (wait > 0 && !opts.final) { schedule(wait); return; }
        var sent = { netFailures: metrics.netFailures, http5xx: metrics.http5xx, slow: metrics.slow, maxMs: metrics.maxMs };
        var body = { page: page, device: mobile ? 'mobile' : 'desktop', visible: !document.hidden && !opts.final, active: active, metrics: sent };
        active = false;
        inFlight = true;
        lastSent = Date.now();
        fetch(URL_BEAT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: !!opts.final
        }).then(function (res) {
            inFlight = false;
            if (res.status === 429) { active = active || body.active; schedule(MIN_GAP_MS); return null; }
            if (!res.ok) { failures++; schedule(Math.min(intervalMs * Math.pow(2, failures), MAX_BACKOFF_MS)); return null; }
            failures = 0;
            // Compteurs transmis : retirés (ceux arrivés pendant l'envoi restent pour le prochain signal).
            metrics.netFailures -= sent.netFailures; metrics.http5xx -= sent.http5xx; metrics.slow -= sent.slow;
            if (metrics.maxMs === sent.maxMs) metrics.maxMs = 0;
            return res.json().then(function (r) {
                if (r && r.enabled === false) { stopped = true; clearTimeout(timer); return; }
                if (r && r.intervalSeconds) intervalMs = r.intervalSeconds * 1000;
                if (r && r.slowMs) slowMs = r.slowMs;
                schedule(intervalMs);
            });
        }).catch(function () {
            // Réseau coupé : l'interaction n'est pas perdue, elle repartira au prochain essai.
            inFlight = false;
            active = active || body.active;
            failures++;
            schedule(Math.min(intervalMs * Math.pow(2, failures), MAX_BACKOFF_MS));
        });
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { clearTimeout(timer); beat({ final: true }); }
        else { active = true; failures = 0; beat(); }
    });
    window.addEventListener('pagehide', function () { clearTimeout(timer); });
    window.addEventListener('online', function () { failures = 0; beat(); });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { beat(); });
    else beat();
})();
