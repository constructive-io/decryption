-- Verify schemas/dcrypt_vault/tables/fields on pg

BEGIN;

SELECT id, item_id, name, purpose, value_enc, concealed FROM dcrypt_vault.fields WHERE false;

ROLLBACK;
