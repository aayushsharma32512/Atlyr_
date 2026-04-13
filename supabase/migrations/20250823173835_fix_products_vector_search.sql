-- Migration: Fix products vector search function type mismatch
-- Purpose: Correct the return type for the 'type' column in search_products_by_vector function

-- Drop the existing function
DROP FUNCTION IF EXISTS search_products_by_vector(vector(1536), float, int);

-- Recreate the function with correct type definition
CREATE OR REPLACE FUNCTION search_products_by_vector(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  type item_type,
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

-- Add comment for documentation
COMMENT ON FUNCTION search_products_by_vector IS 'Search products by vector similarity using cosine distance (fixed type definition)';
