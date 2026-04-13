-- Drop old functions to avoid signature conflicts
DROP FUNCTION IF EXISTS match_products_text(vector, float, int);
DROP FUNCTION IF EXISTS match_products_image(vector, float, int);
DROP FUNCTION IF EXISTS match_products_text(vector, jsonb, float, int);
DROP FUNCTION IF EXISTS match_products_image(vector, jsonb, float, int);

-- 1. Text Match with Filters
CREATE OR REPLACE FUNCTION match_products_text(
  query_embedding vector(768),
  filters jsonb DEFAULT '{}'::jsonb,
  match_threshold float DEFAULT 0,
  match_count int DEFAULT 100
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
    p.type_category, -- Keeps compatibility with frontend which expects 'type_category'
    1 - (p.text_vector <=> query_embedding) AS similarity
  FROM public.products p
  WHERE p.text_vector IS NOT NULL
    AND 1 - (p.text_vector <=> query_embedding) > match_threshold
    -- Dynamic Filtering Logic
    AND (
      (filters->'genders' IS NULL OR jsonb_array_length(filters->'genders') = 0) 
      OR (p.gender = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'genders'))))
    )
    AND (
      (filters->'brands' IS NULL OR jsonb_array_length(filters->'brands') = 0) 
      OR (p.brand = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'brands'))))
    )
    AND (
      (filters->'categoryIds' IS NULL OR jsonb_array_length(filters->'categoryIds') = 0) 
      OR (p.category_id = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'categoryIds'))))
    )
    -- !!! FIX: Using 'type' column with ::text cast to handle Enum comparison !!!
    AND (
      (filters->'typeCategories' IS NULL OR jsonb_array_length(filters->'typeCategories') = 0)
      OR (p.type::text = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'typeCategories'))))
    )
    AND (
      (filters->'fits' IS NULL OR jsonb_array_length(filters->'fits') = 0) 
      OR (p.fit = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'fits'))))
    )
    AND (
      (filters->'feels' IS NULL OR jsonb_array_length(filters->'feels') = 0) 
      OR (p.feel = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'feels'))))
    )
    AND (
      (filters->'vibes' IS NULL OR jsonb_array_length(filters->'vibes') = 0) 
      OR (p.vibes = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'vibes'))))
    )
    AND (
      (filters->>'minPrice' IS NULL) OR (p.price >= (filters->>'minPrice')::numeric)
    )
    AND (
      (filters->>'maxPrice' IS NULL) OR (p.price <= (filters->>'maxPrice')::numeric)
    )
  ORDER BY p.text_vector <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

-- 2. Image Match with Filters
CREATE OR REPLACE FUNCTION match_products_image(
  query_embedding vector(768),
  filters jsonb DEFAULT '{}'::jsonb,
  match_threshold float DEFAULT 0,
  match_count int DEFAULT 100
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
    -- Dynamic Filtering Logic (Same as text)
    AND (
      (filters->'genders' IS NULL OR jsonb_array_length(filters->'genders') = 0) 
      OR (p.gender = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'genders'))))
    )
    AND (
      (filters->'brands' IS NULL OR jsonb_array_length(filters->'brands') = 0) 
      OR (p.brand = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'brands'))))
    )
    AND (
      (filters->'categoryIds' IS NULL OR jsonb_array_length(filters->'categoryIds') = 0) 
      OR (p.category_id = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'categoryIds'))))
    )
    -- !!! FIX: Using 'type' column with ::text cast !!!
    AND (
      (filters->'typeCategories' IS NULL OR jsonb_array_length(filters->'typeCategories') = 0)
      OR (p.type::text = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'typeCategories'))))
    )
    AND (
      (filters->'fits' IS NULL OR jsonb_array_length(filters->'fits') = 0) 
      OR (p.fit = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'fits'))))
    )
    AND (
      (filters->'feels' IS NULL OR jsonb_array_length(filters->'feels') = 0) 
      OR (p.feel = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'feels'))))
    )
    AND (
      (filters->'vibes' IS NULL OR jsonb_array_length(filters->'vibes') = 0) 
      OR (p.vibes = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'vibes'))))
    )
    AND (
      (filters->>'minPrice' IS NULL) OR (p.price >= (filters->>'minPrice')::numeric)
    )
    AND (
      (filters->>'maxPrice' IS NULL) OR (p.price <= (filters->>'maxPrice')::numeric)
    )
  ORDER BY p.image_vector <=> query_embedding ASC
  LIMIT match_count;
END;
$$;