-- Phase 1: Populate core tables with actual data

-- Insert silhouettes
INSERT INTO public.silhouettes (id, name, image_url, description) VALUES
('default', 'Default', '/avatars/Default.png', 'Classic fit for all body types'),
('petite', 'Petite', '/avatars/Default.png', 'Specially designed for petite frames'),
('curvy', 'Curvy', '/avatars/Default.png', 'Flattering cuts for curvy silhouettes'),
('tall', 'Tall', '/avatars/Default.png', 'Extended lengths for taller frames'),
('athletic', 'Athletic', '/avatars/Default.png', 'Comfortable fit for active lifestyles');

-- Insert categories
INSERT INTO public.categories (id, name, slug) VALUES
('old-money', 'Old Money', 'old-money'),
('date-ready', 'Date Ready', 'date-ready'),
('casual-outing', 'Casual Outing', 'casual-outing'),
('ceo-core', 'CEO Core', 'ceo-core'),
('streetwear', 'Streetwear', 'streetwear');

-- Insert occasions
INSERT INTO public.occasions (id, name, slug, description, background_url) VALUES
('work', 'Work', 'work', 'Professional and polished looks for the workplace', '/Backgrounds/7.png'),
('casual', 'Casual', 'casual', 'Relaxed and comfortable everyday outfits', '/Backgrounds/8.png'),
('date', 'Date', 'date', 'Romantic and stylish looks for special occasions', '/Backgrounds/9.png'),
('party', 'Party', 'party', 'Fun and festive outfits for celebrations', '/Backgrounds/10.png'),
('travel', 'Travel', 'travel', 'Comfortable yet stylish travel-friendly looks', '/Backgrounds/11.png'),
('wedding', 'Wedding', 'wedding', 'Elegant guest attire for wedding celebrations', '/Backgrounds/12.png'),
('brunch', 'Brunch', 'brunch', 'Chic and relaxed looks for daytime gatherings', '/Backgrounds/13.png'),
('business', 'Business', 'business', 'Corporate and professional meeting attire', '/Backgrounds/14.png');

-- Insert products (tops)
INSERT INTO public.products (id, type, brand, size, price, currency, image_url, description, color) VALUES
('top-4', 'top', 'Style Co', 'M', 2999, 'INR', '/products/tops/4.png', 'Classic white button-down shirt', 'White'),
('top-5', 'top', 'Fashion Forward', 'L', 3499, 'INR', '/products/tops/5.png', 'Elegant silk blouse', 'Cream'),
('top-6', 'top', 'Urban Chic', 'S', 2799, 'INR', '/products/tops/6.png', 'Casual striped t-shirt', 'Navy Blue'),
('top-7', 'top', 'Luxe Basics', 'M', 4299, 'INR', '/products/tops/7.png', 'Premium cotton tee', 'Black'),
('top-8', 'top', 'Modern Edge', 'L', 3899, 'INR', '/products/tops/8.png', 'Designer crop top', 'Rose Gold'),
('top-9', 'top', 'Classic Cuts', 'S', 3199, 'INR', '/products/tops/9.png', 'Vintage band tee', 'Gray'),
('top-10', 'top', 'Trendy Threads', 'M', 2899, 'INR', '/products/tops/10.png', 'Bohemian blouse', 'Floral'),
('top-11', 'top', 'Elite Fashion', 'L', 4599, 'INR', '/products/tops/11.png', 'Silk camisole', 'Burgundy'),
('top-12', 'top', 'Street Style', 'S', 2599, 'INR', '/products/tops/12.png', 'Graphic hoodie', 'Charcoal'),
('top-13', 'top', 'Refined Wear', 'M', 3799, 'INR', '/products/tops/13.png', 'Cashmere sweater', 'Beige'),
('top-14', 'top', 'Chic Collection', 'L', 3299, 'INR', '/products/tops/14.png', 'Wrap blouse', 'Emerald'),
('top-l3', 'top', 'Luxury Line', 'M', 5999, 'INR', '/products/tops/L3.png', 'Designer blazer top', 'Navy');

