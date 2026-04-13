-- Add user linkage and vibes metadata to outfits
ALTER TABLE public.outfits
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

ALTER TABLE public.outfits
ADD COLUMN IF NOT EXISTS vibes TEXT;

-- Tighten insert policy to tie inserts to the authenticated user when user_id is provided
DROP POLICY IF EXISTS "Authenticated users can insert outfits" ON public.outfits;
CREATE POLICY "Authenticated users can insert outfits"
ON public.outfits
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
