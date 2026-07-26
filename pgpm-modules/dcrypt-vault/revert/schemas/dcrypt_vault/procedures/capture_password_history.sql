-- Revert schemas/dcrypt_vault/procedures/capture_password_history from pg

BEGIN;

DROP TRIGGER fields_capture_password_history ON dcrypt_vault.fields;
DROP FUNCTION dcrypt_vault.capture_password_history();

COMMIT;
