-- Suivi de paiement simulé (pas de vrai prestataire de paiement configuré) :
-- 1:1 avec la commande, pas de paiement partiel/remboursement demandé, donc
-- des colonnes directement sur orders plutôt qu'une table séparée.
ALTER TABLE orders
    ADD COLUMN payment_method ENUM('online','cash') NULL AFTER status,
    ADD COLUMN payment_status ENUM('pending','paid') NOT NULL DEFAULT 'pending' AFTER payment_method,
    ADD COLUMN paid_at TIMESTAMP NULL AFTER payment_status;
