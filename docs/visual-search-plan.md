# Photo → wardrobe: detect, select, segment, match, ingest

**Status:** Phase 0 stateless pipeline harness implemented; production persistence/orchestration remains TODO
**Date:** 2026-07-31
**Touches:** `services/segmentation/` · `supabase/functions/` · `services/ingestion-automated/` · `src/features/visual-search/`

---

## Current implementation decision (2026-08-01)

Before adding job tables and user-facing orchestration, the segmentation and catalog-search path is
being validated as a stateless harness. The caller provides both the image and one explicit category:

| UI value | Segmentation target | Catalog filter |
|---|---|---|
| `upper` | FASHN `top`; GDINO top tokens on parser miss | `products.type = 'top'` |
| `lower` | combined skirt/pants classes; GDINO pants tokens on parser miss | `products.type = 'bottom'` |
| `shoes` | FASHN footwear classes; GDINO footwear tokens on parser miss | `products.type = 'shoes'` |

This replaces Phase A's detect-all/garment-picker for the first test milestone: the user's category
selection directly gates which garment is segmented when a model photo contains multiple garments.
The implemented request path is:

```text
image + category → FASHN target mask (or GDINO fallback) → SAM2/post-process →
ROI from mask + best GDINO box → original crop + white cutout crop →
deployed fashion SigLIP embedder → two match_products_image calls → rank fusion
```

The temporary implementation is documented in `docs/visual-search-implementation.md`. Everything
below describes the intended production architecture and is retained as the next-stage plan.

## Context

Users can only build a wardrobe from what Atlyr already stocks — browse the catalog, save items.
There's no way to start from a *photo* of clothes they own or want and get those specific garments
into their wardrobe.

This adds that. A user uploads any image — a single garment lying flat, a fully dressed person in
top + bottom + shoes, a cropped half-body shot. Every garment is detected and shown back; the user
picks which ones they care about; each picked garment is segmented, matched against the catalog, and
either saved to their wardrobe from a catalog match or — if nothing matches — resolved through a web
search whose chosen result is handed to the existing ingestion pipeline.

Cheap by construction at every step: expensive GPU refinement runs only on garments the user picked,
web search fires only when the catalog misses *and* the user rejects, and exactly one URL is ingested
rather than five speculative ones.

## What already exists (reuse, don't rebuild)

| Need | Already there |
|---|---|
| Multi-garment masks on a person | FASHN human parser already segments every class in one pass (top 3, dress 4, skirt 5, pants 6, footwear) — `services/segmentation/experiment_segmentation.py:39` |
| Tuned per-garment refinement | `pipeline/green_screen_pipeline.py` steps 2–6: SCHP parse, adaptive skin/chroma exclusion, SAM2 refine, post-process, final RGBA |
| Detection with no person / flatlay | GroundingDINO + SAM2; `BASE_GDINO_TOKENS` at `experiment_segmentation.py:74`, adapters in `pipeline/adapters/` |
| GPU host, weights pre-baked | `services/segmentation/modal_app.py` (L4, SAM2 + FASHN in the image) |
| Image embedding | `modal-fashion-embed/`, `Marqo/marqo-fashionSigLIP`, 768-d normalized |
| Catalog vector search | `match_products_image(query_embedding, filters, threshold, count)` — `supabase/migrations/20251230091500_*.sql` |
| User-scoped API pattern | `supabase/functions/search-v2/index.ts` — JWT auth, Modal embed, match RPCs |
| Wardrobe | `wardrobe` is a reserved system collection slug (`user_collections`, `manage_collection` RPC); write path is `useSaveProductToCollection` in `src/features/collections/hooks/useMoodboards.ts` |
| URL → full catalog product | `POST /jobs` on ingestion-automated (`api/routes/submit.ts`) |

**The retrieval constraint being measured:** `products.image_url` is the segmented ghost-mannequin
cutout (`services/ingestion-automated/src/domain/catalog.ts:112`) and `image_vector` was embedded
from it. A white-composited cutout is therefore retained as one query. For worn model photos, however,
strict body-part subtraction can fragment visible fabric and leave the garment tiny in a full canvas.
Phase 0 now also embeds a tightly localized original RGB crop, preserves real occluders, and exposes
both rankings plus a 75/25 rank fusion so the domain trade-off can be measured rather than assumed.

## Relationship to the ingestion pipeline's segmentation

