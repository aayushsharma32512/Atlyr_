#!/usr/bin/env python3
import os
import sys
import time
import shutil
import cv2
import numpy as np
from PIL import Image
import torch
from torchvision import transforms

# Ensure parent directory is in path for imports
scratch_dir = os.path.dirname(os.path.abspath(__file__))
segmentation_dir = os.path.dirname(scratch_dir)
sys.path.insert(0, segmentation_dir)

from fashn_human_parser import FashnHumanParser
from scipy import ndimage
from experiment_segmentation import (
    colorize_segmentation,
    extract_class_mask,
    _load_birefnet,
    refine_with_birefnet,
    extract_garment_rgba,
    HEAD_NECK_CLASSES,
    punch_vneck_skin_final,
    bezier_neck_clip,
    sample_background_color_local,
    _strip_border_bg_from_mask,
    get_schp_exclusion_mask
)

# Configuration
TEST_CASES = ["F1", "F3", "F8", "F10", "N1", "N3", "N8", "T4", "T5", "T6"]
OUTPUT_ROOT = os.path.join(scratch_dir, "comparison_test")

def save_transparent_rgba(img_rgb, mask, sampled_bg, output_path):
    # Pass sampled_bg to enable de-spill matting, fringe erasing, and edge cleanup
    rgba = extract_garment_rgba(img_rgb, mask, sampled_bg=sampled_bg)
    cv2.imwrite(output_path, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))

def _punch_schp_vneck_hole(mask, schp_map, category):
    if schp_map is not None and category in ["top", "dress"]:
        schp_inside = (schp_map > 127) & (mask > 127)
        labeled, n = ndimage.label(schp_inside)
        for cid in range(1, n + 1):
            comp = labeled == cid
            if comp.sum() < 80:
                continue
            if (comp[0,:].any() or comp[-1,:].any() or
                comp[:,0].any() or comp[:,-1].any()):
                continue
            mask[comp] = 0
            print(f"  [SCHP-VNeck] Punched {comp.sum()}px enclosed skin hole")
    return mask

