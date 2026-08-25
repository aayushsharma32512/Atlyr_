-- Manual asset lane: a product whose try-on and cut-out are produced by an operator in Photoshop
-- rather than by the automated VTON + segmentation steps. Built for footwear, which has no VTON
-- path at all (the prompt bank is topwear/bottomwear/dresses, and every prompt says "dress the
-- full body avatar"), but the lane is deliberately keyed on its own column rather than on
-- product_type so a garment can take it too.
--
-- The lane replaces four automated steps with four human gates:
--
--   scraping -> awaiting_manual_identification   operator picks the preferred scraped photo
--            -> awaiting_manual_vton             operator uploads a try-on image
--            -> awaiting_manual_segmentation     operator uploads a hand-cut transparent PNG
--            -> awaiting_manual_placement        operator places it on the mannequin
--            -> completed
--
-- All four are HITL states in the service: they carry a TRANSITIONS entry and are resumed by
-- POST /jobs/:id/proceed. They are NOT parked states — parked means "an external system owns
-- this and may abandon it", which is a different resume shape.

-- ─── ingestion_pipeline_jobs ─────────────────────────────────────────────────

-- Which lane produces this job's VTON and segmented images. Defaults to 'automated' so every
-- existing row, and every caller that does not opt in, behaves exactly as it does today.
--
-- One discriminator rather than a boolean per step: the gates are not independently meaningful
-- (a manual cut-out of an automated VTON is not a workflow anyone asked for), and two booleans
-- would make those nonsense combinations representable.
ALTER TABLE public.ingestion_pipeline_jobs
  ADD COLUMN IF NOT EXISTS asset_lane TEXT NOT NULL DEFAULT 'automated'
    CHECK (asset_lane IN ('automated', 'manual'));

-- The four gate states. The original CHECK was declared inline and unnamed, so Postgres
-- auto-named it; drop by that name and re-add with the new members.
ALTER TABLE public.ingestion_pipeline_jobs
  DROP CONSTRAINT IF EXISTS ingestion_pipeline_jobs_current_state_check;

ALTER TABLE public.ingestion_pipeline_jobs
  ADD CONSTRAINT ingestion_pipeline_jobs_current_state_check
  CHECK (current_state IN (
    'pending','scraping','identifying',
    'awaiting_hitl_identification',
    'generating_garment_summary','generating_vton',
    'vton_batch_queued',
    'segmenting','segmented',
    'awaiting_hitl_segmentation',
    'awaiting_manual_identification',
    'awaiting_manual_vton',
    'awaiting_manual_segmentation',
    'awaiting_manual_placement',
    'placement','completed','failed','discarded','cancelled'
  ));

-- Footwear as a product type. Nothing upstream of the manual lane can accept it today: the
-- submit route's zod enum rejects it, and garment-summary.handler.ts would silently coerce it to
-- 'topwear' (resolveCategory falls through). The manual lane skips both, but the column has to
-- admit the value before a shoe can have a job row at all.
ALTER TABLE public.ingestion_pipeline_jobs
  DROP CONSTRAINT IF EXISTS ingestion_pipeline_jobs_product_type_check;

ALTER TABLE public.ingestion_pipeline_jobs
  ADD CONSTRAINT ingestion_pipeline_jobs_product_type_check
  CHECK (product_type IN ('topwear', 'bottomwear', 'dress', 'footwear'));

-- The shoes dashboard's hot query is "everything waiting on an operator". A partial index keeps
-- that scan proportional to the waiting set rather than to the whole job table.
CREATE INDEX IF NOT EXISTS ingestion_pipeline_jobs_awaiting_manual_idx
  ON public.ingestion_pipeline_jobs (current_state)
  WHERE current_state IN (
    'awaiting_manual_identification',
    'awaiting_manual_vton',
    'awaiting_manual_segmentation',
    'awaiting_manual_placement'
  );

-- The dashboard lists one lane at a time.
CREATE INDEX IF NOT EXISTS ingestion_pipeline_jobs_asset_lane_idx
  ON public.ingestion_pipeline_jobs (asset_lane)
  WHERE asset_lane = 'manual';
