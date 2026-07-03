# Ghost Mannequin Pipeline — Experiment KT

> **Status**: Active experiment. Best-performing iteration lives in `test_avatar_ghost.py` (GDINO-primary, all fixes applied).
> **Dataset**: 22 garments across 5 categories — see `test_data/*/manifest.json` + `test_data/*/pipeline*/stage2_avatar_vton.png`
> **Run anything**: `python test_run_pipeline.py --item F1` or `python test_run_pipeline.py --stage3-only`

---

## 1. What This Is

Ghost mannequin (also called "hollow man") is an e-commerce photography technique where a garment is shot on a model/mannequin and then the body is digitally removed — leaving only the garment floating in shape, showing interior construction (neckline, hem, sleeves). This pipeline automates that end-to-end from a raw product image.

**Input**: single product image (flatlay or model shot) from Myntra  
**Output**: `ghost_mannequin.png` — RGBA PNG of garment with transparent background, body removed

---

## 2. Pipeline Architecture

Five sequential stages. Each stage feeds the next.

```
[Stage 0] Fetch avatar from Supabase
              ↓
[Stage 1] Gemini: garment physics analysis → flags + item name
              ↓
[Stage 1.5] Sample background color from V-ToN image corners
              ↓
[Stage 2] Gemini image generation: avatar wearing garment → V-ToN image
              ↓
[Stage 3] Segmentation: GroundingDINO → SAM2 box prompts → clothing mask
              ↓
[Composite] V-ToN × mask → RGBA ghost PNG
```

### Stage 0 — Avatar Fetch
- Pulls a pre-made flat, featureless mannequin silhouette from Supabase storage.
- Separate avatars for male/female. Same avatar reused across all garments of that gender.
- Avatar is a plain skin-toned body with no face features, no hair — intentionally featureless so Gemini can dress it cleanly.

### Stage 1 — Garment Physics (Gemini)
- Sends garment product image + optional model-wearing photo to Gemini.
- Returns structured JSON: `garment_physics` (text description), `item_name`, `flags`, `subcategories`, `components`.
- **Flags** are the most critical output — they drive every downstream decision:

| Flag | Effect |
|------|--------|
| `has_belt` | closing_size=6, belt component guaranteed in mask |
| `is_sheer` | closing_size=0, no trapped-bg detection |
| `has_fringe` | closing_size=8, fringe strips preserved |
| `has_cutouts` | closing_size=0 |
| `has_overalls` | bib+strap bg-subtraction guarantee, arm-label exclusion removed |
| `is_two_piece` | GDINO path forced, separate component masks merged |
| `has_wrap_front` | closing_size=4 |
| `has_holes` | closing_size=8 — **caution: Gemini false-positives on this flag** |
| `is_jumpsuit` | full-body SegFormer labels used |

- **`subcategories`** (e.g. `["shirt dress", "midi dress"]`) are injected into GDINO query tokens.
- **`components`** (e.g. `["belt", "bib", "strap"]`) trigger component-guarantee logic in Stage 3.

### Stage 1.5 — Background Color Sampling
- Samples 20×20px corners of the V-ToN image to get actual background color.
- Used downstream for trapped-bg hole detection and overalls bg-subtraction.
- Handles non-standard backgrounds (dark, warm gray) robustly.

### Stage 2 — V-ToN Generation (Gemini Image Gen)
- Sends avatar image + garment image to Gemini image generation.
- Per-category system prompts with GEOMETRY LOCK instruction (hold avatar pose/angle).
- Returns a synthetic image of the avatar wearing the garment.
- **This is the hardest stage to control** — see §6 Failure Modes.

### Stage 3 — Segmentation (Primary focus of this experiment)
Three-path hierarchy (tried in order, falls through on failure):

```
1. GroundingDINO → SAM2 box prompts      ← PRIMARY (best results)
2. Anchor point-SAM2                      ← DISABLED (see §6)
3. SegFormer fallback                     ← LAST RESORT
```

Detailed Stage 3 flow:

