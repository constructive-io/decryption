-- Revert schemas/dcrypt_vault/procedures/touch_updated_at from pg

BEGIN;

DROP TRIGGER items_touch_updated_at ON dcrypt_vault.items;
DROP TRIGGER fields_touch_updated_at ON dcrypt_vault.fields;
DROP FUNCTION dcrypt_vault.touch_updated_at();

COMMIT;
