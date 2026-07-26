-- Verify schemas/dcrypt_vault/tables/folders on pg

BEGIN;

SELECT id, name, parent_id FROM dcrypt_vault.folders WHERE false;

ROLLBACK;
