# Ingestion Automated — Implementation Plan

**Status:** Planning  
**Service:** `services/ingestion-automated`  
**Date:** 2026-06-19

---

## Diagram 1 — System Architecture (Component Communication)

> Who talks to whom, and over what interface.

```mermaid
graph LR
    subgraph App["👤 Mobile App"]
        USER[User]
    end

    subgraph Svc["ingestion-automated  ·  Node.js / Fastify"]
        API["API Layer
        ───────────────
        POST /jobs
        GET /jobs/:jobId
        POST /jobs/:jobId/review"]
        BOSS["pg-boss
        ───────────────
        PostgreSQL-backed queue
        table: pgboss.job
        worker polls every few seconds"]
        WRK["LangGraph Worker
        ───────────────
        Runs each pipeline node
        Checkpoints state after every node
        Resumes from last checkpoint on crash"]
        SEX["Segmentation Executor
        ───────────────
        Sequential step runner
        Fully decoupled from main graph
        Steps driven by DB config"]
    end

    subgraph Ext["External APIs"]
        FC["Firecrawl
        scrapes product page"]
        SIG["Google SigLIP
        image classification"]
        GEM["Google Gemini
        garment summary"]
        FVN["fashn_vton
        Modal · synchronous
        simple outfits"]
        SDR["Seedream
        complex outfits"]
        SMOD["Segmentation Models
        fashn_seg · schp_seg · gdino
        sam_v2 · vitmatte · birefnet"]
    end

    subgraph PG["PostgreSQL  ·  Supabase"]
        TJ[("automated_ingestion_jobs
        one row per job
        status · current_step")]
        TS[("automated_ingestion_job_state
        full state blob per job
        LangGraph checkpoint")]
        TC[("segmentation_pipeline_config
        active step config")]
        TR[("segmentation_step_results
        one row per step per job")]
        TAI[("automated_ingested_products
        staging before promotion")]
        TP[("products
        live catalog")]
        TEQ[("enrichment_queue
        async batch enrichment")]
    end

    subgraph Store["Supabase Storage  ·  ingestion-automated bucket"]
        SR["#123;jobId#125;/raw/
        downloaded product images"]
        ST["#123;jobId#125;/tryon/
        tryon output image"]
        SS["#123;jobId#125;/segmentation/
        step masks + final cutout"]
    end

    USER -->|"submit job"| API
    USER -->|"accept or discard + placement"| API
    API -->|"poll job status"| USER
    API -->|"INSERT row"| TJ
    API -->|"enqueue pipeline message"| BOSS
    BOSS -->|"worker picks up job"| WRK
    WRK -->|"UPDATE status · current_step"| TJ
    WRK -->|"UPSERT state blob + checkpoint"| TS
    WRK -->|"scrape product page"| FC
    WRK -->|"classify images"| SIG
    WRK -->|"garment summary"| GEM
    WRK -->|"tryon · simple"| FVN
    WRK -->|"tryon · complex"| SDR
    WRK -->|"upload raw images"| SR
    WRK -->|"upload tryon image"| ST
    WRK -->|"delegate seg sub-pipeline"| SEX
    WRK -->|"INSERT staging row"| TAI
    WRK -->|"MOVE staging to live"| TP
    WRK -->|"INSERT productId"| TEQ
    SEX -->|"read active config"| TC
    SEX -->|"write result per step"| TR
    SEX -->|"call each model"| SMOD
    SEX -->|"upload masks + final image"| SS
```

---

## Diagram 2 — Full Pipeline Flow

> Step by step: what happens, what is written to state, which DB table is hit.

