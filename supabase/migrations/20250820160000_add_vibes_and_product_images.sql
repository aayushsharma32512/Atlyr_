-- Migration: Add vibes column to products and create product_images table
-- Purpose: Support product vibes and multiple product images for PDP

-- Step 1: Add vibes column to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS vibes TEXT;

COMMENT ON COLUMN public.products.vibes IS 'Product vibe/mood description (e.g., casual, formal, trendy, vintage)';

-- Step 2: Create product_images table
CREATE TABLE IF NOT EXISTS public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('flatlay', 'model', 'detail')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Step 3: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON public.product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_sort_order ON public.product_images(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_images_primary ON public.product_images(product_id, is_primary) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_product_images_kind ON public.product_images(product_id, kind);

-- Step 4: Add constraint to ensure only one primary image per product
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_one_primary 
ON public.product_images(product_id) 
WHERE is_primary = true;

-- Step 5: Add comments for documentation
COMMENT ON TABLE public.product_images IS 'Multiple images for each product (flatlays, model shots, details)';
COMMENT ON COLUMN public.product_images.product_id IS 'Reference to the product this image belongs to';
COMMENT ON COLUMN public.product_images.kind IS 'Type of image: flatlay, model, or detail';
COMMENT ON COLUMN public.product_images.sort_order IS 'Display order for the image gallery';
COMMENT ON COLUMN public.product_images.is_primary IS 'Whether this is the main image for the product (only one per product)';
COMMENT ON COLUMN public.product_images.url IS 'Live URL to the image in Supabase Storage';

-- Step 6: Enable Row Level Security
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

-- Step 7: Create policy for public read access
CREATE POLICY "Allow public read access to product_images" ON public.product_images
  FOR SELECT USING (true);

-- Step 8: Create policy for authenticated users to manage images (optional)
CREATE POLICY "Allow authenticated users to manage product_images" ON public.product_images
  FOR ALL USING (auth.role() = 'authenticated');

-- Step 9: Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_product_images_updated_at 
    BEFORE UPDATE ON public.product_images 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
