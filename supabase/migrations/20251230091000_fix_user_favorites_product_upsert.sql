-- Ensure product favorites can be upserted via ON CONFLICT (user_id, collection_slug, product_id).
-- Root cause: previous migration created a *partial* unique index for product_id, which cannot be
-- targeted by INSERT ... ON CONFLICT (cols) DO UPDATE used by the client.

-- 1) Ensure product_id exists (idempotent safety)
ALTER TABLE public.user_favorites
  ADD COLUMN IF NOT EXISTS product_id TEXT REFERENCES public.products(id) ON DELETE CASCADE;

-- 2) Dedupe any existing rows that would block creating the unique index
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, collection_slug, product_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.user_favorites
  WHERE product_id IS NOT NULL
)
DELETE FROM public.user_favorites uf
USING ranked r
WHERE uf.id = r.id
  AND r.rn > 1;

-- 3) Create a non-partial unique index matching the upsert conflict target
CREATE UNIQUE INDEX IF NOT EXISTS user_favorites_unique_collection_product
  ON public.user_favorites (user_id, collection_slug, product_id);

-- 4) Drop the old partial unique index (no longer needed, and not compatible with ON CONFLICT inference)
DROP INDEX IF EXISTS public.idx_user_favorites_user_collection_product;

