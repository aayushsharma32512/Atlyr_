-- Migration: Add vector embeddings support for outfits and products
-- Purpose: Enable semantic search using OpenAI text-embedding-3-small model (1536 dimensions)

-- Step 0: Enable pgvector extension FIRST (required before using vector type)
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 1: Add description_text column to outfits table
ALTER TABLE public.outfits 
ADD COLUMN IF NOT EXISTS description_text TEXT;

COMMENT ON COLUMN public.outfits.description_text IS 'Natural language description of the outfit for vector embedding generation';

-- Step 2: Add vector_embedding column to outfits table
-- Using vector(1536) for OpenAI text-embedding-3-small model
ALTER TABLE public.outfits 
ADD COLUMN IF NOT EXISTS vector_embedding vector(1536);

COMMENT ON COLUMN public.outfits.vector_embedding IS 'Vector embedding (1536 dimensions) for semantic search using OpenAI text-embedding-3-small';

-- Step 3: Add description_text column to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS description_text TEXT;

COMMENT ON COLUMN public.products.description_text IS 'Natural language description of the product for vector embedding generation';

-- Step 4: Add vector_embedding column to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS vector_embedding vector(1536);

COMMENT ON COLUMN public.products.vector_embedding IS 'Vector embedding (1536 dimensions) for semantic search using OpenAI text-embedding-3-small';

-- Step 5: Create indexes for vector similarity search
CREATE INDEX IF NOT EXISTS idx_outfits_vector_embedding ON public.outfits USING ivfflat (vector_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_products_vector_embedding ON public.products USING ivfflat (vector_embedding vector_cosine_ops) WITH (lists = 100);

-- Step 6: Create function for vector similarity search on outfits
CREATE OR REPLACE FUNCTION search_outfits_by_vector(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  category TEXT,
  occasion TEXT,
  background_id TEXT,
  gender TEXT,
  created_by TEXT,
  fit TEXT,
  feel TEXT,
  word_association TEXT,
  description TEXT,
  outfit_match TEXT,
  visible_in_feed BOOLEAN,
  popularity INTEGER,
  rating FLOAT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  description_text TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.name,
    o.category,
    o.occasion,
    o.background_id,
    o.gender,
    o.created_by,
    o.fit,
    o.feel,
    o.word_association,
    o.description,
    o.outfit_match,
    o.visible_in_feed,
    o.popularity,
    o.rating,
    o.created_at,
    o.updated_at,
    o.description_text,
    1 - (o.vector_embedding <=> query_embedding) AS similarity
  FROM public.outfits o
  WHERE o.vector_embedding IS NOT NULL
    AND 1 - (o.vector_embedding <=> query_embedding) > match_threshold
  ORDER BY o.vector_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 7: Create function for vector similarity search on products
CREATE OR REPLACE FUNCTION search_products_by_vector(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  type TEXT,
  brand TEXT,
  size TEXT,
  price INTEGER,
  currency TEXT,
  image_url TEXT,
  description TEXT,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  description_text TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.type,
    p.brand,
    p.size,
    p.price,
    p.currency,
    p.image_url,
    p.description,
    p.color,
    p.created_at,
    p.updated_at,
    p.description_text,
    1 - (p.vector_embedding <=> query_embedding) AS similarity
  FROM public.products p
  WHERE p.vector_embedding IS NOT NULL
    AND 1 - (p.vector_embedding <=> query_embedding) > match_threshold
  ORDER BY p.vector_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 8: Add comments for documentation
COMMENT ON FUNCTION search_outfits_by_vector IS 'Search outfits by vector similarity using cosine distance';
COMMENT ON FUNCTION search_products_by_vector IS 'Search products by vector similarity using cosine distance';
