-- Repair migration for Lookbooks (user collections)
-- Goals:
-- - Ensure persistent user_collections table exists with RLS + slug normalization
-- - Backfill collections from historical user_favorites
-- - Replace RPCs to avoid ambiguous created_at and reliably return empty collections
-- - Ensure manage_collection operates on user_collections and cleans memberships on delete

-- 1) Table + RLS + Trigger
CREATE TABLE IF NOT EXISTS public.user_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_collections_user_slug_unique UNIQUE (user_id, slug)
);

ALTER TABLE public.user_collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their collections" ON public.user_collections;
CREATE POLICY "Users manage their collections" ON public.user_collections
  FOR ALL TO authenticated, anon
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.normalize_user_collection_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NOT NULL THEN
    NEW.slug := LOWER(NEW.slug);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_user_collection_slug ON public.user_collections;
CREATE TRIGGER trg_normalize_user_collection_slug
  BEFORE INSERT OR UPDATE ON public.user_collections
  FOR EACH ROW EXECUTE FUNCTION public.normalize_user_collection_slug();

-- 2) Backfill from historical user_favorites (non-system slugs only)
INSERT INTO public.user_collections (user_id, slug, label)
SELECT DISTINCT uf.user_id,
       LOWER(uf.collection_slug) AS slug,
       COALESCE(NULLIF(uf.collection_label, ''), INITCAP(LOWER(uf.collection_slug))) AS label
FROM public.user_favorites uf
WHERE LOWER(uf.collection_slug) NOT IN ('favorites','generations')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_collections uc
    WHERE uc.user_id = uf.user_id AND uc.slug = LOWER(uf.collection_slug)
  );

-- 3) RPC: manage_collection → operate on user_collections
CREATE OR REPLACE FUNCTION public.manage_collection(
  p_operation TEXT, -- 'create', 'rename', 'delete'
  p_collection_slug TEXT,
  p_collection_label TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  reserved_slugs TEXT[] := ARRAY['favorites','generations'];
  normalized_slug TEXT := LOWER(p_collection_slug);
BEGIN
  IF p_operation NOT IN ('create','rename','delete') THEN
    RAISE EXCEPTION 'Invalid operation: %', p_operation;
  END IF;
  IF normalized_slug = ANY(reserved_slugs) THEN
    RAISE EXCEPTION 'Cannot % reserved collection: %', p_operation, normalized_slug;
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF p_operation = 'create' THEN
    INSERT INTO public.user_collections (user_id, slug, label)
    VALUES (p_user_id, normalized_slug, COALESCE(p_collection_label, INITCAP(normalized_slug)));
    result := jsonb_build_object('success', true, 'operation','create', 'collection_slug', normalized_slug);
  ELSIF p_operation = 'rename' THEN
    UPDATE public.user_collections
      SET label = COALESCE(p_collection_label, label)
      WHERE user_id = p_user_id AND slug = normalized_slug;
    IF NOT FOUND THEN RAISE EXCEPTION 'Collection not found: %', normalized_slug; END IF;
    result := jsonb_build_object('success', true, 'operation','rename', 'collection_slug', normalized_slug);
  ELSE
    DELETE FROM public.user_favorites WHERE user_id = p_user_id AND collection_slug = normalized_slug;
    DELETE FROM public.user_collections WHERE user_id = p_user_id AND slug = normalized_slug;
    result := jsonb_build_object('success', true, 'operation','delete', 'collection_slug', normalized_slug);
  END IF;

  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.manage_collection TO authenticated, anon;

-- Drop old version first to allow changing OUT parameters
DROP FUNCTION IF EXISTS public.get_user_collections(UUID);

-- 4) RPC: get_user_collections → avoid ambiguous created_at; include empty lookbooks
CREATE OR REPLACE FUNCTION public.get_user_collections(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  collection_slug TEXT,
  collection_label TEXT,
  item_count BIGINT,
  is_system BOOLEAN,
  collection_created_at TIMESTAMPTZ
) AS $$
DECLARE
  reserved_slugs TEXT[] := ARRAY['favorites','generations'];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT slug AS collection_slug, label AS collection_label, created_at
    FROM public.user_collections
    WHERE user_id = p_user_id

  )
  SELECT 
    b.collection_slug,
    b.collection_label,
    COALESCE(COUNT(uf.outfit_id), 0) AS item_count,
    (b.collection_slug = ANY(reserved_slugs)) AS is_system,
    MIN(b.created_at) AS collection_created_at
  FROM base b
  LEFT JOIN public.user_favorites uf
    ON uf.user_id = p_user_id AND uf.collection_slug = b.collection_slug
  GROUP BY b.collection_slug, b.collection_label
  ORDER BY CASE WHEN b.collection_slug = ANY(reserved_slugs) THEN 0 ELSE 1 END,
           b.collection_label;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_user_collections TO authenticated, anon;
