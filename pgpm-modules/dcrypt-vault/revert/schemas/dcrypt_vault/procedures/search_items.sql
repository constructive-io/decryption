-- Revert schemas/dcrypt_vault/procedures/search_items from pg

BEGIN;

DROP FUNCTION dcrypt_vault.search_items(text);

COMMIT;
