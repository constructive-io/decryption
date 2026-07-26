-- Revert schemas/dcrypt_vault/tables/items from pg

BEGIN;

DROP TABLE dcrypt_vault.items;

COMMIT;
