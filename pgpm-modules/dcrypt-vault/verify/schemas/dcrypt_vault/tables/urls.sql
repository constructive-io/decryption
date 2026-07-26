-- Verify schemas/dcrypt_vault/tables/urls on pg

BEGIN;

SELECT id, item_id, url FROM dcrypt_vault.urls WHERE false;

ROLLBACK;