```
V-ToN image
  → SegFormer (exclusion mask only — body parts + off-category garment labels)
  → GroundingDINO: text prompt from category + flags + subcategories + components
      → detect garment bounding boxes
      → NMS + cross-label NMS
      → classify: primary / accessory / component detections
  → SAM2 (box prompt): one box per detection → raw masks
  → Merge masks (primary union + accessories if overlapping)
  → Component guarantee: belt/bib/strap/collar forced in from SegFormer fallback
  → Body-color exclusion (overalls only)
  → Trapped-bg hole detection → punch interior bg voids
  → _polish_mask_hard: morphological closing (size from flags) + fill_holes + debris filter
  → Feathering (soft edge, 1-2px)
  → Composite with V-ToN → RGBA ghost
```

---

## 3. Test Dataset

22 items covering edge cases across all categories:

| ID | Name | Category | Gender | Hard flags |
|----|------|----------|--------|-----------|
| F1 | Forever New Pink Linen A-Line Belted Midi Dress | dresses | F | belt |
| F3 | ONLY Sheer Lace Top | topwear | F | is_sheer |
| F4 | Ketch Halter Neck Top + Skirt Co-ord | topwear | F | is_two_piece |
| F6 | DressBerry Wrap Dress | dresses | F | has_wrap_front |
| F7 | DressBerry Front Open Cardigan | topwear | F | is_open_front |
| F8 | DressBerry Peplum Top | topwear | F | has_peplum |
| F9 | Mango One Shoulder Fringe Top | topwear | F | has_fringe |
| F10 | Tokyo Talkies Cold Shoulder Top | topwear | F | has_cutouts |
| F11 | Showoff Denim Dungaree | bottomwear | F | has_overalls |
| N1 | Louis Philippe Slim Fit T-Shirt | topwear | M | — |
| N2 | H&M Hooded Sweatshirt | topwear | M | — |
| N3 | Lulu & Sky Open Back Tube Top | topwear | F | — |
| N4 | Anouk Floral Maxi Dress | dresses | F | — |
| N5 | Bershka Denim Midi Dress | dresses | F | — |
| N6 | Mango Halter Jumpsuit | dresses | F | is_jumpsuit |
| N7 | H&M Wide High Waist Jeans | bottomwear | F | — |
| N8 | H&M Crochet Tiered Skirt | bottomwear | F | is_sheer override |
| N9 | Carlton London Sports Sandals | footwear | F | open-toe, skin |
| N10 | Bata Men Round Toe Boots | footwear | M | — |
| T4 | HRX White Sneakers | footwear | M | — |
| T5 | H&M Voluminous Ramie Blouse | topwear | F | — |
| T6 | Louis Philippe Formal Trousers | bottomwear | M | belt, has_holes override |

**V-ToN images** (inputs to Stage 3): `test_data/<ID>/pipeline*/stage2_avatar_vton.png`  
**Comparison panels** (4-panel: model | V-ToN | ghost before | ghost after): `test_data/<ID>/pipeline*/comparison_bg_removal.png`

---

## 4. Segmentation: What Was Built and Why

### 4.1 GroundingDINO for Spatial Localization

**Why**: Standard semantic segmentation (SegFormer) gives coarse labels per pixel, but the label map often bleeds across garment boundaries or confuses adjacent clothing. We need a bounding box that says "the dress is HERE" before asking SAM2 to trace the exact boundary.

**How GDINO is prompted**:
- Base tokens per category: `topwear → ["shirt", "top", "blouse", ...]`
- Enriched with subcategory tokens from Stage 1: `"shirt dress . midi dress ."`
- Component tokens from Stage 1: `"belt ."`, `"bib ."`, `"strap ."`
- Period-separated format required by GroundingDINO: `"belt . dress . midi . shirt ."`

**Thresholds tuned**:
- `BOX_THRESHOLD=0.25`, `TEXT_THRESHOLD=0.20` — lowered from defaults because synthetic V-ToN images score ~0.30-0.35 (lower than real photos)
- `MIN_SCORE=0.28` — post-filter; if nothing passes, marginal rescue logic kicks in
- NMS within same label, then cross-label NMS to suppress duplicate detections

