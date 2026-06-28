# Ingestion Pipeline V2 — Tech Discussion & Implementation Guide

**Service:** `services/ingestion-automated`  
**Date:** 2026-06-23  
**Purpose:** Complete context for implementation. Feed this into any new session to continue where we left off.

---

## 1. What We Are Building

A new automated product ingestion pipeline. It replaces `services/ingestion` which required heavy manual intervention (HITL1 and HITL2 phases).

The new pipeline:
- Takes a product URL + basic metadata from an admin
- Automatically scrapes, classifies, generates a virtual try-on, and segments the product
- Has optional human review points (configurable per job)
- Ends with an admin giving a placement + verdict (approved/discarded)

**New service location:** `services/ingestion-automated`  
**This is a separate service** — existing `services/ingestion` is untouched.

---

## 2. Key Architectural Decisions (with reasoning)

### Decision 1 — No LangGraph

**What we rejected:** Using LangGraph (used in existing `services/ingestion`).

**Why:**
- Our pipeline is sequential — there is no branching LLM reasoning. LangGraph adds abstraction with no benefit.
- LangGraph's checkpoint format is opaque — hard to manipulate for "restart from step X".
- With our design, restart from step = `UPDATE current_state WHERE job_id = X` + trigger. With LangGraph you'd have to manipulate internal checkpoint blobs.
- The existing service has experienced pain with LangGraph version upgrades.
- Adding a new step in our design = one new file + one line in HANDLERS map. Nothing else changes.

**What we use instead:** Plain sequential executor + pg-boss + `current_state` in DB.

---

### Decision 2 — Plain sequential executor

**Pattern:**
```
pg-boss picks up job
→ dispatch(jobId)
→ reads current_state from DB
→ HANDLERS[current_state].validate(job)
→ HANDLERS[current_state].execute(job)
→ handler advances state + enqueues next step
```

Each step is a `StepHandler` class implementing `validate()` and `execute()`. The dispatcher maps state → handler. Nothing else knows about routing.

**Why this works:**
- Node.js is single-threaded but async. `await externalApiCall()` does NOT block the thread — it releases it back to the event loop to handle other jobs.
- Every heavy operation (Firecrawl, SigLIP, Gemini, fashn_vton, segmentation models) runs on external servers. Our code just sends HTTP requests and awaits.
- With `teamSize: 5` on pg-boss, 5 jobs are processed simultaneously — each waiting on different external APIs — no thread blocking.

---

### Decision 3 — teamSize is about GPU concurrency, not step count

**Common misconception:** teamSize should match number of steps (6-7).

**Reality:** teamSize = how many concurrent pipeline runs you want simultaneously. The right value = how many concurrent requests your slowest GPU endpoint (fashn_vton / seedream) can handle.

```
Start: teamSize 3
→ measure GPU response time under 3 concurrent requests
→ acceptable? bump to 4 → keep going until response degrades
→ that number = your teamSize
```

Bottleneck is always the GPU models, never Node.js or Supabase writes.

---

### Decision 4 — Segmentation is a separate state machine

Segmentation has 8 steps driven by DB config. It has its own:
- `segmentation_jobs` table (one row per segmentation run)
- `segmentation_pipeline_config` table (defines which steps run, in what order)
- `segmentation_step_results` table (one row per step per job — crash recovery)
- Separate pg-boss queue: `run-segmentation-step`
- Separate worker

**Why separate:**
- Steps are configurable — swap a model by updating DB config, no code change
- Crash recovery: reads `segmentation_step_results`, skips completed steps
- Main pipeline waits at `segmenting` state — seg pipeline re-triggers main pipeline when done

---

### Decision 5 — pipeline_step_artifacts as temp store

All intermediate step outputs (crawl metadata, classified images, garment summary, vton image path) live in `pipeline_step_artifacts` during the pipeline run. This is a temp table — weekly cleanup for completed/failed jobs.

Main product tables (`ingested_products`, `ingested_product_images`, `products`) are only written at the END (Step 6 complete + Step 7 verdict).

**Why:**
- Admin can discard a job — no point polluting main tables with rejected products
- Clean separation between "in progress" data and "finalised" data
- All intermediate data available for debugging if something goes wrong

---

### Decision 6 — Verdict system

