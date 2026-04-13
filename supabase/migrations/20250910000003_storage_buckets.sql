-- Create storage buckets for VTO assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('neutral-poses', 'neutral-poses', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('generations', 'generations', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('temp-candidates', 'temp-candidates', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']);

-- RLS for neutral-poses storage
CREATE POLICY "Users can upload their neutral poses"
ON storage.objects FOR INSERT
TO authenticated, anon
WITH CHECK (bucket_id = 'neutral-poses' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view their neutral poses"
ON storage.objects FOR SELECT
TO authenticated, anon
USING (bucket_id = 'neutral-poses' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their neutral poses"
ON storage.objects FOR DELETE
TO authenticated, anon
USING (bucket_id = 'neutral-poses' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS for generations storage
CREATE POLICY "Users can upload their generations"
ON storage.objects FOR INSERT
TO authenticated, anon
WITH CHECK (bucket_id = 'generations' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view their generations"
ON storage.objects FOR SELECT
TO authenticated, anon
USING (bucket_id = 'generations' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their generations"
ON storage.objects FOR DELETE
TO authenticated, anon
USING (bucket_id = 'generations' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS for temp-candidates storage
CREATE POLICY "Users can upload their temp candidates"
ON storage.objects FOR INSERT
TO authenticated, anon
WITH CHECK (bucket_id = 'temp-candidates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view their temp candidates"
ON storage.objects FOR SELECT
TO authenticated, anon
USING (bucket_id = 'temp-candidates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their temp candidates"
ON storage.objects FOR DELETE
TO authenticated, anon
USING (bucket_id = 'temp-candidates' AND (storage.foldername(name))[1] = auth.uid()::text);