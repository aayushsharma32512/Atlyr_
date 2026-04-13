-- Create embedding queue table
CREATE TABLE IF NOT EXISTS embedding_queue (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  needs_text_embedding BOOLEAN DEFAULT FALSE,
  needs_image_embedding BOOLEAN DEFAULT FALSE,
  queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(product_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_embedding_queue_product_id ON embedding_queue(product_id);
CREATE INDEX IF NOT EXISTS idx_embedding_queue_queued_at ON embedding_queue(queued_at);

-- Add comment
COMMENT ON TABLE embedding_queue IS 'Queue for products that need embedding updates';