Every job gets a verdict: `approved` or `discarded`. Both are written to `ingested_products` — even discarded ones. Only approved ones get promoted to `products`.

**Why keep discarded products in ingested_products:**
- Analyse what went wrong
- Track discard rate per product type / model / step
- Re-process a discarded job later without re-scraping

---

### Decision 7 — HITL gates are configurable per job

Two optional HITL gates, set at job creation:
- `hitl_post_identification` — admin reviews image tagging after Step 3
- `hitl_post_segmentation` — admin reviews segmented image after Step 6

Both default to `false`. Step 7 (placement + verdict) is always HITL.

When a HITL gate is reached, pipeline stops. Admin uses dashboard to proceed. API call updates state + re-enqueues pg-boss job.

---

### Decision 8 — Restart from any step

To restart from step N:
1. DELETE `pipeline_step_artifacts` for step N onwards (stale — will be regenerated)
2. DELETE `segmentation_jobs` + `segmentation_step_results` if restarting from segmentation
3. `UPDATE ingestion_pipeline_jobs SET current_state = 'state_N'`
4. `boss.send('run-pipeline-step', { jobId })`

Artifacts from steps BEFORE N are kept — still valid inputs. Supabase storage files get overwritten naturally (deterministic paths like `{jobId}/tryon/front.jpg`).

---

## 3. Database Tables

### New tables to create

#### `ingestion_pipeline_jobs`
```sql
CREATE TABLE ingestion_pipeline_jobs (
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
  current_state             TEXT NOT NULL DEFAULT 'pending',
  v_ton_preferred_image     TEXT DEFAULT NULL,
  vton_image_url            TEXT DEFAULT NULL,
  segmented_image_url       TEXT DEFAULT NULL,
  ingested_product_id       UUID REFERENCES ingested_products(id),
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

#### `pipeline_step_artifacts`
```sql
CREATE TABLE pipeline_step_artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES ingestion_pipeline_jobs(job_id) ON DELETE CASCADE,
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

#### `segmentation_pipeline_config`
```sql
CREATE TABLE segmentation_pipeline_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN DEFAULT FALSE,
  steps      JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed v1 config:
INSERT INTO segmentation_pipeline_config (name, is_active, steps) VALUES (
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
```

#### `segmentation_jobs`
```sql
CREATE TABLE segmentation_jobs (
  seg_job_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_job_id     UUID NOT NULL UNIQUE REFERENCES ingestion_pipeline_jobs(job_id),
  pipeline_config_id  UUID NOT NULL REFERENCES segmentation_pipeline_config(id),
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

#### `segmentation_step_results`
```sql
CREATE TABLE segmentation_step_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seg_job_id          UUID NOT NULL REFERENCES segmentation_jobs(seg_job_id) ON DELETE CASCADE,
  pipeline_config_id  UUID NOT NULL REFERENCES segmentation_pipeline_config(id),
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

CREATE INDEX ON segmentation_step_results (seg_job_id);
CREATE UNIQUE INDEX ON segmentation_step_results (seg_job_id, step_name);
```

### Existing tables — alterations

```sql
-- ingested_products
ALTER TABLE ingested_products
  ADD COLUMN pipeline_job_id     UUID REFERENCES ingestion_pipeline_jobs(job_id),
  ADD COLUMN segmented_image_url TEXT,
  ADD COLUMN verdict             TEXT CHECK (verdict IN ('approved', 'discarded')),
  ADD COLUMN verdict_at          TIMESTAMPTZ,
  ADD COLUMN verdict_by          TEXT,
  ADD COLUMN discard_reason      TEXT;

-- ingested_product_images
ALTER TABLE ingested_product_images
  ADD COLUMN pipeline_job_id UUID REFERENCES ingestion_pipeline_jobs(job_id);
