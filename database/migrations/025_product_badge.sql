-- Étiquette d'un produit (« popular » = Populaire, « new » = Nouveau), choisie dans l'admin.
-- Avant : enregistrée seulement dans le navigateur de l'admin, invisible pour les clients.
-- Ajout uniquement : une colonne nullable, vide par défaut. Aucun produit, prix ou commande modifié.
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge VARCHAR(16) NULL DEFAULT NULL AFTER dietary_tags;
