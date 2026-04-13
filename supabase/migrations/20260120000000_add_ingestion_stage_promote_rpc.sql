-- Add RPC helpers to stage and promote ingested products atomically.

CREATE OR REPLACE FUNCTION public.stage_ingested_product(product JSONB, images JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF product IS NULL THEN
    RAISE EXCEPTION 'stage_ingested_product_missing_product';
  END IF;

  INSERT INTO public.ingested_products (
    id,
    type,
    brand,
    size,
    price,
    currency,
    image_url,
    description,
    color,
    fit,
    feel,
    category_id,
    image_length,
    product_length,
    product_url,
    gender,
    placement_y,
    placement_x,
    color_group,
    product_name,
    type_category,
    vibes,
    description_text,
    vector_embedding,
    similar_items,
    garment_summary,
    garment_summary_version,
    size_chart,
    garment_summary_front,
    garment_summary_back,
    body_parts_visible,
    occasion,
    material_type,
    care,
    product_specifications
  )
  SELECT
    r.id,
    r.type,
    r.brand,
    r.size,
    r.price,
    r.currency,
    r.image_url,
    r.description,
    r.color,
    r.fit,
    r.feel,
    r.category_id,
    r.image_length,
    r.product_length,
    r.product_url,
    r.gender,
    r.placement_y,
    r.placement_x,
    r.color_group,
    r.product_name,
    r.type_category,
    r.vibes,
    r.description_text,
    r.vector_embedding,
    r.similar_items,
    r.garment_summary,
    r.garment_summary_version,
    r.size_chart,
    r.garment_summary_front,
    r.garment_summary_back,
    r.body_parts_visible,
    r.occasion,
    r.material_type,
    r.care,
    r.product_specifications
  FROM jsonb_populate_record(NULL::public.ingested_products, product) AS r
  ON CONFLICT (id) DO UPDATE SET
    type = EXCLUDED.type,
    brand = EXCLUDED.brand,
    size = EXCLUDED.size,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    image_url = EXCLUDED.image_url,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    fit = EXCLUDED.fit,
    feel = EXCLUDED.feel,
    category_id = EXCLUDED.category_id,
    image_length = EXCLUDED.image_length,
    product_length = EXCLUDED.product_length,
    product_url = EXCLUDED.product_url,
    gender = EXCLUDED.gender,
    placement_y = EXCLUDED.placement_y,
    placement_x = EXCLUDED.placement_x,
    color_group = EXCLUDED.color_group,
    product_name = EXCLUDED.product_name,
    type_category = EXCLUDED.type_category,
    vibes = EXCLUDED.vibes,
    description_text = EXCLUDED.description_text,
    vector_embedding = EXCLUDED.vector_embedding,
    similar_items = EXCLUDED.similar_items,
    garment_summary = EXCLUDED.garment_summary,
    garment_summary_version = EXCLUDED.garment_summary_version,
    size_chart = EXCLUDED.size_chart,
    garment_summary_front = EXCLUDED.garment_summary_front,
    garment_summary_back = EXCLUDED.garment_summary_back,
    body_parts_visible = EXCLUDED.body_parts_visible,
    occasion = EXCLUDED.occasion,
    material_type = EXCLUDED.material_type,
    care = EXCLUDED.care,
    product_specifications = EXCLUDED.product_specifications,
    updated_at = now();

  DELETE FROM public.ingested_product_images
  WHERE product_id = (product->>'id');

  IF images IS NOT NULL AND jsonb_array_length(images) > 0 THEN
    INSERT INTO public.ingested_product_images (
      product_id,
      kind,
      sort_order,
      is_primary,
      url,
      gender,
      vto_eligible,
      product_view,
      ghost_eligible,
      summary_eligible
    )
    SELECT
      i.product_id,
      i.kind,
      i.sort_order,
      i.is_primary,
      i.url,
      i.gender,
      i.vto_eligible,
      i.product_view,
      i.ghost_eligible,
      i.summary_eligible
    FROM jsonb_populate_recordset(NULL::public.ingested_product_images, images) AS i;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_ingested_product(product_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  staged public.ingested_products;
BEGIN
  SELECT * INTO staged FROM public.ingested_products WHERE id = product_id;
  IF staged IS NULL THEN
    RAISE EXCEPTION 'promote_ingested_product_missing_product';
  END IF;

  INSERT INTO public.products (
    id,
    type,
    brand,
    size,
    price,
    currency,
    image_url,
    description,
    color,
    created_at,
    fit,
    feel,
    category_id,
    image_length,
    product_length,
    product_url,
    gender,
    placement_y,
    placement_x,
    color_group,
    product_name,
    type_category,
    vibes,
    description_text,
    vector_embedding,
    similar_items,
    garment_summary,
    garment_summary_version,
    size_chart,
    garment_summary_front,
    garment_summary_back,
    body_parts_visible,
    occasion,
    material_type,
    care,
    product_specifications,
    updated_at
  )
  SELECT
    staged.id,
    staged.type,
    staged.brand,
    staged.size,
    staged.price,
    staged.currency,
    staged.image_url,
    staged.description,
    staged.color,
    staged.created_at,
    staged.fit,
    staged.feel,
    staged.category_id,
    staged.image_length,
    staged.product_length,
    staged.product_url,
    staged.gender,
    staged.placement_y,
    staged.placement_x,
    staged.color_group,
    staged.product_name,
    staged.type_category,
    staged.vibes,
    staged.description_text,
    staged.vector_embedding,
    staged.similar_items,
    staged.garment_summary,
    staged.garment_summary_version,
    staged.size_chart,
    staged.garment_summary_front,
    staged.garment_summary_back,
    staged.body_parts_visible,
    staged.occasion,
    staged.material_type,
    staged.care,
    staged.product_specifications,
    now()
  ON CONFLICT (id) DO UPDATE SET
    type = EXCLUDED.type,
    brand = EXCLUDED.brand,
    size = EXCLUDED.size,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    image_url = EXCLUDED.image_url,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    fit = EXCLUDED.fit,
    feel = EXCLUDED.feel,
    category_id = EXCLUDED.category_id,
    image_length = EXCLUDED.image_length,
    product_length = EXCLUDED.product_length,
    product_url = EXCLUDED.product_url,
    gender = EXCLUDED.gender,
    placement_y = EXCLUDED.placement_y,
    placement_x = EXCLUDED.placement_x,
    color_group = EXCLUDED.color_group,
    product_name = EXCLUDED.product_name,
    type_category = EXCLUDED.type_category,
    vibes = EXCLUDED.vibes,
    description_text = EXCLUDED.description_text,
    vector_embedding = EXCLUDED.vector_embedding,
    similar_items = EXCLUDED.similar_items,
    garment_summary = EXCLUDED.garment_summary,
    garment_summary_version = EXCLUDED.garment_summary_version,
    size_chart = EXCLUDED.size_chart,
    garment_summary_front = EXCLUDED.garment_summary_front,
    garment_summary_back = EXCLUDED.garment_summary_back,
    body_parts_visible = EXCLUDED.body_parts_visible,
    occasion = EXCLUDED.occasion,
    material_type = EXCLUDED.material_type,
    care = EXCLUDED.care,
    product_specifications = EXCLUDED.product_specifications,
    updated_at = now();

  DELETE FROM public.product_images WHERE product_id = staged.id;

  INSERT INTO public.product_images (
    id,
    product_id,
    kind,
    sort_order,
    is_primary,
    url,
    gender,
    vto_eligible,
    product_view,
    ghost_eligible,
    summary_eligible
  )
  SELECT
    i.id,
    i.product_id,
    i.kind,
    i.sort_order,
    i.is_primary,
    i.url,
    i.gender,
    i.vto_eligible,
    i.product_view,
    i.ghost_eligible,
    i.summary_eligible
  FROM public.ingested_product_images AS i
  WHERE i.product_id = staged.id;
END;
$$;