**Detection classification**: detections split into primary / accessory / component by token membership. Only one primary box used for SAM2 (highest confidence). Accessories (scarves, belts) are optional add-ons if overlapping sufficiently.

### 4.2 SAM2 for Precise Boundary Tracing

**Why**: GDINO gives bounding boxes. SAM2 (Segment Anything Model 2) takes those boxes as prompts and traces the exact garment silhouette with sub-pixel precision. Box prompts are much more reliable than point prompts for fashion because:
- Garments are spatially bounded (the dress is roughly within its detected box)
- Point prompts can leak into adjacent body regions (arm bleed into topwear, skin into bib)

**Variant used**: `sam2_large` on CPU. Slow (~10-15s per mask) but highest quality.

### 4.3 SegFormer — Exclusion Mask Only

SegFormer (`mattmdjaga/segformer_b2_clothes`) is used **exclusively for exclusion** — not to generate the positive mask. Its role:

1. **Body part exclusion**: remove pixels labeled as face, hair, hat, arms, legs — so avatar body doesn't bleed into the garment mask
2. **Off-category garment exclusion**: for topwear, exclude bottomwear labels (prevents SAM2 bleeding into trouser area); for bottomwear, exclude upper-clothes labels

**SegFormer label map**:
```
0=background  1=hat  2=hair  3=sunglasses  4=upper-clothes  5=skirt
6=pants  7=dress  8=belt  9=L-shoe  10=R-shoe  11=face
12=L-leg  13=R-leg  14=L-arm  15=R-arm  16=bag  17=scarf
```

**Why not use SegFormer for the positive mask?** SegFormer is good at semantic labels but terrible at exact boundaries — it bleeds across garment edges, misses fine details (lace, fringe, straps), and has coarse predictions at scale. It's used as a veto/guarantee mechanism only.

### 4.4 Category-Aware Exclusion Logic

Not all body labels should be excluded for all categories:

```python
BODY_EXCLUSION_LABELS = [1, 2, 3, 11, 14, 15, 16, 17]  # always excluded
# Note: 12, 13 (legs) intentionally NOT in base list — see below

CATEGORY_GARMENT_EXCLUSIONS = {
    "topwear":    [5, 6, 9, 10, 12, 13],  # legs excluded: thighs show below top hem
    "bottomwear": [4, 9, 10],             # upper-clothes, shoes only
    "dresses":    [9, 10],                # only shoes — dress spans full body
    "footwear":   [4, 5, 6, 7, 8],        # all clothing above feet
}
```

**Key nuance — why leg labels (12, 13) are NOT in base exclusion**:  
For `bottomwear`, SegFormer mislabels dark trouser ankle fabric as "l-leg" skin → excluding it creates notch cutouts at trouser hems. Since GDINO bounding box already constrains SAM2 to the garment region, leg-label exclusion is redundant for bottomwear and harmful. Only topwear needs it (to clip exposed thigh below a short top).

**Why dress label (7) removed from bottomwear exclusion**:  
Mini skirts are labeled as "dress" by SegFormer. Excluding label 7 for bottomwear was splitting mini skirt masks into two pieces. Removed — GDINO box handles spatial containment anyway.

### 4.5 Component Guarantee Logic

Some garment parts aren't reliably detected by GDINO (narrow belts, shoulder straps on dungarees, halter necks). The pipeline has fallback mechanisms:

**Belt guarantee**: If belt detected by GDINO → SAM2 mask → dilated → added to merged mask as immune from exclusion.  
If not detected → SegFormer belt label (8) used as fallback, dilated, guaranteed.

**Overalls bib + strap guarantee**: SegFormer can't detect shoulder straps at all (labels them as background). Fix: **background subtraction** in the zone above the trouser waistband.
- Non-background + non-body-color pixels in upper zone = garment straps
- More reliable than any label-based approach for thin dark straps on gray background

**Upper-component fallback** (halter necks, hoods, capes): SegFormer label 4 (upper-clothes) scoped above the primary detection box top, dilated, guaranteed.

