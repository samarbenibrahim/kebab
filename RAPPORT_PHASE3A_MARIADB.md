# SOUCOFFE — Phase 3A : sécurisation réseau de MariaDB

Date : 10 octobre 2026. Action autorisée : **A uniquement**. Aucun mot de passe ne figure dans ce document.

## Résultat

| Objectif | Statut | Preuve |
|---|---|---|
| MariaDB n'écoute plus que sur la boucle locale | **PASS** | `Get-NetTCPConnection` : `127.0.0.1:3306` seulement (avant : `0.0.0.0:3306` et `[::]:3306`) ; variable serveur `bind_address = 127.0.0.1` |
| Accès par l'adresse réseau du PC refusé | **PASS** | connexion à `192.168.100.3:3306` → `ERROR 2002 … (10061)` connexion refusée (compte applicatif et root) |
| L'application se connecte toujours | **PASS** | API 200 (catégories, produits, module intelligent) ; site 200 en local et via `192.168.100.3:8080` |
| Données intactes | **PASS** | 9 commandes / 121,400 DT, 43 produits / 272,000 DT, 10 comptes, 22 migrations ; `CHECK TABLE` OK sur 5 tables |
| Règles du pare-feu MariaDB désactivées | **WARNING — non fait** | session sans droits administrateur (`IsInRole(Administrator) = False`) : commande prête ci-dessous |

## 1. Constats avant modification (lecture seule)

- **Lancement de MariaDB** : à la main par `mariadbd.exe --console`, via `scripts/start-lan.vbs` ou `start-backend.vbs`. Ce n'est pas un service Windows.
- **Configuration lue** : `C:\Program Files\MariaDB 13.0\data\my.ini`, confirmé par `mariadbd --print-defaults`. Il n'existe aucun autre fichier de configuration.
- **Connexion de l'application** : `api/config/database.php` lit `DB_HOST` dans `.env`, qui vaut `127.0.0.1`. Aucun fichier du projet n'utilise un autre hôte.
- **Dépendances** : aucun autre logiciel de base de données sur le PC, et aucune connexion distante établie vers le port 3306 au moment de l'audit.
- **Arrêt propre possible** : le compte `root` de MariaDB est accessible sans mot de passe **depuis ce PC uniquement** (comptes `root@127.0.0.1`, `root@::1`, `root@localhost`, `root@<nom du PC>` ; aucun `root@%`). Il a servi à l'arrêt propre. **Nouveau constat** : voir §6.
- **Règles d'entrée du pare-feu concernées**, toutes actives :

| Nom affiché | Programme | Profil | Protocole |
|---|---|---|---|
| `MariaDB 13.0 (x64)` | `bin\mysqld.exe` | tous | tous |
| `mariadbd` | `bin\mariadbd.exe` | Public | TCP |
| `mariadbd` | `bin\mariadbd.exe` | Public | UDP |

Les noms techniques exacts de ces règles sont enregistrés dans la sauvegarde (`pare-feu-et-ecoute.avant.txt`).

## 2. Sauvegardes avant modification

