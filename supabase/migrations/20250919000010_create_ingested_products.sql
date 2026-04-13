-- Create ingested_products as a replica of products schema

-- 1) Table definition mirrors public.products (including types and nullability)
CREATE TABLE IF NOT EXISTS public.ingested_products (
  id TEXT NOT NULL PRIMARY KEY,
  type public.item_type NOT NULL,
  brand TEXT NOT NULL,
  size TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  image_url TEXT NOT NULL,
  description TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Added by later migrations on products
  fit TEXT,
  feel TEXT,
  category_id TEXT REFERENCES public.categories(id),
  image_length FLOAT,
  product_length FLOAT,
  product_url TEXT,
  gender TEXT,

  placement_y DOUBLE PRECISION,
  placement_x FLOAT,
  color_group TEXT,
  product_name TEXT,
  type_category TEXT,

  vibes TEXT,
  description_text TEXT,
  vector_embedding vector(1536),
  similar_items TEXT,
  garment_summary JSONB,
  garment_summary_version TEXT
);

-- 2) Constraints mirroring products
ALTER TABLE public.ingested_products 
ADD CONSTRAINT ingested_products_length_positive 
CHECK (image_length IS NULL OR image_length > 0);

ALTER TABLE public.ingested_products 
ADD CONSTRAINT ingested_products_product_length_positive 
CHECK (product_length IS NULL OR product_length > 0);

-- 3) Indexes similar to products
CREATE INDEX IF NOT EXISTS idx_ingested_products_type ON public.ingested_products(type);
CREATE INDEX IF NOT EXISTS idx_ingested_products_category_id ON public.ingested_products(category_id);
CREATE INDEX IF NOT EXISTS idx_ingested_products_type_category ON public.ingested_products(type, category_id);
CREATE INDEX IF NOT EXISTS idx_ingested_products_vector_embedding ON public.ingested_products USING ivfflat (vector_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_ingested_products_similar_items ON public.ingested_products USING gin(to_tsvector('english', similar_items));

-- 4) RLS and policies mirroring products
ALTER TABLE public.ingested_products ENABLE ROW LEVEL SECURITY;

-- Allow anonymous/public read access like products
DROP POLICY IF EXISTS "Ingested products are viewable by all" ON public.ingested_products;
CREATE POLICY "Ingested products are viewable by all" ON public.ingested_products FOR SELECT USING (true);

-- 5) Trigger to auto-update updated_at like products
DROP TRIGGER IF EXISTS update_ingested_products_updated_at ON public.ingested_products;
CREATE TRIGGER update_ingested_products_updated_at 
BEFORE UPDATE ON public.ingested_products 
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Comments to document parity
COMMENT ON TABLE public.ingested_products IS 'Replica of products schema for ingestion pipeline. Mirrors columns, constraints, indexes, RLS, and triggers of public.products.';
COMMENT ON COLUMN public.ingested_products.description_text IS 'Natural language description of the product for vector embedding generation';
COMMENT ON COLUMN public.ingested_products.vector_embedding IS 'Vector embedding (1536 dimensions) for semantic search using OpenAI text-embedding-3-small';
COMMENT ON COLUMN public.ingested_products.vibes IS 'Product vibe/mood description (e.g., casual, formal, trendy, vintage)';
COMMENT ON COLUMN public.ingested_products.similar_items IS 'Comma-separated list of product IDs for similar items. Used for the "Similar Items" feature.';

