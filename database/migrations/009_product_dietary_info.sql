-- Informations allergènes / nutritionnelles (valeurs indicatives, catalogue de démonstration).
-- allergens : liste séparée par des virgules ; NULL = non renseigné, '' = aucun allergène déclaré.
-- dietary_tags : végétarien / végan / sans-gluten (liste séparée par des virgules).
ALTER TABLE products
    ADD COLUMN allergens VARCHAR(255) NULL,
    ADD COLUMN calories SMALLINT UNSIGNED NULL,
    ADD COLUMN dietary_tags VARCHAR(255) NULL;
