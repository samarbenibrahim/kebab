# SOUCOFFE — Phase 2 : audit de préparation à la production

Date : 10 octobre 2026. **Audit et rapport uniquement** : aucune modification du code applicatif, de la base active, de la configuration réseau ou du système. Aucun secret n'est reproduit dans ce document.

Statuts : **PASS** · **WARNING** · **BLOCKER**.

---

## 1. Synthèse

| Domaine | Statut |
|---|---|
| Secrets hors du code du projet | PASS |
| Secrets dans les sauvegardes et fichiers de test hors projet | WARNING |
| Fichiers sensibles inaccessibles par HTTP | PASS |
| Erreurs API sans fuite technique | PASS |
| Journaux sans secret ni jeton | PASS |
| Sauvegarde lisible et restaurable | PASS (code sans images/vidéos : WARNING) |
| Tests API (base isolée) | PASS 108/108 |
| Tests module intelligent (base isolée) | PASS 82/82 |
| Tests navigateur (parcours, responsive, design) | Non relancés (voir §4.3) ; derniers résultats toujours valables |
| Intégrité de la base active | PASS |
| **Exposition réseau de la base de données** | **BLOCKER** |
| HTTPS, serveur de production, redémarrage auto | BLOCKER (hors périmètre local) |
| CORS | WARNING (domaine inexistant) |

**Verdict : LOCAL TESTING OK — NOT READY FOR PRODUCTION.** « READY FOR STAGING » n'est pas atteint : aucun environnement de staging n'existe, et la base de données est exposée sur le réseau local.

---

## 2. Vérifications effectuées et commandes

Toutes les commandes lisant la base ont utilisé un fichier d'identifiants temporaire généré depuis `.env` (jamais affiché), supprimé en fin d'audit.

### 2.1 Fichiers et secrets

| Vérification | Méthode | Résultat | Statut |
|---|---|---|---|
| Dépôt Git | `git rev-parse` | Le projet n'est **pas** un dépôt Git : aucun historique à purger, mais aucun suivi de version non plus. | WARNING |
| `.env` présent, clés attendues | lecture des noms de clés seulement | `DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD` | PASS |
| `.env.example` | lecture | uniquement des valeurs vides | PASS |
| `.gitignore` | lecture | ignore `.env`, `api/logs/`, `*.log` | PASS |
| Mot de passe de la base dans le projet | recherche de la valeur réelle (non affichée) dans tous les fichiers | présent **uniquement** dans `.env` | PASS |
| … dans les sauvegardes | même recherche | 3 fichiers de `soucoffe_backups/2026-10-10_avant-production/` (`api/config/database.php`, `scripts/sauvegarde-base.bat`, `code.tar`) : copies **d'avant** le correctif | WARNING |
| … dans les fichiers de test temporaires | même recherche | 3 fichiers du dossier temporaire de session de l'assistant (hors projet) | WARNING |
| … dans les journaux | même recherche | 0 | PASS |
| Jetons (64 hex) dans les journaux | `grep -E '[0-9a-f]{64}'` | 0 | PASS |
| Configuration Apache/Nginx, `.htaccess` | recherche de fichiers | aucune (serveur intégré PHP) | WARNING (à créer pour la production) |
| Cookies | recherche `setcookie` | aucun cookie posé par l'API | PASS |

### 2.2 Exposition HTTP (site port 8080, API port 8000)

`curl` sur 25 chemins, dont des variantes d'encodage (`..%2f.env`, `%2e%65%6e%76`, `//.env`, `/./.env`) :

| Cible | Site 8080 | API 8000 |
|---|---|---|
| `.env`, `.env.example`, `.gitignore` | 403 | 404 |
| Rapports `.md`, CV `.pdf` / `.docx`, archives `.zip` | 403 | 404 |
| `api/logs/`, `api/config/*.php`, `database/*.sql`, `scripts/*.bat`, `tests/*.php` | 403 | 404 |
| `//.env`, `///.env` | 302 vers l'accueil, corps vide | 404 |
| Pages, CSS, images | 200 | — |

**PASS.** Remarque : les fichiers sources bruts à la racine (`logo soucoffe.png`, `hero video.mp4`, `acceuil image.png`…) restent téléchargeables. Ils ne sont pas sensibles, mais ne sont pas utilisés par le site (WARNING mineur).

### 2.3 Erreurs de l'API

