-- Deploy schemas/dcrypt_vault/procedures/set_field to pg
-- requires: schemas/dcrypt_vault/tables/fields
-- requires: schemas/dcrypt_vault/tables/audit_log

BEGIN;

CREATE FUNCTION dcrypt_vault.set_field(
  in_item_id uuid,
  in_name text,
  in_purpose dcrypt_vault.field_purpose,
  in_value text,
  in_key text,
  in_concealed boolean DEFAULT true
) RETURNS uuid
AS $$
DECLARE
  field_id uuid;
BEGIN
  IF in_key IS NULL OR length(in_key) = 0 THEN
    RAISE EXCEPTION 'set_field requires a non-empty session key';
  END IF;

  INSERT INTO dcrypt_vault.fields (item_id, name, purpose, value_enc, concealed)
  VALUES (
    in_item_id,
    in_name,
    in_purpose,
    pgp_sym_encrypt(in_value, in_key, 'compress-algo=1, cipher-algo=aes256'),
    in_concealed
  )
  ON CONFLICT (item_id, name)
  DO UPDATE SET
    purpose = EXCLUDED.purpose,
    value_enc = EXCLUDED.value_enc,
    concealed = EXCLUDED.concealed
  RETURNING id INTO field_id;

  INSERT INTO dcrypt_vault.audit_log (item_id, field_name, action)
  VALUES (in_item_id, in_name, 'set');

  RETURN field_id;
END;
$$
LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION dcrypt_vault.set_field IS 'Write a field value; the only path in — plaintext never hits a column';

COMMIT;