```

### Weekly cleanup job
```sql
-- Run as a scheduled pg-boss job or cron
DELETE FROM pipeline_step_artifacts
WHERE created_at < NOW() - INTERVAL '7 days'
AND job_id IN (
  SELECT job_id FROM ingestion_pipeline_jobs
  WHERE current_state IN ('completed', 'failed', 'cancelled', 'discarded')
);
```

---

## 4. Folder Structure

```
services/ingestion-automated/
  src/
    api/
      index.ts                  # Fastify server setup
      routes/
        submit.ts               # POST /jobs
        status.ts               # GET /jobs/:jobId
        proceed.ts              # POST /jobs/:jobId/proceed  (HITL resume)
        placement.ts            # POST /jobs/:jobId/placement (Step 7 verdict)
        restart.ts              # POST /jobs/:jobId/restart  (restart from step)

    orchestration/
      dispatcher.ts             # HANDLERS map + dispatch(jobId)
      advance-and-trigger.ts    # nextState() + advanceAndTrigger()
      state-machine.ts          # TRANSITIONS map + HITL_STATES + STEP_ORDER

    steps/
      pending.handler.ts
      scraping.handler.ts
      identification.handler.ts
      garment-summary.handler.ts
      vton-generation.handler.ts
      segmentation.handler.ts   # triggers seg pipeline, waits
      segmented.handler.ts      # writes ingested_products + ingested_product_images
      hitl-segmentation.handler.ts
      placement.handler.ts      # handles verdict

    segmentation/
      worker.ts                 # listens on run-segmentation-step queue
      executor.ts               # runs steps sequentially/parallel
      state-machine.ts          # seg pipeline states + transitions
      registry.ts               # STEP_REGISTRY: name → adapter
      adapters/
        fashn-seg.adapter.ts
        schp-seg.adapter.ts
        gdino.adapter.ts
        sam-v2.adapter.ts
        fashn-seg-refine.adapter.ts
        vitmatte.adapter.ts
        birefnet.adapter.ts
        combine.adapter.ts

    adapters/
      firecrawl.ts              # reuse from services/ingestion
      siglip.ts                 # Google SigLIP bulk classification
      gemini.ts                 # reuse from services/ingestion
      vton/
        index.ts                # resolveVtonModel() + route to provider
        fashn-vton.adapter.ts
        seedream.adapter.ts
        gemini-nano-banana.adapter.ts

    domain/
      types.ts                  # IngestionPipelineJob, StepHandler, etc.
      job-catalog.ts            # getJob(), updateJob(), updateState()
      artifacts.ts              # saveArtifact(), getArtifacts(), getLatestArtifact()
      dedup.ts                  # MD5 deduplication logic

    queue/
      boss.ts                   # pg-boss client
      worker.ts                 # main pipeline worker (run-pipeline-step)

    config/
      index.ts                  # Zod-validated env vars

    db/
      supabase.ts

    utils/
      logger.ts
      retry.ts                  # withRetry(fn, { retries, backoff })
      storage.ts                # uploadToSupabase(), getPublicUrl()

    index.ts                    # start server + worker
```

---

## 5. Core Interfaces

```typescript
// src/domain/types.ts

export interface IngestionPipelineJob {
  job_id: string;
  product_url: string;
  dedupe_key: string | null;
  product_gender_type: 'male' | 'female' | 'unisex';
  product_type: 'topwear' | 'bottomwear' | 'dress';
  product_sub_type: string;
  product_complexity: string;
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

export interface SegmentationStep {
  name: string;
  run(input: SegmentationStepInput): Promise<SegmentationStepOutput>;
}

export interface SegmentationStepInput {
  jobId: string;
  segJobId: string;
  inputImageUrl: string;
  stepConfig: Record<string, unknown>;
  priorResults: SegmentationStepOutput[];
}

export interface SegmentationStepOutput {
  stepName: string;
  outputImageUrl: string;
  maskUrl?: string;
  metadata: {
    modelVersion?: string;
    inferenceMs?: number;
    confidence?: number;
    [key: string]: unknown;
  };
}

export interface TryonProvider {
  name: string;
  run(input: TryonInput): Promise<TryonOutput>;
}

export interface TryonInput {
  imageUrl: string;
  gender: string;
  productType: string;
  productSubType: string;
  techPack: string;
  garmentPhysics: string;
  itemName: string;
  colorAndFabric: string;
}

export interface TryonOutput {
  imageUrl: string;
  storagePath: string;
  inferenceMs: number;
  modelUsed: string;
}
```

---

## 6. State Machine Implementation

```typescript
// src/orchestration/state-machine.ts

export const STEP_ORDER = [
  'scraping',
  'identifying',
  'garment_summary',
  'vton_generation',
  'segmentation',
];

export const HITL_STATES = [
  'awaiting_hitl_identification',
  'awaiting_hitl_segmentation',
  'placement',
];

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

export function nextState(job: IngestionPipelineJob): string {
  const fn = TRANSITIONS[job.current_state];
  if (!fn) throw new Error(`No transition for state: ${job.current_state}`);
  return fn(job);
}
```

```typescript
// src/orchestration/advance-and-trigger.ts

export async function advanceAndTrigger(job: IngestionPipelineJob): Promise<void> {
  const next = nextState(job);

  await db.query(
    `UPDATE ingestion_pipeline_jobs
     SET current_state = $1, updated_at = NOW()
     WHERE job_id = $2`,
    [next, job.job_id]
  );

  if (HITL_STATES.includes(next)) return; // stop — wait for human

  await boss.send('run-pipeline-step', { jobId: job.job_id });
}
```

---

## 7. Dispatcher

```typescript
// src/orchestration/dispatcher.ts

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

