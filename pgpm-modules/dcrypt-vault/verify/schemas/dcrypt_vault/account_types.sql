-- Verify schemas/dcrypt_vault/account_types on pg

BEGIN;

SELECT 'account'::dcrypt_vault.item_kind;
SELECT 'api_key'::dcrypt_vault.item_kind;
SELECT 'token'::dcrypt_vault.field_purpose;

ROLLBACK;
