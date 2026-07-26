-- Verify schemas/dcrypt_vault/tables/item_tags on pg

BEGIN;

SELECT item_id, tag_id FROM dcrypt_vault.item_tags WHERE false;

ROLLBACK;