### 4.6 Morphological Post-Processing

After merging all masks:

1. **Trapped-bg hole detection** (`_detect_trapped_bg_holes`): finds connected components of background-colored pixels *interior* to the mask (e.g., open collar void, armhole). These are legitimate ghost mannequin openings — punches them out. Skipped for sheer garments (lace holes would be destroyed).

2. **`_polish_mask_hard`**: binary closing (bridges thin gaps based on `closing_size` from flags) → `fill_holes` (fills remaining interior voids) → debris filter (removes isolated components < 5% of main component or < 500px).

3. **`_feather_mask`**: 1-2px Gaussian edge softening for anti-aliased composite.

`closing_size` is the primary tunable per garment type:
- 0 = sheer/cutouts (preserve exact edges)
- 1 = footwear, two-piece
- 2 = default topwear/bottomwear/dresses
- 3 = peplum
- 4 = wrap front, open front
- 6 = belt (needs to bridge waistband gap)
- 8 = fringe/holes (aggressive bridging)

---

## 5. Manifest Flags and Overrides

Each test item has a `manifest.json`. The `flags` field overrides Gemini's Stage 1 flag detection. This is the primary mechanism for manual correction.

```json
{
  "id": "T6",
  "flags": {"has_holes": false},
  "notes": "Overrides Gemini false-positive: trouser leg gap seen as holes → closing_size=8 was wrong"
}
```

**Why overrides exist**: Gemini's physics analysis is accurate about the garment's physical structure but doesn't understand the segmentation implications. It will correctly identify "lace has holes" but doesn't know that `is_sheer` → `closing_size=0` produces jagged mask edges for a knit skirt ghost.

**When to add overrides**:
- `has_holes: false` — when Gemini flags holes on items that shouldn't use aggressive closing (formal trousers, structured garments)
- `is_sheer: false` — knit/crochet lace that looks sheer but needs `closing_size=2` for clean ghost silhouette
- `is_two_piece: true` — co-ord sets where Stage 1 only sees the top piece (common for co-ords where flatlay shows separated pieces)

---

## 6. Failure Modes and Nuances

### 6.1 The Anchor Path Regression (Important)

**What happened**: An anatomy-guided SAM2 *point prompt* path was implemented as the primary segmentation route. The idea was to use calibrated body landmarks (shoulder, bust, waist, hip fractions from actual avatar measurements) to generate precise foreground/background point prompts for SAM2.

**Why it was built**: Point prompts seemed more elegant — no need for GDINO text queries, purely geometric.

**Why it failed**: SAM2 box prompts vs point prompts behave very differently in practice:
- Box prompts: SAM2 is spatially constrained. It segments what's inside the box. Even if it slightly over- or under-segments, the result is bounded.
- Point prompts: SAM2 "floods" from the point outward. Near anatomy (bib over chest, strap over shoulder) the flood can follow adjacent body regions rather than garment boundaries. Result: skin/body silhouette bleeding through the garment mask.

**Specific failures observed**: F11 dungaree bib showed full avatar arm/body silhouette; F6 wrap dress had ragged collar; F10 cold shoulder had debris + arm skin bleed.

**Current state**: `_anchor_skip = True` — point-SAM2 path is permanently disabled as primary. Code is preserved for potential future use as post-GDINO enhancement. GDINO-primary consistently outperforms it.

**Lesson**: GDINO bounding boxes provide spatial constraint that point prompts fundamentally lack for fashion segmentation. The semantic understanding (text → "this is a dress bounding box") is more robust than purely geometric approaches for garments.

### 6.2 SegFormer Label False Positives

Several SegFormer mislabeling issues encountered:

| Situation | SegFormer behavior | Impact | Fix |
|-----------|-------------------|--------|-----|
| Dark trouser ankle | Labels as l-leg (12) skin | Notch cut at trouser hem | Removed 12/13 from base exclusion |
| Mini skirt | Labels as dress (7) | Splits bottomwear mask | Removed label 7 from bottomwear exclusion |
| Dungaree shoulder strap | Labels as background (0) | Strap invisible, not guaranteed | bg-subtraction instead of label-based guarantee |
| Dungaree strap near shoulder | Labels as L-arm (14) / R-arm (15) | Strap pixels excluded | Remove 14/15 from exclusion when has_overalls |
| Crochet/pointelle fabric | Labels as upper-clothes (4) | Correct label but wrong exclusion for co-ords | Handled via full_body flag for overalls |

