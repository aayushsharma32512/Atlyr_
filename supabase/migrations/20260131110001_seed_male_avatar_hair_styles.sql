-- Seed male avatar hair styles (hairtype SVGs) with placement metadata.
-- Head segments are rendered at z-index 3; hair should be at z-index 4.

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
    'male',
    'spikes',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/male/hairtype/spikes.svg',
    8.58,
    -14.80,
    4,
    false,
    true,
    1
  ),
  (
    'male',
    'straight',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/male/hairtype/straight.svg',
    8.05,
    -14.60,
    4,
    false,
    true,
    2
  ),
  (
    'male',
    'buzz',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/male/hairtype/buzz.svg',
    6.74,
    -13.80,
    4,
    true,
    true,
    3
  ),
  (
    'male',
    'curly',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/male/hairtype/curly.svg',
    8.35,
    -15.20,
    4,
    false,
    true,
    4
  ),
  (
    'male',
    'parted',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/male/hairtype/parted.svg',
    8.22,
    -14.70,
    4,
    false,
    true,
    5
  ),
  (
    'male',
    'long',
    'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/mannequin/male/hairtype/long.svg',
    12.92,
    -15.40,
    4,
    false,
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

