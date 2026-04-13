-- Seed female avatar hair styles (hairtype SVGs) with placement metadata.
-- Head segments are rendered at z-index 3; hair should be at z-index 4.
-- Default female hair type is "straight".

INSERT INTO public.avatar_hair_styles (
  gender,
  style_key,
  asset_url,
  length_pct,
  y_offset_pct,
  z_index,
  is_default,
  is_active,
  sort_order
)
VALUES
  (
    'female',
    'fringe',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/female/hairtype/fringe.svg',
    22.40,
    -16.00,
    4,
    false,
    true,
    1
  ),
  (
    'female',
    'bob',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/female/hairtype/bob.svg',
    15.66,
    -16.10,
    4,
    false,
    true,
    2
  ),
  (
    'female',
    'pixie',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/female/hairtype/pixie.svg',
    10.17,
    -15.00,
    4,
    false,
    true,
    3
  ),
  (
    'female',
    'curly',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/female/hairtype/curly.svg',
    22.40,
    -16.10,
    4,
    false,
    true,
    4
  ),
  (
    'female',
    'bangs',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/female/hairtype/bangs.svg',
    22.12,
    -15.40,
    4,
    false,
    true,
    5
  ),
  (
    'female',
    'straight',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/female/hairtype/straight.svg',
    22.82,
    -16.60,
    4,
    true,
    true,
    6
  )
ON CONFLICT (gender, style_key) DO UPDATE
SET
  asset_url = EXCLUDED.asset_url,
  length_pct = EXCLUDED.length_pct,
  y_offset_pct = EXCLUDED.y_offset_pct,
  z_index = EXCLUDED.z_index,
  is_default = EXCLUDED.is_default,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