Same models, same tuned chain — one line makes the existing one single-garment.
`green_screen_pipeline.py` step 1 loops `GARMENT_CLASSES_LOCAL`, keeps whichever mask has the largest
area, and discards the rest; steps 2–6 then operate on that one mask. **Lifting the argmax out makes
the chain per-garment**, so this is a refactor of proven code rather than a new pipeline.

Two genuine differences:

- **No-person inputs are new.** FASHN is a human parser; on a flatlay it returns nothing, `best_area`
  stays 0 and the chain produces garbage. ingestion-automated never hits this because its input is
  always a generated VTON model shot. Hence the GDINO + SAM2 discovery fallback.
- **GDINO is used differently.** Today it's a registered adapter the green-screen path never calls,
  and when called it uses category-scoped tokens to refine *one known* garment. Here it needs the
  union of all category tokens to discover *unknown* ones.

`chroma_key` needs no change: it auto-detects a green screen via coverage plus a border heuristic and
degrades gracefully on ordinary photos by protecting the garment from skin exclusion.

## Architecture

User-facing, so auth drives topology: `ingestion-automated` authenticates with one shared `API_TOKEN`,
which cannot ship to consumer browsers. The orchestrator is a **Supabase edge function** (user JWT +
RLS, same shape as `search-v2`); Modal writes back to Supabase directly as the segmentation pipeline
already does. No pg-boss in this feature.

```
client ──POST──► edge fn `visual-search`
                   ├─ upload → visual_search_jobs (user_id = auth.uid())
                   └─ spawn Modal PHASE A, return job_id
                                    │
   PHASE A — detect (cheap): one FASHN pass → every garment class above an area floor
             → label + bbox + plain bbox crop per garment.  No SAM2.
             → visual_search_garments rows, status `awaiting_garment_selection`
                                    │
             user picks which garments they want  ◄── the "what do you want to extract" step
                                    │
   PHASE B — extract (expensive, selected only): skin exclusion → SAM2 refine →
             post-process → final RGBA cutout → embed → match_products_image
             → db_candidates per garment, status `awaiting_selection`
                                    ▼
        ┌───────────────────────────┴───────────────────────┐
   picks a DB match                                  rejects all
   → save to `wardrobe` collection            → edge fn `.../web-search` (SerpAPI, top 5)
                                                          │
                                                     picks one
                                                          └─► edge fn calls ingestion-automated
                                                              `POST /jobs` server-to-server
                                                              (API_TOKEN stays in Deno env)
                                                              → ingested → wardrobe
```

Splitting A/B is what makes the selection step pay for itself: SCHP, SAM2 and post-processing are
per-garment L4 time, so a four-garment outfit where the user wants only the shoes skips three
refinements.

## Data model

New migration `supabase/migrations/<ts>_visual_search.sql`, both tables RLS'd to `auth.uid()`:

```sql
visual_search_jobs (
  job_id UUID PK, user_id UUID NOT NULL REFERENCES auth.users,
  source_image_url TEXT, source_storage_path TEXT,
  status TEXT CHECK (status IN ('pending','detecting','awaiting_garment_selection',
                                'extracting','awaiting_selection','completed','failed')),
  detector TEXT,                       -- 'fashn_parse' | 'gdino_sam2'
  garment_count INT, last_error TEXT, created_at, updated_at
)

visual_search_garments (
  id UUID PK, job_id UUID FK CASCADE, garment_index INT,
  label TEXT,                          -- top | dress | skirt | pants | footwear
  bbox JSONB, preview_url TEXT,        -- Phase A: plain bbox crop, for the picker
  selected_for_extraction BOOLEAN DEFAULT FALSE,
  crop_url TEXT, mask_url TEXT,        -- Phase B: RGBA cutout
  embedding vector(768),
  db_candidates JSONB, web_candidates JSONB,
  selection_kind TEXT CHECK (selection_kind IN ('db','web','dismissed')),
  selected_product_id TEXT, selected_web_url TEXT,
  ingestion_job_id UUID REFERENCES ingestion_pipeline_jobs(job_id),
  status TEXT, created_at, updated_at,
  UNIQUE (job_id, garment_index)
)
```

Persisting `embedding` allows re-matching after a threshold change or catalog growth without
re-hitting the GPU. Persisting both candidate sets gives the data to calibrate the threshold.

## Component 1 — Detection service (Modal, Python)

