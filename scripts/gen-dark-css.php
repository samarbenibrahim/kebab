<?php
/**
 * Génère le thème sombre de SOUCOFFE et l'écrit dans css/soucoffe.css, entre
 * deux marqueurs (réexécutable : l'ancien bloc est remplacé, jamais dupliqué).
 *
 * Pourquoi un script : les couleurs Tailwind du site (config CDN, palette
 * Material) sont figées en valeurs claires dans chaque page. Le thème sombre
 * redéfinit, sous `html.dark`, chaque utilitaire de couleur de cette palette
 * (bg-*, text-*, border-*, ring-* et leurs variantes hover:/focus:/group-hover:
 * ainsi que dark:*) avec la valeur sombre correspondante. Rien ne change sans
 * la classe `dark` sur <html> : le mode clair est strictement inchangé.
 *
 * Usage : php scripts/gen-dark-css.php
 */
$dark = [
    // surfaces (les cartes restent plus claires que le fond de page, comme en mode clair)
    'background' => '#242120', 'surface' => '#242120', 'surface-bright' => '#4a4441', 'surface-dim' => '#1d1a19',
    'surface-container-lowest' => '#2e2a28', 'surface-container-low' => '#2a2725', 'surface-container' => '#34302e',
    'surface-container-high' => '#3c3735', 'surface-container-highest' => '#45403d', 'surface-variant' => '#45403d',
    'surface-tint' => '#e8a3b0',
    // textes / contours
    'on-surface' => '#f3ede8', 'on-background' => '#f3ede8', 'on-surface-variant' => '#cfc6c1',
    'outline' => '#9b918c', 'outline-variant' => '#4f4845',
    'inverse-surface' => '#f3ede8', 'inverse-on-surface' => '#242120', 'inverse-primary' => '#571d29',
    // primaire
    'primary' => '#f3dde1', 'on-primary' => '#ffffff', 'primary-container' => '#571d29', 'on-primary-container' => '#ffd9df',
    'primary-fixed' => '#ffd9df', 'primary-fixed-dim' => '#f0b9c3', 'on-primary-fixed' => '#3f1520', 'on-primary-fixed-variant' => '#e8a3b0',
    // secondaire
    'secondary' => '#d9c4a5', 'on-secondary' => '#3b2f1a', 'secondary-container' => '#4e402c', 'on-secondary-container' => '#f6dfc0',
    'secondary-fixed' => '#f6dfc0', 'secondary-fixed-dim' => '#d9c4a5', 'on-secondary-fixed' => '#251a07', 'on-secondary-fixed-variant' => '#d9c4a5',
    // tertiaire (texte clair ; fond = brun moyen, utilisé en survol de boutons)
    'tertiary' => '#e9bda7', 'on-tertiary' => '#2d1608', 'tertiary-container' => '#6e2a38', 'on-tertiary-container' => '#dfb49e',
    'tertiary-fixed' => '#ffdbca', 'tertiary-fixed-dim' => '#e9bda7', 'on-tertiary-fixed' => '#2d1608', 'on-tertiary-fixed-variant' => '#e9bda7',
    // erreur
    'error' => '#ffb4ab', 'on-error' => '#690005', 'error-container' => '#7a1410', 'on-error-container' => '#ffdad6',
];
$bgOverride = ['tertiary' => '#6e2a38', 'primary' => '#571d29']; // bg-tertiary / hover:bg-tertiary : fond, pas texte
// Couleurs utilisées à la fois en fond ET en texte : le texte garde sa propre valeur
// (ex. text-secondary-container = prix crème posés sur des photos sombres).
$textOverride = ['secondary-container' => '#f6dfc0', 'primary-container' => '#f3dde1'];

function hexToRgb(string $hex): string
{
    $h = ltrim($hex, '#');
    return hexdec(substr($h, 0, 2)) . ',' . hexdec(substr($h, 2, 2)) . ',' . hexdec(substr($h, 4, 2));
}

$rules = [];
$add = function (string $selector, string $decl) use (&$rules) { $rules[] = "html.dark $selector{{$decl}}"; };

