-- Revert schemas/dcrypt_vault/tables/tags from pg

BEGIN;

DROP TABLE dcrypt_vault.tags;

COMMIT;
