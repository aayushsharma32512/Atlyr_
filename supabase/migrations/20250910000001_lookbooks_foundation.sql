-- Extend user_favorites for collections
ALTER TABLE user_favorites 
ADD COLUMN collection_slug TEXT NOT NULL DEFAULT 'favorites',
ADD COLUMN collection_label TEXT NOT NULL DEFAULT 'Favorites';

-- Update existing data
UPDATE user_favorites SET collection_slug = 'favorites', collection_label = 'Favorites';

-- Add new constraints (after data migration)
ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_user_id_outfit_id_key;
ALTER TABLE user_favorites 
ADD CONSTRAINT user_favorites_unique_collection_outfit 
UNIQUE (user_id, collection_slug, outfit_id);

CREATE INDEX idx_user_favorites_collection ON user_favorites (user_id, collection_slug);

-- Add collections metadata to profiles
ALTER TABLE profiles ADD COLUMN collections_meta JSONB DEFAULT '{"order": ["favorites", "generations"]}';

-- Create neutral poses table
CREATE TYPE neutral_pose_status AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE user_neutral_poses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  original_fullbody_path TEXT NOT NULL,
  original_selfie_path TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  status neutral_pose_status NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce one active pose per user
CREATE UNIQUE INDEX idx_user_neutral_poses_active 
ON user_neutral_poses (user_id) WHERE is_active = true;

CREATE INDEX idx_user_neutral_poses_user ON user_neutral_poses (user_id, created_at DESC);

-- Create generations table
CREATE TYPE generation_status AS ENUM ('queued', 'generating', 'ready', 'failed');

CREATE TABLE user_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outfit_id TEXT REFERENCES outfits(id) ON DELETE SET NULL,
  neutral_pose_id UUID NOT NULL REFERENCES user_neutral_poses(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,
  status generation_status NOT NULL DEFAULT 'queued',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_generations_user ON user_generations (user_id, created_at DESC);
CREATE INDEX idx_user_generations_outfit ON user_generations (user_id, outfit_id);

-- Extend products for VTO summaries
ALTER TABLE products 
ADD COLUMN garment_summary JSONB,
ADD COLUMN garment_summary_version TEXT;

-- Extend product_images for VTO eligibility
ALTER TABLE product_images 
ADD COLUMN vto_eligible BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_product_images_vto_eligible 
ON product_images (product_id, kind, vto_eligible) WHERE vto_eligible = true;

-- Add privacy to outfits
ALTER TABLE outfits 
ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT true;