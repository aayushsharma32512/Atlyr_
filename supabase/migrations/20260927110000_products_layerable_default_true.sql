-- Every product counts as layerable until someone turns it off.
-- Re-adding the column with a default sets every row without an UPDATE, so no trigger runs and no
-- product's updated_at changes (the Alternates rack sorts by it). Nothing reads the column yet.
ALTER TABLE public.products DROP COLUMN IF EXISTS layerable;

ALTER TABLE public.products
  ADD COLUMN layerable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.layerable
  IS 'True unless someone turned it off. The Layer tab lists only tops with true.';
