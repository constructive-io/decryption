-- Revert schemas/dcrypt_vault/tables/password_history from pg

BEGIN;

DROP TABLE dcrypt_vault.password_history;

COMMIT;
