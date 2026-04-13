-- Migration: Add multimodal vector embeddings to products table
-- Purpose: Enable separate text and image-based semantic search with 768 dimensions

-- Step 1: Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add text_vector column to products table (768 dimensions)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'products' 
    AND column_name = 'text_vector'
  ) THEN
    ALTER TABLE public.products ADD COLUMN text_vector vector(768);
  END IF;
END $$;

COMMENT ON COLUMN public.products.text_vector IS 'Text-based vector embedding (768 dimensions) for semantic search';

-- Step 3: Add image_vector column to products table (768 dimensions)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'products' 
    AND column_name = 'image_vector'
  ) THEN
    ALTER TABLE public.products ADD COLUMN image_vector vector(768);
  END IF;
END $$;

COMMENT ON COLUMN public.products.image_vector IS 'Image-based vector embedding (768 dimensions) for visual similarity search';

-- Step 4: Create ivfflat index for text_vector using cosine distance
CREATE INDEX IF NOT EXISTS idx_products_text_vector 
ON public.products 
USING ivfflat (text_vector vector_cosine_ops) 
WITH (lists = 100);

-- Step 5: Create ivfflat index for image_vector using cosine distance
CREATE INDEX IF NOT EXISTS idx_products_image_vector 
ON public.products 
USING ivfflat (image_vector vector_cosine_ops) 
WITH (lists = 100);