**The core problem**: SegFormer was trained on real-world photos, not synthetic V-ToN avatar images. In synthetic V-ToN images the avatar is a featureless mannequin, backgrounds are solid gray, and garment boundaries are artificially clean. This distribution shift means SegFormer's labels are less reliable at boundaries than on real photos.

### 6.3 Gemini Stage 1 Flag False Positives

| Item | Wrong flag | Root cause | Fix |
|------|-----------|-----------|-----|
| T6 formal trousers | `has_holes: true` | Gap between trouser legs | `manifest.json` override |
| N9 sandal | `has_holes: true` | Strap gaps | Footwear ignores has_holes in closing_size |
| N8 crochet skirt | `is_sheer: true` | Pointelle lace pattern | `manifest.json` override |

**Structural fix to add**: A `_sanitize_flags(category, flags, item_name)` post-processing step that applies category-aware validation rules before flags hit pipeline logic. Not yet implemented — currently handled per-item via manifest overrides.

### 6.4 Gemini Stage 2 Front View Compliance

**Problem**: The dresses front-view prompt includes GEOMETRY LOCK, 0° azimuth constraint, bilateral symmetry instructions, and a NEGATIVE list — but Gemini still generates 3/4 angled or slightly rotated V-ToN images (~10-15% of runs).

**Why it happens**: Gemini image generation doesn't truly "composite" the garment onto the avatar. It generates a new image inspired by both inputs. When the avatar (a flat, featureless silhouette) and the garment (a product photo) are given, Gemini generates a photo-realistic figure wearing the garment — often a more natural-looking 3/4 pose because that's what the training distribution looks like for "model wearing a dress."

**Workaround**: Strengthened prompt with explicit bilateral symmetry constraint and expanded NEGATIVE list. Reduces frequency but doesn't eliminate. Re-running Stage 2 sometimes produces a better result on second attempt (different random seed).

**Categories most affected**: dresses (full-body garments where Gemini defaults to natural posing). Topwear/bottomwear are less affected because the partial body framing constrains Gemini more.

### 6.5 Open Footwear — Inherent Limitation

Sandals (N9) are categorically difficult:
1. Open-toe design shows avatar foot skin through straps — the ghost ends up showing skin interior
2. SegFormer foot-skin exclusion (labels 12/13) only catches ankle-level skin, not skin between sandal straps
3. GDINO bounding box includes both the sandal and the visible foot → SAM2 includes both

Current status: **manual touchup required** for open sandals. Closed-toe footwear (N10 boots, T4 sneakers) works well.

For production: body-color exclusion for footwear (sample skin tone from visible shin area above sandal, remove from mask interior) could partially address this, but beige/tan sandal footbed colors closely match skin tones — risk of removing footbed.

### 6.6 Two-Piece Co-ords (F4)

**Problem**: The co-ord is a halter top + skirt. Gemini Stage 1 sees only the top half when analyzing the flatlay → sets `is_two_piece: false`.

**Fix**: `manifest.json` sets `is_two_piece: true` override + `recommended_vton_image` pointed to the image that shows both pieces. Stage 2 prompt gets an explicit "dress avatar in BOTH pieces" instruction. Works but relies on human curation of which image to use.

---

## 7. What's Currently Broken / Known Limitations

