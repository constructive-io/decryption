-- Revert schemas/dcrypt_vault/tables/meta from pg

BEGIN;

DROP TABLE dcrypt_vault.meta;

COMMIT;
