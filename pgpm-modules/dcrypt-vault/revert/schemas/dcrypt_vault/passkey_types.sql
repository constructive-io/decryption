-- Revert schemas/dcrypt_vault/passkey_types from pg

-- Postgres cannot drop an enum value, so the type is rebuilt without it. The
-- cast fails if any row still carries one, which is the right answer: the data
-- has to go before the value can.

BEGIN;

ALTER TYPE dcrypt_vault.item_kind RENAME TO item_kind_passkeys;

CREATE TYPE dcrypt_vault.item_kind AS ENUM (
  'login',
  'note',
  'card',
  'identity',
  'wallet',
  'totp',
  'ssh_key',
  'account',
  'api_key'
);

ALTER TABLE dcrypt_vault.items
  ALTER COLUMN kind TYPE dcrypt_vault.item_kind
  USING kind::text::dcrypt_vault.item_kind;

DROP TYPE dcrypt_vault.item_kind_passkeys;

COMMIT;
