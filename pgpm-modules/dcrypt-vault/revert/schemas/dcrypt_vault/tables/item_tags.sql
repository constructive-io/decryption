-- Revert schemas/dcrypt_vault/tables/item_tags from pg

BEGIN;

DROP TABLE dcrypt_vault.item_tags;

COMMIT;
