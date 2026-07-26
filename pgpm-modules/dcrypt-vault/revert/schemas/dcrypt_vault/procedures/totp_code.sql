-- Revert schemas/dcrypt_vault/procedures/totp_code from pg

BEGIN;

DROP FUNCTION dcrypt_vault.totp_code(uuid, text, int, int, timestamptz);

COMMIT;
