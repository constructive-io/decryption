-- Verify schemas/dcrypt_vault/procedures/set_field on pg

BEGIN;

SELECT pg_catalog.has_function_privilege('dcrypt_vault.set_field(uuid, text, dcrypt_vault.field_purpose, text, text, boolean)', 'execute');

ROLLBACK;
