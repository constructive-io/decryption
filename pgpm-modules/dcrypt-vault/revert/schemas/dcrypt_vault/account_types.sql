-- Revert schemas/dcrypt_vault/account_types from pg

-- Postgres cannot drop an enum value, so each type is rebuilt without it. The
-- casts fail if any row still carries one, which is the right answer: the data
-- has to go before the value can.

BEGIN;

ALTER TYPE dcrypt_vault.item_kind RENAME TO item_kind_accounts;

CREATE TYPE dcrypt_vault.item_kind AS ENUM (
  'login',
  'note',
  'card',
  'identity',
  'wallet',
  'totp',
  'ssh_key'
);

ALTER TABLE dcrypt_vault.items
  ALTER COLUMN kind TYPE dcrypt_vault.item_kind
  USING kind::text::dcrypt_vault.item_kind;

DROP TYPE dcrypt_vault.item_kind_accounts;

ALTER TYPE dcrypt_vault.field_purpose RENAME TO field_purpose_accounts;

CREATE TYPE dcrypt_vault.field_purpose AS ENUM (
  'username',
  'password',
  'totp_seed',
  'mnemonic',
  'private_key',
  'text',
  'url'
);

ALTER TABLE dcrypt_vault.fields
  ALTER COLUMN purpose TYPE dcrypt_vault.field_purpose
  USING purpose::text::dcrypt_vault.field_purpose;

DROP TYPE dcrypt_vault.field_purpose_accounts;

COMMIT;
