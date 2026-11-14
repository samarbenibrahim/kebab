-- Idempotence de POST /api/orders : une même clé (en-tête Idempotency-Key) ne
-- peut jamais créer deux commandes. Le hash du contenu permet de refuser la
-- réutilisation d'une clé avec une commande différente.
ALTER TABLE orders
    ADD COLUMN idempotency_key VARCHAR(64) NULL,
    ADD COLUMN idempotency_hash CHAR(64) NULL,
    ADD UNIQUE KEY uq_orders_idempotency_key (idempotency_key);
