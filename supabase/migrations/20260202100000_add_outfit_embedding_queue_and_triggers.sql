-- Migration: Add outfit embedding queue and auto-nullify triggers
-- Mirrors the products embedding queue system for outfits

-- ============================================
-- Part 1: Add Vector Versioning Columns to Outfits
-- ============================================

-- Add vector_version column (defaults to 1 for existing rows)
ALTER TABLE outfits 
ADD COLUMN IF NOT EXISTS vector_version INT DEFAULT 1;

-- Add embedded_at timestamp column (NULL for rows that haven't been embedded yet)
ALTER TABLE outfits 
ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE NULL;

-- Add index for efficient querying of rows needing updates
CREATE INDEX IF NOT EXISTS idx_outfits_embedding_status 
ON outfits(vector_version, embedded_at, updated_at)
WHERE text_vector IS NULL OR image_vector IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN outfits.vector_version IS 'Version of the embedding model/logic used. Increment when model changes.';
COMMENT ON COLUMN outfits.embedded_at IS 'Timestamp when embeddings were last generated for this outfit.';

-- ============================================
-- Part 2: Create Outfit Embedding Queue Table
-- ============================================

CREATE TABLE IF NOT EXISTS outfit_embedding_queue (
  id BIGSERIAL PRIMARY KEY,
  outfit_id TEXT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  needs_text_embedding BOOLEAN DEFAULT FALSE,
  needs_image_embedding BOOLEAN DEFAULT FALSE,
  queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(outfit_id)
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_outfit_embedding_queue_outfit_id ON outfit_embedding_queue(outfit_id);
CREATE INDEX IF NOT EXISTS idx_outfit_embedding_queue_queued_at ON outfit_embedding_queue(queued_at);

-- Add comment
COMMENT ON TABLE outfit_embedding_queue IS 'Queue for outfits that need embedding updates';

-- ============================================
-- Part 3: Queue-Based Trigger System for Outfits
-- ============================================

-- Drop old triggers if they exist
DROP TRIGGER IF EXISTS trg_queue_outfit_embedding_update ON outfits;
DROP TRIGGER IF EXISTS trg_queue_new_outfit ON outfits;
DROP FUNCTION IF EXISTS queue_outfit_embedding_update();
DROP FUNCTION IF EXISTS queue_new_outfit();

-- Create combined trigger function for outfit updates
-- text_vector source: enriched_description
-- image_vector source: outfit_images
CREATE OR REPLACE FUNCTION queue_outfit_embedding_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if text source field changed (enriched_description)
  IF (NEW.enriched_description IS DISTINCT FROM OLD.enriched_description)
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

-- Create trigger for outfit updates
CREATE TRIGGER trg_queue_outfit_embedding_update
  BEFORE UPDATE ON outfits
  FOR EACH ROW
  EXECUTE FUNCTION queue_outfit_embedding_update();

-- Create trigger function for new outfits
CREATE OR REPLACE FUNCTION queue_new_outfit()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if vectors are missing AND source fields exist
  IF (NEW.text_vector IS NULL AND NEW.enriched_description IS NOT NULL)
     OR (NEW.image_vector IS NULL AND NEW.outfit_images IS NOT NULL)
  THEN
    INSERT INTO outfit_embedding_queue (
      outfit_id, 
      needs_text_embedding, 
      needs_image_embedding
    )
    VALUES (
      NEW.id, 
      NEW.text_vector IS NULL AND NEW.enriched_description IS NOT NULL,
      NEW.image_vector IS NULL AND NEW.outfit_images IS NOT NULL
    )
    ON CONFLICT (outfit_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new outfits
CREATE TRIGGER trg_queue_new_outfit
  AFTER INSERT ON outfits
  FOR EACH ROW
  EXECUTE FUNCTION queue_new_outfit();

-- Add documentation
COMMENT ON FUNCTION queue_outfit_embedding_update() IS 'Queues outfits for embedding updates when source fields change (enriched_description, outfit_images)';
COMMENT ON FUNCTION queue_new_outfit() IS 'Queues new outfits with missing embeddings';
