# Garment Extraction Experiments

Local experiment scripts to validate the ML pipeline before integrating into the ingestion service.

## Setup

```bash
cd services/segmentation
pip install -r requirements.txt
```

> **GPU**: These scripts auto-detect CUDA. RTX 4060 (8GB VRAM) is more than sufficient.

## Quick Start

### 1. Get test images
Drop garment images (model shots work best) into `test_images/`:
```bash
mkdir test_images
# Copy some product images there — model shots with visible garment
```

### 2. Run individual experiments

**Segmentation only** (no API key needed):
```bash
python experiment_segmentation.py test_images/shirt.jpg --output-dir output_seg
```

**LaMa Inpainting** (no API key needed, auto-downloads model ~200MB):
```bash
python experiment_inpainting.py output_seg/original.png output_seg/occlusion_mask.png --output-dir output_inpaint
```

**VLM Classification** (needs Gemini API key):
```bash
set GEMINI_API_KEY=your_key_here
python experiment_vlm_classify.py test_images/shirt.jpg --output-dir output_vlm
# Or batch: python experiment_vlm_classify.py test_images/ --output-dir output_vlm
```

### 3. Run full pipeline
```bash
set GEMINI_API_KEY=your_key_here
python experiment_full_pipeline.py test_images/shirt.jpg --output-dir output_pipeline
```

## What Each Experiment Tests

| Script | What | Models Used | GPU Needed? |
| :--- | :--- | :--- | :--- |
| `experiment_segmentation.py` | Garment mask extraction + neck clipping | FASHN Human Parser (SegFormer-B4) | Yes (or slow CPU) |
| `experiment_inpainting.py` | Hair/hand occlusion cleanup | LaMa (ONNX) | Optional (CPU works) |
| `experiment_vlm_classify.py` | View/type/placement auto-detection | Gemini 2.5 Flash (API) | No (cloud API) |
| `experiment_full_pipeline.py` | All of the above chained together | All above | Yes |

## Output Files

Each experiment creates numbered output files:

```
output_pipeline/
├── 01_original.png           # Input image
├── 02_classification.json    # VLM classification result
├── 03_segmentation_map.png   # 18-class colored segmentation
├── 04_garment_mask.png       # Raw garment binary mask
├── 05_head_neck_mask.png     # Head/neck region
├── 06_occlusion_mask.png     # Hair/hand overlap on garment
├── 07_neck_clipped_mask.png  # After Bézier collar clipping
├── 08_inpainted.png          # After LaMa cleanup (if needed)
├── 09_final_garment.png      # Clean RGBA garment (transparent BG)
└── pipeline_report.json      # Timing + quality metrics
```

## Key Parameters to Tune

- `--collar-depth 0.03`: How deep the Bézier neck clip goes (fraction of image height). Increase for deeper V-necks.
- `--occlusion-threshold 5.0`: Minimum occlusion % to trigger LaMa inpainting. Lower = more aggressive cleanup.
- `--garment-type auto`: Force a specific garment class (`top`, `dress`, `pants`, `skirt`, `coat`).

## SAM-Guided Matting Pipeline

This pipeline combines parser models and segmenters to resolve staircase (aliasing) artifacts at garment boundaries and outputs clean transparent RGBA garment assets.

### Model Inputs and Output Usage Summary

| Model / Stage | Inputs Provided | Outputs and Usage |
| :--- | :--- | :--- |
| FASHN Human Parser & SCHP | Original model shot image | Coarse semantic segmentation maps used to isolate garment region, neckline, and body part exclusion boundaries (hands, face, hair, etc.). |
| Grounded-SAM-2 | Original image, Grounding DINO text prompts, and FASHN/SCHP exclusion coordinates | High-precision binary garment mask and neck cutout. Used as the region gate for BiRefNet and to generate the trimap for ViTMatte. |
| Trimap Generation | Grounded-SAM-2 binary mask | A three-state trimap (foreground, background, unknown boundary region). Used as the guide for ViTMatte. |
| ViTMatte | Original image and the generated trimap | Soft, sub-pixel alpha transparency values. Used to resolve fine fabric edges and anti-alias boundaries during hybrid blending. |
| BiRefNet | Original image and the dilated Grounded-SAM-2 gate mask | Sharp alpha matte restricted to the gated region. Used to retain solid interior garment opacity and block skin/background leaks. |
| Hybrid Blending | ViTMatte soft alpha, BiRefNet sharp alpha, and Gaussian-blurred blend weights | Combined final hybrid alpha matte. Used to extract the final transparent RGBA garment. |

