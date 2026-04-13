-- Allow users to update their own outfits
-- This enables updating outfit_images after snapshot capture

CREATE POLICY "Users can update their own outfits"
ON public.outfits
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
