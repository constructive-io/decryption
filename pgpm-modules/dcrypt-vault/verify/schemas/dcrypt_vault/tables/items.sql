-- Verify schemas/dcrypt_vault/tables/items on pg

BEGIN;

SELECT id, kind, title, folder_id, favorite, deleted_at FROM dcrypt_vault.items WHERE false;

ROLLBACK;
