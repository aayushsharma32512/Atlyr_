-- Fix ambiguous column reference in get_similar_products by fully qualifying column names

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
    product_record products%ROWTYPE;
BEGIN
    -- Get the similar_items string for the given product (qualify table.column to avoid ambiguity)
    SELECT p.similar_items INTO similar_items_str
    FROM products AS p
    WHERE p.id = product_id_param;
    
    -- If no similar_items found, return empty result
    IF similar_items_str IS NULL OR trim(similar_items_str) = '' THEN
        RETURN;
    END IF;
    
    -- Loop through each product ID in the similar_items string, preserving order
    FOR product_record IN 
        SELECT p.*
        FROM products AS p
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

GRANT EXECUTE ON FUNCTION get_similar_products(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_similar_products(TEXT) TO anon;

COMMENT ON FUNCTION get_similar_products(TEXT) IS 'Returns ordered similar products for a given product ID based on the similar_items column.';


