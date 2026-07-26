-- Verify schemas/dcrypt_vault/tables/audit_log on pg

BEGIN;

SELECT id, item_id, field_name, action, occurred_at FROM dcrypt_vault.audit_log WHERE false;

ROLLBACK;