  if (!handler) {
    logger.error({ jobId, state: job.current_state }, 'No handler for state');
    throw new Error(`No handler for state: ${job.current_state}`);
  }

  await handler.validate(job);
  await handler.execute(job);
}
```

```typescript
// src/queue/worker.ts

export function startWorker() {
  boss.work(
    'run-pipeline-step',
    { teamSize: parseInt(config.BOSS_TEAM_SIZE) },
    async ({ data: { jobId } }) => {
      await dispatch(jobId);
    }
  );
}
```

---

## 8. Step-by-Step Implementation Guide

Build in this order. Each step is self-contained and testable independently.

---

### Phase 1 — Foundation (build first)

**1. DB migrations**
- Create all new tables (ingestion_pipeline_jobs, pipeline_step_artifacts, segmentation tables)
- Run alterations on ingested_products + ingested_product_images
- Seed segmentation_pipeline_config v1

**2. Core domain**
- `types.ts` — all interfaces
- `job-catalog.ts` — getJob(), updateJob(), updateState()
- `artifacts.ts` — saveArtifact(), getArtifacts(), getLatestArtifact()
- `state-machine.ts` — TRANSITIONS, nextState()
- `advance-and-trigger.ts` — advanceAndTrigger()

**3. Queue setup**
- `boss.ts` — pg-boss client
- `worker.ts` — boss.work('run-pipeline-step', ...)
- `dispatcher.ts` — HANDLERS map + dispatch()

**4. API skeleton**
- Fastify server
- `POST /jobs` — validate + deduplicate + INSERT + enqueue
- `GET /jobs/:jobId` — return current state + relevant data

At this point you can submit jobs and they'll sit at `pending`. Foundation is testable.

---

### Phase 2 — Steps 1 to 3

**Step 1 — PendingHandler**
```typescript
class PendingHandler implements StepHandler {
  async validate(job) {
    if (!job.product_url) throw new Error('Missing product_url');
  }
  async execute(job) {
    // Just advance to scraping
    await advanceAndTrigger(job);
  }
}
```

**Step 2 — ScrapingHandler**
- Integrate Firecrawl adapter (reuse from services/ingestion)
- Download images + upload to `{jobId}/raw/N.jpg`
- Save `crawl_meta` artifact (1 row)
- Save `raw_image` artifact per image (N rows)
- Advance to `scraped`

**Step 3 — IdentificationHandler**
- Integrate SigLIP bulk classification adapter
- Send ALL image storage paths in one request
- Apply priority selection: `model_front → flatlay_front → model_side → flatlay_back → model_back → detail_texture`
- If `v_ton_image_preference` set → filter first, then pick highest confidence
- Save `image_classification` artifact per image
- Save `vton_image_selection` artifact (1 row)
- Update `ingestion_pipeline_jobs.v_ton_preferred_image`
- Check `hitl_post_identification` → stop or advance

At this point you can run jobs through Steps 1–3 and see artifacts in DB.

---

### Phase 3 — Steps 4 and 5

**Step 4 — GarmentSummaryHandler**
- Validate: `v_ton_preferred_image` is set
- Fetch image from Supabase storage
- Call Gemini with image + user inputs (gender, product_type, product_sub_type)
- Category-specific prompt (topwear / bottomwear / dress)
- Gemini returns: `tech_pack, garment_physics, item_name, color_and_fabric, complexity_level`
- Save `garment_summary` artifact

```typescript
// Garment summary artifact data shape:
{
  view: 'front',
  tech_pack: string,
  garment_physics: string,
  item_name: string,
  color_and_fabric: string,
  complexity_level: 'simple' | 'complex',
  model: string,
  prompt_version: string
}
```

**Step 5 — VtonGenerationHandler**
- Validate: `v_ton_preferred_image` set AND `garment_summary` artifact exists
- Resolve model:
  ```typescript
  function resolveVtonModel(job, garmentSummary): string {
    if (job.v_ton_model) return job.v_ton_model;
    const map = { simple: 'fashn_vton', complex: 'seedream' };
    return map[garmentSummary.complexity_level] ?? 'gemini_nano_banana';
  }
  ```
- Build TryonInput from job + garmentSummary artifact
- Call resolved provider adapter
- Upload result to `{jobId}/tryon/front.jpg`
- Update `ingestion_pipeline_jobs.vton_image_url`
- Save `vton_image` artifact
- Retry config per provider:
  - fashn_vton: 3 retries, 2s → 4s → 8s
  - seedream: 5 retries, 5s → 10s → 20s → 40s → 80s
  - gemini_nano_banana: 3 retries, 1s → 2s → 4s

---

### Phase 4 — Segmentation Pipeline

**Build separately, then integrate.**

**4a. Segmentation executor**
```typescript
// src/segmentation/executor.ts