New `services/segmentation/detect/modal_app_detect.py`, app `atlyr-garment-detect`, following the
`services/segmentation/eraser/modal_app_eraser.py` precedent: separate app file, same image
definition, independent deploy. Two endpoints on one app so a warm container serves both.

**`detect` (Phase A)** — reads the job row for the source image, then:

1. One FASHN parse. Every class in `GARMENT_CLASSES_LOCAL` above an area floor becomes a garment —
   this is exactly the loop that currently argmaxes, with the collapse removed.
2. If FASHN yields nothing (flatlay, hanger, no person), fall back to GroundingDINO with the union
   of `BASE_GDINO_TOKENS` primaries, NMS the boxes, one garment per surviving box.
3. Write a plain bbox crop per garment to `visual-search/{jobId}/{index}_preview.png`, insert rows,
   set `awaiting_garment_selection`.

**`extract` (Phase B)** — takes the selected garment ids and, per garment, runs the existing steps
2–6 of `green_screen_pipeline.py` with that garment's mask as `coarse_garment_mask`. Refactor
`run_green_screen_pipeline_e2e` to accept a target class-set/mask rather than deriving one; SCHP
parses once for the image and is reused across garments, SAM2 refine runs per garment. Then:

- Write the final RGBA cutout using the **same output convention** as the existing pipeline, so query
  and corpus share a visual domain.
- **Embed each cutout** by calling the deployed `fashion-siglip-embed` app via `modal.Function.lookup`
  — that exact deployment produced every `products.image_vector`, guaranteeing model and preprocessing
  identity. Do **not** bake `open_clip` + marqo weights into the L4 image; it slows every GPU cold
  start for no accuracy gain.
- Call `match_products_image` through the Supabase client already used in `pipeline/db_store.py`,
  persist `db_candidates`, set `awaiting_selection`.

## Component 2 — Edge functions

`supabase/functions/visual-search/`, modelled on `search-v2` (JWT forwarded, RLS enforced):

| Route | Does |
|---|---|
| `POST /` | store upload, insert job row, spawn Phase A, return `job_id` |
| `POST /:jobId/extract` | mark `selected_for_extraction`, spawn Phase B |
| `POST /:jobId/garments/:id/web-search` | call the web provider, persist top 5 |
| `POST /:jobId/garments/:id/select` | record the choice; `kind:'web'` also triggers ingestion |

No status endpoint — the client reads `visual_search_jobs` / `visual_search_garments` directly
through supabase-js under RLS.

`select` with `kind:'web'` is the hinge: server-to-server `POST /jobs` against ingestion-automated
with `API_TOKEN` from Deno env, passing the chosen URL plus `product_gender_type` / `product_type` /
`product_sub_type` / `product_complexity`, then recording the returned `ingestion_job_id`. Prefill
`product_type` from the detected label (top→topwear, pants|skirt→bottomwear, dress→dress) and confirm
in the UI, since `submit.ts` requires sub-type and complexity.

`select` with `kind:'db'` records the selection; the wardrobe write stays client-side through the
existing `useSaveProductToCollection` mutation, so it goes through the same RLS-checked path as every
other save rather than a service-role backdoor.

## Component 3 — Web search provider

`supabase/functions/_shared/web-search/`, an interface plus one implementation:

```ts
export interface WebSearchProvider {
  readonly name: string
  search(input: { imageUrl: string; hint?: string }): Promise<WebCandidate[]>
}
// WebCandidate: { title, source, price, currency, inStock, thumbnailUrl, productUrl, exactMatch }
```

**Recommended: SerpAPI `engine=google_lens`.** Returns title, source, price with currency, in-stock
and exact-match flags — the fields a user needs to choose intelligently. GCP Vision Web Detection is
~7x cheaper ($3.50/1k vs ~$25/1k) and credits would cover it, but returns bare page and image URLs
with no price or merchant, making a poor picker; since web search only fires on a double-miss,
absolute volume is low. The interface keeps Vision a drop-in swap if the bill grows.

Env: `WEB_SEARCH_PROVIDER` (default `serpapi`), `SERPAPI_KEY`. Query with the garment **cutout**, not
the original photo, so Lens sees one garment rather than a whole outfit.

## Component 4 — User-facing UI

New `src/features/visual-search/`, following `AGENTS.md` (services → queryKeys → hooks → screens;
screens never touch Supabase directly):

