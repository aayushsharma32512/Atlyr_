# Garment Extraction & Segmentation Pipeline

Production-ready local segmentation scripts to extract clean transparent garment assets from model shots.

## Setup

```bash
cd services/segmentation
pip install -r requirements.txt
```

> **GPU Requirement**: These scripts automatically detect and leverage CUDA. An RTX 3060/4060 (8GB VRAM) or higher is recommended for fast processing.

---

## Production Pipeline: SAM2-Only VTON (Improved)

The core script is **`run_exact_sam2_only_vton_improved.py`**. It performs high-precision garment segmentation using Grounded-SAM-2 as the base mask, completely bypassing BiRefNet to avoid background bleeding, and applies advanced parsing and morphological filters for clean edge extraction.

### Execution

```bash
python run_exact_sam2_only_vton_improved.py
```

### Ingestion Details

The pipeline processes input model shots from `output_ghost_test_vton/` and outputs clean transparent garments to `final_sam2_only_exclusion_improved/` using the following stages:

1. **Garment Prior Filtering**: Leverages FASHN and SCHP human parser models to construct a coarse semantic garment region gate, filtering the SAM2 base mask.
2. **Morphological Closing**: Fills vertical slits and gaps (e.g., zipper lines, button seams) inside the garment prior to preserve detail.
3. **Skin Exclusion Subtraction**: Subtracts skin boundaries (arms, neck, face) based on FASHN/SCHP maps without aggressive dilation to prevent trimming garment cuffs.
4. **Multi-Component Cleanup**: Runs connected-component analysis and retains all disjoint regions with an area > 1000px to safeguard disconnected sleeves, strings, or footwear.
5. **Adaptive Color Extension (Inpainting)**: Erodes the mask to find a clean garment core, then inpaints background border regions using the garment's internal colors to completely remove edge contamination.
6. **Erosion Gating**: Applies a final outer boundary-only 2px erosion to ensure no background bleeding remains.

---

## Output File Structure

Each processed subject folder inside `final_sam2_only_exclusion_improved/` contains:

```
final_sam2_only_exclusion_improved/<subject_id>/
├── 01_sam_raw.png                # Raw SAM2 gating mask
├── 02_fashn_garment.png          # FASHN & SCHP combined garment prior
├── 03_sam_and_fashn.png          # Morphologically closed and filtered base mask
├── 06_exclusion_mask.png         # Combined skin/background exclusion region
├── 07b_sam2_alpha.png            # Final eroded binary mask
├── 09_final_garment.png          # Clean RGBA garment (transparent background)
└── 09_final_garment_checker.png  # Checkerboard preview of the extracted garment
```

---

## Alternative/Legacy Scripts (Excluded from Git)

The following scripts are excluded from repository tracking to keep the codebase focused on the production SAM2-only pipeline:
* `run_exact_biref_vton.py`: Alternative matting pipeline incorporating BiRefNet.
* `experiment_full_pipeline.py`: Chained segmentation, VLM classification, and LaMa inpainting.
* `experiment_vlm_classify.py`: VLM-based view/type/placement classification.
