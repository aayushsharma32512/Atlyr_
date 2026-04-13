-- Migration: Allow authenticated users to insert outfits
CREATE POLICY "Authenticated users can insert outfits"
ON public.outfits
FOR INSERT
TO authenticated
WITH CHECK (true); 