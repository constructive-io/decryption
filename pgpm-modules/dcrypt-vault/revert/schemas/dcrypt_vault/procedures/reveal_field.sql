-- Revert schemas/dcrypt_vault/procedures/reveal_field from pg

BEGIN;

DROP FUNCTION dcrypt_vault.reveal_field(uuid, text, text);

COMMIT;
