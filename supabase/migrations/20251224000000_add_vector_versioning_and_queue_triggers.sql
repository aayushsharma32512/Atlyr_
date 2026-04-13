-- Combined migration: Add vector versioning and queue-based trigger system
-- Replaces separate migrations: 20251207040000_add_vector_versioning and 20251217000001_update_triggers_with_queue

-- ============================================
-- Part 1: Add Vector Versioning Columns
-- ============================================

-- Add vector_version column (defaults to 1 for existing rows)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS vector_version INT DEFAULT 1;

-- Add embedded_at timestamp column (NULL for rows that haven't been embedded yet)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE NULL;

-- Add index for efficient querying of rows needing updates
CREATE INDEX IF NOT EXISTS idx_products_embedding_status 
ON products(vector_version, embedded_at, updated_at)
WHERE text_vector IS NULL OR image_vector IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN products.vector_version IS 'Version of the embedding model/logic used. Increment when model changes.';
COMMENT ON COLUMN products.embedded_at IS 'Timestamp when embeddings were last generated for this product.';

-- ============================================
-- Part 2: Queue-Based Trigger System
-- ============================================

-- Drop old triggers if they exist
DROP TRIGGER IF EXISTS trg_nullify_text_vector ON products;
DROP TRIGGER IF EXISTS trg_nullify_image_vector ON products;
DROP FUNCTION IF EXISTS nullify_text_vector_on_update();
DROP FUNCTION IF EXISTS nullify_image_vector_on_update();

-- Create combined trigger function for product updates
CREATE OR REPLACE FUNCTION queue_embedding_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if text fields changed (product_name, description, fit, feel, color, vibes, type_category)
  IF (NEW.product_name IS DISTINCT FROM OLD.product_name)
     OR (NEW.description IS DISTINCT FROM OLD.description)
     OR (NEW.fit IS DISTINCT FROM OLD.fit)
     OR (NEW.feel IS DISTINCT FROM OLD.feel)
     OR (NEW.color IS DISTINCT FROM OLD.color)
     OR (NEW.vibes IS DISTINCT FROM OLD.vibes)
     OR (NEW.type_category IS DISTINCT FROM OLD.type_category)
  THEN
    NEW.text_vector := NULL;
    
    -- Add to queue with refreshed timestamp
    INSERT INTO embedding_queue (product_id, needs_text_embedding)
    VALUES (NEW.id, TRUE)
    ON CONFLICT (product_id) 
    DO UPDATE SET 
      needs_text_embedding = TRUE, 
      queued_at = NOW();
  END IF;
  
  -- Check if image changed
  IF (NEW.image_url IS DISTINCT FROM OLD.image_url) THEN
    NEW.image_vector := NULL;
    
    -- Add to queue with needs_image_embedding = TRUE
    INSERT INTO embedding_queue (product_id, needs_image_embedding)
    VALUES (NEW.id, TRUE)
    ON CONFLICT (product_id) 
    DO UPDATE SET 
      needs_image_embedding = TRUE, 
      queued_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for product updates
CREATE TRIGGER trg_queue_embedding_update
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION queue_embedding_update();

-- Create trigger function for new products
CREATE OR REPLACE FUNCTION queue_new_product()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.text_vector IS NULL OR NEW.image_vector IS NULL THEN
    INSERT INTO embedding_queue (
      product_id, 
      needs_text_embedding, 
      needs_image_embedding
    )
    VALUES (
      NEW.id, 
      NEW.text_vector IS NULL,
      NEW.image_vector IS NULL
    )
    ON CONFLICT (product_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new products
CREATE TRIGGER trg_queue_new_product
  AFTER INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION queue_new_product();

-- Add documentation
COMMENT ON FUNCTION queue_embedding_update() IS 'Queues products for embedding updates when fields change';
COMMENT ON FUNCTION queue_new_product() IS 'Queues new products with missing embeddings';
