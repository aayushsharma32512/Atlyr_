-- Create avatar hair styles table + profile selection fields
-- Stores gender-specific hair SVG assets and placement metadata aligned to mannequin coordinate system.

CREATE TABLE IF NOT EXISTS public.avatar_hair_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  style_key TEXT NOT NULL,
  asset_url TEXT NOT NULL,
  length_pct DOUBLE PRECISION NOT NULL CHECK (length_pct > 0),
  y_offset_pct DOUBLE PRECISION NOT NULL,
  z_index INTEGER NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS avatar_hair_styles_gender_style_key_idx
  ON public.avatar_hair_styles (gender, style_key);

CREATE INDEX IF NOT EXISTS avatar_hair_styles_gender_active_sort_idx
  ON public.avatar_hair_styles (gender, is_active, sort_order);

ALTER TABLE public.avatar_hair_styles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Avatar hair styles are viewable by all" ON public.avatar_hair_styles;
CREATE POLICY "Avatar hair styles are viewable by all"
  ON public.avatar_hair_styles
  FOR SELECT
  USING (true);

DROP TRIGGER IF EXISTS update_avatar_hair_styles_updated_at ON public.avatar_hair_styles;
CREATE TRIGGER update_avatar_hair_styles_updated_at
  BEFORE UPDATE ON public.avatar_hair_styles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hair_style_id UUID NULL,
  ADD COLUMN IF NOT EXISTS hair_color_hex TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_hair_style_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_hair_style_id_fkey
      FOREIGN KEY (hair_style_id) REFERENCES public.avatar_hair_styles(id);
  END IF;
END $$;

