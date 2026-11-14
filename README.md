# Kebab — restaurant intelligent

Site de commande à table pour un restaurant kebab avec sa cafétéria : les clients scannent le QR code de leur table, commandent depuis leur téléphone et suivent leur commande en direct. Le personnel (admin, serveur, caisse, cuisine) gère tout depuis ses écrans.

## Fonctions

- Menus Kebab et Café (et tout menu ajouté dans l'admin), page de choix des menus.
- Commande express à la voix ou au clavier, profil d'allergies, commande commune de la table, « Passez en menu ».
- Suivi de commande en direct, appel du serveur, demande d'addition, fidélité, promotions.
- Admin : produits (photos, choix, étiquettes « Populaire » / « Nouveau »), menus et catégories, infos du restaurant, tables, employés, statistiques.
- 5 langues : italien (par défaut), français, anglais, allemand, espagnol.
- Thème sombre par défaut (#242120, couleur principale #571D29), mode clair disponible.

## Technique

- Front : HTML/CSS/JS sans framework (Tailwind compilé en local), polices incluses.
- API : PHP 8.3 sans framework (`api/index.php`), base MariaDB.
- Fonctionne sur le Wi-Fi du restaurant : site sur le port 8080 (`scripts/lan_router.php`), API sur le port 8000.

## Installation (Windows)

1. Installer PHP 8.3 et MariaDB.
2. Créer la base, puis appliquer les migrations : `php database/migrate.php`.
3. Copier `.env.example` en `.env` et le remplir. Ce fichier n'est jamais publié.
4. Créer le compte admin : `php database/create_admin.php admin`.
5. Démarrage automatique : double-cliquer sur `scripts/ACTIVER-DEMARRAGE-AUTO.bat`.

Tests : `php tests/api_test.php`, `catalog_test.php`, `choix_groupe_test.php`, `presence_test.php`, `product_create_test.php`.