export async function runSegmentationPipeline(
  segJobId: string,
  pipeline_job_id: string,
  vtонImageUrl: string
): Promise<string> {

  const config = await getActiveSegConfig();
  const groups = groupByParallelGroup(config.steps);

  let allResults: SegmentationStepOutput[] = [];

  for (const group of groups) {
    // Check which steps in this group are already done (crash recovery)
    const done = await getCompletedSteps(segJobId, group.map(s => s.name));
    const todo = group.filter(s => !done.has(s.name));

    // Re-collect already done results
    allResults.push(...done.values());

    if (todo.length === 0) continue;

    // Run pending steps in this group (parallel within group)
    const results = await Promise.all(
      todo.map(step => runSingleStep(segJobId, step, vtonImageUrl, allResults))
    );

    allResults.push(...results);
  }

  const final = allResults.find(r => r.stepName === 'combine');
  if (!final) throw new Error('No final image from combine step');
  return final.outputImageUrl;
}
```

**4b. Segmentation worker**
```typescript
// src/segmentation/worker.ts

boss.work(
  'run-segmentation-step',
  { teamSize: 3 },
  async ({ data: { segJobId } }) => {
    const segJob = await getSegJob(segJobId);

    const finalImageUrl = await runSegmentationPipeline(
      segJobId,
      segJob.pipeline_job_id,
      segJob.vton_image_url
    );

    // Update seg job
    await updateSegJob(segJobId, {
      current_state: 'completed',
      final_image_url: finalImageUrl,
    });

    // Write back to main pipeline job
    await updateJob(segJob.pipeline_job_id, {
      segmented_image_url: finalImageUrl,
    });

    // Re-trigger main pipeline
    await boss.send('run-pipeline-step', {
      jobId: segJob.pipeline_job_id,
    });
  }
);
```

**4c. SegmentationHandler (main pipeline side)**
```typescript
class SegmentationHandler implements StepHandler {
  async validate(job) {
    if (!job.vton_image_url) throw new Error('vton_image_url not set');
  }

  async execute(job) {
    await updateState(job.job_id, 'segmenting');

    const config = await getActiveSegConfig();

    const segJob = await insertSegJob({
      pipeline_job_id: job.job_id,
      pipeline_config_id: config.id,
      vton_image_url: job.vton_image_url,
      current_state: 'pending',
    });

    await boss.send('run-segmentation-step', { segJobId: segJob.seg_job_id });
    // STOP — segmentation pipeline re-triggers us when done
  }
}
```

**4d. SegmentedHandler (runs after seg pipeline completes)**
```typescript
class SegmentedHandler implements StepHandler {
  async validate(job) {
    if (!job.segmented_image_url) throw new Error('segmented_image_url not set');
  }

