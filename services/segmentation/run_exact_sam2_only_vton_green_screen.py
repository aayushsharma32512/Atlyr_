#!/usr/bin/env python3
"""
Batch SAM2-Only VTON Pipeline (SAM2 Point-Interactive Green Screen Version):
This script performs garment segmentation specifically optimized for Green Screen inputs
using SAM2 Point-Interactive Refinement.
It applies:
  1. FASHN + SCHP coarse garment detection.
  2. Spatially guided SAM2 point prompt generation (positive points on garment, negative points on skin).
  3. Dynamic skin color detection to handle misclassifications by FASHN/SCHP.
  4. SAM2 model refinement to get a precise body-conforming garment mask.
  5. Chroma-key gating to ensure pixel-perfect background separation.
  6. Adaptive inpainting of background boundaries.
  7. Distance transform-based soft feathering and explicit green color despill.
"""
import os
import sys
import cv2
import numpy as np
from PIL import Image
import argparse

base_dir = r"c:\Users\namja\Downloads\Atlyr_\services\segmentation"
sys.path.insert(0, base_dir)

# Ensure SCHP_ROOT is set correctly before imports
os.environ["SCHP_ROOT"] = os.path.join(base_dir, "Utils", "Self-Correction-Human-Parsing")

from experiment_segmentation import (
    extract_class_mask,
    run_schp_parsing,
    refine_garment_mask,
    SCHP_EXCLUSION_CLASSES,
    SCHP_GARMENT_CLASSES,
)
from fashn_human_parser import FashnHumanParser


