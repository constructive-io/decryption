-- Deploy schemas/dcrypt_vault/tables/password_history to pg
-- requires: schemas/dcrypt_vault/tables/fields

BEGIN;

CREATE TABLE dcrypt_vault.password_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  field_id uuid NOT NULL REFERENCES dcrypt_vault.fields (id) ON DELETE CASCADE,
  value_enc bytea NOT NULL,
  replaced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dcrypt_vault.password_history IS 'Previous field values, still encrypted, captured on update';

CREATE INDEX password_history_field_id_idx ON dcrypt_vault.password_history (field_id);

COMMIT;
