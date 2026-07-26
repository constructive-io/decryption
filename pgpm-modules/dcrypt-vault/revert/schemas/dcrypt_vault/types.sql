-- Revert schemas/dcrypt_vault/types from pg

BEGIN;

DROP TYPE dcrypt_vault.field_purpose;
DROP TYPE dcrypt_vault.item_kind;

COMMIT;
