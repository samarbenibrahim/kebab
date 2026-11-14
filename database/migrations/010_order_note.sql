-- Note de commande (précision valable pour toute la commande, en plus des
-- commentaires par article déjà stockés dans order_items.note).
ALTER TABLE orders ADD COLUMN note VARCHAR(255) NULL AFTER party_size;
