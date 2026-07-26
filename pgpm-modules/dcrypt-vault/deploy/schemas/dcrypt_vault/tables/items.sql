-- Deploy schemas/dcrypt_vault/tables/items to pg
-- requires: schemas/dcrypt_vault/types
-- requires: schemas/dcrypt_vault/tables/folders

BEGIN;

CREATE TABLE dcrypt_vault.items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind dcrypt_vault.item_kind NOT NULL,
  title text NOT NULL,
  folder_id uuid REFERENCES dcrypt_vault.folders (id) ON DELETE SET NULL,
  favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE dcrypt_vault.items IS 'A vault item: login, note, card, identity, wallet, totp seed or ssh key';
COMMENT ON COLUMN dcrypt_vault.items.deleted_at IS 'Soft delete timestamp; rows are purged from trash after 30 days';

CREATE INDEX items_folder_id_idx ON dcrypt_vault.items (folder_id);
CREATE INDEX items_kind_idx ON dcrypt_vault.items (kind);

COMMIT;
