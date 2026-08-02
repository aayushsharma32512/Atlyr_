# Visual search: stateless pipeline test environment

## What is implemented

This milestone validates the expensive/accuracy-sensitive portion of visual search without adding a
new persistence model:

```text
JPEG/PNG/WebP + upper|lower|shoes
  → production FASHN parse
  → category-selected coarse mask
  → category-scoped GroundingDINO fallback when the parser mask is empty/small
  → SCHP exclusions + SAM2 refine + existing post-processing
  → RGBA cutout for diagnostics
  → padded square ROI from visible mask + best overlapping GroundingDINO garment box
  → original RGB crop (occluders retained) + white-composited cutout crop
  → two deployed Marqo fashion SigLIP embeddings in one batched Modal class call
  → two existing Supabase match_products_image RPC calls, filtered to top|bottom|shoes
  → weighted reciprocal-rank fusion + side-by-side candidate sets
```

There are two clients:

- `/visual-search-test`: temporary React page for inspecting the contextual crop, white cutout crop,
  raw segmentation, detector, timings, fused results, and both source rankings.
- `npm run test:visual-search`: CLI runner that writes all three query artifacts and `results.json`
  for repeatable comparisons.

No source image or cutout is persisted. The Modal container deletes its per-request `/tmp` directory
after returning the response.

## Files

- `services/segmentation/visual_search/modal_app_visual_search.py` — authenticated stateless Modal API.
- `services/segmentation/pipeline/green_screen_pipeline.py` — explicit category targeting and a
  `persist_results=False` mode; the default persisted ingestion behavior is retained.
- `services/segmentation/pipeline/core_segmentation.py` — GDINO-box coarse-mask fallback for flatlays.
- `modal-fashion-embed/modal_app.py` — correct white compositing for transparent RGBA input.
- `scripts/visual-search-test.mjs` — Node 20+ CLI client.
- `src/services/visualSearch/visualSearchTestService.ts` — browser API adapter.
- `src/features/visual-search/` — TanStack mutation and temporary test screen.

## Prerequisites

1. Modal CLI authenticated to the workspace. If it is not installed, installing the `modal` Python
   package is the only required local Python download; model dependencies and weights are built in
   Modal's cloud image.
2. Existing Modal secret `supabase-secret` containing:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

3. Modal secret `my-api-secrets`. The Marqo deployment's HTTP compatibility endpoint expects
   `MODAL_INTERNAL_SECRET`; the visual-search app itself calls the deployed class internally. If the
   secret is missing, create it before deploying Marqo:

   ```bash
   export MODAL_INTERNAL_SECRET="$(openssl rand -hex 32)"
   modal secret create --env main my-api-secrets MODAL_INTERNAL_SECRET="$MODAL_INTERNAL_SECRET"
   ```

   Preserve this value only if another client will call the Marqo HTTP endpoint; the stateless visual
   search uses Modal's internal class call and does not send this token.
4. The target Supabase catalog has populated 768-dimensional `products.image_vector` values and the
   `match_products_image` RPC.

The service-role key stays in Modal. Never put it in `.env.local`, a `VITE_` variable, the browser,
or the CLI invocation.

## Deploy

The currently deployed `siglip-embed` app is the Google
`siglip-so400m-patch14-384` classifier used by automated ingestion. It is not interchangeable with
Marqo FashionSigLIP even though both produce 768-dimensional vectors. Deploy the Marqo app under its
separate name so query vectors share the catalog's embedding space:

```bash
modal config show
modal secret list
modal deploy modal-fashion-embed/modal_app.py
```

That creates `fashion-siglip-embed`; it does not replace `siglip-embed`. The deployment builds the
OpenCLIP dependencies and downloads `Marqo/marqo-fashionSigLIP` into the remote Modal image.
Redeploy this app when upgrading an earlier version of the test because RGBA inputs now composite
onto white instead of silently discarding their alpha channel.

Create a test-only bearer token and deploy the endpoint:

```bash
modal secret create visual-search-test VISUAL_SEARCH_TEST_TOKEN=<long-random-token>
modal deploy services/segmentation/visual_search/modal_app_visual_search.py
```

This creates `atlyr-visual-search-test`. Do not redeploy `atlyr-segmentation`, `siglip-embed`,
`fashn-vton-1-5`, `atlyr-placement`, or `eraser` for this test. If the workspace uses multiple Modal
Environments, pass the same `--env <name>` to the secret and both deployment commands; the internal
`modal.Cls.from_name` lookup resolves within the calling app's environment.

The deployment output prints the web URL. The API exposes:

- `GET /health` — unauthenticated liveness check.
- `POST /search` — multipart request protected by `X-Visual-Search-Token`.

