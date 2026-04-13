-- Update collections_meta defaults to include try-ons and for-you ordering
UPDATE profiles
SET collections_meta = '{
  "order": ["favorites", "try-ons", "for-you"],
  "favorites": {"label": "Favorites", "isSystem": true},
  "try-ons": {"label": "Try-ons", "isSystem": true},
  "for-you": {"label": "For You", "isSystem": true}
}'
WHERE collections_meta = '{"order": ["favorites", "generations"], "favorites": {"label": "Favorites", "isSystem": true}, "generations": {"label": "Generations", "isSystem": true}}';

ALTER TABLE profiles 
ALTER COLUMN collections_meta 
SET DEFAULT '{
  "order": ["favorites", "try-ons", "for-you"],
  "favorites": {"label": "Favorites", "isSystem": true},
  "try-ons": {"label": "Try-ons", "isSystem": true},
  "for-you": {"label": "For You", "isSystem": true}
}';
