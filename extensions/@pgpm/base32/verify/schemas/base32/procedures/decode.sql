-- Verify schemas/base32/procedures/decode  on pg

BEGIN;

SELECT verify_function ('base32.decode');
SELECT verify_function ('base32.decode_bytea');
SELECT verify_function ('base32.decode_hex');

ROLLBACK;
