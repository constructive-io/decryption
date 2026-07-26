-- Revert schemas/dcrypt_vault/procedures/set_field from pg

BEGIN;

DROP FUNCTION dcrypt_vault.set_field(uuid, text, dcrypt_vault.field_purpose, text, text, boolean);

COMMIT;
