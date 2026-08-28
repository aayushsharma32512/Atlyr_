# Visual search: FASHN + GroundingDINO hypothesis harness

## Purpose

This milestone validates garment localization and coarse background removal before adding SAM2,
embeddings, catalog search, persistence, or user-facing orchestration.

```text
JPEG/PNG/WebP + upper|lower|shoes
  → FASHN full-image class map
  → category-specific FASHN target mask
  → all-non-background FASHN foreground mask
  → category-scoped GroundingDINO boxes
  → select the best DINO box using FASHN overlap
  → union FASHN and DINO boxes + 15% padding
  → square original crop
  → square FASHN-foreground crop composited onto white
  → return every intermediate artifact inline
```

This test answers three questions:

1. Does FASHN reliably identify the requested garment on worn/model images?
2. Does combining the FASHN extent with a GroundingDINO box produce a complete garment crop?
3. Is `FASHN class != 0` inside that crop a useful coarse background-removal mask while retaining
   hands, arms, hair, straps, and other real foreground pixels?

It intentionally does not answer whether the resulting crop retrieves the correct catalog product.
Embeddings and vector search remain disabled until the localization hypothesis is reviewed.

## Production isolation

The harness is a separate Modal app:

- App name: `atlyr-visual-search-test`
- Source: `services/segmentation/visual_search/modal_app_visual_search.py`
- Pipeline: `services/segmentation/visual_search/fashn_gdino_pipeline.py`
- Authentication: test-only `VISUAL_SEARCH_TEST_TOKEN`

It owns a dedicated Modal image containing FASHN, GroundingDINO and their supporting libraries. The
image excludes SAM2 and does not import, call, or deploy the production `atlyr-segmentation` app.
The shared production green-screen pipeline and FashionSigLIP embedder remain at their pre-experiment
behavior.

The test app has no Supabase secret. It does not read or write the database, upload to Storage,
create job rows, invoke SAM/SAM2, or call an embedding deployment. Each request uses a UUID-scoped
directory under `/tmp/visual-search/`, encodes the diagnostics into the response, and deletes the
directory in a `finally` block.

## Category mapping

| UI category | FASHN target classes | GroundingDINO role |
|---|---|---|
| `upper` | `3` (`top`) | Find/expand shirt, jacket, coat, sweater, and related upper-garment boxes |
| `lower` | `5,6` (`skirt`,`pants`) | Find/expand trousers, jeans, skirt, shorts, and related boxes |
| `shoes` | `15` (`feet`) | Primary footwear-localization signal because FASHN has no dedicated shoe class |

The experiment deliberately does not use FASHN classes 8 and 9 for shoes: the repository's FASHN
label map identifies them as bag and hat.

## Box selection

1. Treat the FASHN target as usable only when it contains at least
   `max(256 pixels, 0.05% of the image)`, then compute an exclusive `XYXY` box around it. The raw
   mask is still returned when it falls below this floor so parser noise remains visible.
2. Run GroundingDINO using category-specific garment terms.
3. For each DINO box, measure:

   - target-mask coverage: fraction of FASHN target pixels inside the box;
   - box precision: fraction of box pixels occupied by the FASHN target;
   - area ratio relative to the FASHN box.

4. When FASHN found the target, reject DINO boxes with no overlap or more than four times the FASHN
   box area, then select the highest `coverage + precision` score.
5. When FASHN found no target, select the highest-confidence DINO box.
6. Union the FASHN and selected DINO boxes when both exist, add 15% padding, and clamp to the image.
7. Crop that rectangle from the original image and pad the shorter dimension with white to create a
   square. Pixels are never stretched.

## Background-removal hypothesis

For this test, foreground is intentionally broad:

```text
foreground_mask = FASHN class map != background class 0
```

The final box localizes the garment; inside that box, every FASHN-recognized foreground pixel is
kept. This preserves garment pixels plus skin, hair, hands, arms, belts, scarves, bags, and straps.
Only pixels FASHN calls background are replaced with white.

This is not a production-quality alpha matte. Its purpose is to reveal whether coarse person parsing
is sufficient for a fashion embedding. Flatlays and hangers may produce little or no FASHN
foreground because FASHN is a human parser. In that case, the original DINO crop remains available,
and the foreground crop visibly demonstrates the failure rather than silently introducing SAM2.

## Returned diagnostics

`POST /analyze` returns all of the following as inline PNG data URLs:

| Artifact | What to inspect |
|---|---|
| `00_source.png` | Normalized source image |
| `01_fashn_class_map.png` | Raw per-pixel class IDs |
| `02_fashn_colored.png` | Human-readable class visualization |
| `03_fashn_target_mask.png` | Requested garment pixels only |
| `04_fashn_target_overlay.png` | Target-mask alignment on the source |
| `05_fashn_foreground_mask.png` | Every non-background FASHN pixel |
| `06_detection_boxes.png` | FASHN box, all DINO boxes, selected DINO box, final crop box |
| `07_original_crop.png` | Untouched square contextual crop |
| `08_fashn_foreground_crop.png` | Proposed retrieval crop with coarse background removal |
| `09_fashn_target_only_crop.png` | Diagnostic showing holes if only garment-class pixels were kept |
| `10_fashn_foreground_mask_crop.png` | Exact mask used for the proposed retrieval crop |

