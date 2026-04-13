-- Create RPC function to get similar products
-- This function takes a product_id and returns the similar products based on the similar_items column

CREATE OR REPLACE FUNCTION get_similar_products(product_id_param TEXT)
RETURNS TABLE (
    id TEXT,
    type item_type,
    brand TEXT,
    product_name TEXT,
    size TEXT,
    price NUMERIC(10,2),
    currency TEXT,
    image_url TEXT,
    description TEXT,
    color TEXT,
    color_group TEXT,
    gender TEXT,
    placement_y DOUBLE PRECISION,
    placement_x DOUBLE PRECISION,
    image_length DOUBLE PRECISION,
    fit TEXT,
    feel TEXT,
    category_id TEXT,
    vibes TEXT,
    type_category TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    similar_items_str TEXT;
    product_record RECORD;
BEGIN
    -- Get the similar_items string for the given product
    SELECT similar_items INTO similar_items_str
    FROM products 
    WHERE id = product_id_param;
    
    -- If no similar_items found, return empty result
    IF similar_items_str IS NULL OR similar_items_str = '' THEN
        RETURN;
    END IF;
    
    -- Loop through each product ID in the similar_items string
    FOR product_record IN 
        SELECT p.*
        FROM products p
        WHERE p.id = ANY(
            string_to_array(similar_items_str, ',')::TEXT[]
        )
        ORDER BY array_position(
            string_to_array(similar_items_str, ',')::TEXT[], 
            p.id
        )
    LOOP
        id := product_record.id;
        type := product_record.type;
        brand := product_record.brand;
        product_name := product_record.product_name;
        size := product_record.size;
        price := product_record.price;
        currency := product_record.currency;
        image_url := product_record.image_url;
        description := product_record.description;
        color := product_record.color;
        color_group := product_record.color_group;
        gender := product_record.gender;
        placement_y := product_record.placement_y;
        placement_x := product_record.placement_x;
        image_length := product_record.image_length;
        fit := product_record.fit;
        feel := product_record.feel;
        category_id := product_record.category_id;
        vibes := product_record.vibes;
        type_category := product_record.type_category;
        created_at := product_record.created_at;
        updated_at := product_record.updated_at;
        
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_similar_products(TEXT) TO authenticated;

-- Grant execute permission to anon users (if needed for guest access)
GRANT EXECUTE ON FUNCTION get_similar_products(TEXT) TO anon;

-- Add comment to document the function
COMMENT ON FUNCTION get_similar_products(TEXT) IS 'Returns similar products for a given product ID based on the similar_items column. Used for the "Similar Items" feature in the studio alternates panel.';
