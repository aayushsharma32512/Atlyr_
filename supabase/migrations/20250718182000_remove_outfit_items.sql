-- Migration: Remove old outfit_items table
-- This migration removes the old junction table since we've migrated to direct columns

-- Step 1: Drop the old junction table
DROP TABLE public.outfit_items CASCADE;

-- Step 2: Drop old indexes that are no longer needed
DROP INDEX IF EXISTS idx_outfit_items_outfit_id;
DROP INDEX IF EXISTS idx_outfit_items_product_id;

-- Step 3: Verify the new structure is working
-- This will show us that outfits still have their items properly linked
SELECT 
    id, 
    name, 
    top_id, 
    bottom_id, 
    shoes_id,
    total_price
FROM public.outfits 
LIMIT 3; 