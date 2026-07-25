# Garment Placement and Camera Registration Service

Production-grade camera registration, dual-mannequin selection, affine warping, and alpha compositing pipeline for e-commerce virtual try-on assets.

---

## 1. Overview

The `test_placement` service recovers the global similarity transformation (scale, rotation, translation) between an input model image and standard candidate mannequin avatars. It automatically selects the optimal mannequin body type (Female vs Male) using dense feature matching and warps the segmented garment onto the target avatar.

### Technical Pipeline Stages

1. Canvas Standardization: Resizes input images to the standard 1800x3072 canvas while preserving aspect ratio.
2. Background Removal: Cleans chroma-key green, solid white, or solid black backgrounds to extract foreground RGBA.
3. Feature Extraction: Generates binary skin and foreground masks for textureless feature alignment.
4. LoFTR Feature Matching: Uses dense transformer-based matching (via Kornia) across mannequin skin/body contours.
5. Dual-Mannequin Auto-Selection: Evaluates alignment scores across candidate avatars (Female vs Male) and picks the winner based on inliers, match ratio, and reprojection error.
6. Affine Similarity Estimation: Computes the 2x3 affine matrix using RANSAC partial affine estimation.
7. Garment Transformation: Applies a 1.03x scale multiplier and a 0.7% Y-axis offset shift (+21.5px down on a 3072px canvas) for natural collar alignment.
8. Edge Refinement: Erodes and Gaussian-blurs the alpha channel boundary to prevent background bleed and halos.
9. Alpha Compositing: Blends the refined garment onto the selected mannequin avatar canvas.

---

## 2. The Two-Input Contract

The placement pipeline requires two distinct input images to execute registration and compositing:

### Input 1: Model Image (`vton_image`)
- Description: The full image showing the model or mannequin wearing the garment on a green screen or solid background.
- Role: Used by LoFTR feature matching to compare body shape, pose, and skin contours against candidate mannequin avatars (`avatar_clean.png` female vs `male_asset.jpg.jpeg` male). This step selects the winning mannequin and computes the 2x3 affine registration matrix.

### Input 2: Segmented Garment (`segmented_garment`)
- Description: The transparent SAM2/SCHP cutout RGBA of the garment (`09_final_garment.png`).
- Role: The clothing layer transformed using the computed affine matrix (with scale=1.03x and Y-offset=0.7% down), edge-feathered, and blended onto the winning mannequin avatar.

---

## 3. Directory Structure

```text
services/test_placement/
├── modal_app.py                      # Modal Cloud GPU web endpoint definition
├── .env                              # Supabase DB & Storage environment secrets (git-ignored)
├── .gitignore                        # Git ignore rules
├── README.md                         # Service documentation
├── pipeline/
│   ├── placement_pipeline.py        # Master end-to-end placement pipeline (run_placement_pipeline_e2e)
│   ├── camera_registration.py       # Core LoFTR registration engine & modular algorithms
│   ├── db_store.py                  # Supabase database status and result updates
│   ├── supabase_client.py           # Supabase storage upload utilities
│   └── types.py                     # Data transfer objects and types
├── assets/
│   ├── mannequins/                  # Candidate avatars (Female avatar_clean.png, Male male_asset.jpg)
│   ├── raw_inputs/                  # Raw model images (vton_image)
│   └── segmented_garments/          # Segmented garment RGBA cutouts
└── asset_placement_results/         # Generated output directory
    ├── composites/                  # Final composited RGBA output images
    ├── debug/                       # Step-by-step intermediate debug masks
    └── bulk_placement_report.json   # Batch execution analytics and metrics
```

---

## 4. Key Modules in `pipeline/`

### `pipeline/placement_pipeline.py`
Provides `run_placement_pipeline_e2e(pipeline_job_id, segmented_image_url, vton_image_url)`.
Downloads inputs, runs dual-mannequin LoFTR registration, warps the garment, uploads the final output to Supabase Storage, and updates public.ingestion_pipeline_jobs DB.

### `pipeline/camera_registration.py`
Contains modular registration algorithms:
- `standardize_to_canvas(image, target_w=1800, target_h=3072)`
- `remove_background(image)`
- `extract_skin_mask(image_bgra)`
- `compute_registration(avatar_clean, generated_avatar, mask_clean, mask_gen)`
- `select_best_mannequin(generated_avatar, candidate_mannequins)`
- `warp_garment(garment_std, matrix, target_size, scale_multiplier=1.03, y_offset_percent=0.007)`
- `alpha_composite(avatar_bgra, garment_warped_bgra)`

### `pipeline/db_store.py`
Provides DB functions: `fetch_job()` and `update_job_placement_result()`.

### `pipeline/supabase_client.py`
Provides storage upload helper: `upload_file_to_storage()`.

---

## 5. Configuration & Tuning Parameters

Placement tuning parameters are defined in `pipeline/camera_registration.py`:

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `MIN_INLIERS` | `10` | Minimum RANSAC inliers required to accept skin feature registration. |
| `MIN_INLIER_RATIO` | `0.15` | Minimum ratio of inliers to total matches (15%). |
| `MAX_REPROJ_ERROR` | `8.0` | Maximum allowable mean reprojection error in pixels. |
| `garment_scale_multiplier` | `1.03` | Scales garment canvas by 1.03x around center for coverage. |
| `garment_y_offset_percent` | `0.007` | Shifts garment down by 0.7% of canvas height (+21.5px on 3072px canvas) for collar alignment. |

---

## 6. Execution Instructions

### Cloud GPU Endpoint Deployment (Modal)
To deploy the placement endpoint to Modal Cloud GPUs:

```bash
cd services/test_placement
modal deploy modal_app.py --profile coeht-iitd
```

### Triggering Cloud Endpoint via HTTP
```http
POST https://<modal-username>--atlyr-placement-place.modal.run/?pipeline_job_id=<JOB_ID>&segmented_image_url=<GARMENT_URL>&vton_image_url=<MODEL_URL>
```

---

## 7. Ingestion Pipeline Integration

In the automated ingestion pipeline (`services/ingestion-automated`), placement is handled by `PlacementHandler` in `src/steps/placement.handler.ts`.

State Transition:
`segmented` -> `placement` -> `completed`

Environment Variable Configuration:
```env
MODAL_PLACEMENT_URL=https://<your-modal-username>--atlyr-placement-place.modal.run
```
