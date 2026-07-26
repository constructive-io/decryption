-- Deploy schemas/dcrypt_vault/tables/item_tags to pg
-- requires: schemas/dcrypt_vault/tables/items
-- requires: schemas/dcrypt_vault/tables/tags

BEGIN;

CREATE TABLE dcrypt_vault.item_tags (
  item_id uuid NOT NULL REFERENCES dcrypt_vault.items (id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES dcrypt_vault.tags (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

COMMIT;