The response also includes FASHN class pixel counts, target/foreground coverage, every DINO label,
confidence and overlap metric, the chosen box source, final coordinates, and total analysis time.

Inline base64 is test-only and intentionally avoids defining Storage paths or retention policy.

## SerpApi key

The optional online-search test uses SerpApi's free Google Lens allowance. Create an account at
[`serpapi.com/users/sign_up`](https://serpapi.com/users/sign_up), then copy the private API key from
[`serpapi.com/manage-api-key`](https://serpapi.com/manage-api-key). Never put this key in `.env.local`
or a `VITE_` variable.

Add `SERPAPI_API_KEY` to the existing `visual-search-test` Modal secret in the Modal dashboard while
preserving `VISUAL_SEARCH_TEST_TOKEN` and any origin allowlist. The CLI equivalent overwrites the
named secret, so supply every value that must remain:

```bash
modal secret create --force visual-search-test \
  VISUAL_SEARCH_TEST_TOKEN=<existing-long-random-token> \
  SERPAPI_API_KEY=<copied-serpapi-private-key>
```

Then redeploy only the experiment app.

## Deploy

Modal CLI must be authenticated to the intended workspace/environment. Create a test-only bearer
token and deploy only the test app:

```bash
modal secret create visual-search-test \
  VISUAL_SEARCH_TEST_TOKEN=<long-random-token> \
  SERPAPI_API_KEY=<copied-serpapi-private-key>
modal deploy services/segmentation/visual_search/modal_app_visual_search.py
```

Do not deploy or redeploy any of these for this experiment:

- `services/segmentation/modal_app.py` / `atlyr-segmentation`
- `modal-fashion-embed/modal_app.py` / `fashion-siglip-embed`
- `siglip-embed`
- `fashn-vton-1-5`
- `atlyr-placement`
- `eraser`

The deployment prints the test app URL. It exposes:

- `GET /health` — unauthenticated capability/liveness response;
- `POST /analyze` — multipart diagnostic request protected by `X-Visual-Search-Token`;
- `POST /search-online` — protected SerpApi Google Lens Products request using only artifact 08.

The default CORS allowlist is `http://localhost:8080,http://127.0.0.1:8080`. Add a comma-separated
`VISUAL_SEARCH_ALLOWED_ORIGINS` value to the `visual-search-test` secret only if another temporary
frontend origin is required.

## Browser test page

Optionally put only the endpoint URL in `.env.local`:

```bash
VITE_VISUAL_SEARCH_TEST_URL=https://<workspace>--atlyr-visual-search-test-visualsearchtest-web.modal.run
```

Never put the test token in a `VITE_` variable. Start the SPA and open:

```bash
bun run dev
# http://localhost:8080/visual-search-test
```

Paste the test token into the page, select an image and category, then compare every diagnostic
artifact. After analysis, **Search online** uploads only `08_fashn_foreground_crop.png`; the backend
strips metadata, converts it to JPEG, and keeps it below SerpApi's 500 KB Image API limit. SerpApi's
temporary image ID expires after 10 minutes. The test token remains in component memory and is not
stored.

## CLI test

Node 20+ is sufficient:

```bash
VISUAL_SEARCH_TEST_URL=https://<modal-endpoint> \
VISUAL_SEARCH_TEST_TOKEN=<token> \
npm run test:visual-search -- \
  --image ./test-data/model-shot.jpg \
  --category upper \
  --output ./tmp/visual-search/upper-test
```

The CLI writes every numbered PNG plus `results.json` to the output directory.

## Request contract

### `POST /analyze`

| Field | Required | Contract |
|---|---:|---|
| `image` | yes | JPEG, PNG, or WebP; 10 MB maximum |
| `category` | yes | `upper`, `lower`, or `shoes` |

### `POST /search-online`

| Field | Required | Contract |
|---|---:|---|
| `image` | yes | Artifact 08 as JPEG, PNG, or WebP; backend normalizes it under 500 KB |
| `category` | yes | Category returned by the corresponding analysis |
| `country` | no | Two-letter code; the test page currently sends `in` |

The response contains normalized product cards only. Results and images are not written to Supabase
or local persistent storage. Price and stock values are third-party search signals and may be stale.

## Validation matrix

Run and retain outputs for:

1. Upper garment with a hand or arm crossing it.
2. Upper garment partly covered by hair or a cross-body strap.
3. Full-body model image tested separately as `upper`, `lower`, and `shoes`.
4. Skin-coloured garment.
5. Loose sleeves and wide-leg trousers where FASHN may under-estimate the extent.
6. Flatlay on a simple background.
7. Hanger product image.
8. Image with a nearby bag or hat to confirm footwear localization is not contaminated.

For each case, record:

- whether FASHN selected the correct pixels;
- whether the chosen DINO box belongs to the requested garment;
- whether the final box contains the complete garment without most unrelated body regions;
- whether coarse background removal preserves occluders and removes useful amounts of background;
- whether `dino_only` cases are common enough to justify a later segmentation fallback.

## Explicitly deferred

- SAM/SAM2 or any other pixel-refinement fallback
- FashionSigLIP or other embeddings
- `match_products_image` or any catalog search
- Supabase migrations, tables, RLS policies, RPC changes, and Storage objects
- wardrobe writes, ingestion handoff, and production web-search orchestration
- production auth/orchestration, retries, rate limits, retention, and analytics

The next implementation decision should be based on saved diagnostic outputs, not made in advance.
