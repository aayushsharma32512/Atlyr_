-- Migration: Add body_parts_visible column to products
-- Purpose: Store mannequin segment visibility per product item

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS body_parts_visible JSONB;

ALTER TABLE public.products
  ADD CONSTRAINT products_body_parts_visible_array
  CHECK (
    body_parts_visible IS NULL
    OR jsonb_typeof(body_parts_visible) = 'array'
  );

COMMENT ON COLUMN public.products.body_parts_visible IS
  'JSON array of mannequin segments that remain visible when this product is rendered.';


