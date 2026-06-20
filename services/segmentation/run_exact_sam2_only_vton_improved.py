#!/usr/bin/env python3
"""
Batch SAM2-Only VTON Pipeline (Improved version):
This script performs garment segmentation using SAM2 as the base mask,
completely bypassing BiRefNet. It applies:
  1. FASHN + SCHP garment prior filtering on SAM2 base mask.
  2. Morphological closing to fill vertical gaps/slits (like zippers) and preserve strings/details.
  3. FASHN + SCHP skin exclusion subtraction (no dilation).
  4. Multi-component cleanup (keeping all components with area > 1000px).
  5. Adaptive color extension/inpainting to remove background boundaries.
  6. Final outer boundary-only 2px erosion gating.
"""
import os
import sys
import cv2
import numpy as np
from PIL import Image

base_dir = r"c:\Users\namja\Downloads\Atlyr_\services\segmentation"
sys.path.insert(0, base_dir)

# Ensure SCHP_ROOT is set correctly before imports
os.environ["SCHP_ROOT"] = os.path.join(base_dir, "Utils", "Self-Correction-Human-Parsing")

from experiment_segmentation import (
    extract_garment_rgba,
    sample_background_color_local,
    extract_class_mask,
    run_schp_parsing,
    GARMENT_CLASSES,
    SCHP_EXCLUSION_CLASSES,
    SCHP_GARMENT_CLASSES,
)
from fashn_human_parser import FashnHumanParser


