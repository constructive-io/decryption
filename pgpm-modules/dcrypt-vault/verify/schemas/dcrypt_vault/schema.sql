-- Verify schemas/dcrypt_vault/schema on pg

BEGIN;

SELECT pg_catalog.has_schema_privilege('dcrypt_vault', 'usage');

ROLLBACK;
