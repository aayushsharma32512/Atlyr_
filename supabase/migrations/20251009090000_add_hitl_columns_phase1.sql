-- Phase 1 HITL support columns for images and products

-- 1) Image metadata enhancements (product_images + ingested_product_images)
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS product_view TEXT,
  ADD COLUMN IF NOT EXISTS ghost_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS summary_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.ingested_product_images
  ADD COLUMN IF NOT EXISTS product_view TEXT,
  ADD COLUMN IF NOT EXISTS ghost_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS summary_eligible BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_images.product_view IS 'View tag chosen during Phase 1 HITL review (e.g. front, back, side, detail). Optional; used to drive downstream automation.';
COMMENT ON COLUMN public.product_images.ghost_eligible IS 'Flag set during HITL review indicating whether this image should be sent for ghost mannequin generation.';
COMMENT ON COLUMN public.product_images.summary_eligible IS 'Flag set during HITL review indicating whether this image should feed garment summary generation.';

COMMENT ON COLUMN public.ingested_product_images.product_view IS 'View tag chosen during Phase 1 HITL review (e.g. front, back, side, detail). Optional; mirrored from product_images once promoted.';
COMMENT ON COLUMN public.ingested_product_images.ghost_eligible IS 'HITL toggle indicating this ingested image should pass through ghost mannequin processing.';
COMMENT ON COLUMN public.ingested_product_images.summary_eligible IS 'HITL toggle indicating this ingested image should be included in garment summary prompts.';

-- 2) Garment summary outputs (products + ingested_products)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS garment_summary_front JSONB,
  ADD COLUMN IF NOT EXISTS garment_summary_back JSONB;

ALTER TABLE public.ingested_products
  ADD COLUMN IF NOT EXISTS garment_summary_front JSONB,
  ADD COLUMN IF NOT EXISTS garment_summary_back JSONB;

COMMENT ON COLUMN public.products.garment_summary_front IS 'Structured garment summary generated from front-view imagery during automation (Phase 2).';
COMMENT ON COLUMN public.products.garment_summary_back IS 'Structured garment summary generated from back-view imagery during automation (Phase 2).';

COMMENT ON COLUMN public.ingested_products.garment_summary_front IS 'Structured garment summary (front view) stored during ingestion prior to promotion.';
COMMENT ON COLUMN public.ingested_products.garment_summary_back IS 'Structured garment summary (back view) stored during ingestion prior to promotion.';

