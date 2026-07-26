-- Deploy schemas/dcrypt_vault/procedures/totp_code to pg
-- requires: schemas/dcrypt_vault/procedures/reveal_field
-- requires: pgpm-totp:schemas/totp/procedures/generate_totp

BEGIN;

CREATE FUNCTION dcrypt_vault.totp_code(
  in_item_id uuid,
  in_key text,
  in_period int DEFAULT 30,
  in_digits int DEFAULT 6,
  in_time_from timestamptz DEFAULT now()
) RETURNS text
AS $$
  SELECT totp.generate(
    dcrypt_vault.reveal_field(in_item_id, 'seed', in_key),
    in_period,
    in_digits,
    in_time_from
  );
$$
LANGUAGE sql VOLATILE;

COMMENT ON FUNCTION dcrypt_vault.totp_code IS 'Current TOTP code for a totp item; the seed is stored as the encrypted field "seed"';

COMMIT;