The default CORS allowlist is `http://localhost:8080,http://127.0.0.1:8080`. To use another temporary
frontend origin, add `VISUAL_SEARCH_ALLOWED_ORIGINS` as a comma-separated value to the
`visual-search-test` Modal secret and redeploy.

## Run from the browser

Optionally put only the endpoint URL in `.env.local`:

```bash
VITE_VISUAL_SEARCH_TEST_URL=https://<workspace>--atlyr-visual-search-test-visualsearchtest-web.modal.run
```

Do not put the token in a Vite variable. Start the SPA and open the page:

```bash
bun run dev
# http://localhost:8080/visual-search-test
```

Paste the test token into the page, choose a file/category, and run. A cold L4 plus model loading can
take several minutes; the page keeps the request open and shows a pending state.

## Run from the CLI

Node 20+ is sufficient; this command does not require Bun dependencies:

```bash
VISUAL_SEARCH_TEST_URL=https://<modal-endpoint> \
VISUAL_SEARCH_TEST_TOKEN=<token> \
npm run test:visual-search -- \
  --image ./test-data/model-shot.jpg \
  --category lower \
  --threshold 0.75 \
  --count 12 \
  --output ./tmp/visual-search/lower-test
```

Outputs:

- `original-crop.png` — primary contextual RGB query; real hair/hands/straps inside the ROI remain.
- `cutout-crop.png` — secondary segmented query, tightly cropped and composited onto white.
- `cutout.png` — full-canvas RGBA segmentation for diagnostics; it is not directly embedded.
- `results.json` — query images, crop box, detector, timings, fused candidates, and source rankings.

## Request/response contract

`POST /search` accepts multipart fields:

| Field | Required | Contract |
|---|---:|---|
| `image` | yes | JPEG, PNG, or WebP; 10 MB maximum |
| `category` | yes | `upper`, `lower`, or `shoes` |
| `threshold` | no | 0–1; default 0.75 |
| `count` | no | 1–30; default 12 |

The `detector` response value is `fashn_parse_sam2` when the requested class produced a useful human
parser mask and `gdino_sam2` when the flatlay/no-person fallback supplied the coarse mask.
`candidateSets.originalCrop` and `candidateSets.segmentedCutout` preserve each RPC's cosine ordering.
Top-level `candidates` are ordered using weighted reciprocal-rank fusion (75% contextual crop, 25%
cutout); their displayed similarity is the better of the two source similarities, not the fusion score.

## Suggested validation set

Run at least these cases and keep each `results.json`:

1. A single flat garment (`upper`) — expect `gdino_sam2` and a clean single-garment cutout.
2. A full-body model (`upper`) — confirm the contextual crop contains the complete garment region,
   including real occluders, while excluding most of the face, lower garment, and background.
3. The same model image (`lower`) — confirm the upper garment is excluded.
4. The same model image (`shoes`) — confirm both footwear components survive cleanup.
5. A known catalog source/model image — its own catalog product should be rank 1.

Record correct rank, correct/wrong similarity separation, cutout defects, and per-stage timings before
changing the default threshold.

## TODO: deferred production implementation

- Create `visual_search_jobs` and `visual_search_garments`, RLS policies, indexes, and private Storage
  paths through a reviewed Supabase migration.
- Replace the synchronous test endpoint with user-JWT edge orchestration, job status, retries,
  idempotency, rate limits, and failure state transitions.
- Return signed artifact URLs instead of inline base64 and define retention/deletion rules for model
  photos.
- Add Google Lens/SerpAPI fallback only after the user rejects catalog candidates; persist the chosen
  result set for calibration/auditing.
- Handoff the chosen Google URL to `services/ingestion-automated`, including a supported footwear
  ingestion path, then reconcile completion to the user's wardrobe.
- Add DB-match wardrobe writes through existing collection hooks.
- Calibrate `VISUAL_SEARCH_MATCH_THRESHOLD` on self-retrieval data instead of shipping the test
  default blindly.
- Add production observability, abuse controls, cost limits, and PostHog events only after updating
  the engagement tracking spec with locked vocabulary.

## Known test-harness constraints

- One requested category per invocation; group photos remain unsupported.
- The test app explicitly sets `SKIP_DINO=0`; do not override it when validating flatlays.
- `lower` intentionally combines skirt and pants parser classes.
- Occluded fabric is not reconstructed. The contextual crop preserves observed pixels instead of
  hallucinating hidden patterns or construction details.
- Inline base64 makes responses large and is for testing only.
- The endpoint uses a service-role key for read-only catalog lookup; authorization is a separate
  test token, not end-user Supabase auth.
- Calling a deployed Modal class by name requires the `fashion-siglip-embed` app to be deployed;
  an ephemeral `modal serve` version of that separate app cannot be looked up.
