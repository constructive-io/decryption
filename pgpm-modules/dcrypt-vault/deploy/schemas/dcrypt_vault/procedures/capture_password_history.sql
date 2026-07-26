-- Deploy schemas/dcrypt_vault/procedures/capture_password_history to pg
-- requires: schemas/dcrypt_vault/tables/fields
-- requires: schemas/dcrypt_vault/tables/password_history

BEGIN;

CREATE FUNCTION dcrypt_vault.capture_password_history()
RETURNS TRIGGER
AS $$
BEGIN
  IF OLD.value_enc IS DISTINCT FROM NEW.value_enc THEN
    INSERT INTO dcrypt_vault.password_history (field_id, value_enc)
    VALUES (OLD.id, OLD.value_enc);
  END IF;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER fields_capture_password_history
  BEFORE UPDATE ON dcrypt_vault.fields
  FOR EACH ROW
  WHEN (OLD.purpose = 'password')
  EXECUTE FUNCTION dcrypt_vault.capture_password_history();

COMMIT;
