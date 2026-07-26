-- Verify schemas/dcrypt_vault/procedures/reveal_field on pg

BEGIN;

SELECT pg_catalog.has_function_privilege('dcrypt_vault.reveal_field(uuid, text, text)', 'execute');

ROLLBACK;