```mermaid
flowchart TD
    START(["👤 POST /jobs
    url · gender · category · subcategory"])

    DEDUP{"Deduplicate
    MD5 canonical URL
    check automated_ingestion_jobs"}

    EXIST(["↩ Return existing jobId + productId
    no pipeline started"])

    INTAKE["API — Job Intake
    ─────────────────────
    DB WRITE: automated_ingestion_jobs
      status: queued
      gender · category · subcategory stored
    ─────────────────────
    pg-boss: enqueue pipeline job
    API returns jobId immediately"]

    START --> DEDUP
    DEDUP -->|"same URL, status ≠ discarded"| EXIST
    DEDUP -->|"new URL"| INTAKE

    INTAKE -.->|"worker picks up job"| CRAWL

    subgraph LG["⚙️  LangGraph Worker  —  automated_ingestion_job_state updated after every node"]

        CRAWL["🔍 crawl   retries: 3  backoff: 1s → 2s → 4s
        Firecrawl scrapes the product URL
        ─────────────────────
        STATE: artifacts.htmlPath
               artifacts.crawlMeta
               { title · brand · price · description }
        DB: automated_ingestion_jobs → status: crawling"]

        EXTRACT["📄 extract   retries: 2  backoff: 1s → 2s
        Parse all image URLs from crawl output
        ─────────────────────
        STATE: artifacts.draftImages[]
               { url · alt · width · height }"]

        DOWNLOAD["⬇️ download   retries: 3  backoff: 1s → 2s → 4s
        Fetch each image · upload to Supabase
        ─────────────────────
        STATE: artifacts.rawImages[]
               { hash · storagePath · width · height }
               flags.downloadReady: true
        STORAGE: {jobId}/raw/0.jpg · 1.jpg · ...
        DB: automated_ingestion_jobs → status: downloading"]

        IDENTIFY["🏷️ identify   retries: 2  backoff: 1s → 2s
        Google SigLIP classifies each downloaded image
        Labels: model_front · model_back · model_side
                flatlay_front · flatlay_back · detail_texture
        Best image for tryon selected by priority:
          flatlay_front → model_front → flatlay_back → model_side
        ─────────────────────
        STATE: artifacts.imageClassifications[]
               { hash · storagePath · label · confidence }
               artifacts.bestTryonImagePath
               flags.identifyReady: true
        DB: automated_ingestion_jobs → status: identifying"]

        GS["📋 garment_summary   retries: 3  backoff: 1s → 2s → 4s
        Google Gemini · text model
        Injects user inputs: gender · category · subcategory
        ─────────────────────
        STATE: artifacts.garmentSummaryPayloads[]
               { techPack · garmentPhysics · itemName
                 colorAndFabric · complexityLevel }
               flags.garmentSummaryReady: true
        DB: automated_ingestion_jobs → status: summarizing"]

        TRYON_R{"complexityLevel?"}

        FASHN["fashn_vton
        Modal · synchronous
        ─────────
        retries: 3
        backoff: 2s → 4s → 8s"]

        SEED["seedream
        ─────────
        retries: 5
        backoff: 5s → 10s → 20s → 40s → 80s"]

        TRYON_OUT["STATE: artifacts.tryonImage
        { imageUrl · storagePath
          modelUsed · inferenceMs }
        flags.tryonReady: true
        STORAGE: {jobId}/tryon/front.jpg
        DB: automated_ingestion_jobs → status: tryon_pending"]

        SEG_N["✂️ segmentation   retries: 2  backoff: 2s → 4s
        Calls segmentation executor
        See Diagram 3 for internal steps
        ─────────────────────
        STATE: artifacts.segmentation
               { configId · segmentedImageUrl · storagePath }
               flags.segmentationReady: true
        STORAGE: {jobId}/segmentation/final.png
        DB: segmentation_step_results — one row per step
        DB: automated_ingestion_jobs → status: segmenting"]

        FIN["📦 finalize
        Assembles full product record from all prior state
        ─────────────────────
        DB: automated_ingested_products ← draft row inserted
        DB: automated_ingestion_jobs → status: finalizing"]

        RPAUSE["⏸️ review_pause
        Pipeline pauses — waits for user decision
        ─────────────────────
        STATE: pause.reason: awaiting_review
        DB: automated_ingestion_jobs → status: awaiting_review"]
    end

    INTAKE -.-> CRAWL
    CRAWL --> EXTRACT --> DOWNLOAD --> IDENTIFY --> GS
    GS --> TRYON_R
    TRYON_R -->|"simple"| FASHN --> TRYON_OUT
    TRYON_R -->|"complex"| SEED --> TRYON_OUT
    TRYON_OUT --> SEG_N --> FIN --> RPAUSE

    RPAUSE -->|"result surfaced to user"| REVIEW

    REVIEW(["👤 User reviews result
    Sees tryon image + segmented product on avatar
    Drags product to set placement on body
    ─────────────────────
    POST /jobs/:jobId/review
    { action: 'accept' | 'discard'
      placement: { x · y · bodyPartsVisible } }"])

    REVIEW --> RINT

    subgraph END["Review Resolution"]
        RINT["review_interrupt
        Reads action + placement from signal"]

        PROMOTE["✅ promote
        ─────────────────────
        DB: automated_ingested_products → products
            + placement_x · placement_y · body_parts_visible
        DB: automated_ingestion_jobs → status: completed
        DB: enrichment_queue ← productId inserted
             async worker enriches in batch later"]

        DISCARD["❌ discard
        ─────────────────────
        DB: automated_ingestion_jobs → status: discarded
        Nothing promoted"]
    end

    RINT -->|"accept"| PROMOTE
    RINT -->|"discard"| DISCARD

    PROMOTE --> ASYNC[["async enrichment worker
    reads enrichment_queue in batches
    calls Gemini · generates fit · feel · vibes
    description · material · occasion
    updates products table"]]
```

