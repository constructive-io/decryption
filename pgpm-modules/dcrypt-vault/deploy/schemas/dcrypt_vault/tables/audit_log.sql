-- Deploy schemas/dcrypt_vault/tables/audit_log to pg
-- requires: schemas/dcrypt_vault/tables/items

BEGIN;

CREATE TABLE dcrypt_vault.audit_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id uuid REFERENCES dcrypt_vault.items (id) ON DELETE SET NULL,
  field_name text,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dcrypt_vault.audit_log IS 'What was revealed or changed, and when — never the value itself';

COMMIT;
