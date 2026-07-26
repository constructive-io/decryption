-- Verify schemas/dcrypt_vault/tables/meta on pg

BEGIN;

SELECT key, value FROM dcrypt_vault.meta WHERE false;

ROLLBACK;
