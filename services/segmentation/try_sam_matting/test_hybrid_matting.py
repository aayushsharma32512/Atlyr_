#!/usr/bin/env python3
import os
import sys
import cv2
import numpy as np
import torch
from PIL import Image

# Setup path imports
segmentation_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, segmentation_dir)

from experiment_segmentation import (
    _load_vitmatte,
    _run_birefnet_raw,
    extract_garment_rgba,
    generate_trimap
)

def run_sam_guided_matting_all():
    comparison_test_dir = os.path.join(segmentation_dir, "scratch", "comparison_test")
    output_root = os.path.join(segmentation_dir, "scratch", "try_sam_matting", "output")
    os.makedirs(output_root, exist_ok=True)
    
    print("=" * 80)
    print("  SAM-GUIDED MATTING (BIREFNET, VITMATTE & HYBRID FOR ALL CASES)")
    print("=" * 80)
    
    if not os.path.exists(comparison_test_dir):
        print(f"[Error] Comparison test directory not found: {comparison_test_dir}")
        return

    # Find all test cases (subdirectories of comparison_test)
    cases = sorted([d for d in os.listdir(comparison_test_dir) if os.path.isdir(os.path.join(comparison_test_dir, d))])
    if not cases:
        print("[Error] No test cases found in comparison_test directory.")
        return

    print(f"Found {len(cases)} cases to process: {cases}")

    # Load ViTMatte model once
    print("\n[Init] Loading ViTMatte model...")
    vitmatte_processor, vitmatte_model = _load_vitmatte("hustvl/vitmatte-base-composition-1k")

    for case in cases:
        case_dir = os.path.join(comparison_test_dir, case)
        original_img_path = os.path.join(case_dir, "original.png")
        sam_rgba_path = os.path.join(case_dir, "grounded_sam2_transparent.png")
        
        if not os.path.exists(original_img_path) or not os.path.exists(sam_rgba_path):
            print(f"[Warning] Skipping case {case}: 'original.png' or 'grounded_sam2_transparent.png' missing.")
            continue

        print(f"\n--- Processing Case: {case} ---")
        case_out_dir = os.path.join(output_root, case)
        os.makedirs(case_out_dir, exist_ok=True)

        # 1. Load Original Image & SAM Mask
        img_bgr = cv2.imread(original_img_path)
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        orig_h, orig_w = img_rgb.shape[:2]
        
        sam_rgba = cv2.imread(sam_rgba_path, cv2.IMREAD_UNCHANGED)
        sam_mask = sam_rgba[:, :, 3]  # Alpha channel is the SAM mask
        
        # Sample background color locally using the SAM mask
        ys, xs = np.where(sam_mask > 127)
        if len(xs) > 0:
            sampled_bg = np.array([img_rgb[y, x].mean() for y, x in zip(ys, xs)]).mean()
            sampled_bg = np.array([sampled_bg, sampled_bg, sampled_bg])
        else:
            sampled_bg = np.array([127.0, 127.0, 127.0])
            
        print(f"[{case}] Loaded SAM mask: {(sam_mask > 127).sum()} px, size: {orig_w}x{orig_h}")
        
        # ═══════════════════════════════════════════
        # Method A: BiRefNet Gated by SAM Mask
        # ═══════════════════════════════════════════
        biref_raw = None
        dilated_sam = None
        try:
            print(f"[{case}] Running BiRefNet gated by SAM...")
            biref_raw = _run_birefnet_raw(original_img_path, "ZhengPeng7/BiRefNet_HR-matting", input_size=1024)
            
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            dilated_sam = cv2.dilate(sam_mask, kernel, iterations=1)
            biref_gated = biref_raw.copy()
            biref_gated[dilated_sam == 0] = 0
            
            biref_rgba = extract_garment_rgba(img_rgb, biref_gated, sampled_bg=sampled_bg)
            cv2.imwrite(os.path.join(case_out_dir, f"{case}_biref_gated.png"), cv2.cvtColor(biref_rgba, cv2.COLOR_RGBA2BGRA))
            print(f"[{case}] Saved BiRefNet output.")
        except Exception as e:
            print(f"[Warning] BiRefNet failed for {case}: {e}")

        # ═══════════════════════════════════════════
        # Method B: ViTMatte Guided by SAM Trimap
        # ═══════════════════════════════════════════
        vitmatte_alpha = None
        try:
            print(f"[{case}] Generating Trimap...")
            trimap = generate_trimap(sam_mask, erode_size=7, dilate_size=9)
            cv2.imwrite(os.path.join(case_out_dir, f"{case}_trimap.png"), trimap)
            
            print(f"[{case}] Running ViTMatte...")
            pil_img = Image.open(original_img_path).convert("RGB")
            pil_trimap = Image.fromarray(trimap).convert("L")
            
            inputs = vitmatte_processor(images=pil_img, trimaps=pil_trimap, return_tensors="pt")
            if torch.cuda.is_available():
                inputs = {k: v.cuda() for k, v in inputs.items()}
                
            with torch.no_grad():
                outputs = vitmatte_model(**inputs)
            
            vitmatte_alpha = outputs.alphas.squeeze(0).squeeze(0).cpu().numpy()
            
            # RESIZE BACK TO ORIGINAL IMAGE SIZE (ViTMatte processor pads/resizes to multiples of 32/16)
            if vitmatte_alpha.shape != (orig_h, orig_w):
                vitmatte_alpha = cv2.resize(vitmatte_alpha, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)
                
            vitmatte_alpha = (np.clip(vitmatte_alpha, 0, 1) * 255).astype(np.uint8)
            
            vitmatte_rgba = extract_garment_rgba(img_rgb, vitmatte_alpha, sampled_bg=sampled_bg)
            cv2.imwrite(os.path.join(case_out_dir, f"{case}_vitmatte_refined.png"), cv2.cvtColor(vitmatte_rgba, cv2.COLOR_RGBA2BGRA))
            print(f"[{case}] Saved ViTMatte output.")
        except Exception as e:
            print(f"[Warning] ViTMatte failed for {case}: {e}")

        # ═══════════════════════════════════════════
        # Method C: Hybrid Matting (BiRefNet interior + ViTMatte edges)
        # ═══════════════════════════════════════════
        if biref_raw is not None and vitmatte_alpha is not None:
            try:
                print(f"[{case}] Blending Hybrid...")
                interior_erode_px = 15
                blend_sigma = 7.0
                kernel_interior = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (interior_erode_px * 2 + 1, interior_erode_px * 2 + 1))
                interior_zone = cv2.erode(sam_mask, kernel_interior, iterations=1) > 127
                blend_weight = cv2.GaussianBlur(interior_zone.astype(float), (0, 0), blend_sigma)
                
                hybrid_alpha = blend_weight * biref_raw.astype(float) + (1.0 - blend_weight) * vitmatte_alpha.astype(float)
                hybrid_alpha = np.clip(hybrid_alpha, 0, 255).astype(np.uint8)
                
                # Apply same dilation mask constraint
                if dilated_sam is not None:
                    hybrid_alpha[dilated_sam == 0] = 0
                
                hybrid_rgba = extract_garment_rgba(img_rgb, hybrid_alpha, sampled_bg=sampled_bg)
                cv2.imwrite(os.path.join(case_out_dir, f"{case}_hybrid_refined.png"), cv2.cvtColor(hybrid_rgba, cv2.COLOR_RGBA2BGRA))
                print(f"[{case}] Saved Hybrid output.")
            except Exception as e:
                print(f"[Warning] Hybrid blending failed for {case}: {e}")
            
    print("\n[Success] SAM-Guided Matting completed for all cases!")
    print(f"All outputs saved under: {output_root}")

if __name__ == "__main__":
    run_sam_guided_matting_all()
