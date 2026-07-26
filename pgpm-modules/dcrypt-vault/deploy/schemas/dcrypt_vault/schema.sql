-- Deploy schemas/dcrypt_vault/schema to pg

BEGIN;

CREATE SCHEMA dcrypt_vault;

COMMENT ON SCHEMA dcrypt_vault IS 'Local encrypted vault: items, fields, folders, tags, TOTP and audit log';

COMMIT;