| Item | Issue | Root cause | Status |
|------|-------|-----------|--------|
| T6 trousers | Bottom ankle cutoff | GDINO box doesn't reach bottom of full-leg V-ToN | Partially fixed; small cuff splits remain |
| N8 crochet skirt | Bottom-left/right corner cutoff | SAM2 box doesn't fully extend to outer hem corners | Open |
| N9 sandal | Avatar foot skin visible | Open-toe design, inherent challenge | Manual touchup |
| F1 dress | V-ToN slightly angled | Gemini Stage 2 compliance | Improved prompt, residual issue |
| F3 sheer lace top | Lace holes partially filled | is_sheer + crochet boundary is fuzzy | Inherent; manual touchup |
| F10 cold shoulder | Strap band debris | Strap connected to body → debris filter can't isolate | Manual touchup |

---

## 8. What Else Can Be Tried

### 8.1 Segmentation Improvements

**Better SAM2 prompts for edge cases**:
- For items with bottom-cutoff (T6, N8): expand GDINO box by a margin (pad box 5-10% before SAM2 prompt) to ensure SAM2 sees the full hem. GDINO detection boxes are often tight; SAM2 can track better with looser boxes.
- For N8 skirt bottom corners: run a second SAM2 pass with a wider bounding box (take convex hull of all detections + padding), OR use SegFormer label map to expand the initial mask at the hem.

**Ensemble masks**:
- Run both GDINO+SAM2 AND SegFormer positive mask (not just exclusion), take IoU-weighted union. SegFormer is spatially coarser but semantically reliable for main body — could fill in corners/edges that SAM2 misses.

**SAM2 video-mode for consistency**:
- SAM2 was trained on video and supports multi-frame propagation. Could run front + back V-ToN images as a "video" and propagate the mask — potentially more consistent garment coverage.

**Iterative refinement with feedback**:
- After first SAM2 pass: check if mask has coverage < expected_frac (from CATEGORY_QA). If yes, expand prompts and re-run. Currently the pipeline just falls through to SegFormer on QA fail; could instead try a second SAM2 pass with a wider box.

**Model upgrade**:
- `sam2_large` is used but `sam2_hiera_large` with more iterations may improve boundary precision at hem edges.
- GDINO is `grounding-dino-base` — `grounding-dino-large` may give better bounding boxes for fashion vocabulary.

### 8.2 Flag Quality

**`_sanitize_flags` function** (not yet built):
```python
def _sanitize_flags(category: str, flags: dict, item_name: str) -> dict:
    f = flags.copy()
    # has_holes is almost always a false positive for opaque structured garments
    if category == "bottomwear" and f.get("has_holes"):
        name_lower = item_name.lower()
        if not any(w in name_lower for w in ["mesh", "crochet", "fishnet", "net"]):
            f["has_holes"] = False
    if category == "footwear":
        f["has_holes"] = False  # strap gaps should never trigger aggressive closing
    return f
```

**Better Gemini Stage 1 prompt**: add explicit examples of what `has_holes` means for segmentation purposes (deliberately perforated fabric, NOT lace pattern, NOT strap gaps, NOT leg separation).

### 8.3 V-ToN Quality (Upstream)

Better V-ToN → better segmentation. Two approaches:

**Prompt engineering for Gemini Stage 2**:
- Current approach: GEOMETRY LOCK text instructions. Low compliance for dresses.
- Try: show the avatar image as a "style reference" rather than a "pose reference" and provide explicit 3D model renders as examples of the desired output format.
- Try: reference image inpainting instead of image generation — pass the avatar image and ask Gemini to inpaint only the garment region, preserving avatar structure.

**Alternative V-ToN models**:
- CatVTON, IDM-VTON, OOTD-Diffusion: open-source try-on models trained specifically on fashion pairs. They don't hallucinate poses. Tradeoff: require exactly paired inputs (model photo + garment flatlay), less flexible for arbitrary garment images.
- These models output avatars in consistent poses with clean garment transfer — would significantly improve Stage 3 segmentation quality since the background is controlled and the pose is fixed.

### 8.4 Background-Aware Segmentation

Current approach: SegFormer + GDINO + SAM2 on the full V-ToN image. All three models see both the garment and the avatar body.

Alternative: **foreground/background pre-segmentation using the avatar mask**.
- The Stage 0 avatar is a known silhouette (skin-colored blob on black).
- When Gemini dresses it, the avatar shape is (roughly) preserved.
- Could use the original avatar mask as a spatial prior: pixels inside the silhouette are candidate garment pixels; pixels outside are definitely background.
- Reduces SAM2's search space, potentially improves boundary precision.

