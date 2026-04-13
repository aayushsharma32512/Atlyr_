-- Fix critical issues in previous migrations

-- Remove the incorrect attempt to change outfit_id to UUID
-- Keep it as TEXT to match outfits.id which is TEXT type

-- Fix storage_path to allow empty default for queued generations
ALTER TABLE user_generations ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE user_generations ALTER COLUMN storage_path SET DEFAULT '';

-- Fix collections_meta to include full structure
UPDATE profiles 
SET collections_meta = '{
  "order": ["favorites", "generations"],
  "favorites": {"label": "Favorites", "isSystem": true},
  "generations": {"label": "Generations", "isSystem": true}
}'
WHERE collections_meta = '{"order": ["favorites", "generations"]}';

-- Update default for new profiles
ALTER TABLE profiles 
ALTER COLUMN collections_meta 
SET DEFAULT '{
  "order": ["favorites", "generations"],
  "favorites": {"label": "Favorites", "isSystem": true},
  "generations": {"label": "Generations", "isSystem": true}
}';