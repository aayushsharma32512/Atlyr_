-- Add RPC functions for dual-retrieval search using cosine distance

CREATE OR REPLACE FUNCTION match_products_text(
  query_embedding vector(768),
  match_threshold float DEFAULT 0,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  id TEXT,
  product_name TEXT,
  brand TEXT,
  color TEXT,
  type_category TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.product_name,
    p.brand,
    p.color,
    p.type_category,
    1 - (p.text_vector <=> query_embedding) AS similarity
  FROM public.products p
  WHERE p.text_vector IS NOT NULL
    AND 1 - (p.text_vector <=> query_embedding) > match_threshold
  ORDER BY p.text_vector <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_products_image(
  query_embedding vector(768),
  match_threshold float DEFAULT 0,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  id TEXT,
  product_name TEXT,
  brand TEXT,
  color TEXT,
  type_category TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.product_name,
    p.brand,
    p.color,
    p.type_category,
    1 - (p.image_vector <=> query_embedding) AS similarity
  FROM public.products p
  WHERE p.image_vector IS NOT NULL
    AND 1 - (p.image_vector <=> query_embedding) > match_threshold
  ORDER BY p.image_vector <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_products_text IS 'Match products by text vector using cosine distance (top 50)';
COMMENT ON FUNCTION match_products_image IS 'Match products by image vector using cosine distance (top 50)';

