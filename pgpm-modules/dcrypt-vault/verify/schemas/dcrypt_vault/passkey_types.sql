-- Verify schemas/dcrypt_vault/passkey_types on pg

BEGIN;

SELECT 'passkey'::dcrypt_vault.item_kind;

ROLLBACK;
