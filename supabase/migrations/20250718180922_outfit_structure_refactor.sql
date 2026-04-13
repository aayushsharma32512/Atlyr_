-- Migration: Refactor outfit structure from junction table to direct columns
-- This migration adds direct item columns to outfits table and migrates existing data

-- Step 1: Add new columns to outfits table
ALTER TABLE public.outfits 
ADD COLUMN top_id TEXT REFERENCES public.products(id),
ADD COLUMN bottom_id TEXT REFERENCES public.products(id),
ADD COLUMN shoes_id TEXT REFERENCES public.products(id);

-- Step 2: Create indexes for the new foreign key columns
CREATE INDEX idx_outfits_top_id ON public.outfits(top_id);
CREATE INDEX idx_outfits_bottom_id ON public.outfits(bottom_id);
CREATE INDEX idx_outfits_shoes_id ON public.outfits(shoes_id);

-- Step 3: Migrate existing data from outfit_items to new columns
-- Update top_id
UPDATE public.outfits 
SET top_id = (
    SELECT oi.product_id 
    FROM public.outfit_items oi 
    JOIN public.products p ON oi.product_id = p.id 
    WHERE oi.outfit_id = outfits.id AND p.type = 'top' 
    LIMIT 1
)
WHERE id IN (SELECT outfit_id FROM public.outfit_items);

-- Update bottom_id
UPDATE public.outfits 
SET bottom_id = (
    SELECT oi.product_id 
    FROM public.outfit_items oi 
    JOIN public.products p ON oi.product_id = p.id 
    WHERE oi.outfit_id = outfits.id AND p.type = 'bottom' 
    LIMIT 1
)
WHERE id IN (SELECT outfit_id FROM public.outfit_items);

-- Update shoes_id
UPDATE public.outfits 
SET shoes_id = (
    SELECT oi.product_id 
    FROM public.outfit_items oi 
    JOIN public.products p ON oi.product_id = p.id 
    WHERE oi.outfit_id = outfits.id AND p.type = 'shoes' 
    LIMIT 1
)
WHERE id IN (SELECT outfit_id FROM public.outfit_items);



-- Step 4: Verify migration by checking a sample
-- This will show us if the migration worked correctly
SELECT 
    id, 
    name, 
    top_id, 
    bottom_id, 
    shoes_id
FROM public.outfits 
LIMIT 5;

-- Step 5: Drop the old junction table (commented out for safety - uncomment after testing)
-- DROP TABLE public.outfit_items CASCADE;

-- Step 6: Drop old indexes that are no longer needed
-- DROP INDEX IF EXISTS idx_outfit_items_outfit_id;
-- DROP INDEX IF EXISTS idx_outfit_items_product_id;
