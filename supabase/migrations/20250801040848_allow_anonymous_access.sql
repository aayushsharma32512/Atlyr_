-- Allow anonymous access to public data for guest users
-- Drop existing policies that require authentication
DROP POLICY IF EXISTS "Silhouettes are viewable by all" ON public.silhouettes;
DROP POLICY IF EXISTS "Categories are viewable by all" ON public.categories;
DROP POLICY IF EXISTS "Occasions are viewable by all" ON public.occasions;
DROP POLICY IF EXISTS "Products are viewable by all" ON public.products;
DROP POLICY IF EXISTS "Outfits are viewable by all" ON public.outfits;

-- Create new policies that allow anonymous access for core app data
CREATE POLICY "Silhouettes are viewable by all" ON public.silhouettes FOR SELECT USING (true);
CREATE POLICY "Categories are viewable by all" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Occasions are viewable by all" ON public.occasions FOR SELECT USING (true);
CREATE POLICY "Products are viewable by all" ON public.products FOR SELECT USING (true);
CREATE POLICY "Outfits are viewable by all" ON public.outfits FOR SELECT USING (true);

-- Add policies for analytics tables (optional for guests)
-- Global metrics already has anon access, but let's ensure it's consistent
DROP POLICY IF EXISTS "Global metrics are viewable by all" ON public.global_metrics;
CREATE POLICY "Global metrics are viewable by all" ON public.global_metrics FOR SELECT USING (true);

-- Add policies for user interactions (optional for guests)
-- Guests can insert interactions but not view others' data
DROP POLICY IF EXISTS "Users can insert their own interactions" ON public.user_interactions;
CREATE POLICY "Users can insert their own interactions" ON public.user_interactions 
FOR INSERT WITH CHECK (true);

-- Add policies for outfit hashes (optional for guests)
-- Guests can insert outfit hashes but not view others' data
DROP POLICY IF EXISTS "Users can insert their own outfit hashes" ON public.outfit_hashes;
CREATE POLICY "Users can insert their own outfit hashes" ON public.outfit_hashes 
FOR INSERT WITH CHECK (true); 