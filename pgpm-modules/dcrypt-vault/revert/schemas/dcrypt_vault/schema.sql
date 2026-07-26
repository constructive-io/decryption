-- Revert schemas/dcrypt_vault/schema from pg

BEGIN;

DROP SCHEMA dcrypt_vault;

COMMIT;
