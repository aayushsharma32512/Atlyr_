-- Migration: Add product_name column to products table
ALTER TABLE products ADD COLUMN product_name TEXT NULL;
-- (No rollback provided here)


