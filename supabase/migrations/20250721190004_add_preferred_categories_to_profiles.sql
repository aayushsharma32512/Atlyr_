-- Add preferred_categories column to profiles table
-- This will store an array of category IDs that the user has selected during onboarding

ALTER TABLE profiles 
ADD COLUMN preferred_categories TEXT[] DEFAULT '{}';

-- Add a comment to document the purpose
COMMENT ON COLUMN profiles.preferred_categories IS 'Array of category IDs that the user has selected as their preferred categories during onboarding'; 