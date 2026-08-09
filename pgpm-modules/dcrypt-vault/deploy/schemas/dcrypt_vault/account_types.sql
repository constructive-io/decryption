-- Deploy schemas/dcrypt_vault/account_types to pg
-- requires: schemas/dcrypt_vault/types

-- An account holds a session token; every API key it mints is its own item, so
-- a key can be revoked and audited on its own.

BEGIN;

ALTER TYPE dcrypt_vault.item_kind ADD VALUE 'account';
ALTER TYPE dcrypt_vault.item_kind ADD VALUE 'api_key';

ALTER TYPE dcrypt_vault.field_purpose ADD VALUE 'token';

COMMIT;
