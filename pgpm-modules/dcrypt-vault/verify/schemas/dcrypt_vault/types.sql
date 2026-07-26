-- Verify schemas/dcrypt_vault/types on pg

BEGIN;

SELECT 'login'::dcrypt_vault.item_kind;
SELECT 'password'::dcrypt_vault.field_purpose;

ROLLBACK;