  async execute(job) {
    // Assemble product data from artifacts
    const crawlMeta = await getLatestArtifact(job.job_id, 'crawl_meta');
    const garmentSummary = await getLatestArtifact(job.job_id, 'garment_summary');
    const classifications = await getArtifacts(job.job_id, 'image_classification');

    // INSERT ingested_products
    const ingestedProduct = await insertIngestedProduct({
      pipeline_job_id: job.job_id,
      segmented_image_url: job.segmented_image_url,
      // ... all product fields from crawlMeta + garmentSummary
      verdict: null,
    });

    // INSERT ingested_product_images (one row per classified image + vton image)
    await insertIngestedProductImages(ingestedProduct.id, job.job_id, classifications);

    // Update job with ingested_product_id
    await updateJob(job.job_id, { ingested_product_id: ingestedProduct.id });

    // Advance state
    await updateState(job.job_id, 'segmented');

    // Check HITL flag
    if (job.hitl_post_segmentation) {
      await updateState(job.job_id, 'awaiting_hitl_segmentation');
      return; // STOP
    }

    await updateState(job.job_id, 'placement');
    // placement is always HITL — do not trigger next step
  }
}
```

---

### Phase 5 — HITL Resume + Placement API

**Proceed endpoint (HITL resume):**
```typescript
// POST /jobs/:jobId/proceed

async function proceed(jobId, body) {
  const job = await getJob(jobId);

  if (!['awaiting_hitl_identification', 'awaiting_hitl_segmentation'].includes(job.current_state)) {
    throw new Error('Job is not awaiting HITL');
  }

  // Handle overrides
  if (body.vton_image_override) {
    await updateJob(jobId, { v_ton_preferred_image: body.vton_image_override });
    await updateArtifact(jobId, 'vton_image_selection', { storage_path: body.vton_image_override, source: 'admin_override' });
  }

  if (body.segmented_image_override) {
    await updateJob(jobId, { segmented_image_url: body.segmented_image_override });
    await updateIngestedProduct(job.ingested_product_id, { segmented_image_url: body.segmented_image_override });
  }

  const next = nextState(job);
  await updateState(jobId, next);

  if (!HITL_STATES.includes(next)) {
    await boss.send('run-pipeline-step', { jobId });
  }
}
```

**Placement + Verdict endpoint:**
```typescript
// POST /jobs/:jobId/placement

async function handlePlacement(jobId, body) {
  const job = await getJob(jobId);

  if (job.current_state !== 'placement') {
    throw new Error('Job is not at placement step');
  }

  if (body.verdict === 'approved') {
    // Update ingested_products with verdict + placement
    await updateIngestedProduct(job.ingested_product_id, {
      verdict: 'approved',
      verdict_at: new Date().toISOString(),
      verdict_by: body.admin_id,
      placement_x: body.placement_x,
      placement_y: body.placement_y,
      body_parts_visible: body.body_parts_visible,
    });

    // Promote to products
    await promoteToProducts(job.ingested_product_id);

    // Copy segmented image to final path
    await copyStorageFile(
      job.segmented_image_url,
      `processed/${productId}/segmented.png`
    );

    await updateState(jobId, 'completed');

  } else {
    // Discard
    await updateIngestedProduct(job.ingested_product_id, {
      verdict: 'discarded',
      verdict_at: new Date().toISOString(),
      verdict_by: body.admin_id,
      discard_reason: body.discard_reason ?? null,
    });

    await updateState(jobId, 'discarded');
  }
}
```

---

### Phase 6 — Restart From Step API

```typescript
// POST /jobs/:jobId/restart
// Body: { from_state: string }