---

## Diagram 3 — Segmentation Pipeline (Internal)

> Fully decoupled from the main LangGraph. Steps are driven by `segmentation_pipeline_config` in DB.
> Each step result is persisted to `segmentation_step_results` immediately — crash recovery resumes from the first incomplete step.

```mermaid
flowchart TD
    IN(["Input: vton image URL
    from state.artifacts.tryonImage.imageUrl"])

    CFG["Read active config
    FROM segmentation_pipeline_config
    WHERE is_active = true
    ─────────────────────
    Returns ordered array of step descriptors
    Each has: name · type · config JSON"]

    IN --> CFG

    CFG --> CHECK{"Check segmentation_step_results
    for this jobId — any steps
    already completed?"}
    CHECK -->|"yes — skip completed steps"| RESUME["Resume from first
    non-completed step"]
    CHECK -->|"no — fresh run"| PAR1

    RESUME --> PAR1

    subgraph PAR1["Round 1  —  Parallel"]
        FS["fashn_seg
        Input: vton image
        Output: segmentation mask A
        ─────────
        segmentation_step_results row:
        step_name: fashn_seg · order: 1
        output_image_url: steps/fashn_seg_mask.png"]

        SC["schp_seg
        Input: vton image
        Output: segmentation mask B
        ─────────
        segmentation_step_results row:
        step_name: schp_seg · order: 2
        output_image_url: steps/schp_seg_mask.png"]

        GD["gdino
        Input: vton image + prompt: 'clothing item'
        Output: bounding boxes JSON
        ─────────
        segmentation_step_results row:
        step_name: gdino · order: 3
        metadata: { boxes: [...] }"]
    end

    FS & SC & GD --> SAM

    SAM["sam_v2
    Input: vton image + mask A + mask B + bounding boxes
    All three Round 1 outputs feed in as hints
    Output: coarse segmentation mask
    ─────────
    segmentation_step_results row:
    step_name: sam_v2 · order: 4
    output_image_url: steps/sam_v2_coarse.png
    retries: 2"]

    SAM --> REF

    REF["fashn_seg_refine
    Input: coarse mask from sam_v2
    Output: refined mask with cleaner edges
    ─────────
    segmentation_step_results row:
    step_name: fashn_seg_refine · order: 5
    output_image_url: steps/fashn_seg_refined.png"]

    REF --> PAR2

    subgraph PAR2["Round 2  —  Parallel"]
        VM["vitmatte
        Input: vton image + refined mask
        Uses mask as trimap guidance
        Output: alpha matte A
        ─────────
        segmentation_step_results row:
        step_name: vitmatte · order: 6
        output_image_url: steps/vitmatte_alpha.png"]

        BR["birefnet
        Input: vton image only
        Independent matting — no mask needed
        Output: alpha matte B
        ─────────
        segmentation_step_results row:
        step_name: birefnet · order: 7
        output_image_url: steps/birefnet_alpha.png"]
    end

    VM & BR --> COMB

    COMB["combine
    Input: alpha matte A + alpha matte B
    Strategy: weighted average
    Output: final segmented product image
    ─────────
    segmentation_step_results row:
    step_name: combine · order: 8
    output_image_url: segmentation/final.png
    ─────────
    STORAGE: {jobId}/segmentation/final.png"]

    COMB --> OUT(["Output: segmented product image URL
    → written to state.artifacts.segmentation.segmentedImageUrl
    → main LangGraph pipeline continues"])

    subgraph CRASH["Crash Recovery"]
        CR["If process dies mid-segmentation:
        pg-boss retries the main job
        LangGraph resumes segmentation node
        Executor reads segmentation_step_results
        Steps with status=completed → skipped
        Resumes from first status=pending step
        No duplicate API calls"]
    end
```

---

## Key Design Decisions (Summary)

