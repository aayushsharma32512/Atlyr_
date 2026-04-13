-- Migration: Update outfit text vector source to search_summary
-- Purpose: Switch from listening to enriched_description to search_summary for text embeddings

-- 1. Update the combined trigger function for outfit updates
-- text_vector source switched to: search_summary
CREATE OR REPLACE FUNCTION queue_outfit_embedding_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if text source field changed (search_summary instead of enriched_description)
  IF (NEW.search_summary IS DISTINCT FROM OLD.search_summary)
  THEN
    NEW.text_vector := NULL;
    
    -- Add to queue with refreshed timestamp
    INSERT INTO outfit_embedding_queue (outfit_id, needs_text_embedding)
    VALUES (NEW.id, TRUE)
    ON CONFLICT (outfit_id) 
    DO UPDATE SET 
      needs_text_embedding = TRUE, 
      queued_at = NOW();
  END IF;
  
  -- Check if image source field changed (outfit_images)
  IF (NEW.outfit_images IS DISTINCT FROM OLD.outfit_images) THEN
    NEW.image_vector := NULL;
    
    -- Add to queue with needs_image_embedding = TRUE
    INSERT INTO outfit_embedding_queue (outfit_id, needs_image_embedding)
    VALUES (NEW.id, TRUE)
    ON CONFLICT (outfit_id) 
    DO UPDATE SET 
      needs_image_embedding = TRUE, 
      queued_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Update trigger function for new outfits
-- text_vector check switched to: search_summary
CREATE OR REPLACE FUNCTION queue_new_outfit()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if vectors are missing AND source fields exist
  IF (NEW.text_vector IS NULL AND NEW.search_summary IS NOT NULL)
     OR (NEW.image_vector IS NULL AND NEW.outfit_images IS NOT NULL)
  THEN
    INSERT INTO outfit_embedding_queue (
      outfit_id, 
      needs_text_embedding, 
      needs_image_embedding
    )
    VALUES (
      NEW.id, 
      NEW.text_vector IS NULL AND NEW.search_summary IS NOT NULL,
      NEW.image_vector IS NULL AND NEW.outfit_images IS NOT NULL
    )
    ON CONFLICT (outfit_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Update documentation comments
COMMENT ON COLUMN public.outfits.text_vector IS 'Text-based vector embedding (768 dimensions) for semantic search, generated from search_summary';
COMMENT ON FUNCTION queue_outfit_embedding_update() IS 'Queues outfits for embedding updates when source fields change (search_summary, outfit_images)';
COMMENT ON FUNCTION match_outfits_text IS 'Search outfits by text vector similarity (generated from search_summary) using cosine distance with filter support';