15 requêtes invalides (identifiant non numérique ou géant, injection dans l'URL, JSON cassé, types incorrects, période invalide, méthode inconnue, préflight CORS). Recherche dans chaque réponse de `SQLSTATE`, `stack`, `.php`, chemins Windows, `PDO`, `mysql`, `Exception`, numéros de ligne : **0 occurrence**. Codes : 400, 401, 404, 204 selon le cas. **PASS.**

Sans `.env`, l'API répond `500 « Erreur interne du serveur »` ; le détail ne va qu'au journal (constaté en phase 1, journal relu aujourd'hui). **PASS.**

### 2.4 Journaux

`api/logs/api-2026-10-10.log` : 370 lignes JSON. Aucun jeton, aucune valeur de mot de passe ; la seule occurrence de « password » est le **nom** de la variable `DB_PASSWORD` dans un message d'erreur de configuration. **PASS.** Le dossier est inaccessible par HTTP (§2.2). Pas de rotation des journaux (WARNING).

### 2.5 Exposition réseau (lecture seule)

| Élément | Constat |
|---|---|
| MariaDB (3306) | écoute sur **toutes les interfaces** (IPv4 et IPv6) |
| API (8000) et site (8080) | écoutent sur toutes les interfaces (voulu, pour l'accès par téléphone) |
| Profil réseau Windows du Wi-Fi | **Public** |
| Pare-feu Windows | règles entrantes **Autoriser** pour `mariadbd.exe` (profil Public), `mysqld.exe` (tous profils) et `php.exe` (profil Public) |

**BLOCKER : la base de données est joignable par tout appareil du même réseau Wi-Fi**, protégée par son seul mot de passe, qui a figuré en clair dans le code. Rien ne montre une exposition sur Internet (cela dépendrait d'une redirection de port sur la box, non vérifiable d'ici), mais un réseau Wi-Fi de café est partagé. Conformément à vos conditions d'arrêt, **aucune correction n'a été faite** : voir §6, action A.

### 2.6 Sauvegarde

| Vérification | Résultat | Statut |
|---|---|---|
| Présence | `code.tar` (1,68 Mo, 164 entrées), `soucoffe.sql` (133 Ko), copies individuelles des fichiers modifiés | PASS |
| Lisibilité de l'archive | `tar -t` sans erreur ; fichiers clés présents (`api/index.php`, `css/soucoffe.css`, `home/home.html`, migration 021…) | PASS |
| Contenu de l'archive | **images, vidéos, `.zip`, `.pdf`, `.docx` exclus** : la sauvegarde du code ne permet pas de reconstruire le site seul | WARNING |
| Dump SQL | en-tête et pied « Dump completed » ; 28 `CREATE TABLE` ; données de `orders`, `products`, `staff`, `clients`, `schema_migrations` | PASS |
| Restauration isolée | dans une base temporaire `test_soucoffe_phase2` : 28 tables, 22 migrations (jusqu'à 021), 43 produits (total des prix identique à la base active), 30 clés étrangères ; base supprimée après les tests | PASS |
| Contenu métier | la sauvegarde contient 1 commande de test (#195) et 1 compte de test, créés juste avant elle (supprimés depuis de la base active) | WARNING (à savoir en cas de restauration) |
| Script de restauration | aucun script dédié ; procédure manuelle documentée en phase 1 | WARNING |

---

## 3. Contrôles de sécurité métier

Vérifiés par les tests exécutés aujourd'hui (§4) sur la base isolée.

| Contrôle | Résultat |
|---|---|
| Rôles vérifiés côté serveur | matrice 6 rôles × 17 routes, dont 5 écritures sur des données réelles avec un corps invalide → PASS |
| Prix et totaux recalculés côté serveur | prix, total et remise imposés par le client ignorés ; total en base = calcul serveur ; options facturées selon la base → PASS |
| Commandes répétées | même clé d'idempotence → même commande (200, `Idempotent-Replayed`) ; même clé, contenu différent → 409 → PASS |
| Validation des entrées | quantités 0, -1, 51, 1.5, "2" → 400 ; produit inexistant → 404 ; option d'un autre produit → 400 ; `<` `>` refusés dans les noms et messages → PASS |
| Échappement à l'affichage | test d'injection réel sur 9 écrans en phase 1 : aucune exécution → PASS (non relancé, code inchangé) |
| Stock | quantités négatives ou nulles refusées ; seuil → « Risque de rupture » ; le stock enregistré n'est jamais modifié automatiquement → PASS |

**Limites de couverture (honnêtement) :**
- **Non couverts** : paiement en ligne réel (il est simulé), envoi simultané de commandes en parallèle (concurrence), fidélité (gain et utilisation de points), promotions appliquées à une commande, appels serveur, changements de table, journal d'audit, exports de rapport.
- **Faille XSS** : le test vérifie les notes de commande ; il ne parcourt pas automatiquement chaque `innerHTML` (environ 160 occurrences).
- **Tests navigateur** : non relancés aujourd'hui (voir §4.3).
- **Conclusion** : le fait que les tests réussissent **ne prouve pas l'absence de faille**.

---

## 4. Tests exécutés

### 4.1 Isolation

Une API temporaire a été lancée sur `127.0.0.1:8001` (accès limité à ce PC) avec la variable `DB_NAME` pointant vers la base restaurée `test_soucoffe_phase2`. L'isolation a été vérifiée avant le lancement : `SELECT DATABASE()` renvoyait la base de test.

État de la base active **avant / après** les tests :

| Commandes | Total des commandes | Lignes du journal d'audit | Comptes |
|---|---|---|---|
| 9 / 9 | 121,400 / 121,400 DT | 594 / 594 | 10 / 10 |

Aucune écriture sur la base active.

### 4.2 Résultats

| Suite | Commande | Résultat | Comparaison phase 1 |
|---|---|---|---|
| API métier | `DB_NAME=<base isolée> php tests/api_test.php http://127.0.0.1:8001/api` | **108 réussis, 0 échoué**, code de sortie 0, 9,2 s | identique (108/108) |
| Module intelligent | outil de test de session (hors projet), pointé sur 8001 et la base isolée | **82 réussis, 0 échoué** | identique (82/82) |

### 4.3 Tests navigateur : non relancés

Les pages appellent toujours l'API active (`127.0.0.1:8000`, adresse calculée par `js/auth.js`). Le parcours client crée une vraie commande. Les isoler demanderait de modifier le code, ce qui n'est pas autorisé dans cette phase. Ils n'ont donc **pas** été relancés.

**Validité des résultats précédents** : aucun fichier du site n'a été modifié depuis leur dernier passage (10/10/2026 09:44), ce que montre `find -newer` (journaux, rapports et tests exclus). Ces résultats étaient : parcours client **34/34**, en-tête mobile **32/32**, audit visuel de **102 écrans** sans erreur ni chevauchement.

### 4.4 Cohérence de la base active (lecture seule)

| Contrôle | Résultat |
|---|---|
| Migrations appliquées / fichiers | 22 / 22 |
| Lignes ou options orphelines | 0 / 0 |
| Sous-total ≠ somme des lignes | 0 |
| Total ≠ sous-total − remises | 0 |
| Total de ligne ≠ prix unitaire × quantité | 0 |
| Prix unitaire ≠ prix de base + options | 0 |
| Commandes payées sans date / annulées et payées | 0 / 0 |
| Clés d'idempotence en double | 0 |
| Prix ≤ 0, mouvements de stock négatifs | 0 / 0 |
| Moteur InnoDB (transactions, clés étrangères) | 28 / 28 tables |
| `CHECK TABLE` (8 tables principales) | OK |

**PASS.** Note : un premier contrôle a signalé 7 écarts ; c'était ma formule, qui comptait les options deux fois. Le prix unitaire enregistré inclut déjà les options. Corrigé dans le contrôle, pas dans les données.

---

## 5. Problèmes restants

| Gravité | Problème | Fichiers / éléments concernés |
|---|---|---|
| **BLOCKER** | Base de données accessible depuis le réseau Wi-Fi (écoute sur toutes les interfaces + pare-feu ouvert sur le profil Public) | configuration MariaDB (`my.ini`), règles du pare-feu Windows |
| **BLOCKER** | Mot de passe de la base resté longtemps en clair dans le code : à considérer comme compromis | `.env` ; compte MariaDB de l'application |
| **BLOCKER** | Pas de HTTPS | futur serveur |
| **BLOCKER** | Serveur de développement `php -S` (une requête à la fois, en-têtes non appliqués aux fichiers statiques) | `scripts/start-lan.vbs`, `scripts/lan_router.php` |
| **BLOCKER** | Pas de redémarrage automatique ni de supervision | — |
| WARNING | CORS ouvert (`*`) : domaine inexistant | `api/middleware/Cors.php` |
| WARNING | Jetons de session dans `localStorage` | `js/auth.js`, `api/middleware/Auth.php` |
| WARNING | Tailwind compilé dans le navigateur (CDN) sur 12 pages sur 14 ; polices Google | 12 pages HTML |
| WARNING | Pas de limitation de débit sur l'identification client ni sur la création de commande | `api/index.php`, services |
| WARNING | Sauvegardes : contiennent l'ancien mot de passe ; images et vidéos non sauvegardées ; aucun script de restauration ni sauvegarde automatique | `soucoffe_backups/`, `scripts/sauvegarde-base.bat` |
| WARNING | Pas de dépôt Git (aucun historique, retour arrière manuel) | projet |
| WARNING | Journaux sans rotation | `api/logs/` |
| WARNING | Base `test_soucoffe_restore` (copie du 2 octobre) toujours présente dans MariaDB | MariaDB |
| WARNING | Fichiers de test de l'assistant contenant l'ancien mot de passe dans le dossier temporaire Windows | `%TEMP%\claude\…\scratchpad` |

---

## 6. Plan de préparation production (rien n'est appliqué)

Chaque action demande votre accord. Ordre recommandé : A → B → K, puis le reste une fois l'hébergeur choisi.

### A. Fermer l'accès réseau à la base de données (prioritaire, faisable dès maintenant en local)
- **Prérequis** : votre accord ; une fenêtre de quelques minutes sans service.
- **Fichiers et éléments** : `my.ini` de MariaDB (`bind-address=127.0.0.1`), règles du pare-feu « mariadbd » et « MariaDB 13.0 (x64) » (désactiver plutôt que supprimer).
- **Risques** : MariaDB ne redémarre pas si le fichier est mal édité. L'API locale n'est pas touchée : elle se connecte déjà via `127.0.0.1`.
- **Validation** : `Get-NetTCPConnection -LocalPort 3306` montre uniquement `127.0.0.1` ; connexion depuis le téléphone refusée ; `php tests/api_test.php` à 108/108.
- **Retour arrière** : copie de `my.ini` avant modification, réactivation des règles du pare-feu.
- **Option complémentaire** : passer le profil du Wi-Fi en « Privé » si c'est votre réseau.

### B. Renouveler le mot de passe de la base
- **Prérequis** : A fait ; accord ; un compte MariaDB administrateur (root).
- **Fichiers** : `.env` uniquement (le code lit déjà `.env`).
- **Étapes** :
  1. Faire une sauvegarde.
  2. `ALTER USER 'soucoffe_app'@'localhost' IDENTIFIED BY '<nouveau>'`.
  3. Mettre à jour `.env`.
  4. Redémarrer l'API.
- **Risque** : interruption si `.env` et la base ne correspondent pas.
- **Validation** : l'API répond 200, `tests/api_test.php` à 108/108, `sauvegarde-base.bat` réussit.
- **Retour arrière** : remettre l'ancien mot de passe dans `.env` et dans MariaDB (à noter dans un gestionnaire de mots de passe, jamais dans un fichier du projet).
- **Ensuite** : supprimer ou chiffrer les anciennes sauvegardes qui le contiennent, après avoir créé une nouvelle sauvegarde valide.

### C. Serveur web de production (Apache ou Nginx + PHP-FPM)
- **Prérequis** : hébergeur choisi (VPS Linux recommandé).
- **Fichiers à créer** : configuration de site Nginx ou `.htaccess` Apache reprenant les règles de `lan_router.php` :
  - racine publique ;
  - refus de `api/` hors front-controller, de `database/`, `scripts/`, `tests/` et des fichiers cachés ;
  - liste blanche des extensions ;
  - en-têtes de sécurité ;
  - prise en charge des vidéos (Range).
- **Risque** : règles de réécriture incorrectes (404, ou fichiers exposés).
- **Validation** : rejouer la batterie HTTP du §2.2 et les 3 suites de tests sur le staging.
- **Retour arrière** : configuration versionnée, rechargement de la version précédente.

### D. HTTPS
- **Prérequis** : nom de domaine pointant vers le serveur.
- **Méthode** : certificat Let's Encrypt (certbot), redirection HTTP → HTTPS, puis HSTS seulement après une semaine sans incident.
- **Risque** : site inaccessible si le certificat expire. Le renouvellement automatique est à vérifier (`certbot renew --dry-run`).
- **Validation** : SSL Labs note A ; pas de contenu mixte.
- **Retour arrière** : retirer la redirection et HSTS, garder HTTP le temps de corriger.

### E. CORS
- **Prérequis** : domaine(s) définitif(s). Liste réelle des origines : le site lui-même. Si le site et l'API partagent le même domaine, CORS devient inutile.
- **Fichier** : `api/middleware/Cors.php`, avec la liste lue dans `.env` (`CORS_ALLOWED_ORIGINS`).
- **Risque** : site bloqué si l'origine est mal écrite.
- **Validation** : appel depuis l'origine autorisée → OK, depuis une autre origine → bloqué par le navigateur ; tests navigateur verts.
- **Retour arrière** : remettre la valeur précédente dans `.env`.

### F. Tailwind compilé localement
- **Prérequis** : accord pour télécharger le binaire autonome de Tailwind (CLI v3, même version majeure que le CDN ; environ 40 Mo).
- **Fichiers** : `tailwind.config.js` (fusion des 12 configurations en ligne, identiques à la famille de polices près), un fichier `css/tailwind.build.css` généré ; dans les 12 pages, la balise CDN remplacée par un `<link>`.
- **Risque** : classes générées dynamiquement en JavaScript non détectées → styles manquants.
- **Validation** : captures avant/après des 102 écrans et comparaison pixel par pixel ; audit responsive identique.
- **Retour arrière** : remettre la balise CDN (une ligne par page).

### G. Redémarrage automatique
- **Sur le futur serveur** : services systemd (`php-fpm`, `nginx`, `mariadb`) en mode `enabled` ; supervision externe (ping HTTP toutes les 5 minutes).
- **Sur ce PC** : une tâche planifiée avait été refusée par le passé. Rien n'est fait sans votre accord explicite.
- **Validation** : redémarrer le serveur et vérifier que le site répond.

### H. Sauvegardes automatiques et restauration
- **Méthode** :
  - `mariadb-dump` quotidien (tâche cron) vers un dossier hors du site ;
  - rotation sur 30 jours ;
  - copie hors du serveur (stockage externe) ;
  - archive complète du site **avec** images et vidéos ;
  - script `restore-test` qui restaure dans une base temporaire et compte les tables et les lignes (comme au §2.6).
- **Validation** : un test de restauration mensuel, avec son rapport.
- **Retour arrière** : sans objet (ajout uniquement).

### I. Limiter les abus sans bloquer un Wi-Fi partagé
- **Principe** : limiter par **session client** et par **table**, pas seulement par adresse IP.
  - **Identification client** : au plus N nouvelles sessions par table et par 10 minutes. Une limite par IP très large ne sert que contre les robots, par exemple 200 par heure.
  - **Commandes** : au plus N commandes par session et par 5 minutes.
  - **Connexion de l'équipe** : verrouillage déjà en place.
- **Fichiers** : nouvelle table de compteurs (migration additive), vérification dans les services concernés.
- **Risque** : seuils trop bas qui bloquent de vrais clients ; à définir avec vous, et d'abord en mode « journaliser seulement ».
- **Validation** : tests automatisés des seuils ; une semaine en mode journal.
- **Retour arrière** : interrupteur dans `.env`.

### J. Journaux, surveillance et retour arrière
- **Journaux** : rotation quotidienne (logrotate), conservation de 30 jours, alerte au-delà de N erreurs 500 par heure.
- **Surveillance** : disponibilité, espace disque, âge de la dernière sauvegarde.
- **Versions** : initialiser un dépôt Git (avec `.gitignore` déjà prêt) **avant** toute mise en ligne ; une version étiquetée par déploiement ; retour arrière = redéployer l'étiquette précédente + migrations uniquement additives.

### K. Environnement de staging
- **Prérequis** : C et D.
- **Contenu** :
  - même configuration que la production ;
  - base séparée, alimentée par une **copie anonymisée** (noms et téléphones des clients remplacés) ;
  - `.env` propre ;
  - accès restreint (mot de passe HTTP ou liste d'adresses IP).
- **Validation** : les 3 suites de tests, la batterie HTTP et l'audit visuel, tous verts sur le staging avant chaque mise en production.

---

## 7. Étapes nécessitant votre autorisation

1. **A** : fermer l'accès réseau à MariaDB (`my.ini` + pare-feu). Recommandé immédiatement.
2. **B** : changer le mot de passe de la base.
3. Suppression des anciennes sauvegardes qui contiennent l'ancien mot de passe, **après** création d'une nouvelle sauvegarde valide.
4. Suppression de la base `test_soucoffe_restore` (copie du 2 octobre) et des fichiers de test temporaires de l'assistant.
5. Ajouter les images et vidéos à la sauvegarde du code.
6. Initialiser un dépôt Git.
7. **F** : télécharger l'outil Tailwind.
8. **I** : seuils de limitation de débit.
9. **C, D, E, G, H, J, K** : après le choix d'un hébergeur et d'un domaine.

---

## Verdict

**LOCAL TESTING OK** — les tests API (108/108) et du module intelligent (82/82) passent sur une base isolée, la base active est cohérente et n'a pas été modifiée, et la sauvegarde est restaurable.

**NOT READY FOR PRODUCTION** — 5 points bloquants : la base de données est exposée sur le réseau local, le mot de passe est compromis, il n'y a pas de HTTPS, le serveur est un serveur de développement, et rien ne redémarre automatiquement.

**READY FOR STAGING : non** — aucun environnement de staging n'existe, et le point bloquant d'exposition de la base doit être levé avant.