async function restartFromState(jobId, fromState) {
  if (!TRANSITIONS[fromState]) {
    throw new Error(`Unknown state: ${fromState}`);
  }

  const stepOrder = ['scraping', 'identifying', 'garment_summary', 'vton_generation', 'segmentation'];
  const fromIndex = stepOrder.indexOf(fromState.replace('generating_', '').replace('_generated', ''));
  const stepsToClean = stepOrder.slice(fromIndex);

  // Delete stale artifacts
  await db.query(
    `DELETE FROM pipeline_step_artifacts
     WHERE job_id = $1 AND step_name = ANY($2)`,
    [jobId, stepsToClean]
  );

  // Clean segmentation if restarting from segmenting or before
  if (stepsToClean.includes('segmentation')) {
    await db.query(
      `DELETE FROM segmentation_step_results
       WHERE seg_job_id IN (SELECT seg_job_id FROM segmentation_jobs WHERE pipeline_job_id = $1)`,
      [jobId]
    );
    await db.query(`DELETE FROM segmentation_jobs WHERE pipeline_job_id = $1`, [jobId]);
  }

  await updateState(jobId, fromState);
  await boss.send('run-pipeline-step', { jobId });
}
```

---

## 9. API Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/jobs` | Submit new job |
| `GET` | `/jobs` | List jobs (filter by state, created_by) |
| `GET` | `/jobs/:jobId` | Get job status + state + relevant data |
| `POST` | `/jobs/:jobId/proceed` | Resume HITL gate |
| `POST` | `/jobs/:jobId/placement` | Submit verdict + placement |
| `POST` | `/jobs/:jobId/restart` | Restart from a specific state |
| `POST` | `/jobs/:jobId/cancel` | Cancel a job |
| `GET` | `/health` | Health check |

---

## 10. What Each Step Writes — Quick Reference

### DB writes per step

| Step | Table | Action |
|------|-------|--------|
| Step 1 | `ingestion_pipeline_jobs` | INSERT (current_state: pending) |
| Step 2 | `ingestion_pipeline_jobs` | UPDATE current_state |
| Step 2 | `pipeline_step_artifacts` | INSERT crawl_meta + N raw_image rows |
| Step 3 | `ingestion_pipeline_jobs` | UPDATE current_state + v_ton_preferred_image |
| Step 3 | `pipeline_step_artifacts` | INSERT N image_classification + 1 vton_image_selection |
| Step 4 | `ingestion_pipeline_jobs` | UPDATE current_state |
| Step 4 | `pipeline_step_artifacts` | INSERT 1 garment_summary |
| Step 5 | `ingestion_pipeline_jobs` | UPDATE current_state + vton_image_url |
| Step 5 | `pipeline_step_artifacts` | INSERT 1 vton_image |
| Step 6 | `segmentation_jobs` | INSERT 1 row |
| Step 6 | `segmentation_step_results` | INSERT 8 rows (one per seg step) |
| Step 6 | `ingestion_pipeline_jobs` | UPDATE current_state + segmented_image_url |
| Step 6 | `ingested_products` | INSERT 1 row (verdict: NULL) |
| Step 6 | `ingested_product_images` | INSERT N rows |
| Step 7 approved | `ingested_products` | UPDATE verdict + placement |
| Step 7 approved | `products` | INSERT (promote) |
| Step 7 approved | `ingestion_pipeline_jobs` | UPDATE current_state = completed |
| Step 7 discarded | `ingested_products` | UPDATE verdict = discarded |
| Step 7 discarded | `ingestion_pipeline_jobs` | UPDATE current_state = discarded |

### Supabase storage writes per step

| Step | Path | What |
|------|------|------|
| Step 2 | `{jobId}/raw/0.jpg ... N.jpg` | Downloaded product images |
| Step 5 | `{jobId}/tryon/front.jpg` | Generated vton image |
| Step 6 | `{jobId}/segmentation/steps/*.png` | Intermediate masks per seg step |
| Step 6 | `{jobId}/segmentation/final.png` | Final segmented product image |
| Step 7 approved | `processed/{productId}/segmented.png` | Final path in live catalog |

---

## 11. Image Priority for Vton Selection (Step 3)

```
Default priority (no user preference):
  1. model_front     ← best
  2. flatlay_front
  3. model_side
  4. flatlay_back
  5. model_back
  6. detail_texture  ← last resort

If v_ton_image_preference = { type: "flat_lay" }:
  → filter to flatlay_front + flatlay_back only
  → pick highest confidence from that filtered set
```

SigLIP is called **once with all images in bulk** — not one API call per image.

---

## 12. Segmentation Pipeline States