def main():
    print("=" * 80)
    print("  GARMENT SEGMENTATION COMPARISON SUITE (FULL POST-PROCESSING PIPELINE)")
    print("=" * 80)

    # Force complete rerun by deleting old outputs
    if os.path.exists(OUTPUT_ROOT):
        print(f"Cleaning up previous comparison results directory: {OUTPUT_ROOT} ...")
        shutil.rmtree(OUTPUT_ROOT)
    os.makedirs(OUTPUT_ROOT, exist_ok=True)

    # -------------------------------------------------------------------------
    # 1. Initialize and Warm Up Models
    # -------------------------------------------------------------------------
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")

    print("\n[Init 1/6] Loading FASHN Human Parser...")
    parser = FashnHumanParser()

    print("\n[Init 2/6] Loading BiRefNet (ZhengPeng7/BiRefNet_HR-matting)...")
    _load_birefnet("ZhengPeng7/BiRefNet_HR-matting")

    print("\n[Init 3/6] Loading InSPyReNet (transparent_background.Remover)...")
    from transparent_background import Remover
    remover = Remover(device=device)

    print("\n[Init 4/6] Loading BRIA RMBG-1.4...")
    from transformers import pipeline
    rmbg_pipe = pipeline("image-segmentation", model="briaai/RMBG-1.4", trust_remote_code=True, device=0 if device == "cuda" else -1)

    print("\n[Init 5/6] Loading MODNet ONNX...")
    import onnxruntime as ort
    modnet_onnx_path = os.path.join(segmentation_dir, "models", "modnet.onnx")
    providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if 'CUDAExecutionProvider' in ort.get_available_providers() else ['CPUExecutionProvider']
    print(f"  ORT Providers: {providers}")
    modnet_session = ort.InferenceSession(modnet_onnx_path, providers=providers)

    print("\n[Init 6/6] Loading PP-Matting 1024...")
    import paddle.inference as paddle_infer
    ppmatting_model_dir = os.path.join(scratch_dir, "ppmattingv2_1024_inference")
    pdmodel = os.path.join(ppmatting_model_dir, "model.json")
    pdiparams = os.path.join(ppmatting_model_dir, "model.pdiparams")
    pp_config = paddle_infer.Config(pdmodel, pdiparams)
    pp_config.disable_gpu()  # PaddleSeg Matting runs on CPU for maximum compatibility
    try:
        pp_config.disable_mkldnn()
    except AttributeError:
        pass
    pp_config.disable_glog_info()
    pp_config.switch_use_feed_fetch_ops(False)
    pp_predictor = paddle_infer.create_predictor(pp_config)

    print("\nAll models loaded successfully! Starting batch processing...")

    # -------------------------------------------------------------------------
    # 2. Process Test Cases
    # -------------------------------------------------------------------------
    vton_dir = os.path.join(segmentation_dir, "output_ghost_test_vton")
    if not os.path.exists(vton_dir):
        print(f"[Error] Directory not found: {vton_dir}")
        return

    # Keep track of timings and stats for final reporting
    model_keys = ["biref_only", "inspyrenet", "rmbg", "hybrid_rules", "modnet", "ppmatting_1024", "grounded_sam2"]
    timings = {k: [] for k in model_keys}

    for case_idx, case_name in enumerate(TEST_CASES):
        case_dir = os.path.join(vton_dir, case_name)
        img_path = os.path.join(case_dir, "01_original.png")
        if not os.path.exists(img_path):
            print(f"[Warning] original file not found for case {case_name} at {img_path}, skipping...")
            continue

        print(f"\nProcessing Case [{case_idx+1}/{len(TEST_CASES)}]: {case_name}")
        case_out_dir = os.path.join(OUTPUT_ROOT, case_name)
        os.makedirs(case_out_dir, exist_ok=True)

        # Copy original image
        shutil.copy2(img_path, os.path.join(case_out_dir, "original.png"))

        # Load image
        image = cv2.imread(img_path)
        h, w = image.shape[:2]
        img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Shared setup: Run FASHN parser (needed by almost all models for gating)
        print("  Running FASHN Human Parser for gating...")
        seg_map = parser.predict(image)
        seg_map = cv2.resize(seg_map.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST)

        # Resolve category (top, dress, pants, skirt, footwear) dynamically
        category = "top"
        best_area = 0
        from experiment_segmentation import GARMENT_CLASSES
        for name, class_ids in GARMENT_CLASSES.items():
            mask = extract_class_mask(seg_map, class_ids)
            area = mask.sum() // 255
            if area > best_area:
                best_area = area
                category = name
        print(f"  Detected category: {category}")

        # Correct garment mask: include top (3), dress (4), skirt (5), pants (6), and belt (7)
        garment_mask = extract_class_mask(seg_map, [3, 4, 5, 6, 7])
        
        # Hard body exclusion mask: face, hair, arms, hands, legs, feet, torso skin
        fashn_exclusion = extract_class_mask(seg_map, [1, 2, 12, 13, 14, 15, 16])
        head_neck_mask = extract_class_mask(seg_map, HEAD_NECK_CLASSES)

        # SCHP fine exclusion (separate left/right arms, finer boundaries) and visualization
        from experiment_segmentation import run_schp_parsing, colorize_schp, SCHP_EXCLUSION_CLASSES
        schp_checkpoint = os.path.join(segmentation_dir, "checkpoints", "exp-schp-201908261155-lip.pth")
        schp_exclusion = None
        schp_map = None
        try:
            schp_map = run_schp_parsing(img_path, checkpoint_path=schp_checkpoint)
            
            # Save SCHP segmentation map
            colored_schp = colorize_schp(schp_map)
            cv2.imwrite(os.path.join(case_out_dir, "schp_seg.png"), colored_schp)
            print(f"  Saved SCHP segmentation map visualization to schp_seg.png")
            
            # Generate exclusion mask
            exclude_ids = SCHP_EXCLUSION_CLASSES.get(category, [2, 13, 14, 15, 16, 17, 18, 19])
            schp_exclusion = np.zeros_like(schp_map, dtype=np.uint8)
            for cid in exclude_ids:
                schp_exclusion[schp_map == cid] = 255
        except Exception as e:
            print(f"  [SCHP] Failed ({e}), falling back to FASHN exclusion only")

        # Merge: union of FASHN + SCHP exclusions
        if schp_exclusion is not None:
            exclusion_mask = cv2.bitwise_or(fashn_exclusion, schp_exclusion)
            print(f"  [Exclusion] FASHN+SCHP merged: "
                  f"{(exclusion_mask > 127).sum()} total excluded px")
        else:
            exclusion_mask = fashn_exclusion

        # Sample background color locally
        sampled_bg = sample_background_color_local(image, garment_mask)
        print(f"  Sampled local BG color: RGB({sampled_bg[0]:.0f}, {sampled_bg[1]:.0f}, {sampled_bg[2]:.0f})")

        # Skin detection rule (global coordinates)
        B = image[:, :, 0].astype(float)
        G = image[:, :, 1].astype(float)
        R = image[:, :, 2].astype(float)
        is_skin_color = (R > G) & (G > B) & (R - G > 12) & (G - B > 12)
        
        # Skin subtraction mask ONLY applied to non-garment zones
        is_not_garment = ~np.isin(seg_map, [3, 4, 5, 6, 7])
        skin_subtraction_mask = is_not_garment & is_skin_color

        # Write FASHN visualization for context
        colored_seg = colorize_segmentation(seg_map)
        cv2.imwrite(os.path.join(case_out_dir, "fashn_seg.png"), colored_seg)

        # ----------------- 1. BiRefNet Gated -----------------
        t0 = time.time()
        try:
            print("  Running BiRefNet Gated...")
            biref_mask = refine_with_birefnet(
                image_path=img_path,
                fashn_gate_mask=garment_mask,
                variant="ZhengPeng7/BiRefNet_HR-matting",
                input_size=1024
            )
            
            # Post-processing pipeline
            biref_mask[exclusion_mask > 127] = 0
            biref_mask[skin_subtraction_mask] = 0
            biref_mask = punch_vneck_skin_final(
                mask=biref_mask,
                image_bgr=image,
                seg_map=seg_map,
                category=category,
                garment_mask=garment_mask,
                head_neck_mask=head_neck_mask,
                schp_map=schp_map,
            )
            biref_mask = _strip_border_bg_from_mask(biref_mask, image, sampled_bg)
            biref_mask = bezier_neck_clip(biref_mask, head_neck_mask, collar_depth_ratio=0.03)

            save_transparent_rgba(img_rgb, biref_mask, sampled_bg, os.path.join(case_out_dir, "biref_only_transparent.png"))
            timings["biref_only"].append(time.time() - t0)
        except Exception as e:
            print(f"  [Error] BiRefNet failed: {e}")
            timings["biref_only"].append(-1)

        # ----------------- 2. InSPyReNet Gated -----------------
        t0 = time.time()
        try:
            print("  Running InSPyReNet...")
            img_pil = Image.open(img_path).convert("RGB")
            inspyre_pil = remover.process(img_pil, type='map')
            inspyre_raw = np.array(inspyre_pil.resize((w, h), Image.Resampling.LANCZOS))
            if len(inspyre_raw.shape) == 3:
                inspyre_raw = inspyre_raw[:, :, 0]

            # Gate with dilated FASHN garment mask
            inspyre_gated = inspyre_raw.copy()
            kernel_gate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
            dilated_gate = cv2.dilate(garment_mask, kernel_gate, iterations=1)
            inspyre_gated[dilated_gate == 0] = 0

            # Post-processing pipeline
            inspyre_gated[exclusion_mask > 127] = 0
            inspyre_gated[skin_subtraction_mask] = 0
            inspyre_gated = punch_vneck_skin_final(
                mask=inspyre_gated,
                image_bgr=image,
                seg_map=seg_map,
                category=category,
                garment_mask=garment_mask,
                head_neck_mask=head_neck_mask,
                schp_map=schp_map,
            )
            inspyre_gated = _strip_border_bg_from_mask(inspyre_gated, image, sampled_bg)
            inspyre_gated = bezier_neck_clip(inspyre_gated, head_neck_mask, collar_depth_ratio=0.03)

            save_transparent_rgba(img_rgb, inspyre_gated, sampled_bg, os.path.join(case_out_dir, "inspyrenet_transparent.png"))
            timings["inspyrenet"].append(time.time() - t0)
        except Exception as e:
            print(f"  [Error] InSPyReNet failed: {e}")
            timings["inspyrenet"].append(-1)

        # ----------------- 3. RMBG & 4. Hybrid Rules -----------------
        t0 = time.time()
        try:
            print("  Running RMBG...")
            rmbg_pil = rmbg_pipe(img_path, return_mask=True)
            rmbg_raw = np.array(rmbg_pil.resize((w, h), Image.Resampling.LANCZOS))
            if len(rmbg_raw.shape) == 3:
                rmbg_raw = rmbg_raw[:, :, 0]

            # Standard gated RMBG
            rmbg_gated = rmbg_raw.copy()
            kernel_gate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
            dilated_gate = cv2.dilate(garment_mask, kernel_gate, iterations=1)
            rmbg_gated[dilated_gate == 0] = 0

            # Post-processing pipeline
            rmbg_gated[exclusion_mask > 127] = 0
            rmbg_gated[skin_subtraction_mask] = 0
            rmbg_gated = punch_vneck_skin_final(
                mask=rmbg_gated,
                image_bgr=image,
                seg_map=seg_map,
                category=category,
                garment_mask=garment_mask,
                head_neck_mask=head_neck_mask,
                schp_map=schp_map,
            )
            rmbg_gated = _strip_border_bg_from_mask(rmbg_gated, image, sampled_bg)
            rmbg_gated = bezier_neck_clip(rmbg_gated, head_neck_mask, collar_depth_ratio=0.03)

            save_transparent_rgba(img_rgb, rmbg_gated, sampled_bg, os.path.join(case_out_dir, "rmbg_transparent.png"))
            timings["rmbg"].append(time.time() - t0)

            # Hybrid Rules (uses RMBG raw + dilated body exclusion skin filter)
            t_hybrid = time.time()
            print("  Running Hybrid Rules...")
            exclusion_mask_bool = (seg_map == 1) | (seg_map == 2) | (seg_map == 12) | (seg_map == 13) | (seg_map == 14) | (seg_map == 15) | (seg_map == 16)
            kernel_excl = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
            dilated_body = cv2.dilate(exclusion_mask_bool.astype(np.uint8) * 255, kernel_excl, iterations=1)
            final_skin_mask = (dilated_body > 127) & is_skin_color

            hybrid_mask = rmbg_raw.copy()
            hybrid_mask[exclusion_mask > 127] = 0
            hybrid_mask[final_skin_mask] = 0
            # Keep hybrid rules matching its original logic without full new pipeline overlays
            save_transparent_rgba(img_rgb, hybrid_mask, sampled_bg, os.path.join(case_out_dir, "hybrid_rules_transparent.png"))
            timings["hybrid_rules"].append(time.time() - t_hybrid)

        except Exception as e:
            print(f"  [Error] RMBG / Hybrid Rules failed: {e}")
            timings["rmbg"].append(-1)
            timings["hybrid_rules"].append(-1)

        # ----------------- 5. MODNet -----------------
        t0 = time.time()
        try:
            print("  Running MODNet ONNX...")
            # Preprocess
            mod_resized = cv2.resize(img_rgb, (512, 512), interpolation=cv2.INTER_AREA)
            mod_data = mod_resized.astype(np.float32)
            mod_data = (mod_data - 127.5) / 127.5
            mod_data = np.transpose(mod_data, (2, 0, 1))
            mod_data = np.expand_dims(mod_data, axis=0)

            # Inference
            mod_outputs = modnet_session.run(None, {modnet_session.get_inputs()[0].name: mod_data})
            mod_matte = mod_outputs[0][0][0]

            # Upsample & Gate
            mod_matte = cv2.resize(mod_matte * 255.0, (w, h), interpolation=cv2.INTER_LANCZOS4)
            mod_matte = np.clip(mod_matte, 0, 255).astype(np.uint8)

            mod_gated = mod_matte.copy()
            kernel_gate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
            dilated_gate = cv2.dilate(garment_mask, kernel_gate, iterations=1)
            mod_gated[dilated_gate == 0] = 0

            # Post-processing pipeline
            mod_gated[exclusion_mask > 127] = 0
            mod_gated[skin_subtraction_mask] = 0
            mod_gated = punch_vneck_skin_final(
                mask=mod_gated,
                image_bgr=image,
                seg_map=seg_map,
                category=category,
                garment_mask=garment_mask,
                head_neck_mask=head_neck_mask,
                schp_map=schp_map,
            )
            mod_gated = _strip_border_bg_from_mask(mod_gated, image, sampled_bg)
            mod_gated = bezier_neck_clip(mod_gated, head_neck_mask, collar_depth_ratio=0.03)

            save_transparent_rgba(img_rgb, mod_gated, sampled_bg, os.path.join(case_out_dir, "modnet_transparent.png"))
            timings["modnet"].append(time.time() - t0)
        except Exception as e:
            print(f"  [Error] MODNet failed: {e}")
            timings["modnet"].append(-1)

        # ----------------- 6. PP-Matting 1024 -----------------
        t0 = time.time()
        try:
            print("  Running PP-Matting 1024...")
            pp_resized = cv2.resize(img_rgb, (1024, 1024), interpolation=cv2.INTER_LINEAR)
            mean = np.array([0.5, 0.5, 0.5], dtype=np.float32)
            std = np.array([0.5, 0.5, 0.5], dtype=np.float32)
            pp_data = (pp_resized.astype(np.float32) / 255.0 - mean) / std
            pp_data = pp_data.transpose(2, 0, 1)
            pp_data = np.expand_dims(pp_data, axis=0)

            pp_input_names = pp_predictor.get_input_names()
            pp_input_handle = pp_predictor.get_input_handle(pp_input_names[0])
            pp_input_handle.reshape(pp_data.shape)
            pp_input_handle.copy_from_cpu(pp_data)

            pp_predictor.run()

            pp_output_names = pp_predictor.get_output_names()
            pp_output_handle = pp_predictor.get_output_handle(pp_output_names[0])
            pp_matte = pp_output_handle.copy_to_cpu()[0, 0]

            # Upsample & Gate
            pp_matte = cv2.resize(pp_matte * 255.0, (w, h), interpolation=cv2.INTER_LANCZOS4)
            pp_matte = np.clip(pp_matte, 0, 255).astype(np.uint8)

            pp_gated = pp_matte.copy()
            kernel_gate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
            dilated_gate = cv2.dilate(garment_mask, kernel_gate, iterations=1)
            pp_gated[dilated_gate == 0] = 0

            # Post-processing pipeline
            pp_gated[exclusion_mask > 127] = 0
            pp_gated[skin_subtraction_mask] = 0
            pp_gated = punch_vneck_skin_final(
                mask=pp_gated,
                image_bgr=image,
                seg_map=seg_map,
                category=category,
                garment_mask=garment_mask,
                head_neck_mask=head_neck_mask,
                schp_map=schp_map,
            )
            pp_gated = _strip_border_bg_from_mask(pp_gated, image, sampled_bg)
            pp_gated = bezier_neck_clip(pp_gated, head_neck_mask, collar_depth_ratio=0.03)

            save_transparent_rgba(img_rgb, pp_gated, sampled_bg, os.path.join(case_out_dir, "ppmatting_1024_transparent.png"))
            timings["ppmatting_1024"].append(time.time() - t0)
        except Exception as e:
            print(f"  [Error] PP-Matting 1024 failed: {e}")
            timings["ppmatting_1024"].append(-1)

        # ----------------- 7. Grounded-SAM-2 (Pipeline) -----------------
        t0 = time.time()
        try:
            print("  Running Grounded-SAM-2 (Pipeline)...")
            from experiment_segmentation import refine_garment_mask
            
            sam_mask, sampled_bg = refine_garment_mask(
                image_path=img_path,
                coarse_garment_mask=garment_mask,
                exclusion_mask=exclusion_mask,
                category=category,
                seg_map=seg_map,
                schp_map=schp_map,
                output_dir=case_out_dir
            )
            
            save_transparent_rgba(img_rgb, sam_mask, sampled_bg, os.path.join(case_out_dir, "grounded_sam2_transparent.png"))
            timings["grounded_sam2"].append(time.time() - t0)
        except Exception as e:
            print(f"  [Error] Grounded-SAM-2 failed: {e}")
            timings["grounded_sam2"].append(-1)

    # -------------------------------------------------------------------------
    # 3. Generate HTML Dashboard
    # -------------------------------------------------------------------------
    print("\nGenerating HTML Dashboard...")
    html_content = generate_html_dashboard(TEST_CASES, model_keys, timings)
    report_path = os.path.join(OUTPUT_ROOT, "index.html")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"\n[Success] Comparison suite complete. Output saved in: {OUTPUT_ROOT}")
    print(f"[Link] View interactive dashboard at: {report_path}")

