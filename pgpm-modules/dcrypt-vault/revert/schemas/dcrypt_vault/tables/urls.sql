-- Revert schemas/dcrypt_vault/tables/urls from pg

BEGIN;

DROP TABLE dcrypt_vault.urls;

COMMIT;