### 8.5 Post-Processing

**Contour smoothing**: currently `closing_size` does morphological smoothing. Could additionally apply contour-based bezier smoothing for specific categories (scalloped hems, lace edges) — keep the macro shape of the detected edge but smooth within a 3-5px band.

**Edge-guided alpha**: instead of binary mask → feathering, use edge detection (Canny) to build a soft alpha channel where confidence is high at edges but falls to 0 at ambiguous boundary pixels. Standard in production ghost mannequin tools.

**Multi-scale closing**: single closing_size applied uniformly across the mask. A tiered approach (large closing for interior gaps, small for edges) would better handle garments with both large holes (armholes) and fine detail (fringe, scallops).

---

## 9. Running the Pipeline

```bash
# Full pipeline (all stages)
python test_run_pipeline.py --item F1

# Stage 3 only (reuse existing V-ToN)
python test_run_pipeline.py --item F1 --stage3-only

# Full batch
python test_run_pipeline.py --stage3-only

# Override which garment image to use
python test_run_pipeline.py --item F4 --vton-idx 4

# Direct script (more control)
python test_avatar_ghost.py \
    --garment test_data/F1/images/image_000.jpg \
    --category dresses \
    --gender female \
    --output-dir test_data/F1/pipeline \
    --flag-overrides '{"has_belt": true}'
```

**Env required** (`services/ingestion/.env`):
```
GOOGLE_API_KEY=...        # Gemini (Stage 1 + Stage 2)
SUPABASE_URL=...          # Avatar fetch (Stage 0)
SUPABASE_SERVICE_ROLE_KEY=...
```

**Python**: `.venv312/` (Python 3.12). Key deps: `transformers`, `torch`, `sam2`, `pillow`, `google-genai`.

---

## 10. File Map

```
test_avatar_ghost.py        ← Main pipeline script (all 5 stages)
test_run_pipeline.py        ← Batch runner; generates comparison panels
test_scrape_collect.py      ← Scrapes Myntra item images → test_data/<ID>/
avatar_anchors.py           ← Anatomy fracs + anchor point computation (disabled as primary)

test_data/
  <ID>/
    manifest.json           ← Item metadata + flag overrides + recommended_vton_image
    images/                 ← Scraped product images (0-5 per item)
    pipeline/               ← Stage outputs (full run)
    pipeline_v2/            ← Stage outputs (re-run with fixes, preferred for some items)
      stage0_avatar.png
      stage1_garment_physics.txt
      stage2_avatar_vton.png      ← INPUT to Stage 3 (the V-ToN)
      stage3_clothing_mask.png    ← Binary mask
      ghost_mannequin.png         ← RGBA output (transparent bg)
      ghost_mannequin_white.png   ← Same on white bg (preview)
      comparison.png / comparison_bg_removal.png ← 3-4 panel visual
```

---

## 11. Quick Diagnostics

When output looks wrong, check in this order:

1. **Look at `stage2_avatar_vton.png`** — is the V-ToN itself reasonable? Wrong angle, wrong garment, wrong color? → Problem is Stage 2 (Gemini), not Stage 3.

2. **Look at `stage3_clothing_mask.png`** — does the mask shape match the garment?
   - Mask split into two pieces → probably exclusion mask removing garment pixels (check which label)
   - Mask includes body silhouette → exclusion not aggressive enough, or anchor path was used
   - Mask missing corners/edges → GDINO bounding box too tight; SAM2 didn't extend
   - Mask has debris → debris filter threshold (5%/500px), raise if needed

3. **Check flags** — `stage1_garment_physics.txt`. Are the flags correct for this garment? If wrong, add override in `manifest.json`.

4. **Re-run stage3-only** after any code/manifest change: `python test_run_pipeline.py --item <ID> --stage3-only`

---

*Last updated: June 2026. 22-item test set. GDINO-primary + SAM2 box prompts. All structural fixes applied.*
