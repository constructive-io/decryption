-- Deploy schemas/dcrypt_vault/procedures/search_items to pg
-- requires: schemas/dcrypt_vault/tables/urls
-- requires: schemas/dcrypt_vault/tables/item_tags

BEGIN;

CREATE FUNCTION dcrypt_vault.search_items(
  in_query text
) RETURNS SETOF dcrypt_vault.items
AS $$
  SELECT DISTINCT i.*
  FROM dcrypt_vault.items i
  LEFT JOIN dcrypt_vault.urls u ON u.item_id = i.id
  LEFT JOIN dcrypt_vault.item_tags it ON it.item_id = i.id
  LEFT JOIN dcrypt_vault.tags t ON t.id = it.tag_id
  WHERE i.deleted_at IS NULL
    AND (
      i.title ILIKE '%' || in_query || '%'
      OR u.url ILIKE '%' || in_query || '%'
      OR t.name ILIKE '%' || in_query || '%'
    )
  ORDER BY i.title;
$$
LANGUAGE sql STABLE;

COMMENT ON FUNCTION dcrypt_vault.search_items IS 'Search titles, urls and tags — never decrypts values';

COMMIT;
