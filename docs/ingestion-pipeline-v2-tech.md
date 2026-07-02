# Ingestion Pipeline V2 — Technical Implementation Reference

**Service:** `services/ingestion-automated`  
**Date:** 2026-06-23  
**Status:** Ready for implementation

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [State Machine](#2-state-machine)
3. [Core Interfaces](#3-core-interfaces)
4. [Dispatcher & Worker](#4-dispatcher--worker)
5. [Database Schema](#5-database-schema)
6. [Step-by-Step Implementation](#6-step-by-step-implementation)
7. [Segmentation Pipeline](#7-segmentation-pipeline)
8. [HITL Gates](#8-hitl-gates)
9. [Restart From Step](#9-restart-from-step)
10. [Error Handling & Retries](#10-error-handling--retries)
11. [Environment Variables](#11-environment-variables)

---

## 1. Architecture Overview

### What we are NOT using
- ❌ LangGraph — overkill for a sequential pipeline. Adds abstraction with no benefit here.
- ❌ Kafka — message bus between services, not needed for a single service pipeline.

### What we ARE using
- ✅ **pg-boss** — PostgreSQL-backed job queue. No new infrastructure.
- ✅ **Plain sequential executor** — one `StepHandler` per state, dispatched by current state.
- ✅ **`current_state` in DB** — drives which handler runs. Restart from any step by updating this field.
- ✅ **Node.js event loop** — handles concurrency naturally. All external calls are async HTTP — thread is never blocked.

### Why Node.js works perfectly here
Every heavy operation (Firecrawl, SigLIP, Gemini, fashn_vton, segmentation models) runs on external GPU/servers. Our code just sends HTTP requests and awaits responses. The event loop handles multiple jobs concurrently — no threads blocked.

```
Bottleneck = GPU endpoint concurrency, not Node.js
teamSize on pg-boss = how many concurrent GPU requests your endpoints can handle
```

### Call chain
```
User hits POST /jobs
  → API validates + deduplicates
  → INSERT ingestion_pipeline_jobs (current_state: pending)
  → boss.send('run-pipeline-step', { jobId })
  → return { jobId } immediately

Worker picks up job
  → dispatch(jobId)
  → reads current_state from DB
  → HANDLERS[current_state].validate(job)
  → HANDLERS[current_state].execute(job)
  → handler does work → saves artifacts → calls advanceAndTrigger()
  → advanceAndTrigger updates current_state + enqueues next pg-boss job
  → loop continues automatically
```

---

## 2. State Machine

### All states

```
pending                       ← job created
scraping                      ← Step 2: Firecrawl running
scraped                       ← Step 2: complete
identifying                   ← Step 3: SigLIP running
identified                    ← Step 3: complete
awaiting_hitl_identification  ← Step 3: HITL gate (if hitl_post_identification = true)
generating_garment_summary    ← Step 4: Gemini running
garment_summary_generated     ← Step 4: complete
generating_vton               ← Step 5: vton model running
vton_generated                ← Step 5: complete
segmenting                    ← Step 6: segmentation pipeline triggered
segmented                     ← Step 6: segmentation complete, ingested_products written
awaiting_hitl_segmentation    ← Step 6: HITL gate (if hitl_post_segmentation = true)
placement                     ← Step 7: waiting for admin placement + verdict
completed                     ← Step 7: approved + promoted to products
discarded                     ← Step 7: admin discarded
failed                        ← any step: retries exhausted
cancelled                     ← manually cancelled
```

### Transition map

```typescript
// src/domain/state-machine.ts

export const TRANSITIONS: Record<string, (job: IngestionPipelineJob) => string> = {
  pending:                      () => 'scraping',
  scraping:                     () => 'scraped',
  scraped:                      () => 'identifying',
  identifying:                  () => 'identified',
  identified:                   (j) => j.hitl_post_identification
                                         ? 'awaiting_hitl_identification'
                                         : 'generating_garment_summary',
  awaiting_hitl_identification: () => 'generating_garment_summary',
  generating_garment_summary:   () => 'garment_summary_generated',
  garment_summary_generated:    () => 'generating_vton',
  generating_vton:              () => 'vton_generated',
  vton_generated:               () => 'segmenting',
  segmenting:                   () => 'segmented',
  segmented:                    (j) => j.hitl_post_segmentation
                                         ? 'awaiting_hitl_segmentation'
                                         : 'placement',
  awaiting_hitl_segmentation:   () => 'placement',
  placement:                    () => 'completed',
};

export const HITL_STATES = [
  'awaiting_hitl_identification',
  'awaiting_hitl_segmentation',
  'placement',
];

export function nextState(job: IngestionPipelineJob): string {
  const fn = TRANSITIONS[job.current_state];
  if (!fn) throw new Error(`No transition defined for state: ${job.current_state}`);
  return fn(job);
}
```

### advanceAndTrigger

```typescript
// src/domain/advance-and-trigger.ts

export async function advanceAndTrigger(job: IngestionPipelineJob) {
  const next = nextState(job);

  await db.query(
    `UPDATE ingestion_pipeline_jobs
     SET current_state = $1, updated_at = NOW()
     WHERE job_id = $2`,
    [next, job.job_id]
  );

  // HITL gate — stop here, wait for human
  if (HITL_STATES.includes(next)) return;

  // Trigger next step
  await boss.send('run-pipeline-step', { jobId: job.job_id });
}
```

---

## 3. Core Interfaces

```typescript
// src/domain/types.ts

export interface IngestionPipelineJob {
  job_id: string;
  product_url: string;
  dedupe_key: string;
  product_gender_type: 'male' | 'female' | 'unisex';
  product_type: 'topwear' | 'bottomwear' | 'dress';
  product_sub_type: string;
  product_complexity: 'simple' | 'complex';
  v_ton_model: string | null;
  v_ton_image_preference: { type: string } | null;
  hitl_post_identification: boolean;
  hitl_post_segmentation: boolean;
  current_state: string;
  v_ton_preferred_image: string | null;
  vton_image_url: string | null;
  segmented_image_url: string | null;
  ingested_product_id: string | null;
  error_count: number;
  last_error: string | null;
  last_error_step: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StepHandler {
  validate(job: IngestionPipelineJob): Promise<void>;
  execute(job: IngestionPipelineJob): Promise<void>;
}

export interface PipelineStepArtifact {
  id: string;
  job_id: string;
  step_name: string;
  artifact_type: string;
  storage_path: string | null;
  data: Record<string, unknown>;
  created_at: string;
}
```

---

## 4. Dispatcher & Worker

```typescript
// src/orchestration/dispatcher.ts

import { PendingHandler }             from '../steps/pending.handler';
import { ScrapingHandler }            from '../steps/scraping.handler';
import { IdentificationHandler }      from '../steps/identification.handler';
import { GarmentSummaryHandler }      from '../steps/garment-summary.handler';
import { VtonGenerationHandler }      from '../steps/vton-generation.handler';
import { SegmentationHandler }        from '../steps/segmentation.handler';
import { SegmentedHandler }           from '../steps/segmented.handler';
import { HitlSegmentationHandler }    from '../steps/hitl-segmentation.handler';
import { PlacementHandler }           from '../steps/placement.handler';

const HANDLERS: Record<string, StepHandler> = {
  pending:                      new PendingHandler(),
  scraped:                      new ScrapingHandler(),
  identified:                   new IdentificationHandler(),
  generating_garment_summary:   new GarmentSummaryHandler(),
  garment_summary_generated:    new VtonGenerationHandler(),
  vton_generated:               new SegmentationHandler(),
  segmented:                    new SegmentedHandler(),
  awaiting_hitl_segmentation:   new HitlSegmentationHandler(),
  placement:                    new PlacementHandler(),
};

export async function dispatch(jobId: string): Promise<void> {
  const job = await getJob(jobId);

  const handler = HANDLERS[job.current_state];
  if (!handler) throw new Error(`No handler for state: ${job.current_state}`);

  await handler.validate(job);
  await handler.execute(job);
}
```

```typescript
// src/queue/worker.ts

boss.work(
  'run-pipeline-step',
  { teamSize: 5 },           // tune based on GPU endpoint capacity
  async ({ data: { jobId } }) => {
    await dispatch(jobId);
  }
);
```

---

## 5. Database Schema

### `ingestion_pipeline_jobs`

```sql
CREATE TABLE ingestion_pipeline_jobs (
  job_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User inputs
  product_url               TEXT NOT NULL,
  dedupe_key                TEXT UNIQUE,
  product_gender_type       TEXT NOT NULL
                              CHECK (product_gender_type IN ('male', 'female', 'unisex')),
  product_type              TEXT NOT NULL
                              CHECK (product_type IN ('topwear', 'bottomwear', 'dress')),
  product_sub_type          TEXT NOT NULL,
  product_complexity        TEXT NOT NULL,
  v_ton_model               TEXT DEFAULT NULL,
  v_ton_image_preference    JSONB DEFAULT NULL,
  hitl_post_identification  BOOLEAN NOT NULL DEFAULT FALSE,
  hitl_post_segmentation    BOOLEAN NOT NULL DEFAULT FALSE,

  -- State machine
  current_state             TEXT NOT NULL DEFAULT 'pending',

  -- Set progressively
  v_ton_preferred_image     TEXT DEFAULT NULL,
  vton_image_url            TEXT DEFAULT NULL,
  segmented_image_url       TEXT DEFAULT NULL,
  ingested_product_id       UUID REFERENCES ingested_products(id),

  -- Error tracking
  error_count               INT DEFAULT 0,
  last_error                TEXT,
  last_error_step           TEXT,

  created_by                TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON ingestion_pipeline_jobs (current_state);
CREATE INDEX ON ingestion_pipeline_jobs (created_by);
CREATE INDEX ON ingestion_pipeline_jobs (created_at DESC);
CREATE INDEX ON ingestion_pipeline_jobs (dedupe_key);
```

### `pipeline_step_artifacts`

```sql
CREATE TABLE pipeline_step_artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL
                  REFERENCES ingestion_pipeline_jobs(job_id) ON DELETE CASCADE,
  step_name     TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  storage_path  TEXT,
  data          JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON pipeline_step_artifacts (job_id);
CREATE INDEX ON pipeline_step_artifacts (job_id, step_name);
CREATE INDEX ON pipeline_step_artifacts (job_id, artifact_type);
```

**Artifact types reference:**

| step_name | artifact_type | data shape |
|-----------|--------------|------------|
| `scraping` | `crawl_meta` | `{ title, brand, price, currency, description, canonical_url }` |
| `scraping` | `raw_image` | `{ source_url, hash, width, height, mime_type, index }` |
| `identifying` | `image_classification` | `{ hash, storage_path, label, confidence, classifier_version }` |
| `identifying` | `vton_image_selection` | `{ storage_path, label, confidence, source: 'user_preference' OR 'auto' }` |
| `garment_summary` | `garment_summary` | `{ view, tech_pack, garment_physics, item_name, color_and_fabric, complexity_level, model, prompt_version }` |
| `vton_generation` | `vton_image` | `{ model_used, resolved_from: 'user_input' OR 'complexity', inference_ms, prompt_version }` |

### `segmentation_pipeline_config`

```sql
CREATE TABLE segmentation_pipeline_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN DEFAULT FALSE,
  steps      JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- steps JSONB structure:
-- [
--   { "order": 1, "name": "fashn_seg",        "parallel_group": 1,    "config": {} },
--   { "order": 2, "name": "schp_seg",          "parallel_group": 1,    "config": {} },
--   { "order": 3, "name": "gdino",             "parallel_group": 1,    "config": { "prompt": "clothing item" } },
--   { "order": 4, "name": "sam_v2",            "parallel_group": null, "config": {} },
--   { "order": 5, "name": "fashn_seg_refine",  "parallel_group": null, "config": {} },
--   { "order": 6, "name": "vitmatte",          "parallel_group": 2,    "config": {} },
--   { "order": 7, "name": "birefnet",          "parallel_group": 2,    "config": {} },
--   { "order": 8, "name": "combine",           "parallel_group": null, "config": { "strategy": "weighted_average" } }
-- ]
```

### `segmentation_jobs`

```sql
CREATE TABLE segmentation_jobs (
  seg_job_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_job_id     UUID NOT NULL UNIQUE
                        REFERENCES ingestion_pipeline_jobs(job_id),
  pipeline_config_id  UUID NOT NULL
                        REFERENCES segmentation_pipeline_config(id),
  vton_image_url      TEXT NOT NULL,
  current_state       TEXT NOT NULL DEFAULT 'pending',
  final_image_url     TEXT,
  error_count         INT DEFAULT 0,
  last_error          TEXT,
  last_error_step     TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON segmentation_jobs (pipeline_job_id);
CREATE INDEX ON segmentation_jobs (current_state);
```

### `segmentation_step_results`

```sql
CREATE TABLE segmentation_step_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seg_job_id          UUID NOT NULL
                        REFERENCES segmentation_jobs(seg_job_id) ON DELETE CASCADE,
  pipeline_config_id  UUID NOT NULL
                        REFERENCES segmentation_pipeline_config(id),
  step_name           TEXT NOT NULL,
  step_order          INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending','in_progress','completed','failed','skipped'
                        )),
  input_image_url     TEXT,
  output_image_url    TEXT,
  mask_url            TEXT,
  metadata            JSONB,
  error               TEXT,
  retry_count         INT DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

CREATE INDEX ON segmentation_step_results (seg_job_id);
CREATE UNIQUE INDEX ON segmentation_step_results (seg_job_id, step_name);
```

### `ingested_products` — additions

```sql
ALTER TABLE ingested_products
  ADD COLUMN pipeline_job_id     UUID REFERENCES ingestion_pipeline_jobs(job_id),
  ADD COLUMN segmented_image_url TEXT,
  ADD COLUMN verdict             TEXT CHECK (verdict IN ('approved', 'discarded')),
  ADD COLUMN verdict_at          TIMESTAMPTZ,
  ADD COLUMN verdict_by          TEXT,
  ADD COLUMN discard_reason      TEXT;
```

### `ingested_product_images` — additions

```sql
ALTER TABLE ingested_product_images
  ADD COLUMN pipeline_job_id UUID REFERENCES ingestion_pipeline_jobs(job_id);
```

### Weekly cleanup job

```sql
DELETE FROM pipeline_step_artifacts
WHERE created_at < NOW() - INTERVAL '7 days'
AND job_id IN (
  SELECT job_id FROM ingestion_pipeline_jobs
  WHERE current_state IN ('completed', 'failed', 'cancelled', 'discarded')
);
```

---

## 6. Step-by-Step Implementation

### When each table gets written

| Table | Step | Action |
|-------|------|--------|
| `ingestion_pipeline_jobs` | Step 1 | INSERT |
| `ingestion_pipeline_jobs` | Every step | UPDATE current_state |
| `pipeline_step_artifacts` | Step 2 | crawl_meta + raw_image rows |
| `pipeline_step_artifacts` | Step 3 | image_classification + vton_image_selection rows |
| `pipeline_step_artifacts` | Step 4 | garment_summary row |
| `pipeline_step_artifacts` | Step 5 | vton_image row |
| `segmentation_jobs` | Step 6 start | INSERT |
| `segmentation_step_results` | Step 6 (per seg step) | INSERT |
| `ingested_products` | Step 6 complete | INSERT |
| `ingested_product_images` | Step 6 complete | INSERT (N rows) |
| `products` | Step 7 approved | INSERT |

### Supabase storage paths

| Step | Path | What |
|------|------|------|
| Step 2 | `{jobId}/raw/0.jpg ... N.jpg` | Downloaded product images |
| Step 5 | `{jobId}/tryon/front.jpg` | Generated vton image |
| Step 6 | `{jobId}/segmentation/steps/*.png` | Intermediate masks |
| Step 6 | `{jobId}/segmentation/final.png` | Final segmented image |
| Step 7 approved | `processed/{productId}/segmented.png` | Final path in catalog |

---

### Step 1 — Job Intake

**Input:**
```typescript
{
  product_url: string
  product_gender_type: 'male' | 'female' | 'unisex'
  product_type: 'topwear' | 'bottomwear' | 'dress'
  product_sub_type: string
  product_complexity: 'simple' | 'complex'
  v_ton_model?: string
  v_ton_image_preference?: { type: string }
  hitl_post_identification: boolean
  hitl_post_segmentation: boolean
}
```

**Flow:**
```
1. Validate with Zod
2. Compute dedupe_key = MD5(canonicaliseUrl(url))
3. Check ingestion_pipeline_jobs for same dedupe_key where status != 'discarded'
   → found → return { jobId, status: 'already_exists' }
   → not found → continue
4. INSERT ingestion_pipeline_jobs (current_state: 'pending')
5. boss.send('run-pipeline-step', { jobId })
6. Return { jobId }
```

---

### Step 2 — Scraping

**Validate:** `product_url` exists.

**Flow:**
```
1. UPDATE current_state → 'scraping'
2. Firecrawl scrapes product_url (site-specific profile if available)
3. Download each image → upload to Supabase {jobId}/raw/N.jpg
4. INSERT pipeline_step_artifacts:
   → 1 crawl_meta row
   → N raw_image rows (one per image)
5. UPDATE current_state → 'scraped'
6. advanceAndTrigger()
```

---

### Step 3 — Identification & Tagging

**Validate:** At least one `raw_image` artifact exists for this jobId.

**Flow:**
```
1. UPDATE current_state → 'identifying'
2. Fetch all raw_image artifacts → get storage paths
3. Send ALL images in one bulk request to SigLIP
   → returns [{ storage_path, label, confidence }] for each
4. Apply selection logic:
   → if v_ton_image_preference set:
       filter to matching type → pick highest confidence
   → else apply priority:
       model_front → flatlay_front → model_side
       → flatlay_back → model_back → detail_texture
5. UPDATE ingestion_pipeline_jobs.v_ton_preferred_image
6. INSERT pipeline_step_artifacts:
   → N image_classification rows
   → 1 vton_image_selection row
7. UPDATE current_state → 'identified'
8. Check hitl_post_identification:
   → true  → UPDATE current_state = 'awaiting_hitl_identification' → STOP
   → false → advanceAndTrigger()
```

---

### Step 4 — Garment Summary

**Validate:** `v_ton_preferred_image` is set.

**Flow:**
```
1. UPDATE current_state → 'generating_garment_summary'
2. Fetch vton selected image from Supabase
3. Call Gemini with:
   → image + product_gender_type + product_type + product_sub_type
   → category-specific prompt
4. Gemini returns:
   → tech_pack, garment_physics, item_name, color_and_fabric, complexity_level
5. INSERT pipeline_step_artifacts:
   → 1 garment_summary row (view: 'front')
6. UPDATE current_state → 'garment_summary_generated'
7. advanceAndTrigger()
```

---

### Step 5 — V-ton Generation

**Validate:** `v_ton_preferred_image` set AND `garment_summary` artifact exists.

**V-ton model resolution:**
```typescript
function resolveVtonModel(job, garmentSummary): string {
  if (job.v_ton_model) return job.v_ton_model;  // user wins
  const map = { simple: 'fashn_vton', complex: 'seedream' };
  return map[garmentSummary.complexity_level] ?? 'gemini_nano_banana';
}
```

**Flow:**
```
1. UPDATE current_state → 'generating_vton'
2. Fetch garment_summary artifact
3. Resolve model
4. Build input:
   → image_url, gender, product_type, product_sub_type
   → tech_pack, garment_physics, item_name, color_and_fabric
5. Call resolved model
6. Upload result → {jobId}/tryon/front.jpg
7. UPDATE ingestion_pipeline_jobs.vton_image_url
8. INSERT pipeline_step_artifacts:
   → 1 vton_image row
9. UPDATE current_state → 'vton_generated'
10. advanceAndTrigger()
```

**Retry config:**

| Model | Retries | Backoff |
|-------|---------|---------|
| fashn_vton | 3 | 2s → 4s → 8s |
| seedream | 5 | 5s → 10s → 20s → 40s → 80s |
| gemini_nano_banana | 3 | 1s → 2s → 4s |

---

### Step 6 — Segmentation (triggers separate pipeline)

**Validate:** `vton_image_url` is set.

**Flow — main pipeline:**
```
1. UPDATE current_state → 'segmenting'
2. Read active segmentation_pipeline_config (WHERE is_active = true)
3. INSERT segmentation_jobs:
   → pipeline_job_id, pipeline_config_id, vton_image_url
   → current_state: 'pending'
4. boss.send('run-segmentation-step', { segJobId })
5. STOP — main pipeline waits here
```

**Flow — segmentation pipeline (separate worker):**
```
Round 1 (Promise.all):
  fashn_seg + schp_seg + gdino → save each to segmentation_step_results

Round 2:
  sam_v2 (uses Round 1 outputs) → save to segmentation_step_results

Round 3:
  fashn_seg_refine → save to segmentation_step_results

Round 4 (Promise.all):
  vitmatte + birefnet → save each to segmentation_step_results

Round 5:
  combine → final image
  → upload to {jobId}/segmentation/final.png
  → UPDATE segmentation_jobs.final_image_url + current_state = 'completed'
  → UPDATE ingestion_pipeline_jobs.segmented_image_url
  → boss.send('run-pipeline-step', { jobId: pipeline_job_id })
```

**Flow — main pipeline resumes (SegmentedHandler):**
```
1. INSERT ingested_products (verdict: NULL, all product data from artifacts)
2. INSERT ingested_product_images (N rows — all tagged images + vton image)
3. UPDATE ingestion_pipeline_jobs.ingested_product_id
4. UPDATE current_state → 'segmented'
5. Check hitl_post_segmentation:
   → true  → UPDATE current_state = 'awaiting_hitl_segmentation' → STOP
   → false → UPDATE current_state = 'placement' → STOP (placement is HITL)
```

---

### Step 7 — Placement & Verdict

**This step is entirely HITL — no automated processing.**

**API endpoint:**
```
POST /jobs/:jobId/placement
{
  verdict: 'approved' | 'discarded'
  placement_x?: number          // 0-1 normalised
  placement_y?: number          // 0-1 normalised
  body_parts_visible?: string[] // ['torso', 'upper_arms']
  discard_reason?: string
}
```

**On APPROVED:**
```
1. UPDATE ingested_products:
   → verdict = 'approved', verdict_at, verdict_by
   → placement_x, placement_y, body_parts_visible
2. INSERT products (promote from ingested_products)
3. Copy segmented image:
   → {jobId}/segmentation/final.png → processed/{productId}/segmented.png
4. UPDATE ingestion_pipeline_jobs.current_state = 'completed'
```

**On DISCARDED:**
```
1. UPDATE ingested_products:
   → verdict = 'discarded', verdict_at, verdict_by, discard_reason
2. Nothing written to products
3. UPDATE ingestion_pipeline_jobs.current_state = 'discarded'
```

---

## 7. Segmentation Pipeline

### State machine

```
pending
→ running_round1      (fashn_seg + schp_seg + gdino — parallel)
→ running_sam_v2
→ running_refinement  (fashn_seg_refine)
→ running_round2      (vitmatte + birefnet — parallel)
→ combining
→ completed
→ failed
```

### Crash recovery

Each step result written to `segmentation_step_results` immediately on completion.
On retry, executor checks `status = 'completed'` per step — skips already done steps.
No duplicate GPU calls.

### Adding / removing / swapping steps

- **Remove a step** → remove from `segmentation_pipeline_config.steps` JSONB. No code change.
- **Add a step** → add to JSONB + register adapter in `STEP_REGISTRY`. One file.
- **Swap a model** → insert new `segmentation_pipeline_config` row with `is_active = true`. In-flight jobs complete on old config. New jobs use new config.

### Step registry

```typescript
// src/adapters/segmentation/registry.ts

export const STEP_REGISTRY: Record<string, SegmentationStep> = {
  fashn_seg:        new FashnSegAdapter(),
  schp_seg:         new SchpSegAdapter(),
  gdino:            new GdinoAdapter(),
  sam_v2:           new SamV2Adapter(),
  fashn_seg_refine: new FashnSegRefineAdapter(),
  vitmatte:         new VitMatteAdapter(),
  birefnet:         new BiRefNetAdapter(),
  combine:          new CombineAdapter(),
};
```

---

## 8. HITL Gates

Three HITL pause points:

| State | When | Admin action |
|-------|------|-------------|
| `awaiting_hitl_identification` | After Step 3, if flag set | Review image tags, override vton image selection |
| `awaiting_hitl_segmentation` | After Step 6, if flag set | Review segmented image, optionally upload replacement |
| `placement` | Always — Step 7 | Set placement on avatar, give verdict |

**Resume endpoint:**
```
POST /jobs/:jobId/proceed
{
  // for awaiting_hitl_identification:
  vton_image_override?: string  // storage path if admin changed selection

  // for awaiting_hitl_segmentation:
  segmented_image_override?: string  // storage path if admin uploaded replacement
}
```

**What proceed does:**
```typescript
async function proceed(jobId, body) {
  const job = await getJob(jobId);

  if (body.vton_image_override) {
    await updateJob(jobId, { v_ton_preferred_image: body.vton_image_override });
  }

  if (body.segmented_image_override) {
    await updateJob(jobId, { segmented_image_url: body.segmented_image_override });
    // also update ingested_products.segmented_image_url
  }

  const next = nextState(job);
  await updateJob(jobId, { current_state: next });
  await boss.send('run-pipeline-step', { jobId });
}
```

---

## 9. Restart From Step

To restart from any step:

```typescript
async function restartFromState(jobId: string, fromState: string) {
  // 1. Determine which steps come after fromState
  const stepsToClean = STEP_ORDER.slice(STEP_ORDER.indexOf(fromState));

  // 2. Delete stale artifacts from those steps onwards
  await db.query(
    `DELETE FROM pipeline_step_artifacts
     WHERE job_id = $1 AND step_name = ANY($2)`,
    [jobId, stepsToClean]
  );

  // 3. If restarting from segmenting or later — clean segmentation data
  if (SEG_STATES.includes(fromState)) {
    await db.query(
      `DELETE FROM segmentation_step_results
       WHERE seg_job_id IN (
         SELECT seg_job_id FROM segmentation_jobs WHERE pipeline_job_id = $1
       )`,
      [jobId]
    );
    await db.query(
      `DELETE FROM segmentation_jobs WHERE pipeline_job_id = $1`,
      [jobId]
    );
  }

  // 4. Update state
  await db.query(
    `UPDATE ingestion_pipeline_jobs
     SET current_state = $1, updated_at = NOW()
     WHERE job_id = $2`,
    [fromState, jobId]
  );

  // 5. Re-trigger
  await boss.send('run-pipeline-step', { jobId });
}
```

**Rule:**
- Delete artifacts from restart point **onwards** — they will be regenerated
- Keep artifacts from steps **before** restart point — still valid inputs
- Supabase storage files get overwritten naturally — no explicit delete needed

---

## 10. Error Handling & Retries

### Per-step retry config

| Step | Retries | Backoff |
|------|---------|---------|
| Scraping | 3 | 1s → 2s → 4s |
| Identification | 2 | 1s → 2s |
| Garment summary | 3 | 1s → 2s → 4s |
| Vton — fashn_vton | 3 | 2s → 4s → 8s |
| Vton — seedream | 5 | 5s → 10s → 20s → 40s → 80s |
| Vton — gemini_nano_banana | 3 | 1s → 2s → 4s |
| Segmentation (per step) | 2 | 1s → 2s |

### On retry exhaustion

```typescript
// On all retries exhausted:
await db.query(
  `UPDATE ingestion_pipeline_jobs
   SET current_state = 'failed',
       error_count = error_count + 1,
       last_error = $1,
       last_error_step = $2,
       updated_at = NOW()
   WHERE job_id = $3`,
  [error.message, job.current_state, job.job_id]
);
```

### Error kinds

| Kind | Meaning | Retry? |
|------|---------|--------|
| `transient` | Network timeout, 503 from API | Yes |
| `fatal` | Invalid input, no images found | No — fail immediately |

---

## 11. Environment Variables

```bash
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL_DIRECT=

# Storage
STORAGE_BUCKET=ingestion-automated

# Firecrawl
FIRECRAWL_API_KEY=
FIRECRAWL_MAX_CONCURRENCY=3

# Google
GOOGLE_API_KEY=
GEMINI_TEXT_MODEL=gemini-1.5-pro
SIGLIP_ENDPOINT=
SIGLIP_API_KEY=

# Vton models
FASHN_VTON_API_URL=
FASHN_VTON_API_KEY=
SEEDREAM_API_URL=
SEEDREAM_API_KEY=
GEMINI_NANO_BANANA_API_URL=

# Segmentation models
FASHN_SEG_API_URL=
SCHP_SEG_API_URL=
GDINO_API_URL=
SAM_V2_API_URL=
FASHN_SEG_REFINE_API_URL=
VITMATTE_API_URL=
BIREFNET_API_URL=

# pg-boss
BOSS_SCHEMA=pgboss_ingestion_v2
BOSS_TEAM_SIZE=5
BOSS_EXPIRE_AFTER=2h

# API
API_TOKEN=
PORT=3001
NODE_ENV=production
LOG_LEVEL=info
```
