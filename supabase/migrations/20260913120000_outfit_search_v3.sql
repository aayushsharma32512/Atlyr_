-- Outfit search v3. outfits.image_vector now holds the embedding of a flat-lay
-- render of the top and bottom products (scripts/outfit_embedding_update.py),
-- not of the screenshot. Two changes: match_outfits_v3, the search function
-- behind the search-outfits-v3 edge function (one result per top+bottom pair,
-- gender filter with unisex passing, visible outfits only); and a trigger fix
-- so a screenshot upload no longer nulls that vector.

create or replace function public.match_outfits_v3(
  query_embedding vector(768),
  filters jsonb default '{}'::jsonb,
  match_count int default 50
)
returns table (id text, score float)
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select o.id,
           o.top_id,
           o.bottom_id,
           o.created_at,
           1 - (o.image_vector <=> query_embedding) as score
    from public.outfits o
    where o.image_vector is not null
      and o.top_id is not null
      and o.bottom_id is not null
      and o.visible_in_feed = true
      -- Gender filter: unisex always passes; no genders in filters means no gender filter.
      and (
        (filters->'genders' is null or jsonb_array_length(filters->'genders') = 0)
        or (
          o.gender = any(array(select jsonb_array_elements_text(filters->'genders')))
          or o.gender = 'unisex'
        )
      )
      -- Category filter
      and (
        (filters->'categories' is null or jsonb_array_length(filters->'categories') = 0)
        or (o.category = any(array(select jsonb_array_elements_text(filters->'categories'))))
      )
      -- Occasion filter
      and (
        (filters->'occasions' is null or jsonb_array_length(filters->'occasions') = 0)
        or (o.occasion = any(array(select jsonb_array_elements_text(filters->'occasions'))))
      )
      -- Fit filter
      and (
        (filters->'fits' is null or jsonb_array_length(filters->'fits') = 0)
        or exists (
          select 1 from jsonb_array_elements_text(filters->'fits') as f
          where f = any(o.enriched_fit)
        )
      )
      -- Vibes filter
      and (
        (filters->'vibes' is null or jsonb_array_length(filters->'vibes') = 0)
        or exists (
          select 1 from jsonb_array_elements_text(filters->'vibes') as f
          where f = any(o.enriched_vibes)
        )
      )
      -- Feel filter
      and (
        (filters->'feels' is null or jsonb_array_length(filters->'feels') = 0)
        or exists (
          select 1 from jsonb_array_elements_text(filters->'feels') as f
          where f = any(o.enriched_feel)
        )
      )
  ),
  deduped as (
    select distinct on (top_id, bottom_id)
           id, score
    from scored
    order by top_id, bottom_id, score desc, created_at asc, id asc
  )
  select id, score
  from deduped
  order by score desc
  limit match_count
$$;

-- Mirror the grants on match_outfits_image / v3_match_outfits.
grant execute on function public.match_outfits_v3(vector, jsonb, int) to anon, authenticated, service_role;

-- The screenshot upload (outfit_images) lands seconds after insert; the vector now
-- comes from the products (top/bottom render), not the screenshot, so it must survive
-- that update untouched. Only the outfit_images branch is removed; search_summary
-- (text_vector) and the insert trigger (queue_new_outfit) are unchanged.
create or replace function queue_outfit_embedding_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if text source field changed (search_summary instead of enriched_description)
  IF (NEW.search_summary IS DISTINCT FROM OLD.search_summary)
  THEN
    NEW.text_vector := NULL;

    -- Add to queue with refreshed timestamp
    INSERT INTO outfit_embedding_queue (outfit_id, needs_text_embedding)
    VALUES (NEW.id, TRUE)
    ON CONFLICT (outfit_id)
    DO UPDATE SET
      needs_text_embedding = TRUE,
      queued_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
