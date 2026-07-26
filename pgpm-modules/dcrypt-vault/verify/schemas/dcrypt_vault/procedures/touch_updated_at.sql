-- Verify schemas/dcrypt_vault/procedures/touch_updated_at on pg

BEGIN;

SELECT pg_catalog.has_function_privilege('dcrypt_vault.touch_updated_at()', 'execute');

ROLLBACK;