-- Insert products (bottoms)
INSERT INTO public.products (id, type, brand, size, price, currency, image_url, description, color) VALUES
('bottom-16', 'bottom', 'Denim Dreams', '30', 4999, 'INR', '/products/bottoms/16.png', 'High-waisted skinny jeans', 'Dark Blue'),
('bottom-17', 'bottom', 'Tailored Fits', '32', 5499, 'INR', '/products/bottoms/17.png', 'Formal trousers', 'Black'),
('bottom-18', 'bottom', 'Casual Comfort', '28', 3799, 'INR', '/products/bottoms/18.png', 'Wide-leg pants', 'Khaki'),
('bottom-19', 'bottom', 'Urban Style', '30', 4299, 'INR', '/products/bottoms/19.png', 'Leather leggings', 'Black'),
('bottom-20', 'bottom', 'Classic Cuts', '32', 3999, 'INR', '/products/bottoms/20.png', 'Pleated midi skirt', 'Navy'),
('bottom-l2', 'bottom', 'Premium Denim', '30', 6999, 'INR', '/products/bottoms/L2.png', 'Designer straight jeans', 'Indigo');

-- Insert products (shoes)
INSERT INTO public.products (id, type, brand, size, price, currency, image_url, description, color) VALUES
('shoes-21', 'shoes', 'Step Forward', '7', 7999, 'INR', '/products/shoes/21.png', 'Classic leather heels', 'Black'),
('shoes-22', 'shoes', 'Comfort Walk', '8', 5999, 'INR', '/products/shoes/22.png', 'Casual sneakers', 'White'),
('shoes-23', 'shoes', 'Elegant Steps', '6', 8999, 'INR', '/products/shoes/23.png', 'Designer pumps', 'Nude');

-- Insert outfits
INSERT INTO public.outfits (id, name, category, total_price, currency, occasion_background, selected_background) VALUES
('outfit-work-1', 'Professional Power Look', 'ceo-core', 12998, 'INR', 'work', '/Backgrounds/7.png'),
('outfit-casual-1', 'Weekend Vibes', 'casual-outing', 8798, 'INR', 'casual', '/Backgrounds/8.png'),
('outfit-date-1', 'Romantic Evening', 'date-ready', 15497, 'INR', 'date', '/Backgrounds/9.png'),
('outfit-party-1', 'Night Out Glam', 'streetwear', 14198, 'INR', 'party', '/Backgrounds/10.png'),
('outfit-travel-1', 'Jet Set Style', 'casual-outing', 11598, 'INR', 'travel', '/Backgrounds/11.png'),
('outfit-brunch-1', 'Sunday Brunch', 'casual-outing', 10398, 'INR', 'brunch', '/Backgrounds/13.png'),
('outfit-old-money-1', 'Timeless Elegance', 'old-money', 16597, 'INR', 'business', '/Backgrounds/14.png'),
('outfit-work-2', 'Corporate Chic', 'ceo-core', 13798, 'INR', 'work', '/Backgrounds/7.png');

-- Insert outfit items (linking products to outfits)
-- Professional Power Look (outfit-work-1)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-work-1', 'top-4'),
('outfit-work-1', 'bottom-17'),
('outfit-work-1', 'shoes-21');

-- Weekend Vibes (outfit-casual-1)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-casual-1', 'top-6'),
('outfit-casual-1', 'bottom-16'),
('outfit-casual-1', 'shoes-22');

-- Romantic Evening (outfit-date-1)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-date-1', 'top-5'),
('outfit-date-1', 'bottom-20'),
('outfit-date-1', 'shoes-23');

-- Night Out Glam (outfit-party-1)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-party-1', 'top-8'),
('outfit-party-1', 'bottom-19'),
('outfit-party-1', 'shoes-21');

-- Jet Set Style (outfit-travel-1)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-travel-1', 'top-7'),
('outfit-travel-1', 'bottom-18'),
('outfit-travel-1', 'shoes-22');

-- Sunday Brunch (outfit-brunch-1)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-brunch-1', 'top-10'),
('outfit-brunch-1', 'bottom-16'),
('outfit-brunch-1', 'shoes-22');

-- Timeless Elegance (outfit-old-money-1)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-old-money-1', 'top-l3'),
('outfit-old-money-1', 'bottom-l2'),
('outfit-old-money-1', 'shoes-23');

-- Corporate Chic (outfit-work-2)
INSERT INTO public.outfit_items (outfit_id, product_id) VALUES
('outfit-work-2', 'top-11'),
('outfit-work-2', 'bottom-17'),
('outfit-work-2', 'shoes-21');