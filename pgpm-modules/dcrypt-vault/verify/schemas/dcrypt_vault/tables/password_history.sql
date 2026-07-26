-- Verify schemas/dcrypt_vault/tables/password_history on pg

BEGIN;

SELECT id, field_id, value_enc, replaced_at FROM dcrypt_vault.password_history WHERE false;

ROLLBACK;