```
pending
→ running_round1      (fashn_seg + schp_seg + gdino — parallel via Promise.all)
→ running_sam_v2      (uses Round 1 outputs)
→ running_refinement  (fashn_seg_refine)
→ running_round2      (vitmatte + birefnet — parallel via Promise.all)
→ combining           (merges both alpha mattes)
→ completed           (re-triggers main pipeline)
→ failed
```

### Crash recovery in segmentation

```
Crash at any point
→ pg-boss retries run-segmentation-step
→ executor reads segmentation_step_results for this seg_job_id
→ steps with status = 'completed' → SKIP
→ resumes from first non-completed step
→ no duplicate GPU calls
```

### Adding a new segmentation model

1. Write adapter implementing `SegmentationStep` interface
2. Add to `STEP_REGISTRY` in `registry.ts`
3. INSERT new `segmentation_pipeline_config` row with new model in steps JSONB
4. Set `is_active = true` on new config, `is_active = false` on old
5. In-flight jobs complete on old config. New jobs use new config.
6. No other code changes.

---

## 13. Error Handling

### On step failure

```typescript
async function handleStepError(job, error, isTransient) {
  if (!isTransient) {
    // Fatal — fail immediately, no retry
    await db.query(
      `UPDATE ingestion_pipeline_jobs
       SET current_state = 'failed',
           last_error = $1,
           last_error_step = $2,
           error_count = error_count + 1,
           updated_at = NOW()
       WHERE job_id = $3`,
      [error.message, job.current_state, job.job_id]
    );
    return;
  }
  // Transient — let pg-boss retry (throw the error)
  throw error;
}
```

### Error kinds

| Kind | Examples | Action |
|------|---------|--------|
| `transient` | Network timeout, 503, rate limit | Retry with backoff |
| `fatal` | No images found, invalid URL, missing required data | Fail immediately |

---

## 14. Retry Configuration

```typescript
// src/utils/retry.ts

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: { retries: number; backoff: number }
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (attempt < config.retries) {
        await sleep(config.backoff * Math.pow(2, attempt - 1));
      }
    }
  }

  throw lastError!;
}
```

### Retry config per step

| Step / Model | Retries | Initial backoff |
|-------------|---------|----------------|
| Scraping | 3 | 1s |
| Identification | 2 | 1s |
| Garment summary | 3 | 1s |
| fashn_vton | 3 | 2s |
| seedream | 5 | 5s |
| gemini_nano_banana | 3 | 1s |
| Each seg step | 2 | 1s |

---

## 15. Environment Variables

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
GEMINI_NANO_BANANA_API_KEY=

# Segmentation model endpoints
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

---

## 16. Build Order (Recommended)

```
Phase 1 — Foundation
  [ ] DB migrations (all new tables + alterations)
  [ ] Seed segmentation_pipeline_config v1
  [ ] Core domain: types, job-catalog, artifacts, state-machine
  [ ] pg-boss setup + dispatcher + worker skeleton
  [ ] POST /jobs + GET /jobs/:jobId API

Phase 2 — Steps 1–3
  [ ] PendingHandler
  [ ] ScrapingHandler (Firecrawl adapter)
  [ ] IdentificationHandler (SigLIP adapter — bulk)
  [ ] POST /jobs/:jobId/proceed (HITL resume)

Phase 3 — Steps 4–5
  [ ] GarmentSummaryHandler (Gemini adapter)
  [ ] VtonGenerationHandler (fashn_vton + seedream + gemini_nano_banana adapters)

Phase 4 — Segmentation
  [ ] Segmentation executor + crash recovery
  [ ] All 8 segmentation step adapters
  [ ] Segmentation worker (run-segmentation-step queue)
  [ ] SegmentationHandler (main pipeline trigger)
  [ ] SegmentedHandler (writes ingested_products + ingested_product_images)
  [ ] HitlSegmentationHandler

Phase 5 — Placement + Verdict
  [ ] PlacementHandler
  [ ] POST /jobs/:jobId/placement API

Phase 6 — Restart + Ops
  [ ] POST /jobs/:jobId/restart API
  [ ] POST /jobs/:jobId/cancel API
  [ ] Weekly cleanup job for pipeline_step_artifacts
  [ ] GET /jobs list endpoint with filters
```
