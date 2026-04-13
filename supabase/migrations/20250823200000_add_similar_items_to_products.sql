-- Add similar_items column to products table
-- This column will store comma-separated product IDs for similar items

ALTER TABLE products ADD COLUMN similar_items TEXT;

-- Add a comment to document the column purpose
COMMENT ON COLUMN products.similar_items IS 'Comma-separated list of product IDs for similar items. Used for the "Similar Items" feature in the studio alternates panel.';

-- Create an index on the similar_items column for better performance when querying
CREATE INDEX idx_products_similar_items ON products USING gin(to_tsvector('english', similar_items));


