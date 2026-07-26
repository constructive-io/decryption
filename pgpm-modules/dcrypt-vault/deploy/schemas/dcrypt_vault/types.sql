-- Deploy schemas/dcrypt_vault/types to pg
-- requires: schemas/dcrypt_vault/schema

BEGIN;

CREATE TYPE dcrypt_vault.item_kind AS ENUM (
  'login',
  'note',
  'card',
  'identity',
  'wallet',
  'totp',
  'ssh_key'
);

CREATE TYPE dcrypt_vault.field_purpose AS ENUM (
  'username',
  'password',
  'totp_seed',
  'mnemonic',
  'private_key',
  'text',
  'url'
);

COMMIT;
