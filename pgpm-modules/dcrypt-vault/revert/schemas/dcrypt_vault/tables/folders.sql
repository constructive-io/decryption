-- Revert schemas/dcrypt_vault/tables/folders from pg

BEGIN;

DROP TABLE dcrypt_vault.folders;

COMMIT;
