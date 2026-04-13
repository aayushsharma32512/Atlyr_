-- Migration: Add type_category column to products table

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS type_category TEXT;

-- No default/backfill set here; populate as needed via a separate data migration or SQL.


