<?php
/**
 * Génère js/i18n/{it,en,de,es}.js depuis scripts/i18n/*.txt.
 *
 * Format (UTF-8, une ligne par texte, colonnes séparées par ||) :
 *   français || italiano || english || deutsch || español
 * Un français précédé de ~ (ex. ~Lun) est un mot court traduisible aussi à
 * l’intérieur d’un texte assemblé (sinon : 4 lettres minimum pour cela).
 * Un français précédé de @ (ex. @il y a {0} min) est une expression dont les
 * {n} sont des NOMBRES, reconnue n’importe où dans un texte (ordre des mots
 * propre à chaque langue : « 5 min fa », « 5 min ago »).
 * Lignes vides et lignes commençant par # ignorées.
 * Un texte contenant {0}, {1}… est un MODÈLE : les valeurs variables
 * (nombres, noms) sont reprises à la même place dans la traduction.
 *
 * Contrôles : 5 colonnes, aucune cellule vide, mêmes {n} dans chaque langue,
 * pas de doublon contradictoire. Le moindre problème arrête la génération.
 *
 * Usage : php scripts/i18n/build.php
 */
$dir = __DIR__;
$out = dirname($dir, 2) . '/js/i18n';
$langs = ['it' => 1, 'en' => 2, 'de' => 3, 'es' => 4];
$data = array_fill_keys(array_keys($langs), ['exact' => [], 'patterns' => [], 'short' => [], 'inline' => []]);
$seen = [];
$errors = [];
$rows = 0;

foreach (glob("$dir/*.txt") as $file) {
    foreach (file($file, FILE_IGNORE_NEW_LINES) as $n => $line) {
        $where = basename($file) . ':' . ($n + 1);
        $line = rtrim($line, "\r");
        if (trim($line) === '' || $line[0] === '#') {
            continue;
        }
        $cols = explode('||', $line);
        if (count($cols) !== 5) {
            $errors[] = "$where : " . count($cols) . " colonnes au lieu de 5 — « " . mb_substr($line, 0, 60) . " »";
            continue;
        }
        $cols = array_map(fn($c) => trim(preg_replace('/\s+/u', ' ', $c)), $cols);
        $short = str_starts_with($cols[0], '~');
        $isInline = str_starts_with($cols[0], '@');
        if ($short || $isInline) {
            $cols[0] = substr($cols[0], 1);
        }
        [$fr] = $cols;
        foreach ($cols as $i => $c) {
            if ($c === '') {
                $errors[] = "$where : cellule vide (colonne " . ($i + 1) . ")";
            }
        }
        preg_match_all('/\{\d\}/', $fr, $ph);
        $ph = $ph[0];
        sort($ph);
        foreach ($langs as $code => $i) {
            preg_match_all('/\{\d\}/', $cols[$i], $p2);
            $p2 = $p2[0];
            sort($p2);
            if ($ph !== $p2) {
                $errors[] = "$where : modèles {n} différents en $code";
            }
        }
        if (isset($seen[$fr])) {
            if ($seen[$fr][0] !== array_slice($cols, 1)) {
                $errors[] = "$where : « $fr » déjà traduit autrement ({$seen[$fr][1]})";
            }
            continue;
        }
        $seen[$fr] = [array_slice($cols, 1), $where];
        $rows++;
        foreach ($langs as $code => $i) {
            if ($isInline) {
                $data[$code]['inline'][] = [$fr, $cols[$i]];
            } elseif ($ph) {
                $data[$code]['patterns'][] = [$fr, $cols[$i]];
            } else {
                $data[$code]['exact'][$fr] = $cols[$i];
                if ($short) {
                    $data[$code]['short'][] = $fr;
                }
            }
        }
    }
}

if ($errors) {
    fwrite(STDERR, implode("\n", $errors) . "\n" . count($errors) . " erreur(s) : rien n'a été généré.\n");
    exit(1);
}
if (!is_dir($out)) {
    mkdir($out, 0755, true);
}
foreach ($data as $code => $d) {
    // Modèles les plus précis d'abord (plus de texte fixe = moins d'ambiguïté).
    usort($d['patterns'], fn($a, $b) => strlen(preg_replace('/\{\d\}/', '', $b[0])) <=> strlen(preg_replace('/\{\d\}/', '', $a[0])));
    $json = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG);
    file_put_contents("$out/$code.js", "// Généré par scripts/i18n/build.php — ne pas modifier à la main.\nwindow.__soucoffeI18n($json);\n");
    printf("%s.js : %d textes, %d modèles (%d Ko)\n", $code, count($d['exact']), count($d['patterns']), round(filesize("$out/$code.js") / 1024));
}
echo "$rows lignes traduites.\n";
