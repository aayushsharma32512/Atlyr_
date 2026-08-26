# Visual search hypothesis-validation plan

**Status:** FASHN + GroundingDINO diagnostic harness

**Production impact:** none intended

**Persistence:** none

## Current question

Before building visual search, determine whether a simple garment-focused representation is good
enough:

```text
original image
  → FASHN garment pixels
  → GroundingDINO category box
  → padded garment crop
  → remove only FASHN background
  → preserve skin, hands, arms, hair, straps, and other foreground occluders
```

If this produces stable, complete garment crops, it may remove the need to run SAM2 on ordinary worn
photos. If it fails on flatlays or difficult images, those failures will define the exact fallback
that is needed.

## Why embeddings are deferred

An embedding score cannot distinguish a localization failure from an embedding-model failure. The
current milestone therefore stops before FashionSigLIP and catalog retrieval. Every intermediate
mask and box is displayed and downloadable so the localization logic can be assessed directly.

Only after the visual artifacts are acceptable should the same saved crops be embedded and measured
against known catalog products.

## Experimental components

### Backend

The separate `atlyr-visual-search-test` Modal app accepts one image and an explicit `upper`, `lower`,
or `shoes` category. It runs FASHN and GroundingDINO, selects a crop box, generates diagnostic masks
and crops, and returns them inline.

It does not call the production segmentation endpoint and has no Supabase credentials.

### Frontend

The temporary `/visual-search-test` page accepts the endpoint, test token, image, and category. It
renders:

- raw and coloured FASHN parsing;
- target and all-foreground masks;
- target overlay;
- every GroundingDINO box and its overlap metrics;
- selected and final padded boxes;
- original, FASHN-foreground, and target-only crops;
- class counts, coverage, box source, and timing.

### CLI

`npm run test:visual-search` sends the same request and writes every numbered artifact plus the full
response JSON to a local directory for comparison across images and algorithm changes.

## Box hypothesis

FASHN supplies a target-pixel extent. GroundingDINO independently detects category-specific boxes.
When both exist, the selected DINO box must overlap the FASHN mask and must not be more than four
times the FASHN box area. The best candidate maximizes FASHN target coverage plus box precision.

The selected box is unioned with the FASHN extent and padded by 15%. This should let GroundingDINO
restore sleeves, hems, and other garment extent that a human parser may miss while preventing a
person-sized DINO box from dominating the crop.

When FASHN has no target pixels, the highest-confidence DINO box is used alone. The response records
`boxSource` as `fashn_union_dino`, `fashn_only`, or `dino_only` so fallback frequency is measurable.

## Background-removal hypothesis

For worn photos, FASHN class `0` is background and every other class is foreground. Keeping every
non-background class inside a tight garment box should retain real occluders without creating holes:

```text
retrieval foreground = (FASHN class != 0) inside final garment box
```

The experiment returns both the proposed foreground crop and a target-only crop. The latter makes the
skin-removal problem visible and provides a direct comparison.

For flatlays, FASHN may return mostly background. GroundingDINO can still provide a useful original
crop but cannot remove its background because it returns boxes, not pixel masks. These cases will
indicate whether a conditional SAM2 fallback is required later.

## Decision gates

### Gate 1: garment localization

Proceed only if the final box consistently contains the complete requested garment while excluding
most unrelated garments and body regions.

### Gate 2: foreground quality

Proceed only if the FASHN foreground crop removes meaningful background without erasing garment
pixels or occluders.

### Gate 3: fallback frequency

Measure the percentage of cases that are `dino_only`, have very small FASHN target coverage, or show
unusable foreground masks.

- Low fallback frequency: keep the ordinary path FASHN + DINO only.
- Failures concentrated in flatlays/hangers: add SAM2 only for those inputs.
- Frequent worn-photo failures: reconsider the foreground-mask strategy before embedding.

### Gate 4: embeddings

Only after Gates 1–3 pass, freeze a diagnostic set and compare embeddings for:

1. original contextual crop;
2. FASHN foreground crop;
3. any future conditional refined crop.

Use known catalog source images and rank-one self-retrieval as the initial measurement. Do not add a
fusion weight until those results exist.

## Test set

The diagnostic set should include:

- hand/arm crossing upper garment;
- hair covering shoulders;
- cross-body strap or bag;
- skin-coloured garment;
- patterned and solid garments;
- loose sleeves and oversized silhouettes;
- skirt, pants, and shorts;
- both shoes visible and one shoe partially occluded;
- full-body, half-body, flatlay, and hanger images;
- nearby unrelated garments or accessories;
- light garment on light background and dark garment on dark background.

Keep each CLI output directory unchanged so results can be compared after box-selection adjustments.

## Out of scope for this milestone

- database schema or migration changes;
- Supabase Storage or job rows;
- user authentication and RLS;
- embeddings and vector search;
- catalog candidate ranking or fusion;
- wardrobe writes;
- web search and ingestion;
- production deployment changes;
- analytics events.

Deployment and request details are in
[`visual-search-implementation.md`](./visual-search-implementation.md).
