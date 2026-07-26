-- Verify schemas/dcrypt_vault/tables/tags on pg

BEGIN;

SELECT id, name FROM dcrypt_vault.tags WHERE false;

ROLLBACK;
