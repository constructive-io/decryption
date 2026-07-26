-- Revert schemas/dcrypt_vault/tables/audit_log from pg

BEGIN;

DROP TABLE dcrypt_vault.audit_log;

COMMIT;
