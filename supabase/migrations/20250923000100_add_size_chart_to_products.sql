-- Migration: Add size_chart JSONB to products and ingested_products
-- Purpose: Store normalized size chart data separately from garment_summary used by VTO

-- 1) Add to public.products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS size_chart JSONB;

COMMENT ON COLUMN public.products.size_chart IS 'Structured size chart data (JSON). Keep garment_summary focused for VTO.';

-- 2) Add to public.ingested_products (staging mirror)
ALTER TABLE public.ingested_products 
ADD COLUMN IF NOT EXISTS size_chart JSONB;

COMMENT ON COLUMN public.ingested_products.size_chart IS 'Structured size chart data (JSON) captured during ingestion.';
