-- Migration: Add occasion and material_type columns to products + ingested_products

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS occasion TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS material_type TEXT;

ALTER TABLE public.ingested_products
  ADD COLUMN IF NOT EXISTS occasion TEXT;

ALTER TABLE public.ingested_products
  ADD COLUMN IF NOT EXISTS material_type TEXT;

COMMENT ON COLUMN public.products.occasion IS 'Merchandising occasion tag generated/approved during ingestion (e.g., workwear, date night).';
COMMENT ON COLUMN public.products.material_type IS 'Merchandising material type generated/approved during ingestion (e.g., cotton, denim, faux leather).';
COMMENT ON COLUMN public.ingested_products.occasion IS 'Staged merchandising occasion tag prior to promotion.';
COMMENT ON COLUMN public.ingested_products.material_type IS 'Staged merchandising material type prior to promotion.';