def main():
    ghost_dir = os.path.join(base_dir, "output_ghost_test_vton")
    output_root = os.path.join(base_dir, "final_sam2_only_exclusion_improved")
    comparison_root = os.path.join(base_dir, "scratch", "different_model_testing", "comparison_test")
    os.makedirs(output_root, exist_ok=True)

    subdirs = sorted([d for d in os.listdir(ghost_dir) if os.path.isdir(os.path.join(ghost_dir, d))])

    print("Loading FASHN Human Parser...")
    fashn = FashnHumanParser()

    print(f"Found {len(subdirs)} subfolders. Writing to final_sam2_only_exclusion_improved.")

    for idx, folder in enumerate(subdirs):
        folder_path = os.path.join(ghost_dir, folder)
        img_path = os.path.join(folder_path, "01_original.png")
        sam_path = os.path.join(folder_path, "07_refined_mask.png")

        out_folder = os.path.join(output_root, folder)
        os.makedirs(out_folder, exist_ok=True)

        if not os.path.isfile(img_path):
            print(f"[{idx+1}/{len(subdirs)}] Skipping {folder}: 01_original.png not found.")
            continue

        print(f"\n{'='*60}")
        print(f"Processing [{idx+1}/{len(subdirs)}]: {folder}")
        print(f"{'='*60}")

        try:
            img_bgr = cv2.imread(img_path)
            img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
            h, w = img_rgb.shape[:2]

            # FASHN parser
            print("  Running FASHN parser...")
            seg_map = fashn.predict(img_rgb)

            # Load SAM gate mask (comparison_test takes priority)
            comp_sam_path = os.path.join(comparison_root, folder, "grounded_sam2_transparent.png")
            if os.path.isfile(comp_sam_path):
                sam_mask_raw = cv2.imread(comp_sam_path, cv2.IMREAD_UNCHANGED)
                sam_mask = sam_mask_raw[:, :, 3]
                print("  SAM gate: comparison_test/grounded_sam2_transparent")
            elif os.path.isfile(sam_path):
                sam_mask = cv2.imread(sam_path, cv2.IMREAD_GRAYSCALE)
                print("  SAM gate: 07_refined_mask.png")
            else:
                garment_path = os.path.join(folder_path, "04_garment_mask.png")
                if os.path.isfile(garment_path):
                    sam_mask = cv2.imread(garment_path, cv2.IMREAD_GRAYSCALE)
                else:
                    sam_mask = extract_class_mask(seg_map, [3, 4])

            # Save raw SAM mask debug
            cv2.imwrite(os.path.join(out_folder, "01_sam_raw.png"), sam_mask)

            # SCHP parser
            schp_map = None
            try:
                print("  Running SCHP parser...")
                schp_map = run_schp_parsing(img_path)
            except Exception as schp_err:
                print(f"  [Warning] SCHP failed: {schp_err}")

            # Resolve category dynamically based on maximum segmentation area
            # We define local garment classes to ensure footwear resolves properly for shoe/boot-only product shots
            GARMENT_CLASSES_LOCAL = {
                "top": [3],
                "dress": [4],
                "skirt": [5],
                "pants": [6],
                "footwear": [8, 9, 15],
            }
            category = "top"
            best_area = 0
            for cat, class_ids in GARMENT_CLASSES_LOCAL.items():
                mask = extract_class_mask(seg_map, class_ids)
                area = mask.sum() // 255
                if area > best_area:
                    best_area = area
                    category = cat

            FASHN_GARMENT_CLASSES = {
                "top": [3, 7, 10, 11],
                "dress": [4, 7, 10, 11],
                "pants": [6, 7],
                "skirt": [5, 7],
                "footwear": [8, 9, 15],
            }

            FASHN_EXCLUSION_CLASSES = {
                "top": [1, 2, 12, 13, 14, 16],
                "dress": [1, 2, 12, 13, 14, 16],
                "pants": [1, 2, 12, 13, 14, 16],
                "skirt": [1, 2, 12, 13, 14, 16],
                "footwear": [1, 2, 12, 13, 16],  # Keep legs/feet out of exclusion for footwear
            }

            # 1. Build garment prior mask (FASHN + SCHP)
            fashn_g_ids = FASHN_GARMENT_CLASSES.get(category, [3])
            fashn_prior = extract_class_mask(seg_map, fashn_g_ids)
            
            if schp_map is not None:
                schp_prior = np.zeros_like(schp_map, dtype=np.uint8)
                schp_g_ids = SCHP_GARMENT_CLASSES.get(category, [5])
                # For footwear, treat legs in SCHP and FASHN as prior to prevent boot cutouts
                if category == "footwear":
                    schp_g_ids = list(set(schp_g_ids + [16, 17]))
                    fashn_prior = cv2.bitwise_or(fashn_prior, extract_class_mask(seg_map, [14]))
                for cid in schp_g_ids:
                    schp_prior[schp_map == cid] = 255
                garment_prior = cv2.bitwise_or(fashn_prior, schp_prior)
            else:
                garment_prior = fashn_prior

            cv2.imwrite(os.path.join(out_folder, "02_fashn_garment.png"), garment_prior)

            # Filter SAM base mask with raw garment prior
            sam_filtered = cv2.bitwise_and(sam_mask, garment_prior)
            
            # IMPROVEMENT 1: Close thin vertical gaps (like zippers or button lines) inside the garment prior
            kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 1))
            sam_filtered = cv2.morphologyEx(sam_filtered, cv2.MORPH_CLOSE, kernel_close)

            cv2.imwrite(os.path.join(out_folder, "03_sam_and_fashn.png"), sam_filtered)

            # Base mask is pure filtered SAM2
            sam2_only_alpha = sam_filtered.copy()

            # 2. Build skin mask (FASHN + SCHP)
            fashn_s_ids = FASHN_EXCLUSION_CLASSES.get(category, [1, 2, 12, 13, 14, 16])
            skin_mask = extract_class_mask(seg_map, fashn_s_ids)
            if schp_map is not None:
                schp_s_ids = SCHP_EXCLUSION_CLASSES.get(category, [2, 13, 14, 15, 16, 17, 18, 19])
                schp_skin = np.zeros_like(schp_map, dtype=np.uint8)
                for cid in schp_s_ids:
                    schp_skin[schp_map == cid] = 255
                skin_mask = np.maximum(skin_mask, schp_skin)

            cv2.imwrite(os.path.join(out_folder, "06_exclusion_mask.png"), skin_mask)

            # Subtract skin (NO dilation)
            sam2_only_alpha[skin_mask > 127] = 0

            # 3. IMPROVEMENT 2: Multi-component cleanup
            # Keep all connected components with area > 1000px to preserve disconnected sleeves, shoes, etc.
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
                (sam2_only_alpha > 127).astype(np.uint8),
                connectivity=8
            )

            if num_labels > 1:
                cleaned = np.zeros_like(sam2_only_alpha)
                for i in range(1, num_labels):
                    if stats[i, cv2.CC_STAT_AREA] > 1000:
                        cleaned[labels == i] = 255
                sam2_only_alpha = cleaned

            # Convert to binary mask (no soft alpha, no matting, no despill)
            sam2_only_alpha_binary = np.zeros_like(sam2_only_alpha)
            sam2_only_alpha_binary[sam2_only_alpha >= 128] = 255

            # Calculate mean saturation of the garment region to determine if the garment itself is gray/black/white.
            garment_pixels = img_bgr[sam2_only_alpha_binary > 127]
            if len(garment_pixels) > 0:
                b_garment = garment_pixels[:, 0].astype(np.int32)
                g_garment = garment_pixels[:, 1].astype(np.int32)
                r_garment = garment_pixels[:, 2].astype(np.int32)
                sat_garment = np.maximum(np.maximum(r_garment, g_garment), b_garment) - np.minimum(np.minimum(r_garment, g_garment), b_garment)
                mean_sat = sat_garment.mean()
            else:
                mean_sat = 0.0

            # Only run background color keying on tops and dresses where arm-torso gaps actually occur
            if mean_sat >= 10.0 and category in ["top", "dress"]:
                # Background color keying: remove neutral gray background pixels that SAM incorrectly included.
                # Sample background color from top-left corner
                bg_color = img_bgr[0, 0].astype(np.float32)
                b = img_bgr[:, :, 0].astype(np.int32)
                g = img_bgr[:, :, 1].astype(np.int32)
                r = img_bgr[:, :, 2].astype(np.int32)
                
                # Saturation: max(R,G,B) - min(R,G,B)
                cmax = np.maximum(np.maximum(r, g), b)
                cmin = np.minimum(np.minimum(r, g), b)
                sat = cmax - cmin
                
                # Color distance to sampled background color
                diff = img_bgr.astype(np.float32) - bg_color
                dist = np.sqrt(np.sum(diff**2, axis=-1))
                
                # Key out pixels that have very low saturation (gray background) AND are close to background color.
                # Thresholds: Sat < 15, Dist < 120 (cleanly removes background gaps like F7's arm-torso gap)
                bg_mask = ((sat < 15) & (dist < 120)).astype(np.uint8) * 255
                
                # Erode the background mask with a 3x3 kernel to remove thin lines (collar trim lines, zippers, seams)
                kernel_clean = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
                bg_mask_eroded = cv2.erode(bg_mask, kernel_clean)
                
                # Filter background mask by size to protect small gray elements (like buttons)
                # We only remove background regions that are large connected components (area > 100 pixels in eroded mask).
                num_labels_bg, labels_bg, stats_bg, _ = cv2.connectedComponentsWithStats(bg_mask_eroded, connectivity=8)
                bg_mask_filtered = np.zeros_like(bg_mask_eroded)
                for i in range(1, num_labels_bg):
                    if stats_bg[i, cv2.CC_STAT_AREA] > 100:
                        bg_mask_filtered[labels_bg == i] = 255
                        
                # Dilate the filtered background mask back to restore the original gap boundaries
                bg_mask_final = cv2.dilate(bg_mask_filtered, kernel_clean)
                sam2_only_alpha_binary[bg_mask_final > 0] = 0

            # Adaptive inpainting (color extension)
            # Erode the mask to get a clean garment core, then fill the background with extended clothing colors.
            orig_pixel_count = np.sum(sam2_only_alpha_binary > 0)
            clean_core = None

            for erode_sz in [9, 7, 5, 3]:
                kernel_core = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_sz, erode_sz))
                candidate_core = cv2.erode(sam2_only_alpha_binary, kernel_core, iterations=1)
                if np.sum(candidate_core > 0) > max(100, 0.1 * orig_pixel_count):
                    clean_core = candidate_core
                    break

            if clean_core is not None:
                inpaint_mask = (clean_core == 0).astype(np.uint8)
                img_bgr_inpainted = cv2.inpaint(img_bgr, inpaint_mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
                img_rgb_inpainted = cv2.cvtColor(img_bgr_inpainted, cv2.COLOR_BGR2RGB)
            else:
                img_rgb_inpainted = img_rgb.copy()

            # Erode the mask with a 3x3 kernel (Variant 1: Entire BG Inpaint | 3x3 Erode | No Blur)
            # This completely removes the background gray boundary contamination while preserving fine details.
            kernel_erode = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            sam2_only_alpha_binary = cv2.erode(sam2_only_alpha_binary, kernel_erode, iterations=1)

            # Stack channels directly (RGB -> RGBA) without Gaussian blur
            # Avoiding blur prevents the reintroduction of a soft-alpha gray fringe/halo against different backgrounds.
            rgba = np.dstack([img_rgb_inpainted, sam2_only_alpha_binary])

            # Save outputs
            cv2.imwrite(os.path.join(out_folder, "09_final_garment.png"),
                         cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
            cv2.imwrite(os.path.join(out_folder, "07b_sam2_alpha.png"), sam2_only_alpha_binary)

            # Checkerboard visualization
            checker = np.zeros((h, w, 3), dtype=np.uint8)
            grid_sz = 16
            for r in range(0, h, grid_sz):
                for c in range(0, w, grid_sz):
                    if ((r // grid_sz) + (c // grid_sz)) % 2 == 0:
                        checker[r:r+grid_sz, c:c+grid_sz] = 200
                    else:
                        checker[r:r+grid_sz, c:c+grid_sz] = 255

            alpha_f = rgba[:, :, 3:4] / 255.0
            vis_bgr = (rgba[:, :, :3] * alpha_f + checker * (1 - alpha_f)).astype(np.uint8)
            cv2.imwrite(os.path.join(out_folder, "09_final_garment_checker.png"),
                         cv2.cvtColor(vis_bgr, cv2.COLOR_RGB2BGR))

            removed = int((sam_mask > 127).sum()) - int((sam2_only_alpha > 127).sum())
            print(f"  Done: {folder} — Removed {removed:,} skin/bg px. Final: {(sam2_only_alpha > 127).sum():,} px")

        except Exception as e:
            print(f"  Error processing {folder}: {e}")
            import traceback
            traceback.print_exc()

    print("\nBatch process completed.")


if __name__ == "__main__":
    main()
