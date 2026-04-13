-- Migration: Create mannequin table for avatar rendering
-- Purpose: Persist mannequin segment configuration and asset URLs

CREATE TABLE IF NOT EXISTS public.mannequin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  body_type TEXT NOT NULL,
  height_cm NUMERIC(6,2) NOT NULL CHECK (height_cm > 0),
  default_scale DOUBLE PRECISION NOT NULL DEFAULT 1,
  segment_config JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mannequin
  ADD CONSTRAINT mannequin_segment_config_object
  CHECK (jsonb_typeof(segment_config) = 'object');

CREATE UNIQUE INDEX IF NOT EXISTS mannequin_gender_body_type_idx
  ON public.mannequin (gender, body_type);

COMMENT ON TABLE public.mannequin IS 'Defines mannequin variants (gender/body type) and their segment asset configs.';
COMMENT ON COLUMN public.mannequin.segment_config IS 'JSON map of segment name to asset URL, length_pct, placement_y_pct, z_index, etc.';

ALTER TABLE public.mannequin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Mannequin configs are viewable by all" ON public.mannequin;
CREATE POLICY "Mannequin configs are viewable by all"
  ON public.mannequin
  FOR SELECT
  USING (true);

DROP TRIGGER IF EXISTS update_mannequin_updated_at ON public.mannequin;
CREATE TRIGGER update_mannequin_updated_at
  BEFORE UPDATE ON public.mannequin
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


