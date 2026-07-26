-- Verify schemas/dcrypt_vault/procedures/search_items on pg

BEGIN;

SELECT pg_catalog.has_function_privilege('dcrypt_vault.search_items(text)', 'execute');

ROLLBACK;
