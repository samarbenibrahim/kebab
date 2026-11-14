# SOUCOFFE — Audit avant mise en production (phase 0, lecture seule)

Date : 10 octobre 2026. Aucun fichier ni aucune donnée n'ont été modifiés pendant cette phase.
Légende : 🟢 conforme · 🟡 à améliorer · 🔴 bloquant pour la production.

## 1. Architecture constatée

- **Front** : pages HTML statiques, Tailwind chargé par CDN (compilation dans le navigateur), `css/soucoffe.css` (≈ 4 100 lignes), ~30 scripts JS sans framework.
- **API** : PHP 8.3 sans framework, `api/index.php` (routeur manuel, ~75 routes), controllers → services → repositories, `middleware/Auth.php`, `config/Permissions.php` (5 rôles, 29 permissions), module additif `api/ai/`.
- **Base** : MariaDB 13, 28 tables, migrations 000 → 021 suivies dans `schema_migrations`.
- **Serveurs** : `php -S` (serveur de développement PHP) pour l'API (port 8000) et pour le site (port 8080, via `scripts/lan_router.php`). Pas de HTTPS. Démarrage manuel (`scripts/start-lan.vbs`).

## 2. Sécurité

| Point | Statut | Constat |
|---|---|---|
| Identifiants de base de données | 🔴 | En clair dans `api/config/database.php` **et** dans `scripts/sauvegarde-base.bat`. |
| CORS | 🟡 | `Access-Control-Allow-Origin: *`. L'authentification passe par un en-tête (`X-Auth-Token`), pas par un cookie : un site tiers ne peut donc pas agir au nom d'un utilisateur. Le domaine de production est inconnu : **voir §8, information requise**. |
| Mots de passe | 🟢 | `password_hash` / `password_verify` (bcrypt), comparaison à temps constant même pour un compte inexistant (hash factice). |
| Jetons de session | 🟢 | 64 caractères aléatoires (`random_bytes`), seul le hash SHA-256 est stocké, expiration 12 h, déconnexion = suppression de la session. |
| Stockage des jetons côté navigateur | 🟡 | `localStorage` : lisible par un script injecté (XSS). Aucune XSS trouvée (voir ci-dessous) ; proposition de migration en §7. |
| Autorisations | 🟢 | Vérifiées **côté serveur** sur chaque route sensible (`Auth::require`, `requirePermission`). À couvrir par des tests automatisés (prévu). |
| Injection SQL | 🟢 | Requêtes préparées partout ; les seuls fragments insérés dans le SQL sont des entiers convertis ou des listes de `?`. |
| XSS | 🟢 | Test réel : charge `<img onerror>` dans les notes de commande et d'article, affichée sur 9 écrans (admin commandes / tableau de bord / historique / tables, cuisine, caisse, serveur, suivi, panier) → **aucune exécution**, le texte est échappé. Les noms, messages et motifs refusent déjà `<` et `>` côté serveur. |
| CSRF | 🟢 | Non applicable : pas de cookie d'authentification, le jeton est envoyé explicitement par le script. |
| Force brute (connexion équipe) | 🟢 | Verrouillage du compte après plusieurs échecs (HTTP 429) + journal d'audit. |
| Limitation de débit (autres routes) | 🟡 | Aucune limite sur `POST /clients` et `POST /orders`. Une limite par adresse IP est risquée dans un café (tous les clients du Wi-Fi peuvent partager la même IP publique) : à décider avec vous. |
| En-têtes de sécurité | 🟡 | Aucun (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`…). |
| Fuite d'erreurs | 🟢 | `display_errors = 0`, gestionnaire global → message générique 500, détail dans le journal PHP. |
| Journalisation | 🟡 | Journal d'audit métier complet en base ; erreurs techniques seulement dans le journal PHP non structuré. |
| Fichiers exposés | 🟢 | Le routeur du site refuse `api/`, `database/`, `scripts/`, les fichiers cachés et `.php/.sql/.vbs/.sh`. |
| Envoi de fichiers | 🟢 | Aucun téléversement de fichier dans l'application. |
| HTTPS | 🔴 | Absent. Indispensable avant toute mise en ligne. |
| Serveur PHP intégré | 🔴 | `php -S` n'est pas prévu pour la production (une requête à la fois, pas de HTTPS). Il faut Apache ou Nginx + PHP-FPM. |

## 3. Commandes et argent

À confirmer par les tests automatisés : le serveur recalcule les prix depuis la base, applique les promotions et la fidélité, vérifie produits, options et quantités, refuse les transitions de statut invalides, et rejoue une commande dupliquée grâce à la clé d'idempotence. Aucune modification de règle métier n'est prévue sauf bug prouvé.

## 4. Base de données

| Point | Statut |
|---|---|
| Clés primaires et étrangères | 🟢 27 relations déclarées |
| Index | 🟢 migration 021 (index de performance) mesurée sur 200 000 commandes |
| Transactions | 🟢 création de commande, paiements, recettes de stock |
| Sauvegarde / restauration | 🟢 script `sauvegarde-base.bat` + restauration testée le 2 octobre |

## 5. Performance

| Point | Statut | Constat |
|---|---|---|
| Temps de réponse | 🟢 | 13 à 40 ms pour les routes rafraîchies en boucle. |
| Rafraîchissement automatique | 🟢 | 4 à 10 s selon l'écran ; environ 6 requêtes / 5 s par écran admin ≈ moins de 5 % du temps du serveur. Pas de passage à SSE/WebSocket justifié aujourd'hui. |
| Tailwind par CDN | 🟡 | Compilation dans le navigateur et dépendance à Internet. Passage à un CSS compilé possible, mais il faut télécharger l'outil Tailwind : **à approuver**. |

## 6. Tests

🔴 Aucun test automatisé dans le projet (seulement des bancs d'essai dans un dossier temporaire). À créer : `tests/`.

## 7. Proposition : jetons hors de `localStorage` (non appliquée)

- **Actuel** : jeton dans `localStorage`, envoyé en en-tête.
- **Risque** : seulement si une faille XSS apparaît un jour (aucune aujourd'hui).
- **Cible** : cookie `HttpOnly; Secure; SameSite=Strict` posé par l'API.
- **Changements requis** : API (pose et lecture du cookie, protection CSRF à ajouter), `js/auth.js`, CORS avec domaine précis (incompatible avec `*`), HTTPS obligatoire (`Secure`).
- **Risques** : déconnexion de toutes les sessions en cours, fonctionnement en `file://` et sur le Wi-Fi local à adapter.
- **Conclusion** : à faire **au moment de la mise en ligne en HTTPS**, pas avant.

## 8. Informations requises de votre part

1. **Domaine de production** (ex. `https://soucoffe.tn`) : nécessaire pour restreindre CORS. Sans lui, je ne change pas CORS.
2. **Hébergeur** : nécessaire pour remplacer `php -S` et mettre en place HTTPS.
3. **Accord pour télécharger l'outil Tailwind** (≈ 40 Mo) si vous voulez supprimer la dépendance au CDN.
4. **Changement du mot de passe de la base** : il est en clair dans le code depuis le début. Je recommande de le changer ; je ne le fais pas sans votre accord.

## 9. Plan des modifications (une à la fois, testée, sauvegardée)

1. Configuration de la base par variables d'environnement (`.env`), plus aucun mot de passe dans le code.
2. En-têtes de sécurité HTTP.
3. Journalisation structurée des erreurs et des refus d'accès.
4. Suite de tests automatisés (`tests/`) : authentification, rôles, commandes, produits, tables, à emporter, stock, analytique.

---

# Rapport final — phase 1 (10 octobre 2026)

## Résumé

Modifications faites une par une, chacune sauvegardée puis testée. Aucune page, couleur ni mise en page modifiée (audit visuel de 102 écrans identique à la référence). **Le projet n'est pas encore prêt pour la production** : 3 points bloquants dépendent de l'hébergement (voir « Restant »).

## Modifications

| # | Changement | Fichiers | Test |
|---|---|---|---|
| 1 | 🔴→🟢 **Fuite de fichiers** : le site servait le CV (PDF, Word), les archives `.zip` et les rapports `.md` à tout le Wi-Fi. Liste blanche des types de fichiers. | `scripts/lan_router.php` | CV, zip, md, `.env` → 403 ; pages, CSS, JS, images, vidéos → 200 |
| 2 | 🔴→🟢 **Mot de passe de la base retiré du code**, lu depuis `.env` (hors du site). | `api/config/env.php` (nouveau), `api/config/database.php`, `scripts/sauvegarde-base.bat`, `.env` (local), `.env.example`, `.gitignore` | API 200 ; sans `.env` → 500 générique, détail au journal ; sauvegarde OK (28 tables) |
| 3 | 🟡→🟢 **En-têtes de sécurité** sur l'API (`nosniff`, `X-Frame-Options`, `no-referrer`, `no-store`) et sur le site. | `api/middleware/Cors.php`, `scripts/lan_router.php` | présents sur l'API ; sur le site, le serveur de développement ne les applique qu'aux réponses du routeur (à configurer sur le serveur de production) |
| 4 | 🟡→🟢 **Journal technique structuré** (JSON) : refus 401/403/429 et erreurs 500, sans jeton ni mot de passe. | `api/helpers/Logger.php` (nouveau), `api/helpers/JsonResponse.php`, `api/exception/GlobalExceptionHandler.php`, `api/index.php` → `api/logs/api-AAAA-MM-JJ.log` | 401 et 500 tracés, aucun jeton dans le journal |
| 5 | 🐞 **Bug stock** : une livraison saisie dans la même seconde que l'inventaire était ignorée. | `api/ai/StockService.php` | test « 4 L + 10 L = 14 L » |
| 6 | 🐞 **Bug analyses** : une commande de la seconde en cours n'était pas comptée. | `api/ai/AnalyticsService.php` | test « nombre de commandes = base » |
| 7 | 🔴→🟢 **Tests automatisés** dans le projet. | `tests/api_test.php` (nouveau) | 108/108 |

Aucune nouvelle migration de base dans cette phase.

## Tests exécutés

| Suite | Résultat |
|---|---|
| `php tests/api_test.php` — authentification, matrice des 6 rôles sur 17 routes, commandes (prix imposés par le client ignorés, options, quantités, idempotence, transitions, annulation, paiement), produits, tables, à emporter, stock, analytique, erreurs, intégrité | **108/108**, deux passages identiques |
| Module intelligent (82 vérifications) | 82/82 |
| Parcours client complet dans le navigateur | 34/34 |
| En-tête mobile 320 → 1024 px | 32/32 |
| Audit visuel 102 écrans (client + équipe, 5 formats) | 0 erreur, 0 chevauchement — identique à la référence |
| Test XSS réel sur 9 écrans | aucune exécution |

## Checklist production

| Point | Statut |
|---|---|
| Secrets hors du code | 🟢 |
| Identifiants de base sécurisés | 🟡 en `.env` ; **mot de passe à changer** (il a été dans le code) |
| CORS contrôlé | 🟡 `*` — en attente du domaine de production |
| Authentification / mots de passe / autorisations | 🟢 testés |
| Validation API, SQL injection, XSS, CSRF | 🟢 |
| Limitation de débit | 🟡 connexion équipe seulement |
| En-têtes de sécurité | 🟡 API oui ; site à configurer sur le serveur de production |
| Fuite d'erreurs | 🟢 |
| Tests automatisés | 🟢 |
| Sauvegarde / restauration | 🟢 |
| Design préservé, responsive | 🟢 |
| HTTPS | 🔴 |
| Serveur de production (Apache/Nginx + PHP-FPM) | 🔴 |
| Démarrage automatique / supervision | 🔴 |

## Restant (par priorité)

1. 🔴 Hébergement avec HTTPS et vrai serveur web (remplace `php -S`).
2. 🔴 Changer le mot de passe MariaDB, puis mettre à jour `.env`.
3. 🟡 CORS : liste blanche avec le domaine final.
4. 🟡 Jetons : passage en cookie `HttpOnly` au moment du HTTPS (proposition §7).
5. 🟡 Tailwind compilé (supprime la dépendance au CDN).
6. 🟡 Limitation de débit sur l'identification client et la création de commande (seuils à définir avec vous).

## Retour arrière

Sauvegarde complète avant la phase : `Downloads/soucoffe_backups/2026-10-10_avant-production/` (`code.tar`, `soucoffe.sql`, copies individuelles des fichiers modifiés). Restaurer un fichier = recopier sa version sauvegardée. Aucune donnée n'a été modifiée en base hors données de test supprimées.
