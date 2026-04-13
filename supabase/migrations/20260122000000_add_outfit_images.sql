-- Add outfit_images column to outfits table for storing mannequin snapshot URLs
-- This stores the rendered outfit preview image

ALTER TABLE public.outfits
ADD COLUMN IF NOT EXISTS outfit_images TEXT NULL;

-- Create storage bucket for outfit preview images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('outfit-previews', 'outfit-previews', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- RLS: Anyone can view outfit previews (public bucket)
CREATE POLICY "Public can view outfit previews"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'outfit-previews');

-- RLS: Authenticated users can upload outfit previews
CREATE POLICY "Authenticated users can upload outfit previews"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'outfit-previews');

-- RLS: Users can delete their own outfit previews
CREATE POLICY "Users can delete their outfit previews"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'outfit-previews' AND (storage.foldername(name))[1] = auth.uid()::text);
