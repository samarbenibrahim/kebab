// SOUCOFFE - Thème clair / sombre.
// Chargé de façon synchrone dans le <head> de chaque page client : la classe
// `dark` est posée sur <html> AVANT le premier affichage (pas de flash clair).
// Les règles visuelles vivent dans css/soucoffe.css (bloc généré par
// scripts/gen-dark-css.php) ; sans la classe `dark`, rien ne change.
(function () {
    var KEY = 'soucoffe_theme_v2'; // v2 : thème Kebab sombre (#242120) par défaut pour tous
    var root = document.documentElement;

    function savedTheme() {
        try {
            var v = localStorage.getItem(KEY);
            return v === 'dark' || v === 'light' ? v : null;
        } catch (e) { return null; }
    }

    function isDark() { return root.classList.contains('dark'); }

    function updateButtons() {
        var dark = isDark();
        document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
            b.innerHTML = window.iconHtml ? window.iconHtml(dark ? 'light_mode' : 'dark_mode') : '';
            b.setAttribute('aria-label', dark ? 'Passer en mode clair' : 'Passer en mode sombre');
            b.setAttribute('title', dark ? 'Mode clair' : 'Mode sombre');
        });
    }

    function apply(theme) {
        var dark = theme === 'dark';
        root.classList.toggle('dark', dark);
        if (dark) root.classList.remove('light');
        updateButtons();
    }

    window.toggleTheme = function () {
        var next = isDark() ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (e) { /* stockage indisponible : bascule non mémorisée */ }
        apply(next);
    };

    // Par défaut : sombre (identité Kebab, fond #242120). Le bouton permet
    // de repasser en clair ; ce choix est mémorisé dans soucoffe_theme_v2.
    apply(savedTheme() || 'dark');

    // Une autre page/onglet change le thème : on suit.
    window.addEventListener('storage', function (e) {
        if (e.key === KEY) apply(e.newValue === 'dark' ? 'dark' : 'light');
    });

    document.addEventListener('DOMContentLoaded', function () {
        // Page sans bouton intégré à son en-tête (accueil de connexion, suivi) :
        // petit bouton flottant pour garder le choix accessible partout.
        if (!document.querySelector('[data-theme-toggle]')) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-theme-toggle', '');
            b.setAttribute('onclick', 'toggleTheme()');
            b.className = 'fixed top-3 right-3 z-50 w-10 h-10 rounded-full bg-surface-container-high border border-outline-variant text-lg flex items-center justify-center shadow-md';
            document.body.appendChild(b);
        }
        updateButtons();
    });
})();
