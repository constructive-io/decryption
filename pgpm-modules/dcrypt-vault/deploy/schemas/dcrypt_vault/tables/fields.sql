-- Deploy schemas/dcrypt_vault/tables/fields to pg
-- requires: schemas/dcrypt_vault/tables/items

BEGIN;

CREATE TABLE dcrypt_vault.fields (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id uuid NOT NULL REFERENCES dcrypt_vault.items (id) ON DELETE CASCADE,
  name text NOT NULL,
  purpose dcrypt_vault.field_purpose NOT NULL,
  value_enc bytea NOT NULL,
  concealed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, name)
);

COMMENT ON TABLE dcrypt_vault.fields IS 'Field values, always pgp_sym_encrypted; plaintext never touches this table';
COMMENT ON COLUMN dcrypt_vault.fields.value_enc IS 'pgp_sym_encrypt(value, session key) — see dcrypt_vault.set_field';

CREATE INDEX fields_item_id_idx ON dcrypt_vault.fields (item_id);

COMMIT;
