-- Ingestion Pipeline V2 — new tables + alterations to existing tables
-- Service: services/ingestion-automated

-- ─── New tables ───────────────────────────────────────────────────────────────

CREATE TABLE public.ingestion_pipeline_jobs (
  job_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_url               TEXT NOT NULL,
  dedupe_key                TEXT UNIQUE,
  product_gender_type       TEXT NOT NULL CHECK (product_gender_type IN ('male', 'female', 'unisex')),
  product_type              TEXT NOT NULL CHECK (product_type IN ('topwear', 'bottomwear', 'dress')),
  product_sub_type          TEXT NOT NULL,
  product_complexity        TEXT NOT NULL,
  v_ton_model               TEXT DEFAULT NULL,
  v_ton_image_preference    JSONB DEFAULT NULL,
  hitl_post_identification  BOOLEAN NOT NULL DEFAULT FALSE,
  hitl_post_segmentation    BOOLEAN NOT NULL DEFAULT FALSE,
  current_state             TEXT NOT NULL DEFAULT 'pending'
                              CHECK (current_state IN (
                                'pending','scraping','identifying',
                                'awaiting_hitl_identification',
                                'generating_garment_summary','generating_vton',
                                'segmenting','segmented',
                                'awaiting_hitl_segmentation',
                                'placement','completed','failed','discarded','cancelled'
                              )),
  v_ton_preferred_image     TEXT DEFAULT NULL,
  vton_image_url            TEXT DEFAULT NULL,
  segmented_image_url       TEXT DEFAULT NULL,
  ingested_product_id       TEXT REFERENCES public.ingested_products(id),
  error_count               INT DEFAULT 0,
  last_error                TEXT,
  last_error_step           TEXT,
  created_by                TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON public.ingestion_pipeline_jobs (current_state);
CREATE INDEX ON public.ingestion_pipeline_jobs (created_by);
CREATE INDEX ON public.ingestion_pipeline_jobs (created_at DESC);
CREATE INDEX ON public.ingestion_pipeline_jobs (dedupe_key);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.pipeline_step_artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES public.ingestion_pipeline_jobs(job_id) ON DELETE CASCADE,
  step_name     TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  storage_path  TEXT,
  data          JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON public.pipeline_step_artifacts (job_id);
CREATE INDEX ON public.pipeline_step_artifacts (job_id, step_name);
CREATE INDEX ON public.pipeline_step_artifacts (job_id, artifact_type);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.segmentation_pipeline_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN DEFAULT FALSE,
  steps      JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.segmentation_pipeline_config (name, is_active, steps) VALUES (
  'v1', true,
  '[
    {"order":1,"name":"fashn_seg","parallel_group":1,"config":{}},
    {"order":2,"name":"schp_seg","parallel_group":1,"config":{}},
    {"order":3,"name":"gdino","parallel_group":1,"config":{"prompt":"clothing item"}},
    {"order":4,"name":"sam_v2","parallel_group":null,"config":{}},
    {"order":5,"name":"fashn_seg_refine","parallel_group":null,"config":{}},
    {"order":6,"name":"vitmatte","parallel_group":2,"config":{}},
    {"order":7,"name":"birefnet","parallel_group":2,"config":{}},
    {"order":8,"name":"combine","parallel_group":null,"config":{"strategy":"weighted_average"}}
  ]'
);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.segmentation_jobs (
  seg_job_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_job_id     UUID NOT NULL UNIQUE REFERENCES public.ingestion_pipeline_jobs(job_id),
  pipeline_config_id  UUID NOT NULL REFERENCES public.segmentation_pipeline_config(id),
  vton_image_url      TEXT NOT NULL,
  current_state       TEXT NOT NULL DEFAULT 'pending',
  final_image_url     TEXT,
  error_count         INT DEFAULT 0,
  last_error          TEXT,
  last_error_step     TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON public.segmentation_jobs (pipeline_job_id);
CREATE INDEX ON public.segmentation_jobs (current_state);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.segmentation_step_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seg_job_id          UUID NOT NULL REFERENCES public.segmentation_jobs(seg_job_id) ON DELETE CASCADE,
  pipeline_config_id  UUID NOT NULL REFERENCES public.segmentation_pipeline_config(id),
  step_name           TEXT NOT NULL,
  step_order          INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','in_progress','completed','failed','skipped')),
  input_image_url     TEXT,
  output_image_url    TEXT,
  mask_url            TEXT,
  metadata            JSONB,
  error               TEXT,
  retry_count         INT DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

CREATE INDEX ON public.segmentation_step_results (seg_job_id);
CREATE UNIQUE INDEX ON public.segmentation_step_results (seg_job_id, step_name);

-- ─── Alter existing tables ────────────────────────────────────────────────────

ALTER TABLE public.ingested_products
  ADD COLUMN IF NOT EXISTS pipeline_job_id     UUID REFERENCES public.ingestion_pipeline_jobs(job_id),
  ADD COLUMN IF NOT EXISTS segmented_image_url TEXT,
  ADD COLUMN IF NOT EXISTS verdict             TEXT CHECK (verdict IN ('approved', 'discarded')),
  ADD COLUMN IF NOT EXISTS verdict_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verdict_by          TEXT,
  ADD COLUMN IF NOT EXISTS discard_reason      TEXT;

ALTER TABLE public.ingested_product_images
  ADD COLUMN IF NOT EXISTS pipeline_job_id UUID REFERENCES public.ingestion_pipeline_jobs(job_id);
