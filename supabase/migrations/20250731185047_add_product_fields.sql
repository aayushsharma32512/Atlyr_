-- Migration: Add new fields to products table
-- This migration adds fit, feel, category_id, image_length, product_length, and product_url to products

-- Step 1: Add new columns to products table
ALTER TABLE public.products 
ADD COLUMN fit TEXT,
ADD COLUMN feel TEXT,
ADD COLUMN category_id TEXT REFERENCES public.categories(id),
ADD COLUMN image_length FLOAT,
ADD COLUMN product_length FLOAT,
ADD COLUMN product_url TEXT,
ADD COLUMN gender TEXT;

-- Step 2: Add indexes for performance
CREATE INDEX idx_products_category_id ON public.products(category_id);
CREATE INDEX idx_products_type_category ON public.products(type, category_id);

-- Step 3: Add constraints for data integrity
-- Add check constraint for positive length values
ALTER TABLE public.products 
ADD CONSTRAINT products_length_positive 
CHECK (image_length IS NULL OR image_length > 0);

ALTER TABLE public.products 
ADD CONSTRAINT products_product_length_positive 
CHECK (product_length IS NULL OR product_length > 0);

-- Step 4: Keep existing products with NULL category_id
-- Category assignment will be done manually or through application logic later
-- Existing products will have category_id = NULL

-- Step 5: Add comments for documentation
COMMENT ON COLUMN public.products.fit IS 'Product fit description (e.g., loose, fitted, oversized)';
COMMENT ON COLUMN public.products.feel IS 'Product mood/feel description (e.g., casual, formal, trendy)';
COMMENT ON COLUMN public.products.category_id IS 'Reference to categories table for product categorization';
COMMENT ON COLUMN public.products.image_length IS 'Length/dimension of product image for avatar positioning';
COMMENT ON COLUMN public.products.product_length IS 'Actual product length measurement';
COMMENT ON COLUMN public.products.product_url IS 'External link to product page';
COMMENT ON COLUMN public.products.gender IS 'Product gender targeting (e.g., male, female, unisex)';

-- Step 6: Verify the migration
-- This will show the new structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'products' 
ORDER BY ordinal_position; 