def generate_html_dashboard(cases, models, timings):
    model_labels = {
        "biref_only": "BiRefNet (Gated)",
        "inspyrenet": "InSPyReNet (Gated)",
        "rmbg": "BRIA RMBG-1.4 (Gated)",
        "hybrid_rules": "Hybrid Rules (RMBG + dilated body skin)",
        "modnet": "MODNet ONNX (Gated)",
        "ppmatting_1024": "PP-Matting 1024 (Gated)",
        "grounded_sam2": "Grounded-SAM-2 (DINO+SAM)"
    }

    model_filenames = {
        "biref_only": "biref_only",
        "inspyrenet": "inspyrenet",
        "rmbg": "rmbg",
        "hybrid_rules": "hybrid_rules",
        "modnet": "modnet",
        "ppmatting_1024": "ppmatting_1024",
        "grounded_sam2": "grounded_sam2"
    }

    # Header section
    html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Garment Segmentation Comparison Dashboard</title>
    <style>
        body {
            font-family: 'Inter', system-ui, sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
            margin: 0;
            padding: 24px;
        }
        h1 {
            font-size: 2.2rem;
            margin-bottom: 8px;
            color: #38bdf8;
            font-weight: 800;
        }
        .subtitle {
            color: #94a3b8;
            margin-bottom: 24px;
            font-size: 1.1rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background-color: #1e293b;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        }
        th, td {
            padding: 16px;
            text-align: center;
            border-bottom: 1px solid #334155;
        }
        th {
            background-color: #0f172a;
            color: #38bdf8;
            font-weight: 700;
            font-size: 0.95rem;
        }
        tr:hover {
            background-color: #33415550;
        }
        .thumb-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        }
        /* Subtly render transparent PNGs on top of CSS checkerboard */
        .transparent-bg {
            background-color: #1e293b;
            background-image: conic-gradient(#161e2e 25%, transparent 25% 50%, #161e2e 50% 75%, transparent 75%);
            background-size: 16px 16px;
            padding: 8px;
            border-radius: 6px;
            box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.3);
        }
        img {
            max-width: 150px;
            border-radius: 4px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            display: block;
        }
        img:hover {
            transform: scale(1.05);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
        }
        .tag {
            font-size: 0.75rem;
            color: #94a3b8;
            background-color: #0f172a;
            padding: 2px 8px;
            border-radius: 9999px;
            margin-top: 4px;
        }
        .time-tag {
            font-size: 0.75rem;
            color: #10b981;
            font-weight: 600;
        }
        .case-header {
            font-weight: 800;
            color: #38bdf8;
            font-size: 1.1rem;
        }
    </style>
