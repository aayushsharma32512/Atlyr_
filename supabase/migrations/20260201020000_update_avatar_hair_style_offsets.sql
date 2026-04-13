-- Add x_offset_pct to avatar hair styles and update placement metrics.

ALTER TABLE public.avatar_hair_styles
  ADD COLUMN IF NOT EXISTS x_offset_pct DOUBLE PRECISION NOT NULL DEFAULT 0;

WITH updates (gender, style_key, length_pct, y_offset_pct, x_offset_pct) AS (
  VALUES
    ('female', 'fringe', 22.40, -16.00, -2.10),
    ('female', 'bob', 15.66, -16.10, 2.20),
    ('female', 'pixie', 10.17, -15.00, -1.90),
    ('female', 'curly', 22.40, -16.10, 5.60),
    ('female', 'bangs', 22.12, -15.40, 0.90),
    ('female', 'straight', 21.90, -15.40, 2.30),
    ('male', 'spikes', 8.58, -14.80, -0.90),
    ('male', 'straight', 8.05, -14.60, -0.60),
    ('male', 'buzz', 6.74, -13.80, -1.20),
    ('male', 'curly', 8.35, -15.20, -1.30),
    ('male', 'parted', 8.22, -14.70, -0.60),
    ('male', 'long', 12.92, -15.40, -0.10)
)
UPDATE public.avatar_hair_styles AS styles
SET
  length_pct = updates.length_pct,
  y_offset_pct = updates.y_offset_pct,
  x_offset_pct = updates.x_offset_pct,
  updated_at = now()
FROM updates
WHERE styles.gender = updates.gender
  AND styles.style_key = updates.style_key;
