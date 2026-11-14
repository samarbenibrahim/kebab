-- Annulation client : champ orthogonal au statut (l'ENUM Nouvelle/En préparation/
-- Prête/Servie est utilisé tel quel partout : SQL, API, timeline, admin).
-- Une commande annulée garde son statut d'origine ("Nouvelle") et porte cancelled_at.
ALTER TABLE orders ADD COLUMN cancelled_at TIMESTAMP NULL AFTER paid_at;