</head>
<body>
    <h1>Garment Segmentation Model Comparison Dashboard</h1>
    <div class="subtitle">Comparing transparent background renders side-by-side on 10 test images. Images are overlaid on top of a CSS checkerboard pattern to reveal transparent boundaries. Click any thumbnail to open.</div>
    
    <table>
        <thead>
            <tr>
                <th>Test Case</th>
                <th>Original</th>
                <th>FASHN Seg</th>
                <th>DINO Boxes</th>
                <th>BiRefNet</th>
                <th>InSPyReNet</th>
                <th>BRIA RMBG-1.4</th>
                <th>Hybrid Rules</th>
                <th>MODNet</th>
                <th>PP-Matting 1024</th>
                <th>Grounded-SAM-2 (DINO+SAM)</th>
            </tr>
        </thead>
        <tbody>
    """

    for i, case in enumerate(cases):
        html += f"""
            <tr>
                <td class="case-header">
                    {case}<br>
                    <span class="tag">Original Size</span>
                </td>
                <td>
                    <div class="thumb-container">
                        <img src="{case}/original.png" alt="Original {case}" onclick="window.open(this.src)">
                    </div>
                </td>
                <td>
                    <div class="thumb-container">
                        <img src="{case}/fashn_seg.png" alt="FASHN Seg {case}" onclick="window.open(this.src)">
                    </div>
                </td>
                <td>
                    <div class="thumb-container">
                        <img src="{case}/dino_detected_boxes.png" alt="DINO Boxes {case}" onclick="window.open(this.src)">
                    </div>
                </td>
        """

        for m in models:
            filename = model_filenames[m]
            t_val = timings[m][i] if i < len(timings[m]) else -1
            time_str = f"{t_val:.2f}s" if t_val >= 0 else "N/A"

            html += f"""
                <td>
                    <div class="thumb-container transparent-bg">
                        <img class="model-img" 
                             src="{case}/{filename}_transparent.png" 
                             alt="{model_labels[m]} {case}"
                             onclick="window.open(this.src)">
                        <span class="time-tag">{time_str}</span>
                    </div>
                </td>
            """

        html += "            </tr>"

    html += """
        </tbody>
    </table>
</body>
</html>
"""
    return html

if __name__ == "__main__":
    main()
