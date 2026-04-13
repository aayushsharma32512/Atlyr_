-- Create ingested_product_images as a replica of product_images schema

-- 1) Table definition mirrors public.product_images
CREATE TABLE IF NOT EXISTS public.ingested_product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL REFERENCES public.ingested_products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('flatlay', 'model', 'detail')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  gender TEXT CHECK (gender IN ('male', 'female')),
  vto_eligible BOOLEAN NOT NULL DEFAULT false
);

-- 2) Indexes mirroring product_images
CREATE INDEX IF NOT EXISTS idx_ingested_product_images_product_id ON public.ingested_product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_ingested_product_images_sort_order ON public.ingested_product_images(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_ingested_product_images_primary ON public.ingested_product_images(product_id, is_primary) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_ingested_product_images_kind ON public.ingested_product_images(product_id, kind);
CREATE INDEX IF NOT EXISTS idx_ingested_product_images_gender ON public.ingested_product_images(gender);
CREATE INDEX IF NOT EXISTS idx_ingested_product_images_vto_eligible ON public.ingested_product_images (product_id, kind, vto_eligible) WHERE vto_eligible = true;

-- 3) RLS and policies mirroring product_images
ALTER TABLE public.ingested_product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to ingested_product_images" ON public.ingested_product_images;
CREATE POLICY "Allow public read access to ingested_product_images" ON public.ingested_product_images
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to manage ingested_product_images" ON public.ingested_product_images;
CREATE POLICY "Allow authenticated users to manage ingested_product_images" ON public.ingested_product_images
  FOR ALL USING (auth.role() = 'authenticated');

-- 4) Trigger to auto-update updated_at like product_images
DROP TRIGGER IF EXISTS update_ingested_product_images_updated_at ON public.ingested_product_images;
CREATE TRIGGER update_ingested_product_images_updated_at 
    BEFORE UPDATE ON public.ingested_product_images 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 5) Comments to document parity
COMMENT ON TABLE public.ingested_product_images IS 'Replica of product_images for ingestion pipeline; references ingested_products.';
COMMENT ON COLUMN public.ingested_product_images.url IS 'Live URL to the image in Supabase Storage';

