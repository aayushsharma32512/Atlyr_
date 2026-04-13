-- Update seed data with ratings and use current schema structure
-- This migration adds realistic ratings to existing outfits and ensures proper structure

-- First, let's update the existing outfits to add ratings
UPDATE public.outfits SET rating = 4.5 WHERE id = 'outfit-work-1';
UPDATE public.outfits SET rating = 4.2 WHERE id = 'outfit-casual-1';
UPDATE public.outfits SET rating = 4.8 WHERE id = 'outfit-date-1';
UPDATE public.outfits SET rating = 4.3 WHERE id = 'outfit-party-1';
UPDATE public.outfits SET rating = 4.1 WHERE id = 'outfit-travel-1';
UPDATE public.outfits SET rating = 4.6 WHERE id = 'outfit-brunch-1';
UPDATE public.outfits SET rating = 4.7 WHERE id = 'outfit-old-money-1';
UPDATE public.outfits SET rating = 4.4 WHERE id = 'outfit-work-2';

-- Now let's add more outfits with ratings to ensure we have good coverage for each category
INSERT INTO public.outfits (id, name, category, occasion, background_id, top_id, bottom_id, shoes_id, rating) VALUES
-- Streetwear category (highest ratings)
('outfit-streetwear-1', 'Trendy Street Style', 'streetwear', 'casual', '/Backgrounds/8.png', 'top-12', 'bottom-16', 'shoes-22', 4.9),
('outfit-streetwear-2', 'Modern Minimalist', 'streetwear', 'casual', '/Backgrounds/8.png', 'top-7', 'bottom-18', 'shoes-22', 4.7),

-- Date Ready category
('outfit-date-ready-2', 'Elegant Evening', 'date-ready', 'date', '/Backgrounds/9.png', 'top-11', 'bottom-20', 'shoes-23', 4.8),
('outfit-date-ready-3', 'Romantic Brunch', 'date-ready', 'brunch', '/Backgrounds/13.png', 'top-14', 'bottom-18', 'shoes-22', 4.6),

-- Old Money category
('outfit-old-money-2', 'Classic Sophistication', 'old-money', 'business', '/Backgrounds/14.png', 'top-l3', 'bottom-l2', 'shoes-23', 4.9),
('outfit-old-money-3', 'Timeless Luxury', 'old-money', 'work', '/Backgrounds/7.png', 'top-13', 'bottom-17', 'shoes-21', 4.7),

-- Casual Outing category
('outfit-casual-outing-2', 'Weekend Comfort', 'casual-outing', 'casual', '/Backgrounds/8.png', 'top-9', 'bottom-16', 'shoes-22', 4.4),
('outfit-casual-outing-3', 'Relaxed Style', 'casual-outing', 'casual', '/Backgrounds/8.png', 'top-6', 'bottom-18', 'shoes-22', 4.3),

-- CEO Core category
('outfit-ceo-core-3', 'Executive Power', 'ceo-core', 'work', '/Backgrounds/7.png', 'top-4', 'bottom-l2', 'shoes-21', 4.6),
('outfit-ceo-core-4', 'Corporate Classic', 'ceo-core', 'work', '/Backgrounds/7.png', 'top-l3', 'bottom-17', 'shoes-21', 4.5);

-- Update existing outfits to use the new schema structure (direct foreign keys)
-- This ensures all outfits have proper top_id, bottom_id, shoes_id values
UPDATE public.outfits SET 
  top_id = 'top-4',
  bottom_id = 'bottom-17', 
  shoes_id = 'shoes-21'
WHERE id = 'outfit-work-1';

UPDATE public.outfits SET 
  top_id = 'top-6',
  bottom_id = 'bottom-16', 
  shoes_id = 'shoes-22'
WHERE id = 'outfit-casual-1';

UPDATE public.outfits SET 
  top_id = 'top-5',
  bottom_id = 'bottom-20', 
  shoes_id = 'shoes-23'
WHERE id = 'outfit-date-1';

UPDATE public.outfits SET 
  top_id = 'top-8',
  bottom_id = 'bottom-19', 
  shoes_id = 'shoes-21'
WHERE id = 'outfit-party-1';

UPDATE public.outfits SET 
  top_id = 'top-7',
  bottom_id = 'bottom-18', 
  shoes_id = 'shoes-22'
WHERE id = 'outfit-travel-1';

UPDATE public.outfits SET 
  top_id = 'top-10',
  bottom_id = 'bottom-18', 
  shoes_id = 'shoes-22'
WHERE id = 'outfit-brunch-1';

UPDATE public.outfits SET 
  top_id = 'top-l3',
  bottom_id = 'bottom-l2', 
  shoes_id = 'shoes-23'
WHERE id = 'outfit-old-money-1';

UPDATE public.outfits SET 
  top_id = 'top-4',
  bottom_id = 'bottom-17', 
  shoes_id = 'shoes-21'
WHERE id = 'outfit-work-2'; 