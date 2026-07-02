# Ingestion Automated — Technical Reference

**Service:** `services/ingestion-automated`  
**Stack:** Node.js · TypeScript · Fastify · LangGraph · pg-boss · Supabase  
**Date:** 2026-06-19

---

## Table of Contents

1. [Service Overview](#1-service-overview)
2. [State Machine — LangGraph](#2-state-machine--langgraph)
3. [Pipeline State Type](#3-pipeline-state-type)
4. [API Specification](#4-api-specification)
5. [Database Schema](#5-database-schema)
6. [Node Specifications](#6-node-specifications)
7. [Tryon Provider Interface](#7-tryon-provider-interface)
8. [Segmentation Step Interface](#8-segmentation-step-interface)
9. [Enrichment Queue](#9-enrichment-queue)
10. [Error Handling & Recovery](#10-error-handling--recovery)
11. [Logging](#11-logging)
12. [Environment Variables](#12-environment-variables)

---

## 1. Service Overview

`ingestion-automated` is a fully automated product ingestion pipeline. It replaces the operator-driven `ingestion` service (which required two HITL phases) with an end-to-end automated flow. The only human touchpoint is a final review step where the user accepts or discards the result and sets product placement.

### Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| HTTP server | Fastify | Already used in `services/ingestion` |
| Pipeline orchestration | LangGraph | Per-node retries, checkpoint-based resume, interrupt/resume for review pause |
| Job queue | pg-boss | PostgreSQL-backed — no new infrastructure |
| Database | Supabase (PostgreSQL) | Existing infra |
| Object storage | Supabase Storage | Existing infra |
| Image classification | Google SigLIP | Zero-shot classifier — fast, no fine-tuning needed |
| Garment summary | Google Gemini (text) | Existing adapter |
| Tryon — simple outfits | fashn_vton via Modal | Synchronous, deterministic |
| Tryon — complex outfits | Seedream | Adapter designed async-capable |
| Segmentation | fashn_seg · schp_seg · gdino · sam_v2 · vitmatte · birefnet | Multi-model pipeline, steps configurable via DB |
| Enrichment | Google Gemini (JSON mode) | Async batch, decoupled from main pipeline |

### Pipeline Node Order

```
crawl → extract → download → identify → garment_summary → tryon → segmentation → finalize → review_pause → review_interrupt → promote
```

`garment_summary` feeds into `tryon` directly (no parallel enrich in main pipeline — enrich runs async after promote).

---

## 2. State Machine — LangGraph

### How it works

Each pipeline node is a LangGraph node. The node:
1. Reads from `AutomatedPipelineState`
2. Does its work (API call, file upload, etc.)
3. Returns a **partial patch** — only the fields it changed
4. LangGraph merges the patch into the full state via `mergeAutomatedPipelineState()`
5. Saves checkpoint + full state to `automated_ingestion_job_state`
6. Advances to the next node

### State persistence

After every node completion, two writes happen:
- `automated_ingestion_job_state.current_state` — full `AutomatedPipelineState` as JSONB
- `automated_ingestion_job_state.checkpoint` — LangGraph checkpoint blob (internal, used for resume)

### Crash recovery

If the worker process crashes mid-node:
1. pg-boss sees the job was never acknowledged → re-queues it
2. Worker picks it up again
3. LangGraph reads the checkpoint from `automated_ingestion_job_state`
4. Resumes from the last **completed** node — the crashed node is re-run from scratch
5. No already-completed nodes are re-executed

### Retry policy

Retries are configured per node using LangGraph's `retryPolicy`. Failures within retry budget are transparent — they don't surface as errors. Only exhausting the retry budget marks the node as failed.

```typescript
.addNode('crawl', crawlNode, {
  retryPolicy: { maxAttempts: 3, initialInterval: 1 }  // exponential backoff
})
```

### Review pause / interrupt

The `review_pause` node sets `state.pause.reason = 'awaiting_review'` and throws a `GraphInterrupt`. LangGraph suspends the graph at that point. When the user POSTs to `/jobs/:jobId/review`, the API writes a `resumeSignal` into the state and re-enqueues the job. The `review_interrupt` node reads the signal and routes to `promote` or `discard`.

---

## 3. Pipeline State Type

```typescript
// services/ingestion-automated/src/domain/state.ts

export type AutomatedPipelineState = {
  jobId: string;
  userId: string;
  originalUrl: string;
  dedupeKey: string;

  // Stored from user input at job submission
  userInputs: {
    gender: 'male' | 'female';
    category: 'topwear' | 'bottomwear' | 'dress';
    subcategory: string;  // free text: "t-shirt", "jeans", "midi dress"
  };

  // Current node name, set at start of each node
  step?: string;

  // ISO8601 timestamps, set at completion of each node
  timestamps?: Record<string, string>;

  // Set by review_pause node, cleared by review_interrupt
  pause?: {
    reason: 'awaiting_review';
    atNode: string;
    requestedAt: string;
    resumeSignal?: {
      action: 'accept' | 'discard';
      placement?: {
        x: number;
        y: number;
        bodyPartsVisible: string[];
      };
    } | null;
  } | null;

  artifacts?: {
    // crawl
    htmlPath?: string;
    crawlMeta?: {
      title?: string;
      brand?: string;
      price?: number;
      currency?: string;
      description?: string;
      [key: string]: unknown;
    };

    // extract
    draftImages?: Array<{
      url: string;
      alt?: string;
      width?: number;
      height?: number;
    }>;

    // download
    rawImages?: Array<{
      hash: string;
      storagePath: string;
      publicUrl: string;
      width: number;
      height: number;
      mimeType: string;
    }>;

    // identify
    imageClassifications?: Array<{
      hash: string;
      storagePath: string;
      label: ImageLabel;
      confidence: number;
      classifierVersion: string;
    }>;
    bestTryonImagePath?: string;
    bestTryonImageUrl?: string;

    // garment_summary
    garmentSummaryPayloads?: Array<{
      view: 'front' | 'back';
      model: string;
      promptVersion: string;
      createdAt: string;
      techPack?: string;
      garmentPhysics?: string;
      itemName?: string;
      colorAndFabric?: string;
      complexityLevel: 'simple' | 'complex';
    }>;

    // tryon
    tryonImage?: {
      imageUrl: string;
      storagePath: string;
      modelUsed: string;  // 'fashn_vton' | 'seedream'
      inferenceMs: number;
      createdAt: string;
    };

    // segmentation
    segmentation?: {
      configId: string;
      configName: string;
      segmentedImageUrl: string;
      storagePath: string;
      createdAt: string;
    };
  };

  flags?: {
    crawlReady?: boolean;
    downloadReady?: boolean;
    identifyReady?: boolean;
    garmentSummaryReady?: boolean;
    tryonReady?: boolean;
    segmentationReady?: boolean;
    finalizeReady?: boolean;
    discarded?: boolean;
    promoteCompleted?: boolean;
    cancelled?: boolean;
  };

  // Assembled by finalize node, written to automated_ingested_products
  draft?: {
    product?: Record<string, unknown>;
  };

  errors?: Array<{
    step: string;
    message: string;
    kind: 'transient' | 'fatal';
    retryCount?: number;
    occurredAt: string;
  }>;
};

export type ImageLabel =
  | 'model_front'
  | 'model_back'
  | 'model_side'
  | 'flatlay_front'
  | 'flatlay_back'
  | 'detail_texture';
```

### State merge

LangGraph requires a reducer for state updates. Deep merge is applied — nested objects are merged, not replaced. Arrays are replaced (last write wins).

```typescript
// services/ingestion-automated/src/orchestration/state-merge.ts

export function mergeAutomatedPipelineState(
  prev: AutomatedPipelineState | undefined,
  update: Partial<AutomatedPipelineState>
): AutomatedPipelineState {
  if (!prev) return update as AutomatedPipelineState;
  return {
    ...prev,
    ...update,
    artifacts: { ...prev.artifacts, ...update.artifacts },
    flags: { ...prev.flags, ...update.flags },
    timestamps: { ...prev.timestamps, ...update.timestamps },
    errors: update.errors ?? prev.errors,
  };
}
```

---

## 4. API Specification

All endpoints require `Authorization: Bearer {API_TOKEN}` header.

---

### `POST /jobs`

Submit a new ingestion job.

**Request body:**
```typescript
{
  url: string;                                     // product page URL
  gender: 'male' | 'female';
  category: 'topwear' | 'bottomwear' | 'dress';
  subcategory: string;                             // e.g. "t-shirt", "jeans"
}
```

**Deduplication:** Computes `MD5(canonicalizeUrl(url))`. If a job with the same `dedupe_key` exists and `status != 'discarded'`, returns the existing job immediately — no new pipeline started.

**Response — new job:**
```typescript
{
  jobId: string;
  status: 'queued';
  deduplicated: false;
}
```

**Response — deduplicated:**
```typescript
{
  jobId: string;
  productId: string | null;  // null if original job not yet completed
  status: string;            // current status of the original job
  deduplicated: true;
}
```

**Error responses:**
```typescript
400  { error: 'INVALID_INPUT', details: ZodError }
500  { error: 'INTERNAL_ERROR', message: string }
```

---

### `GET /jobs/:jobId`

Poll job status and current state.

**Response:**
```typescript
{
  jobId: string;
  status: JobStatus;
  currentStep: string | null;
  createdAt: string;
  updatedAt: string;

  // Only present when status = 'awaiting_review'
  review?: {
    tryonImageUrl: string;
    segmentedImageUrl: string;
  };

  // Only present when status = 'completed'
  result?: {
    productId: string;
    tryonImageUrl: string;
    segmentedImageUrl: string;
  };

  // Only present when status = 'errored'
  error?: {
    step: string;
    message: string;
  };
}

type JobStatus =
  | 'queued'
  | 'crawling'
  | 'downloading'
  | 'identifying'
  | 'summarizing'
  | 'tryon_pending'
  | 'segmenting'
  | 'finalizing'
  | 'awaiting_review'
  | 'completed'
  | 'discarded'
  | 'errored';
```

---

### `POST /jobs/:jobId/review`

Accept or discard the pipeline result. Only valid when `status = 'awaiting_review'`.

**Request body — accept:**
```typescript
{
  action: 'accept';
  placement: {
    x: number;               // 0–1 normalized horizontal position
    y: number;               // 0–1 normalized vertical position
    bodyPartsVisible: string[];  // e.g. ['torso', 'upper_arms']
  };
}
```

**Request body — discard:**
```typescript
{
  action: 'discard';
}
```

**Response:**
```typescript
{
  jobId: string;
  action: 'accept' | 'discard';
  status: 'completed' | 'discarded';
}
```

**Error responses:**
```typescript
400  { error: 'INVALID_ACTION' }          // wrong status for review
400  { error: 'INVALID_INPUT' }           // missing placement on accept
404  { error: 'JOB_NOT_FOUND' }
```

---

### `GET /health`

```typescript
{ status: 'ok', ts: string }
```

---

## 5. Database Schema

### `automated_ingestion_jobs`

Primary job tracking table. One row per submitted job. Updated at every status transition.

```sql
CREATE TABLE automated_ingestion_jobs (
  job_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL,
  original_url         TEXT NOT NULL,
  canonical_url        TEXT,
  dedupe_key           TEXT UNIQUE,  -- MD5(canonical_url), set after canonicalization

  -- User-provided inputs (stored for pipeline use)
  gender               TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  category             TEXT NOT NULL CHECK (category IN ('topwear', 'bottomwear', 'dress')),
  subcategory          TEXT NOT NULL,

  -- Pipeline status
  status               TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN (
                           'queued', 'crawling', 'downloading', 'identifying',
                           'summarizing', 'tryon_pending', 'segmenting', 'finalizing',
                           'awaiting_review', 'completed', 'discarded', 'errored'
                         )),
  current_step         TEXT,

  -- Final outputs (populated on complete)
  product_id           UUID REFERENCES products(id),
  tryon_image_url      TEXT,
  segmented_image_url  TEXT,

  -- Deduplication reference
  existing_job_id      UUID REFERENCES automated_ingestion_jobs(job_id),

  -- Error tracking
  error_count          INT DEFAULT 0,
  last_error           TEXT,
  last_error_step      TEXT,

  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON automated_ingestion_jobs (status);
CREATE INDEX ON automated_ingestion_jobs (user_id);
CREATE INDEX ON automated_ingestion_jobs (dedupe_key);
CREATE INDEX ON automated_ingestion_jobs (created_at DESC);
```

---

### `automated_ingestion_job_state`

Full pipeline state + LangGraph checkpoint. One row per job, upserted after every node.

```sql
CREATE TABLE automated_ingestion_job_state (
  job_id        UUID PRIMARY KEY
                  REFERENCES automated_ingestion_jobs(job_id) ON DELETE CASCADE,
  current_state JSONB NOT NULL,   -- full AutomatedPipelineState
  checkpoint    JSONB,            -- LangGraph internal checkpoint blob
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `segmentation_pipeline_config`

Defines which segmentation steps run and in what order. Only one config is active at a time.
Swapping a model = insert a new config row, set `is_active = true` on it, `false` on the old one. No code change needed.

```sql
CREATE TABLE segmentation_pipeline_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,  -- 'v1', 'v2_no_birefnet', etc.
  is_active  BOOLEAN DEFAULT FALSE,
  steps      JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**`steps` JSONB structure:**
```json
[
  {
    "order": 1,
    "name": "fashn_seg",
    "type": "segmentation",
    "parallel_group": 1,
    "config": {}
  },
  {
    "order": 2,
    "name": "schp_seg",
    "type": "segmentation",
    "parallel_group": 1,
    "config": {}
  },
  {
    "order": 3,
    "name": "gdino",
    "type": "detection",
    "parallel_group": 1,
    "config": { "prompt": "clothing item" }
  },
  {
    "order": 4,
    "name": "sam_v2",
    "type": "sam",
    "parallel_group": null,
    "config": {}
  },
  {
    "order": 5,
    "name": "fashn_seg_refine",
    "type": "refinement",
    "parallel_group": null,
    "config": {}
  },
  {
    "order": 6,
    "name": "vitmatte",
    "type": "matting",
    "parallel_group": 2,
    "config": {}
  },
  {
    "order": 7,
    "name": "birefnet",
    "type": "matting",
    "parallel_group": 2,
    "config": {}
  },
  {
    "order": 8,
    "name": "combine",
    "type": "combine",
    "parallel_group": null,
    "config": { "strategy": "weighted_average" }
  }
]
```

`parallel_group` — steps sharing the same non-null group number are run concurrently via `Promise.all`. Steps with `null` run sequentially and wait for all prior steps to complete.

---

### `segmentation_step_results`

One row per step per job. Written immediately after each step completes or fails.
Used by the executor to skip already-completed steps on retry/resume.

```sql
CREATE TABLE segmentation_step_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID NOT NULL
                        REFERENCES automated_ingestion_jobs(job_id) ON DELETE CASCADE,
  pipeline_config_id  UUID NOT NULL
                        REFERENCES segmentation_pipeline_config(id),
  step_name           TEXT NOT NULL,
  step_order          INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'in_progress', 'completed', 'failed', 'skipped'
                        )),
  input_image_url     TEXT,
  output_image_url    TEXT,
  mask_url            TEXT,
  metadata            JSONB,   -- model version, inference ms, confidence scores, box coords
  error               TEXT,
  retry_count         INT DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

CREATE INDEX ON segmentation_step_results (job_id);
-- Ensures only one result row per step per job (enforced before insert)
CREATE UNIQUE INDEX ON segmentation_step_results (job_id, step_name);
```

---

### `automated_ingested_products`

Staging table. Populated by `finalize` node. Promoted to `products` by `promote` node.
Schema mirrors `ingested_products` from the existing service — strip any fields not needed.

---

### `enrichment_queue`

Simple queue for async batch enrichment after a product is promoted.

```sql
CREATE TABLE enrichment_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  retry_count INT DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON enrichment_queue (status);
```

---

## 6. Node Specifications

### crawl

| Field | Value |
|-------|-------|
| External API | Firecrawl |
| Retry | 3 attempts, backoff 1s → 2s → 4s |
| State written | `artifacts.htmlPath`, `artifacts.crawlMeta` |
| DB written | `automated_ingestion_jobs.status = 'crawling'` |
| Storage written | `{jobId}/raw/page.html` |

Reuses the Firecrawl adapter and site-specific profiles from `services/ingestion`. Site profiles handle Myntra, Nykaa, Mango, Puma, etc.

---

### extract

| Field | Value |
|-------|-------|
| External API | None (parses Firecrawl response) |
| Retry | 2 attempts, backoff 1s → 2s |
| State written | `artifacts.draftImages[]` |

Extracts image URLs from the crawl HTML + JSON-LD output. Deduplicates by URL.

---

### download

| Field | Value |
|-------|-------|
| External API | None (HTTP fetch + Supabase upload) |
| Retry | 3 attempts, backoff 1s → 2s → 4s |
| State written | `artifacts.rawImages[]`, `flags.downloadReady: true` |
| DB written | `automated_ingestion_jobs.status = 'downloading'` |
| Storage written | `{jobId}/raw/{index}.{ext}` per image |

Downloads each image from `draftImages[]`, computes MD5 hash, uploads to Supabase storage. Stores `{ hash, storagePath, publicUrl, width, height, mimeType }` per image.

---

### identify

| Field | Value |
|-------|-------|
| External API | Google SigLIP |
| Retry | 2 attempts, backoff 1s → 2s |
| State written | `artifacts.imageClassifications[]`, `artifacts.bestTryonImagePath`, `artifacts.bestTryonImageUrl`, `flags.identifyReady: true` |
| DB written | `automated_ingestion_jobs.status = 'identifying'` |

Classifies each image in `artifacts.rawImages[]` using SigLIP zero-shot classification against the label set:
- `model_front`, `model_back`, `model_side`
- `flatlay_front`, `flatlay_back`
- `detail_texture`

Best tryon image selection priority:
1. `flatlay_front`
2. `model_front`
3. `flatlay_back`
4. `model_side`

If none of these labels exist with confidence > threshold, falls back to the highest-confidence image overall.

---

### garment_summary

| Field | Value |
|-------|-------|
| External API | Google Gemini (text model) |
| Retry | 3 attempts, backoff 1s → 2s → 4s |
| State written | `artifacts.garmentSummaryPayloads[]`, `flags.garmentSummaryReady: true` |
| DB written | `automated_ingestion_jobs.status = 'summarizing'` |

**Key difference from existing service:** User inputs (`gender`, `category`, `subcategory`) are injected into the prompt. Removes need for operator manual tagging.

**Additional output field:** `complexityLevel: 'simple' | 'complex'` — determined from garment construction complexity (number of layers, structural elements, pattern complexity). Drives tryon model selection.

Prompt is category-specific (topwear / bottomwear / dress). Outputs: `techPack`, `garmentPhysics`, `itemName`, `colorAndFabric`, `complexityLevel`.

---

### tryon

| Field | Value |
|-------|-------|
| External APIs | fashn_vton (Modal · sync) or Seedream |
| Retry | fashn_vton: 3 attempts, 2s → 4s → 8s / Seedream: 5 attempts, 5s → 10s → 20s → 40s → 80s |
| State written | `artifacts.tryonImage`, `flags.tryonReady: true` |
| DB written | `automated_ingestion_jobs.status = 'tryon_pending'` |
| Storage written | `{jobId}/tryon/front.jpg` |

Reads `garmentSummaryPayloads[0].complexityLevel`:
- `simple` → `fashn_vton` adapter
- `complex` → `seedream` adapter

Both adapters implement the same `TryonProvider` interface (see Section 7). The node does not know which provider runs.

---

### segmentation

| Field | Value |
|-------|-------|
| External APIs | fashn_seg · schp_seg · gdino · sam_v2 · vitmatte · birefnet |
| Retry (node level) | 2 attempts, 2s → 4s |
| Retry (per step) | 2 attempts, 1s → 2s |
| State written | `artifacts.segmentation`, `flags.segmentationReady: true` |
| DB written | `automated_ingestion_jobs.status = 'segmenting'`, `segmentation_step_results` (one row per step) |
| Storage written | `{jobId}/segmentation/steps/*.png`, `{jobId}/segmentation/final.png` |

This node is a thin shell. All logic lives in the segmentation executor (see Section 8).

---

### finalize

| Field | Value |
|-------|-------|
| External API | None |
| Retry | 1 attempt (no retry — all prior data is in state) |
| State written | `flags.finalizeReady: true`, `draft.product` |
| DB written | `automated_ingested_products` ← draft row, `automated_ingestion_jobs.status = 'finalizing'` |

Assembles the full product record from all state fields:
- `crawlMeta` → brand, title, price
- `garmentSummaryPayloads` → techPack, itemName, colorAndFabric
- `tryonImage` → tryon_image_url
- `segmentation` → segmented_image_url
- `userInputs` → gender, category, subcategory

---

### review_pause

Sets `state.pause.reason = 'awaiting_review'` and throws `GraphInterrupt`. LangGraph suspends here. Pipeline is resumed when `POST /jobs/:jobId/review` is called.

---

### review_interrupt

Reads `state.pause.resumeSignal.action`:
- `'accept'` → writes placement to draft, clears pause, routes to `promote`
- `'discard'` → sets `flags.discarded: true`, routes to END

---

### promote

| Field | Value |
|-------|-------|
| External API | None |
| DB written | `products` ← final row (from `automated_ingested_products`), including `placement_x`, `placement_y`, `body_parts_visible` from user input / `enrichment_queue` ← productId / `automated_ingestion_jobs.status = 'completed'`, `product_id` set |

Moves the staged product to the live `products` table. Writes `productId` to `enrichment_queue` for async processing.

---

## 7. Tryon Provider Interface

Adding a new tryon model means implementing `TryonProvider` and registering it in the router.

```typescript
// services/ingestion-automated/src/adapters/tryon/types.ts

export interface TryonProvider {
  readonly name: string;
  run(input: TryonInput): Promise<TryonOutput>;
}

export type TryonInput = {
  imageUrl: string;            // public URL of bestTryonImage
  gender: 'male' | 'female';
  category: 'topwear' | 'bottomwear' | 'dress';
  subcategory: string;
  garmentSubCategory: string;  // from garmentSummaryPayloads
  garmentSummary: {
    techPack: string;
    garmentPhysics: string;
    itemName: string;
    colorAndFabric: string;
  };
};

export type TryonOutput = {
  imageUrl: string;       // public URL of result image
  storagePath: string;    // Supabase storage path
  inferenceMs: number;
  modelUsed: string;
};
```

```typescript
// services/ingestion-automated/src/adapters/tryon/index.ts

import { fashnVton } from './fashn-vton';
import { seedream } from './seedream';
import type { TryonProvider } from './types';

const PROVIDERS: Record<string, TryonProvider> = {
  fashn_vton: fashnVton,
  seedream: seedream,
};

export function getTryonProvider(complexityLevel: 'simple' | 'complex'): TryonProvider {
  const name = complexityLevel === 'simple' ? 'fashn_vton' : 'seedream';
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`No tryon provider for complexity: ${complexityLevel}`);
  return provider;
}
```

**Retry config lives on the node, not the provider.** The provider's `run()` method does not retry — it throws on failure and lets LangGraph's `retryPolicy` handle it. This keeps provider adapters simple.

---

## 8. Segmentation Step Interface

Adding a new segmentation step means implementing `SegmentationStep`, adding it to the registry, and inserting a new `segmentation_pipeline_config` row.

```typescript
// services/ingestion-automated/src/adapters/segmentation/types.ts

export interface SegmentationStep {
  readonly name: string;
  run(input: SegmentationStepInput): Promise<SegmentationStepOutput>;
}

export type SegmentationStepInput = {
  jobId: string;
  inputImageUrl: string;              // output of previous step, or original vton image for step 1
  stepConfig: Record<string, unknown>; // from segmentation_pipeline_config.steps[n].config
  priorResults: SegmentationStepOutput[];  // all prior step outputs — steps can read from them
};

export type SegmentationStepOutput = {
  stepName: string;
  outputImageUrl: string;
  maskUrl?: string;
  metadata: {
    modelVersion?: string;
    inferenceMs?: number;
    confidence?: number;
    [key: string]: unknown;
  };
};
```

```typescript
// services/ingestion-automated/src/adapters/segmentation/registry.ts

import type { SegmentationStep } from './types';
import { fashnSeg } from './fashn-seg';
import { schpSeg } from './schp-seg';
import { gdino } from './gdino';
import { samV2 } from './sam-v2';
import { fashnSegRefine } from './fashn-seg-refine';
import { vitMatte } from './vitmatte';
import { biRefNet } from './birefnet';
import { combine } from './combine';

export const STEP_REGISTRY: Record<string, SegmentationStep> = {
  fashn_seg: fashnSeg,
  schp_seg: schpSeg,
  gdino: gdino,
  sam_v2: samV2,
  fashn_seg_refine: fashnSegRefine,
  vitmatte: vitMatte,
  birefnet: biRefNet,
  combine: combine,
};
```

### Executor logic (crash-safe)

```typescript
// services/ingestion-automated/src/adapters/segmentation/executor.ts

export async function runSegmentationPipeline(
  jobId: string,
  tryonImageUrl: string
): Promise<string> {  // returns final segmented image URL

  // 1. Load active config
  const config = await db.query<SegmentationPipelineConfig>(
    `SELECT * FROM segmentation_pipeline_config WHERE is_active = true LIMIT 1`
  );

  // 2. Group steps by parallel_group
  const stepGroups = groupByParallelGroup(config.steps);

  let allResults: SegmentationStepOutput[] = [];

  for (const group of stepGroups) {
    // 3. Check which steps in this group are already done
    const existing = await db.query(
      `SELECT step_name, output_image_url, mask_url, metadata
       FROM segmentation_step_results
       WHERE job_id = $1 AND step_name = ANY($2) AND status = 'completed'`,
      [jobId, group.map(s => s.name)]
    );

    const doneNames = new Set(existing.rows.map(r => r.step_name));
    const todo = group.filter(s => !doneNames.has(s.name));

    // Collect already-done results
    allResults.push(...existing.rows.map(toStepOutput));

    if (todo.length === 0) continue;

    // 4. Run pending steps (parallel within group)
    const results = await Promise.all(
      todo.map(stepConfig => runStep(jobId, stepConfig, tryonImageUrl, allResults, config.id))
    );

    allResults.push(...results);
  }

  // 5. Return final image URL (output of 'combine' step)
  const final = allResults.find(r => r.stepName === 'combine');
  if (!final) throw new Error('Segmentation pipeline did not produce a final image');
  return final.outputImageUrl;
}
```

---

## 9. Enrichment Queue

Enrichment (fit, feel, vibes, description, material, occasion) is **not** part of the main pipeline. After `promote` writes the product to `products`, it inserts the `productId` into `enrichment_queue`. A separate worker processes these in batches.

### Enrichment worker

- Polls `enrichment_queue` for `status = 'pending'` rows (via pg-boss or a simple cron)
- Batches up to N product IDs per run
- For each: fetches images from Supabase, calls Gemini JSON mode
- Updates `products` table with enrichment fields: `fit`, `feel`, `vibes`, `description_text`, `type_category`, `color_group`, `occasion`, `material_type`, `product_specifications`, `product_name_suggestion`
- Marks `enrichment_queue` row as `completed`

This runs independently of user-facing requests and can be triggered on demand or on a schedule.

---

## 10. Error Handling & Recovery

### Node failure flow

```
Node throws error
  → LangGraph catches it
  → Waits backoff interval
  → Retries the node (up to maxAttempts)
  → If all retries exhausted:
      → recordNodeError() writes to state.errors[]
      → automated_ingestion_jobs.status = 'errored'
      → automated_ingestion_jobs.last_error = message
      → automated_ingestion_jobs.last_error_step = step name
      → automated_ingestion_jobs.error_count++
      → LangGraph halts
```

### Manual re-run (future)

A `POST /jobs/:jobId/retry` endpoint can be added. It reads the LangGraph checkpoint and re-runs from the failed node. No need to restart the whole pipeline.

### Segmentation crash recovery

Segmentation steps write their result to `segmentation_step_results` immediately on completion. If the segmentation node fails and is retried (by LangGraph or by pg-boss job retry), the executor checks `segmentation_step_results` for completed steps and skips them. Only incomplete steps are re-run.

### Error kinds

| Kind | Meaning | Example |
|------|---------|---------|
| `transient` | Temporary failure — retry is reasonable | Network timeout, 503 from external API |
| `fatal` | Permanent failure — retry won't help | Invalid image format, Firecrawl returned no images |

Fatal errors skip remaining retries and halt the pipeline immediately.

---

## 11. Logging

All logs are structured JSON emitted via the shared `logger` instance. Every log line includes `service: 'ingestion-automated'` and `jobId`.

### Log events

**Node start:**
```json
{
  "service": "ingestion-automated",
  "jobId": "abc-123",
  "step": "tryon",
  "event": "node_start",
  "ts": "2026-06-19T10:00:00.000Z"
}
```

**Node complete:**
```json
{
  "service": "ingestion-automated",
  "jobId": "abc-123",
  "step": "tryon",
  "event": "node_complete",
  "durationMs": 1840,
  "meta": { "modelUsed": "fashn_vton", "inferenceMs": 1240 },
  "ts": "2026-06-19T10:00:01.840Z"
}
```

**Node error (retrying):**
```json
{
  "service": "ingestion-automated",
  "jobId": "abc-123",
  "step": "tryon",
  "event": "node_error",
  "error": { "code": "ECONNRESET", "message": "socket hang up" },
  "retryCount": 1,
  "willRetry": true,
  "nextRetryIn": 4000,
  "ts": "2026-06-19T10:00:03.000Z"
}
```

**Node error (exhausted):**
```json
{
  "service": "ingestion-automated",
  "jobId": "abc-123",
  "step": "tryon",
  "event": "node_failed",
  "error": { "code": "ECONNRESET", "message": "socket hang up" },
  "retryCount": 3,
  "willRetry": false,
  "ts": "2026-06-19T10:00:15.000Z"
}
```

**Segmentation step:**
```json
{
  "service": "ingestion-automated",
  "jobId": "abc-123",
  "step": "segmentation",
  "event": "seg_step_complete",
  "stepName": "sam_v2",
  "stepOrder": 4,
  "durationMs": 3200,
  "outputImageUrl": "https://...",
  "ts": "2026-06-19T10:00:20.000Z"
}
```

**Deduplication hit:**
```json
{
  "service": "ingestion-automated",
  "event": "deduplicated",
  "url": "https://myntra.com/product/123",
  "existingJobId": "def-456",
  "existingStatus": "completed",
  "ts": "2026-06-19T10:00:00.000Z"
}
```

---

## 12. Environment Variables

```bash
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL_DIRECT=       # direct Postgres URL (not PgBouncer) — required by pg-boss

# Storage
STORAGE_BUCKET=ingestion-automated
RAW_PREFIX=raw
TRYON_PREFIX=tryon
SEGMENTATION_PREFIX=segmentation

# Firecrawl
FIRECRAWL_API_KEY=
FIRECRAWL_MODE=scrape      # 'scrape' | 'extract'
FIRECRAWL_MAX_CONCURRENCY=3

# Google
GOOGLE_API_KEY=
GEMINI_TEXT_MODEL=gemini-1.5-pro
SIGLIP_API_KEY=            # if using hosted SigLIP endpoint
SIGLIP_ENDPOINT=

# Tryon
FASHN_VTON_API_URL=        # Modal endpoint
FASHN_VTON_API_KEY=
SEEDREAM_API_URL=
SEEDREAM_API_KEY=

# Segmentation model endpoints
FASHN_SEG_API_URL=
SCHP_SEG_API_URL=
GDINO_API_URL=
SAM_V2_API_URL=
FASHN_SEG_REFINE_API_URL=
VITMATTE_API_URL=
BIREFNET_API_URL=

# pg-boss
BOSS_SCHEMA=pgboss_automated
BOSS_ARCHIVE_AFTER=24h
BOSS_EXPIRE_AFTER=2h
BOSS_MAX_CONCURRENCY=5     # max parallel pipeline jobs

# API auth
API_TOKEN=                 # Bearer token for all API endpoints

# Service
PORT=3001
NODE_ENV=production
LOG_LEVEL=info
```

---

## Open Decisions

| # | Question | Impact |
|---|----------|--------|
| 1 | Shared adapters — symlink, monorepo `packages/adapters`, or copy? | Affects how Firecrawl + Gemini adapters are shared with existing service |
| 2 | Seedream hosting — Modal or other? | Determines if adapter is truly sync or polling-based |
| 3 | SigLIP — self-hosted on Modal or external API? | Affects `SIGLIP_ENDPOINT` config and latency |
| 4 | Segmentation Round 1 — `Promise.all` or sequential? | `Promise.all` is faster but complicates crash recovery (partial group completion) |
| 5 | `automated_ingested_products` schema — exact copy of `ingested_products`? | Confirm before writing migration |
| 6 | Circuit breaker for Seedream | Add once Seedream hosting and failure characteristics are known |
