-- Verify schemas/dcrypt_vault/procedures/capture_password_history on pg

BEGIN;

SELECT pg_catalog.has_function_privilege('dcrypt_vault.capture_password_history()', 'execute');

ROLLBACK;
