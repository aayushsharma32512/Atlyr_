-- Migration: Add multimodal vector embeddings to outfits table
-- Purpose: Enable separate text and image-based semantic search with 768 dimensions (Fashion-SigLIP)
-- text_vector: generated from enriched_description column
-- image_vector: generated from outfit_images column (rendered mannequin preview)

-- Step 1: Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add text_vector column to outfits table (768 dimensions)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'outfits' 
    AND column_name = 'text_vector'
  ) THEN
    ALTER TABLE public.outfits ADD COLUMN text_vector vector(768);
  END IF;
END $$;

COMMENT ON COLUMN public.outfits.text_vector IS 'Text-based vector embedding (768 dimensions) for semantic search, generated from enriched_description';

-- Step 3: Add image_vector column to outfits table (768 dimensions)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'outfits' 
    AND column_name = 'image_vector'
  ) THEN
    ALTER TABLE public.outfits ADD COLUMN image_vector vector(768);
  END IF;
END $$;

COMMENT ON COLUMN public.outfits.image_vector IS 'Image-based vector embedding (768 dimensions) for visual similarity search, generated from outfit_images';

-- Step 4: Create ivfflat index for text_vector using cosine distance
CREATE INDEX IF NOT EXISTS idx_outfits_text_vector 
ON public.outfits 
USING ivfflat (text_vector vector_cosine_ops) 
WITH (lists = 100);

-- Step 5: Create ivfflat index for image_vector using cosine distance
CREATE INDEX IF NOT EXISTS idx_outfits_image_vector 
ON public.outfits 
USING ivfflat (image_vector vector_cosine_ops) 
WITH (lists = 100);

-- Step 6: Create RPC function for text-based outfit search
-- Matches the format of match_products_text exactly
CREATE OR REPLACE FUNCTION match_outfits_text(
  query_embedding vector(768),
  filters jsonb DEFAULT '{}'::jsonb,
  match_threshold float DEFAULT 0,
  match_count int DEFAULT 100
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  category TEXT,
  occasion TEXT,
  gender TEXT,
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
    o.gender,
    1 - (o.text_vector <=> query_embedding) AS similarity
  FROM public.outfits o
  WHERE o.text_vector IS NOT NULL
    AND o.visible_in_feed = true
    AND 1 - (o.text_vector <=> query_embedding) > match_threshold
    -- Gender filter
    AND (
      (filters->'genders' IS NULL OR jsonb_array_length(filters->'genders') = 0) 
      OR (o.gender = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'genders'))))
    )
    -- Category filter
    AND (
      (filters->'categories' IS NULL OR jsonb_array_length(filters->'categories') = 0) 
      OR (o.category = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'categories'))))
    )
    -- Occasion filter
    AND (
      (filters->'occasions' IS NULL OR jsonb_array_length(filters->'occasions') = 0) 
      OR (o.occasion = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'occasions'))))
    )
    -- Fit filter (enriched_fit is text array)
    AND (
      (filters->'fits' IS NULL OR jsonb_array_length(filters->'fits') = 0)
      OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(filters->'fits') AS f
         WHERE f = ANY(o.enriched_fit)
      )
    )
    -- Vibes filter (enriched_vibes is text array)
    AND (
      (filters->'vibes' IS NULL OR jsonb_array_length(filters->'vibes') = 0)
      OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(filters->'vibes') AS f
         WHERE f = ANY(o.enriched_vibes)
      )
    )
    -- Feel filter (enriched_feel is text array)
    AND (
      (filters->'feels' IS NULL OR jsonb_array_length(filters->'feels') = 0)
      OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(filters->'feels') AS f
         WHERE f = ANY(o.enriched_feel)
      )
    )
  ORDER BY o.text_vector <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_outfits_text IS 'Search outfits by text vector similarity using cosine distance with filter support';

-- Step 7: Create RPC function for image-based outfit search
-- Matches the format of match_products_image exactly
CREATE OR REPLACE FUNCTION match_outfits_image(
  query_embedding vector(768),
  filters jsonb DEFAULT '{}'::jsonb,
  match_threshold float DEFAULT 0,
  match_count int DEFAULT 100
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  category TEXT,
  occasion TEXT,
  gender TEXT,
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
    o.gender,
    1 - (o.image_vector <=> query_embedding) AS similarity
  FROM public.outfits o
  WHERE o.image_vector IS NOT NULL
    AND o.visible_in_feed = true
    AND 1 - (o.image_vector <=> query_embedding) > match_threshold
    -- Gender filter
    AND (
      (filters->'genders' IS NULL OR jsonb_array_length(filters->'genders') = 0) 
      OR (o.gender = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'genders'))))
    )
    -- Category filter
    AND (
      (filters->'categories' IS NULL OR jsonb_array_length(filters->'categories') = 0) 
      OR (o.category = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'categories'))))
    )
    -- Occasion filter
    AND (
      (filters->'occasions' IS NULL OR jsonb_array_length(filters->'occasions') = 0) 
      OR (o.occasion = ANY(ARRAY(SELECT jsonb_array_elements_text(filters->'occasions'))))
    )
    -- Fit filter
    AND (
      (filters->'fits' IS NULL OR jsonb_array_length(filters->'fits') = 0)
      OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(filters->'fits') AS f
         WHERE f = ANY(o.enriched_fit)
      )
    )
    -- Vibes filter
    AND (
      (filters->'vibes' IS NULL OR jsonb_array_length(filters->'vibes') = 0)
      OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(filters->'vibes') AS f
         WHERE f = ANY(o.enriched_vibes)
      )
    )
    -- Feel filter
    AND (
      (filters->'feels' IS NULL OR jsonb_array_length(filters->'feels') = 0)
      OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(filters->'feels') AS f
         WHERE f = ANY(o.enriched_feel)
      )
    )
  ORDER BY o.image_vector <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_outfits_image IS 'Search outfits by image vector similarity using cosine distance with filter support';
