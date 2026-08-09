-- Deploy schemas/dcrypt_vault/passkey_types to pg
-- requires: schemas/dcrypt_vault/account_types

-- A passkey is a P-256 private key held for one site. The public half, the
-- credential id and the sign count are not secret and live in plain fields;
-- only the key itself is concealed.

BEGIN;

ALTER TYPE dcrypt_vault.item_kind ADD VALUE 'passkey';

COMMIT;
