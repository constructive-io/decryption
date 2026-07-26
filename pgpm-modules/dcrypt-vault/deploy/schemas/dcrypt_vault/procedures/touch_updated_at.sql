-- Deploy schemas/dcrypt_vault/procedures/touch_updated_at to pg
-- requires: schemas/dcrypt_vault/tables/items
-- requires: schemas/dcrypt_vault/tables/fields

BEGIN;

CREATE FUNCTION dcrypt_vault.touch_updated_at()
RETURNS TRIGGER
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$
LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER items_touch_updated_at
  BEFORE UPDATE ON dcrypt_vault.items
  FOR EACH ROW
  EXECUTE FUNCTION dcrypt_vault.touch_updated_at();

CREATE TRIGGER fields_touch_updated_at
  BEFORE UPDATE ON dcrypt_vault.fields
  FOR EACH ROW
  EXECUTE FUNCTION dcrypt_vault.touch_updated_at();

COMMIT;
