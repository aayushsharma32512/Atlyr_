-- Allow clients to list staple product images for the landing page grid
DROP POLICY IF EXISTS "Staples images are viewable by all" ON storage.objects;

CREATE POLICY "Staples images are viewable by all"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'product-images'
  AND name LIKE 'product-images/staples/%'
);