Dossier `Downloads\soucoffe_backups\2026-10-10_phase3A-mariadb-reseau\` (nouveau, aucun dossier écrasé) :
- `my.ini.avant` : copie exacte, empreinte identique à l'original ;
- `pare-feu-et-ecoute.avant.txt` : règles et adresses d'écoute avant ;
- `soucoffe.sql` : dump complet (28 tables, « Dump completed »).

## 3. Modification appliquée

Fichier `C:\Program Files\MariaDB 13.0\data\my.ini`, section `[mysqld]` : **une ligne ajoutée**.

```
bind-address=127.0.0.1
```

Différence avec l'original (`diff`) : `3a4 > bind-address=127.0.0.1`. Les fins de ligne d'origine (CRLF) et la section `[client]` sont inchangées.

**Incident pendant la modification, corrigé avant le redémarrage** : une première écriture avait aussi inséré la ligne dans `[client]` et converti les fins de ligne. J'ai restauré le fichier depuis la copie, puis inséré la ligne uniquement dans `[mysqld]`.

**Redémarrage** : arrêt propre (`mariadb-admin shutdown`, 1 s), puis relance de la même façon que les scripts (`mariadbd.exe --console`, fenêtre masquée, 1,7 s). Coupure totale : environ 3 s.

**Incident pendant le redémarrage, sans conséquence** : une première tentative d'arrêt depuis PowerShell a échoué, l'argument de l'hôte ayant été mal découpé. Le script a quand même lancé une seconde instance de MariaDB. Elle s'est arrêtée seule, car les fichiers étaient verrouillés par l'instance active. J'ai vérifié tout de suite : une seule instance, 9 commandes, `CHECK TABLE` OK, API 200. L'arrêt propre a ensuite été refait depuis bash.

## 4. Tests réellement exécutés après modification

| # | Test | Méthode | Résultat |
|---|---|---|---|
| 1 | Adresse d'écoute | `Get-NetTCPConnection -LocalPort 3306` + `SHOW VARIABLES` | `127.0.0.1` seulement · `bind_address=127.0.0.1` |
| 2 | Accès réseau refusé | client MariaDB vers `192.168.100.3:3306` | refusé (10061) |
| 3 | Accès local | client vers `127.0.0.1`, `localhost` et l'hôte par défaut | OK (les trois) |
| 4 | Application | `curl` sur l'API et le site, en local et via l'adresse Wi-Fi | 200 partout |
| 5 | Script de sauvegarde | `scripts\sauvegarde-base.bat` | OK : 28 tables, « Dump completed » |
| 6 | Tests API | `php tests/api_test.php` sur une **base isolée** (`test_soucoffe_phase3a`, restaurée depuis la sauvegarde §2, API temporaire `127.0.0.1:8001`) | **108 réussis, 0 échoué** (code de sortie 0) |
| 7 | Module intelligent | outil de test de session, même base isolée | **82 réussis, 0 échoué** |
| 8 | Parcours local | navigateur : accueil QR → « Get Started » → connexion client (table pré-remplie) ; connexion équipe ; catalogue lu par l'API | **8/8**, aucune erreur JS |
| 9 | Aucune écriture sur la base active | compteurs (commandes, total, journal d'audit, sessions, clients) avant et après les tests 6 à 8 | identiques |
| 10 | Autres services | ports et processus | API 8000 et site 8080 inchangés ; 1 seule instance de MariaDB ; `start-lan.vbs` détecte toujours MariaDB (même test `netstat` que le script) |

Un premier lancement des tests 6 et 7 s'est arrêté net : la commande de préparation de la base isolée avait été bloquée par une protection de l'environnement, et la base n'existait pas. Aucune écriture n'a eu lieu, les compteurs de la base active étant identiques. Les tests ont été relancés correctement ensuite (lignes 6 et 7).

La base temporaire `test_soucoffe_phase3a` et l'API temporaire du port 8001 ont été supprimées après les tests. `test_soucoffe_restore`, l'ancienne copie du 2 octobre, n'a pas été touchée.

**Non testé** : une connexion depuis un **autre appareil** du Wi-Fi, que je ne peux pas piloter. Pour vérifier depuis un téléphone ou un autre PC : l'accès au port 3306 de `192.168.100.3` doit échouer, et le site sur le port 8080 doit fonctionner.

## 5. Pare-feu : commande à lancer en administrateur (non exécutée)

MariaDB n'écoutant plus sur le réseau, ces règles n'ouvrent plus rien aujourd'hui. Les désactiver reste une protection en profondeur, utile si un jour `bind-address` était retiré. **On désactive sans supprimer : réversible.**

Dans **PowerShell lancé en tant qu'administrateur** :

```powershell
# Désactive uniquement les 3 règles d'entrée de MariaDB (rien d'autre)
Get-NetFirewallApplicationFilter |
  Where-Object { $_.Program -match '\\MariaDB 13\.0\\bin\\(mariadbd|mysqld)\.exe$' } |
  Get-NetFirewallRule | Where-Object Direction -eq 'Inbound' |
  Disable-NetFirewallRule -PassThru | Select-Object DisplayName, Profile, Enabled
```

Résultat attendu : 3 lignes avec `Enabled = False`. Les règles de `php.exe`, nécessaires à l'accès par téléphone, ne sont pas concernées.

## 6. Nouveau constat (non traité : hors autorisation)

**WARNING** : le compte administrateur `root` de MariaDB n'a **pas de mot de passe**. Il n'est utilisable que depuis ce PC : aucune entrée `root@%`, et le réseau est maintenant fermé. N'importe quel programme lancé sur le PC peut cependant prendre le contrôle total de la base. À traiter avec l'action B (mots de passe), après votre accord.

## 7. Retour arrière

1. Remettre la configuration d'origine :
   ```
   copy "Downloads\soucoffe_backups\2026-10-10_phase3A-mariadb-reseau\my.ini.avant" "C:\Program Files\MariaDB 13.0\data\my.ini"
   ```
   Ou supprimer la ligne `bind-address=127.0.0.1`.
2. Arrêter MariaDB proprement (`mariadb-admin -uroot -h127.0.0.1 shutdown`, depuis l'invite de commandes ou bash), puis le relancer avec `scripts\start-lan.vbs`.
3. Si vous aviez désactivé les règles du pare-feu (§5), les réactiver en administrateur : même commande avec `Enable-NetFirewallRule`.
4. Vérifier : `Get-NetTCPConnection -LocalPort 3306` indique de nouveau `0.0.0.0`.

Aucune donnée n'est en jeu : seule la configuration réseau a changé.

## Verdict de la phase

**Action A réussie pour MariaDB** : la base n'est plus joignable depuis le réseau, et l'application fonctionne. **Il reste à désactiver les règles du pare-feu**, ce qui demande vos droits administrateur (§5).
