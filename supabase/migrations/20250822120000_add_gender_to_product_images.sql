-- Migration: Add gender column to product_images table
-- Purpose: Store gender information for each product image

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_product_images_gender ON public.product_images(gender);

-- Add comment for documentation
COMMENT ON COLUMN public.product_images.gender IS 'Gender category for the product (male or female)';

-- Update existing records if any (this will be NULL for existing records)
-- You can update them later when you populate the table with actual data


