-- Deploy schemas/dcrypt_vault/procedures/reveal_field to pg
-- requires: schemas/dcrypt_vault/procedures/set_field

BEGIN;

CREATE FUNCTION dcrypt_vault.reveal_field(
  in_item_id uuid,
  in_name text,
  in_key text
) RETURNS text
AS $$
DECLARE
  result text;
BEGIN
  SELECT pgp_sym_decrypt(f.value_enc, in_key)
  INTO result
  FROM dcrypt_vault.fields f
  WHERE f.item_id = in_item_id AND f.name = in_name;

  IF result IS NULL THEN
    RAISE EXCEPTION 'field "%" not found on item %', in_name, in_item_id;
  END IF;

  INSERT INTO dcrypt_vault.audit_log (item_id, field_name, action)
  VALUES (in_item_id, in_name, 'reveal');

  RETURN result;
END;
$$
LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION dcrypt_vault.reveal_field IS 'Decrypt one field value and record the reveal in the audit log';

COMMIT;
