-- Deploy schemas/dcrypt_vault/tables/folders to pg
-- requires: schemas/dcrypt_vault/schema

BEGIN;

CREATE TABLE dcrypt_vault.folders (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  parent_id uuid REFERENCES dcrypt_vault.folders (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, name)
);

COMMENT ON TABLE dcrypt_vault.folders IS 'Hierarchical folders for organizing vault items';

COMMIT;
