-- Verify schemas/dcrypt_vault/procedures/totp_code on pg

BEGIN;

SELECT pg_catalog.has_function_privilege('dcrypt_vault.totp_code(uuid, text, int, int, timestamptz)', 'execute');

ROLLBACK;
