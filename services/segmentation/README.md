# Garment Segmentation Pipeline

This service extracts high-precision, transparent garment assets from model product shots. It features a SAM2-only pipeline designed to segment clothing while avoiding edge bleeding and background contamination.

## Setup

Navigate to the segmentation directory and install the dependencies:

```bash
cd services/segmentation
pip install -r requirements.txt
```

Note: A CUDA-enabled GPU (minimum 8GB VRAM) is recommended for fast processing.

---

## Production Pipeline Execution

To run the standalone segmentation pipeline (local CLI):

```bash
python pipeline/run.py --image /path/to/input.png --output-dir /path/to/output_dir
```

> **Supabase Environment Keys**: Running the pipeline locally requires connection to Supabase storage. Ensure you have `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured in your environment (or inside a `.env` file in the segmentation folder).

### Execution Stages

1. **Garment Prior Filtering**: Uses the FASHN human parser to resolve the garment category and define a coarse garment area.
2. **Morphological Closing**: Fills small slits, button seams, and zipper gaps inside the garment.
3. **Skin Exclusion Subtraction**: Subtracts skin areas (face, neck, arms) from the mask, utilizing SCHP parser maps to augment the exclusion boundaries.
4. **Multi-Component Cleanup**: Retains disjoint areas larger than 1000px to preserve sleeves, straps, or strings.
5. **Adaptive Color Extension (Inpainting)**: Erodes the mask to isolate the garment core and inpaints background borders using the garment's internal colors to remove color bleed.
6. **Erosion Gating**: Applies a final 2px outer boundary erosion to secure clean edges.

---

## Database Nomenclature

The segmentation service tracks each stage of the pipeline in the `segmentation_step_results` table in the database.

### Active Pipeline Steps

For standard production jobs, the following 6 sequential steps are recorded:

| Step Order | Step Name | Description | Output Artifacts |
| :--- | :--- | :--- | :--- |
| 1 | `fashn_parse` | Coarse FASHN semantic segment map extraction. | `02_fashn_garment.png` |
| 2 | `schp_parse` | Self-Correction Human Parsing mask extraction. | `03_schp_exclusion.png` |
| 3 | `chroma_key` | Green-screen detection and skin color checks. | `06_exclusion_mask.png` |
| 4 | `sam2_refine` | SAM2 interactive prompt refinement. | `03_sam_and_fashn.png` |
| 5 | `post_process` | Inpainting, multi-component area checks, and edge feathering. | `07b_sam2_alpha.png` |
| 6 | `final_output` | Composite transparent RGBA image generation and upload. | `09_final_garment.png` |

### Bypassed Steps

The legacy steps listed below are bypassed in the production pipeline and return a status of `skipped` without triggering model inference:

* `vitmatte` (Step 6 in legacy setup)
* `birefnet` (Step 7 in legacy setup)
* `combine` (Step 8 in legacy setup)

---

## Output File Structure

Processed outputs are written to the target directory under the subject identifier:

```
output_dir/<subject_id>/
├── 01_original.png               # Original input image
├── 02_fashn_exclusion.png         # FASHN baseline skin/exclusion mask
├── 02_fashn_garment.png          # FASHN coarse garment prior mask
├── 03_schp_exclusion.png         # SCHP exclusion mask
├── 03_sam_and_fashn.png          # Morphologically closed and filtered base mask
├── 06_exclusion_mask.png         # Combined skin/background exclusion region
├── 07b_sam2_alpha.png            # Final eroded binary mask (post-processed alpha)
├── 09_final_garment.png          # Clean RGBA garment (transparent background)
└── 09_final_garment_checker.png  # Checkerboard preview of the extracted garment
```
