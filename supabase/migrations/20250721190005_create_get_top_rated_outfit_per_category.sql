-- Create function to get top-rated outfit per category with complete product data
-- This function returns all fields needed for DynamicAvatar to display complete avatars

CREATE OR REPLACE FUNCTION get_top_rated_outfit_per_category()
RETURNS TABLE (
  -- Category info
  category_id TEXT,
  category_name TEXT,
  category_slug TEXT,
  
  -- Outfit info
  outfit_id TEXT,
  outfit_name TEXT,
  outfit_rating FLOAT,
  outfit_background_id TEXT,
  
  -- Occasion info
  occasion_id TEXT,
  occasion_name TEXT,
  occasion_background_url TEXT,
  
  -- TOP product (complete OutfitItem fields)
  top_id TEXT,
  top_type TEXT,
  top_brand TEXT,
  top_size TEXT,
  top_price INTEGER,
  top_currency TEXT,
  top_image_url TEXT,
  top_description TEXT,
  top_color TEXT,
  
  -- BOTTOM product (complete OutfitItem fields)
  bottom_id TEXT,
  bottom_type TEXT,
  bottom_brand TEXT,
  bottom_size TEXT,
  bottom_price INTEGER,
  bottom_currency TEXT,
  bottom_image_url TEXT,
  bottom_description TEXT,
  bottom_color TEXT,
  
  -- SHOES product (complete OutfitItem fields)
  shoes_id TEXT,
  shoes_type TEXT,
  shoes_brand TEXT,
  shoes_size TEXT,
  shoes_price INTEGER,
  shoes_currency TEXT,
  shoes_image_url TEXT,
  shoes_description TEXT,
  shoes_color TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.category as category_id, c.name as category_name, c.slug as category_slug,
    o.id as outfit_id, o.name as outfit_name, COALESCE(o.rating, 0) as outfit_rating, o.background_id as outfit_background_id,
    occ.id as occasion_id, occ.name as occasion_name, occ.background_url as occasion_background_url,
    top.id as top_id, top.type::text as top_type, top.brand as top_brand, top.size as top_size, top.price as top_price, top.currency as top_currency, top.image_url as top_image_url, top.description as top_description, top.color as top_color,
    bottom.id as bottom_id, bottom.type::text as bottom_type, bottom.brand as bottom_brand, bottom.size as bottom_size, bottom.price as bottom_price, bottom.currency as bottom_currency, bottom.image_url as bottom_image_url, bottom.description as bottom_description, bottom.color as bottom_color,
    shoes.id as shoes_id, shoes.type::text as shoes_type, shoes.brand as shoes_brand, shoes.size as shoes_size, shoes.price as shoes_price, shoes.currency as shoes_currency, shoes.image_url as shoes_image_url, shoes.description as shoes_description, shoes.color as shoes_color
  FROM outfits o
  JOIN categories c ON o.category = c.id
  JOIN occasions occ ON o.occasion = occ.id
  LEFT JOIN products top ON o.top_id = top.id
  LEFT JOIN products bottom ON o.bottom_id = bottom.id
  LEFT JOIN products shoes ON o.shoes_id = shoes.id
  WHERE o.category IN (
    SELECT DISTINCT category FROM outfits
  )
  AND o.id IN (
    SELECT o2.id FROM outfits o2
    WHERE o2.category = o.category
    ORDER BY COALESCE(o2.rating, 0) DESC, o2.created_at ASC
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql; 