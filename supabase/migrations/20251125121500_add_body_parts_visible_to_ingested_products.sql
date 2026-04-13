-- Migration: Add body_parts_visible to ingested_products
-- Purpose: Keep ingestion staging schema aligned with products for mannequin masking data.

ALTER TABLE public.ingested_products
  ADD COLUMN IF NOT EXISTS body_parts_visible JSONB;

ALTER TABLE public.ingested_products
  ADD CONSTRAINT ingested_products_body_parts_visible_array
  CHECK (
    body_parts_visible IS NULL
    OR jsonb_typeof(body_parts_visible) = 'array'
  );

COMMENT ON COLUMN public.ingested_products.body_parts_visible IS
  'JSON array of mannequin segments that remain visible when this product is rendered.';
