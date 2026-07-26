-- Deploy schemas/dcrypt_vault/tables/meta to pg
-- requires: schemas/dcrypt_vault/schema

BEGIN;

CREATE TABLE dcrypt_vault.meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

COMMENT ON TABLE dcrypt_vault.meta IS 'Vault-level metadata (key derivation salt, schema flags); never secret values';

COMMIT;
