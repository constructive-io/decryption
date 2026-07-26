-- Deploy schemas/dcrypt_vault/tables/urls to pg
-- requires: schemas/dcrypt_vault/tables/items

BEGIN;

CREATE TABLE dcrypt_vault.urls (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id uuid NOT NULL REFERENCES dcrypt_vault.items (id) ON DELETE CASCADE,
  url text NOT NULL,
  UNIQUE (item_id, url)
);

COMMENT ON TABLE dcrypt_vault.urls IS 'Match URLs for login items; searchable, never encrypted';

COMMIT;
