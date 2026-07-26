-- Deploy schemas/dcrypt_vault/tables/tags to pg
-- requires: schemas/dcrypt_vault/schema

BEGIN;

CREATE TABLE dcrypt_vault.tags (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE
);

COMMENT ON TABLE dcrypt_vault.tags IS 'Flat tag namespace for vault items';

COMMIT;
