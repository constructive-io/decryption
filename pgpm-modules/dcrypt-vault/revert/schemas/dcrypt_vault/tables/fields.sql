-- Revert schemas/dcrypt_vault/tables/fields from pg

BEGIN;

DROP TABLE dcrypt_vault.fields;

COMMIT;