def main():
    parser = argparse.ArgumentParser(description="Batch SAM2-Only VTON Pipeline (Green Screen)")
    parser.add_argument("--input_dir", type=str, default=None, help="Directory containing input images")
    parser.add_argument("--output_dir", type=str, default=None, help="Directory for output results")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of images to process")
    parser.add_argument("--start_idx", type=int, default=0, help="Start index of images to process")
    args = parser.parse_args()

    if args.input_dir:
        green_screen_dir = args.input_dir
    else:
        green_screen_dir = os.path.join(base_dir, "green_screen_test")

    if os.path.isdir(green_screen_dir):
        image_files = sorted([f for f in os.listdir(green_screen_dir) if f.lower().endswith((".png", ".jpg", ".jpeg"))])
        
        inputs = []
        if len(image_files) > 0:
            # Standard directory of images
            # Apply start_idx and limit if specified
            start = args.start_idx
            end = None
            if args.limit is not None:
                end = start + args.limit
            image_files = image_files[start:end] if end is not None else image_files[start:]
            
            for f in image_files:
                inputs.append({
                    "name": os.path.splitext(f)[0],
                    "path": os.path.join(green_screen_dir, f)
                })
        else:
            # Check for subdirectories (e.g. output_ghost_test_vton/F1/01_original.png)
            subdirs = sorted([d for d in os.listdir(green_screen_dir) if os.path.isdir(os.path.join(green_screen_dir, d))])
            valid_subdirs = []
            for d in subdirs:
                img_path = os.path.join(green_screen_dir, d, "01_original.png")
                if os.path.isfile(img_path):
                    valid_subdirs.append(d)
            
            # Apply start_idx and limit if specified
            start = args.start_idx
            end = None
            if args.limit is not None:
                end = start + args.limit
            valid_subdirs = valid_subdirs[start:end] if end is not None else valid_subdirs[start:]
            
            for d in valid_subdirs:
                inputs.append({
                    "name": d,
                    "path": os.path.join(green_screen_dir, d, "01_original.png")
                })
    else:
        inputs = [
            {
                "name": "green_image_test3",
                "path": os.path.join(base_dir, "green_image_test3.png")
            },
            {
                "name": "green_screen_test_2",
                "path": os.path.join(base_dir, "green_screen_test_2.png")
            },
            {
                "name": "green_screen_test",
                "path": os.path.join(base_dir, "green_screen_test.png")
            },
            {
                "name": "green_test_image4",
                "path": os.path.join(base_dir, "green_test_image4.png")
            },
            {
                "name": "green_test_image5",
                "path": os.path.join(base_dir, "green_test_image5.png")
            }
        ]

    if args.output_dir:
        output_root = args.output_dir
    else:
        output_root = os.path.join(base_dir, "final_sam2_only_green_screen")
    os.makedirs(output_root, exist_ok=True)

    print("Loading FASHN Human Parser...")
    fashn = FashnHumanParser()

    print(f"Found {len(inputs)} green screen images to process. Writing to {output_root}.")

    for idx, item in enumerate(inputs):
        name = item["name"]
        img_path = item["path"]
        out_folder = os.path.join(output_root, name)
        os.makedirs(out_folder, exist_ok=True)

        if not os.path.isfile(img_path):
            print(f"[{idx+1}/{len(inputs)}] Skipping {name}: File not found at {img_path}")
            continue

        print(f"\n{'='*60}")
        print(f"Processing [{idx+1}/{len(inputs)}]: {name}")
        print(f"{'='*60}")

        try:
            img_bgr = cv2.imread(img_path)
            img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
            h, w = img_rgb.shape[:2]

            # Save copy of original in the output folder
            cv2.imwrite(os.path.join(out_folder, "01_original.png"), img_bgr)

            # FASHN parser
            print("  Running FASHN parser...")
            seg_map = fashn.predict(img_rgb)

            # SCHP parser
            schp_map = None
            try:
                print("  Running SCHP parser...")
                schp_map = run_schp_parsing(img_path)
            except Exception as schp_err:
                print(f"  [Warning] SCHP failed: {schp_err}")

            # 1. Chroma Keying (Green Screen Mask)
            print("  Performing chroma keying...")
            hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
            lower_green = np.array([35, 40, 30])
            upper_green = np.array([90, 255, 255])
            green_mask = cv2.inRange(hsv, lower_green, upper_green)

            kernel_morph = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            green_mask_clean = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, kernel_morph)
            green_mask_clean = cv2.morphologyEx(green_mask_clean, cv2.MORPH_OPEN, kernel_morph)
            foreground_mask = cv2.bitwise_not(green_mask_clean)

            # Resolve category dynamically based on maximum FASHN segmentation area
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
            print(f"  Resolved category: {category}")

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
                "footwear": [1, 2, 12, 13, 16],
            }

            # 2. Build coarse garment mask
            fashn_g_ids = FASHN_GARMENT_CLASSES.get(category, [3])
            coarse_garment_mask = extract_class_mask(seg_map, fashn_g_ids)
            cv2.imwrite(os.path.join(out_folder, "02_fashn_garment.png"), coarse_garment_mask)

            # 3. Build exclusion mask
            fashn_s_ids = FASHN_EXCLUSION_CLASSES.get(category, [1, 2, 12, 13, 14, 16])
            skin_mask = extract_class_mask(seg_map, fashn_s_ids)
            if schp_map is not None:
                schp_s_ids = SCHP_EXCLUSION_CLASSES.get(category, [2, 13, 14, 15, 16, 17, 18, 19])
                schp_skin = np.zeros_like(schp_map, dtype=np.uint8)
                for cid in schp_s_ids:
                    schp_skin[schp_map == cid] = 255
                skin_mask = np.maximum(skin_mask, schp_skin)

            # Auto-detect green screen vs non-green-screen (VTON) images.
            # Green screen: mannequin skin genuinely overlaps garment → do NOT subtract garment mask from exclusion.
            # Non-green-screen: parser misclassifies sleeves as arms → DO subtract garment mask to protect sleeves/logos.
            green_coverage = np.sum(green_mask_clean > 0) / (h * w)
            is_green_screen = green_coverage > 0.05  # >5% green pixels = green screen image
            
            if is_green_screen:
                print(f"  [Mode] Green screen detected ({green_coverage:.1%} green coverage). Keeping full exclusion mask.")
            else:
                # Protect garment details (e.g., sleeves) from semantic parser classification conflicts
                # by removing the coarse garment mask from the exclusion mask
                skin_mask = cv2.bitwise_and(skin_mask, cv2.bitwise_not(coarse_garment_mask))
                print(f"  [Mode] Non-green-screen ({green_coverage:.1%} green coverage). Protecting garment mask from exclusion overlap.")

            # Store the parser-only skin mask (FASHN + SCHP deep learning semantic classes)
            # to safely subtract from the final mask without risk of color-based false positives.
            parser_skin_mask = skin_mask.copy()

            # Dynamic skin color detection (protect beige/pink/nude garments)
            if np.sum(coarse_garment_mask > 127) > 0:
                b_mean = np.mean(img_bgr[:, :, 0][coarse_garment_mask > 127])
                g_mean = np.mean(img_bgr[:, :, 1][coarse_garment_mask > 127])
                r_mean = np.mean(img_bgr[:, :, 2][coarse_garment_mask > 127])
                is_garment_skin_colored = (r_mean > 95) and (g_mean > 40) and (b_mean > 20) and (r_mean > g_mean) and (r_mean > b_mean) and (r_mean - g_mean > 10) and (r_mean - b_mean > 10)
            else:
                is_garment_skin_colored = False

            if not is_garment_skin_colored:
                b_ch = img_bgr[:, :, 0].astype(np.float32)
                g_ch = img_bgr[:, :, 1].astype(np.float32)
                r_ch = img_bgr[:, :, 2].astype(np.float32)
                color_skin = (r_ch > 95) & (g_ch > 40) & (b_ch > 20) & (r_ch - g_ch > 15) & (r_ch - b_ch > 15) & (r_ch > g_ch) & (r_ch > b_ch)
                if is_green_screen:
                    # Green screen: apply color skin detection everywhere (original behavior)
                    skin_mask = np.maximum(skin_mask, color_skin.astype(np.uint8) * 255)
                    color_skin_mask = color_skin.astype(np.uint8) * 255
                    print("  [Exclusion] Garment is non-skin-colored. Added high-precision skin color detection to exclusion mask.")
                else:
                    # Non-green-screen: protect prints/details inside the garment region from color-based false positives
                    color_skin_clean = cv2.bitwise_and(color_skin.astype(np.uint8) * 255, cv2.bitwise_not(coarse_garment_mask))
                    skin_mask = np.maximum(skin_mask, color_skin_clean)
                    color_skin_mask = color_skin_clean
                    print("  [Exclusion] Garment is non-skin-colored. Added high-precision skin color detection to exclusion mask (masked to outside of coarse garment).")
            else:
                color_skin_mask = np.zeros_like(parser_skin_mask)
                print("  [Exclusion] Garment is skin-colored (beige/pink/nude). Bypassed skin color filter to protect fabric.")

            cv2.imwrite(os.path.join(out_folder, "06_exclusion_mask.png"), skin_mask)

            # 4. Run SAM2 Point-Interactive Refinement
            print("  Running SAM2 Point-Interactive Refinement...")
            sam_refined_mask, sampled_bg = refine_garment_mask(
                image_path=img_path,
                coarse_garment_mask=coarse_garment_mask,
                exclusion_mask=skin_mask,
                category=category,
                seg_map=seg_map,
                schp_map=schp_map,
                output_dir=out_folder
            )
            cv2.imwrite(os.path.join(out_folder, "03_sam_and_fashn.png"), sam_refined_mask)

            # 5. Gate SAM2 result with chroma key foreground mask (ensures pixel-perfect background separation)
            sam2_only_alpha = cv2.bitwise_and(sam_refined_mask, foreground_mask)

            # Build head and neck only mask for guiding color skin subtraction
            # FASHN classes: 1 (face), 2 (hair), 16 (torso/neck)
            # SCHP classes: 2 (hair), 13 (face)
            fashn_hn = extract_class_mask(seg_map, [1, 2, 16])
            schp_hn = np.zeros_like(schp_map, dtype=np.uint8) if schp_map is not None else None
            if schp_map is not None:
                for cid in [2, 13]:
                    schp_hn[schp_map == cid] = 255
            head_neck_mask = np.maximum(fashn_hn, schp_hn) if schp_hn is not None else fashn_hn

            # Dilate the head and neck mask by 15 pixels to cover nearby neck/collar skin patches
            kernel_hn = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))  # 15px radius -> 31px diameter
            dilated_hn = cv2.dilate(head_neck_mask, kernel_hn)

            # We subtract parser_skin_mask completely (extremely safe since it comes from DL semantic parsing)
            # We also subtract color_skin but ONLY where it is close to the head/neck area (dilated_hn)
            # to clean up collar/neck skin patches without punching holes in the body/sleeves of the garment.
            color_skin_guided = cv2.bitwise_and(color_skin_mask, dilated_hn)
            combined_exclusion = cv2.bitwise_or(parser_skin_mask, color_skin_guided)

            sam2_only_alpha[combined_exclusion > 127] = 0

            # 6. Multi-component cleanup
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

            # Convert to binary mask base for post-processing
            sam2_only_alpha_binary = np.zeros_like(sam2_only_alpha)
            sam2_only_alpha_binary[sam2_only_alpha >= 128] = 255

            # Adaptive inpainting (color extension)
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

            # Calculate distance transform of the binary mask
            dist = cv2.distanceTransform(sam2_only_alpha_binary, cv2.DIST_L2, 5)

            # Compute soft alpha mask (feathering width of 3 pixels)
            feather_width = 3.0
            alpha = np.clip((dist / feather_width) * 255.0, 0, 255).astype(np.uint8)

            # Boundary-only targeted cleanup & despill (restricted to outer 5 pixels of the mask)
            boundary_mask = (dist > 0) & (dist <= 5)

            # Color calculations to detect background bleed
            b = img_bgr[:, :, 0].astype(np.int32)
            g = img_bgr[:, :, 1].astype(np.int32)
            r = img_bgr[:, :, 2].astype(np.int32)
            cmax = np.maximum(np.maximum(r, g), b)
            cmin = np.minimum(np.minimum(r, g), b)
            sat = cmax - cmin

            bg_color = img_bgr[0, 0].astype(np.float32)
            bg_sat = np.max(bg_color) - np.min(bg_color)
            diff = img_bgr.astype(np.float32) - bg_color
            dist_bg = np.sqrt(np.sum(diff**2, axis=-1))

            # Dynamic Background-Aware Despill
            if bg_sat > 30:
                spill_mask = boundary_mask & (dist_bg < 120)
                print("    [Dynamic Despill] Background detected as saturated. Applying chroma despill.")
            else:
                spill_mask = boundary_mask & (sat < 15) & (dist_bg < 120)
                print("    [Dynamic Despill] Background detected as neutral. Applying gray despill.")

            # Softly suppress alpha for spill pixels
            alpha[spill_mask] = (alpha[spill_mask] * 0.3).astype(np.uint8)

            # Blending original image and color-extended image
            weight = np.clip(dist / feather_width, 0.0, 1.0)
            weight[spill_mask] = 0.0

            weight_3d = np.expand_dims(weight, axis=-1)
            blended_rgb = (weight_3d * img_rgb + (1.0 - weight_3d) * img_rgb_inpainted).astype(np.uint8)

            # Explicit Green color despill on the blended image (RGB)
            blended_r = blended_rgb[:, :, 0].astype(np.float32)
            blended_g = blended_rgb[:, :, 1].astype(np.float32)
            blended_b = blended_rgb[:, :, 2].astype(np.float32)

            green_spill_pixels = boundary_mask & (blended_g > blended_r) & (blended_g > blended_b)
            blended_g[green_spill_pixels] = np.maximum(blended_r[green_spill_pixels], blended_b[green_spill_pixels])

            blended_rgb = np.dstack([blended_r, blended_g, blended_b]).astype(np.uint8)

            # Assemble RGBA
            rgba = np.dstack([blended_rgb, alpha])

            # Save outputs
            cv2.imwrite(os.path.join(out_folder, "09_final_garment.png"),
                         cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
            cv2.imwrite(os.path.join(out_folder, "07b_sam2_alpha.png"), alpha)

            # Checkerboard visualization
            checker = np.zeros((h, w, 3), dtype=np.uint8)
            grid_sz = 16
            for r_grid in range(0, h, grid_sz):
                for c_grid in range(0, w, grid_sz):
                    if ((r_grid // grid_sz) + (c_grid // grid_sz)) % 2 == 0:
                        checker[r_grid:r_grid+grid_sz, c_grid:c_grid+grid_sz] = 200
                    else:
                        checker[r_grid:r_grid+grid_sz, c_grid:c_grid+grid_sz] = 255

            alpha_f = rgba[:, :, 3:4] / 255.0
            vis_bgr = (rgba[:, :, :3] * alpha_f + checker * (1 - alpha_f)).astype(np.uint8)
            cv2.imwrite(os.path.join(out_folder, "09_final_garment_checker.png"),
                         cv2.cvtColor(vis_bgr, cv2.COLOR_RGB2BGR))

            removed = int((foreground_mask > 127).sum()) - int((alpha > 127).sum())
            print(f"  Done: {name} — Removed {removed:,} skin/bg px. Final: {(alpha > 127).sum():,} px")

        except Exception as e:
            print(f"  Error processing {name}: {e}")
            import traceback
            traceback.print_exc()

    print("\nBatch process completed.")


if __name__ == "__main__":
    main()