foreach ($dark as $name => $value) {
    $bg = $bgOverride[$name] ?? $value;
    $tx = $textOverride[$name] ?? $value;
    foreach (['', 'dark\\:'] as $p) {          // classes normales et classes dark:* de Tailwind
        $add(".{$p}bg-$name", "background-color:$bg");
        $add(".{$p}text-$name", "color:$tx");
        $add(".{$p}border-$name", "border-color:$value");
    }
    $add(".hover\\:bg-$name:hover", "background-color:$bg");
    $add(".focus\\:bg-$name:focus", "background-color:$bg");
    $add(".active\\:bg-$name:active", "background-color:$bg");
    $add(".hover\\:text-$name:hover", "color:$tx");
    $add(".group:hover .group-hover\\:text-$name", "color:$tx");
    $add(".group:hover .group-hover\\:bg-$name", "background-color:$bg");
    $add(".hover\\:border-$name:hover", "border-color:$value");
    $add(".focus\\:border-$name:focus", "border-color:$value");
    $add(".ring-$name", "--tw-ring-color:$value");
    $add(".focus\\:ring-$name:focus", "--tw-ring-color:$value");
    $add(".placeholder\\:text-$name::placeholder", "color:$value");
}
// Opacités réellement utilisées sur des couleurs de la palette
foreach ([['text', 'outline', 70], ['text', 'on-surface-variant', 80], ['text', 'on-surface-variant', 70], ['border', 'outline-variant', 30]] as [$prop, $name, $pct]) {
    $rgba = 'rgba(' . hexToRgb($dark[$name]) . ',' . ($pct / 100) . ')';
    $cssProp = $prop === 'text' ? 'color' : 'border-color';
    $add(".$prop-$name\\/$pct", "$cssProp:$rgba");
}
$add('.placeholder\\:text-outline\\/70::placeholder', 'color:rgba(' . hexToRgb($dark['outline']) . ',0.7)');
// Associations de couleurs qui ne s'inversent pas proprement classe par classe
$add('.bg-primary-container.text-on-primary', 'color:#ffffff');
$add('.bg-gradient-to-t.from-surface', 'background-image:linear-gradient(to top,#242120,rgba(36,33,32,.9),rgba(36,33,32,.8))');
// Couleurs codées en dur dans les pages
$add('.bg-white\\/80', 'background-color:rgba(46,42,40,0.8)');
$add('.text-\\[\\#4b2f1f\\]', 'color:#e9bda7');
$add('.border-\\[\\#D8C3A5\\]', 'border-color:#4f4845');

$block = "/* >>> SOUCOFFE DARK THEME (généré par scripts/gen-dark-css.php — ne pas éditer à la main) >>> */\n"
    . "html.dark{color-scheme:dark}\n"
    . "html.dark body{background-color:#242120;color:#f3ede8}\n"
    . implode("\n", $rules) . "\n"
    // Composants propres à soucoffe.css
    . "html.dark .sc-empty-icon{background:#34302e;color:#9b918c}\n"
    . "html.dark .sc-heading-accent{background:#f0b9c3}\n"
    . "html.dark .sc-toast{background:#f3ede8;color:#242120}\n"
    // Le logo (images/brand/logo.png) garde son fond transparent : halo géré dans soucoffe.css
    . "/* <<< SOUCOFFE DARK THEME <<< */\n";

$cssPath = __DIR__ . '/../css/soucoffe.css';
$css = file_get_contents($cssPath);
$pattern = '#/\* >>> SOUCOFFE DARK THEME.*?/\* <<< SOUCOFFE DARK THEME <<< \*/\n?#s';
// Remplacé À SA PLACE : les règles écrites après le bloc gardent leur priorité.
if (preg_match($pattern, $css)) {
    $css = preg_replace_callback($pattern, fn() => $block, $css, 1);
    file_put_contents($cssPath, $css);
} else {
    file_put_contents($cssPath, rtrim($css) . "\n\n" . $block);
}
echo count($rules) . " règles écrites dans css/soucoffe.css\n";