- `src/services/visualSearch/visualSearchService.ts` — edge-function invokes + row reads
- `src/features/visual-search/queryKeys.ts`, `hooks/` — TanStack Query wrappers polling the job row
- `VisualSearchScreen.tsx` — upload → garment picker → per-garment match review
- `components/` — `UploadPanel`, `GarmentPicker` (source photo with bboxes overlaid, multi-select),
  `CandidateGrid` (DB matches with similarity, then web results), `ConfirmIngestDialog`

Reuse `useProductSaveActions` / `useSaveProductToCollection` for the wardrobe write rather than adding
a parallel path. Assumption: nothing pre-selected in the picker — the user picks deliberately.

## Build order

1. Migration + RLS policies.
2. Refactor `run_green_screen_pipeline_e2e` to take a target mask; confirm ingestion-automated still
   passes end-to-end with the argmax moved to its caller. **This is the riskiest step — it touches
   the live segmentation path**, so verify an ingestion job completes before going further.
3. Modal `detect` (Phase A), exercised on the three photo shapes.
4. Modal `extract` (Phase B) + `POST /` and `/extract` edge functions → rows the client can read.
5. **Threshold calibration** (below) — it decides what the picker shows, so do it before building one.
6. `select kind:'db'` + wardrobe write; then the web provider; then `select kind:'web'` → ingestion.
7. UI last, against a working API.

## Threshold calibration

`VISUAL_SEARCH_MATCH_THRESHOLD` (default 0.75 pending measurement) gates which DB candidates surface.

- Take ~20 catalog products, run their **original scraped model shots** (not the ghost cutouts)
  through the new pipeline, confirm each retrieves its own product at rank 1. This exercises the whole
  detect→cutout→embed→match chain in one test.
- Record similarity of correct rank-1 hits vs the best wrong hit; set the threshold between them.
- Confirm RGBA→RGB conversion matches the corpus: the embedder does `.convert("RGB")`, discarding
  alpha, so transparent regions resolve to whatever RGB sits underneath. A mismatch between query and
  catalog cutouts corrupts scores silently — the self-retrieval test is what catches it.

## Verification

- **Detection breadth:** the three shapes from the brief — single flat garment, full-body
  top+bottom+shoes, cropped half-body. Correct counts and labels, and the FASHN→GDINO fallback
  demonstrably firing on the flatlay.
- **Selection gating:** pick one garment of four, confirm Phase B ran SAM2 once, not four times.
- **No regression:** an ingestion-automated job still completes after the step-1 refactor.
- **Self-retrieval:** rank-1 self-match on the calibration set is the pass bar.
- **Hit path:** upload something stocked → candidates above threshold → pick → item in the user's
  wardrobe collection.
- **Miss path end-to-end:** upload something unstocked → thin candidates → web search returns 5
  renderable results → pick → an `ingestion_pipeline_jobs` row exists, `garment.ingestion_job_id` is
  set, job progresses in `/admin/ingestion-automated`.
- **Isolation:** as user B, confirm user A's jobs and garments are invisible (RLS).
- **Failure handling:** dead Modal endpoint → job lands in `failed` with `last_error`, not hanging.
- `bunx jest` stays green.

## Assumptions worth flagging

- **Single person only.** FASHN parses one person; group shots will merge or arbitrarily pick between
  subjects. Out of scope for v1.
- **SerpAPI is assumed** per the reasoning above; the flow is approved, the vendor isn't. Swapping to
  Vision Web Detection is an interface implementation, not a redesign.
- **Abuse surface is real** now this is user-facing, GPU-backed and calls a paid API. Needs per-user
  rate limiting on upload, extract and web-search before launch — not designed here.
- Accessories (bags, hats, belts) are **out of scope**: FASHN has classes and `BASE_GDINO_TOKENS`
  lists them as `accessory`, but the brief says clothes and `ingestion_pipeline_jobs.product_type`
  only permits topwear/bottomwear/dress.
- Ingesting a picked URL inherits every scraper constraint: sites with no profile in
  `adapters/sites/registry.ts` fall back to generic extraction and may fail. The garment row holds a
  failed `ingestion_job_id`; surfacing that to the user is worth doing but isn't scoped.
- A wardrobe item stays pending until ingestion finishes (minutes). `ingestion_job_id` is recorded so
  the UI can show pending state; a "notify when ready" path isn't scoped.
