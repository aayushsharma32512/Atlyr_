-- Align products and ingested_products schemas with Phase 2 payloads.

-- 1) Add care copy column (textual) if it is missing.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS care TEXT;

ALTER TABLE public.ingested_products
  ADD COLUMN IF NOT EXISTS care TEXT;

COMMENT ON COLUMN public.products.care IS 'Phase 2 merchandising care copy shown on PDP.';
COMMENT ON COLUMN public.ingested_products.care IS 'Care instructions generated/approved during ingestion prior to promotion.';

-- 2) Add structured product specifications payload (JSONB) if missing.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_specifications JSONB;

ALTER TABLE public.ingested_products
  ADD COLUMN IF NOT EXISTS product_specifications JSONB;

COMMENT ON COLUMN public.products.product_specifications IS 'Structured key/value product specification data.';
COMMENT ON COLUMN public.ingested_products.product_specifications IS 'Structured specification data captured during ingestion before promotion.';
