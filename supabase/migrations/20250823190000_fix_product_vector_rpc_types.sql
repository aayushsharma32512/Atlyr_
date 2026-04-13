-- Migration: Fix product vector search RPC to use correct types
-- This corrects the search_products_by_vector function to use item_type enum instead of TEXT

-- Drop the existing function first, then recreate it with the correct types
DROP FUNCTION IF EXISTS public.search_products_by_vector(vector(1536), float, int);

CREATE OR REPLACE FUNCTION search_products_by_vector(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  type item_type,
  brand TEXT,
  product_name TEXT,
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
    p.product_name,
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

COMMENT ON FUNCTION search_products_by_vector IS 'Search products by vector similarity with correct types and product_name';
