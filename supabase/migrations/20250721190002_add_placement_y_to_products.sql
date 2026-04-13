-- Migration: Add placement_y column to products table
ALTER TABLE products ADD COLUMN placement_y INTEGER NULL;
-- Set all placement_y values to null (redundant, but explicit for migration)
UPDATE products SET placement_y = NULL;
-- (No rollback provided here) 