| Decision | Choice | Reason |
|----------|--------|--------|
| Orchestration | LangGraph + pg-boss | Already in stack, proven patterns |
| Image classification | Google SigLIP | Purpose-built zero-shot classifier, fast + cheap |
| Tryon — simple | fashn_vton via Modal | Synchronous, deterministic |
| Tryon — complex | Seedream | Adapter is async-capable by design |
| Tryon retries | fashn_vton: 3 · Seedream: 5 | Different backoff per provider |
| Circuit breaker | Not now | Revisit for Seedream when hosting confirmed |
| Placement | User input at review step | Automated placement is unreliable; user sees result on avatar anyway |
| Enrich | Async batch after promote | Keeps main pipeline fast; enrichment is not blocking |
| Segmentation coupling | Fully decoupled executor | Steps driven by DB config — swap a model with no code change |
| Deduplication | MD5 of canonical URL | Return existing jobId + productId, no re-processing |

---

## DB Tables

| Table | Written by | When |
|-------|-----------|------|
| `automated_ingestion_jobs` | API + every node | On submit, on every status transition |
| `automated_ingestion_job_state` | LangGraph after every node | Checkpoint + full state blob |
| `segmentation_pipeline_config` | Manual / migrations | Config only — read during segmentation |
| `segmentation_step_results` | Segmentation executor | One row per step, written immediately after each step |
| `automated_ingested_products` | finalize node | Staging row before promotion |
| `products` | promote node | Final promotion after user accepts |
| `enrichment_queue` | promote node | ProductId queued for async batch enrichment |

---

## Retry Policy Per Node

| Node | Retries | Backoff |
|------|---------|---------|
| crawl | 3 | 1s → 2s → 4s |
| extract | 2 | 1s → 2s |
| download | 3 | 1s → 2s → 4s |
| identify | 2 | 1s → 2s |
| garment_summary | 3 | 1s → 2s → 4s |
| tryon — fashn_vton | 3 | 2s → 4s → 8s |
| tryon — seedream | 5 | 5s → 10s → 20s → 40s → 80s |
| segmentation (node) | 2 | 2s → 4s |
| each segmentation step | 2 | 1s → 2s |

---

## Folder Structure

```
services/ingestion-automated/
  src/
    api/
      index.ts
      routes/
        submit.ts           # POST /jobs
        status.ts           # GET /jobs/:jobId
        review.ts           # POST /jobs/:jobId/review
    adapters/
      crawler/              # Firecrawl (reuse from services/ingestion)
      llm/                  # Gemini wrappers (reuse)
      storage/              # Supabase storage (reuse)
      tryon/
        fashn-vton.ts
        seedream.ts
        index.ts            # Routes: simple → fashn_vton, complex → seedream
      segmentation/
        fashn-seg.ts
        schp-seg.ts
        gdino.ts
        sam-v2.ts
        fashn-seg-refine.ts
        vitmatte.ts
        birefnet.ts
        combine.ts
        executor.ts         # Sequential runner with crash recovery
        registry.ts         # step name → adapter
    config/
      index.ts              # Zod-validated env vars
    db/
      supabase.ts
    domain/
      state.ts              # AutomatedPipelineState type
      state-store.ts        # Load/save from automated_ingestion_job_state
      job-catalog.ts        # CRUD on automated_ingestion_jobs
      dedup.ts              # MD5 deduplication logic
      contracts.ts          # Zod schemas for API inputs
    orchestration/
      graph.ts              # LangGraph StateGraph definition
      nodes/
        crawl.ts
        identify.ts
        garment-summary.ts
        tryon.ts
        segmentation.ts     # Thin shell — calls executor
        finalize.ts
        review-pause.ts
        review-interrupt.ts
        promote.ts
      state-merge.ts
      checkpointer.ts
      resume.ts
    queue/
      boss.ts
      worker.ts
    utils/
      logger.ts
    index.ts
```

---

## Open Decisions

| # | Question |
|---|----------|
| 1 | Shared adapters — symlink, monorepo `packages/adapters`, or copy from existing service? |
| 2 | Seedream hosting — Modal or other? Affects whether adapter is truly sync or polling-based. |
| 3 | `automated_ingested_products` schema — copy `ingested_products` exactly or strip unused fields? |
| 4 | Segmentation parallel steps — run Round 1 (fashn_seg + schp_seg + gdino) truly in parallel via `Promise.all`, or keep sequential for simpler crash recovery? |
