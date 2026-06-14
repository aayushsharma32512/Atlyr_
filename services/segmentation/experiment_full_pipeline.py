"""
Experiment 4: Full Pipeline — Classify → Segment + SAM2 Refine → Neck Clip → Extract

Usage:
    python experiment_full_pipeline.py <image_path> [--output-dir ./output_pipeline]

    With Gemini API:
    set GEMINI_API_KEY=your_key_here
    python experiment_full_pipeline.py test_images/model_tshirt.jpg
"""

import argparse
import json
import os
import sys
import time
import numpy as np
import cv2

# Import from other experiment modules
sys.path.insert(0, os.path.dirname(__file__))


def run_pipeline(image_path: str, output_dir: str, api_key: str = None,
                 collar_depth: float = 0.03, occlusion_threshold: float = 5.0,
                 provider: str = None, ollama_model: str = "gemma3:4b",
                 ollama_url: str = "http://127.0.0.1:11434",
                 openrouter_key: str = None, openrouter_model: str = "google/gemma-4-31b-it:free",
                 matting_model: str = "hybrid"):
    """Run the full refined garment extraction pipeline."""

    os.makedirs(output_dir, exist_ok=True)
    report = {
        "input_image": image_path,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "stages": {}
    }

    # ── Load Image ──
    print(f"\n{'='*60}")
    print(f"  FULL PIPELINE: {os.path.basename(image_path)}")
    print(f"{'='*60}")

    image = cv2.imread(image_path)
    if image is None:
        print(f" Could not read: {image_path}")
        return
    h, w = image.shape[:2]
    print(f"\n[Info] Image: {w}x{h}")
    cv2.imwrite(os.path.join(output_dir, "01_original.png"), image)

    # ═══════════════════════════════════════════
    # STAGE 1: VLM Classification (optional)
    # ═══════════════════════════════════════════
    classification = None
    
    # Auto-detect provider if not specified
    chosen_provider = provider
    if not chosen_provider:
        if openrouter_key:
            chosen_provider = "openrouter"
        elif api_key:
            chosen_provider = "gemini"
        else:
            chosen_provider = "ollama"

    print(f"\n{'-'*40}")
    print(f"  STAGE 1: VLM Classification ({chosen_provider})")
    print(f"{'-'*40}")
    
    try:
        t0 = time.time()
        if chosen_provider == "gemini":
            if not api_key:
                raise ValueError("No Gemini API key provided. Set GEMINI_API_KEY env var or pass --api-key")
            from experiment_vlm_classify import classify_with_gemini
            classification = classify_with_gemini(image_path, api_key)
        elif chosen_provider == "openrouter":
            if not openrouter_key:
                raise ValueError("No OpenRouter API key provided. Set OPENROUTER_API_KEY env var or pass --openrouter-key")
            from experiment_vlm_classify import classify_with_openrouter
            classification = classify_with_openrouter(image_path, openrouter_key, openrouter_model)
        else:
            from experiment_vlm_classify import classify_with_ollama
            classification = classify_with_ollama(image_path, ollama_model, ollama_url)
        vlm_time = time.time() - t0

        print(f"  [Info] View: {classification.get('product_view')}")
        print(f"  [Info] Category: {classification.get('category')}")
        print(f"  [Info] Type: {classification.get('specific_type')}")
        print(f"  [Info] Neckline: {classification.get('neckline_type')}")

        placement = classification.get("predicted_placement", {})
        print(f"  [Info] Placement Y: {placement.get('placement_y')}%")
        print(f"  [Info] Time: {vlm_time*1000:.0f}ms")

        report["stages"]["vlm_classify"] = {
            "success": True,
            "provider": chosen_provider,
            "time_ms": int(vlm_time * 1000),
            "result": classification
        }

        with open(os.path.join(output_dir, "02_classification.json"), "w") as f:
            json.dump(classification, f, indent=2)

    except Exception as e:
        print(f"  [Error] VLM failed: {e}")
        report["stages"]["vlm_classify"] = {"success": False, "error": str(e)}

    # ═══════════════════════════════════════════
    # STAGE 2: Coarse Segmentation (SegFormer)
    # ═══════════════════════════════════════════
    print(f"\n{'-'*40}")
    print(f"  STAGE 2: Coarse Segmentation (FASHN Human Parser)")
    print(f"{'-'*40}")

    try:
        from fashn_human_parser import FashnHumanParser
        from experiment_segmentation import (
            colorize_segmentation, extract_class_mask, detect_occlusions,
            refine_garment_mask, bezier_neck_clip, extract_garment_rgba,
            GARMENT_CLASSES, HEAD_NECK_CLASSES
        )

        t0 = time.time()
        parser_model = FashnHumanParser()
        load_time = time.time() - t0
        print(f"  Model loaded: {load_time:.1f}s")

        t0 = time.time()
        seg_map = parser_model.predict(image_path)
        seg_time = time.time() - t0
        print(f"  Segmentation completed in {seg_time:.2f}s")

        # ── Upsample FASHN seg_map to native image resolution ──
        seg_map_native = cv2.resize(
            seg_map.astype(np.uint8),
            (w, h),
            interpolation=cv2.INTER_NEAREST  # NEAREST to preserve class IDs
        )
        seg_map = seg_map_native

        # Save colored segmentation
        colored = colorize_segmentation(seg_map)
        cv2.imwrite(os.path.join(output_dir, "03_segmentation_map.png"), colored)

        # Resolve garment category
        garment_type = None
        specific_type = "garment"
        if classification:
            cat = classification.get("category", "")
            specific_type = classification.get("specific_type", "garment")
            type_map = {
                "topwear": "top",
                "dresses": "dress",
                "bottomwear": "pants",
                "footwear": "footwear"
            }
            garment_type = type_map.get(cat)
            
            # Sub-category refinement for bottoms (pants vs skirts)
            if cat == "bottomwear" and "skirt" in specific_type.lower():
                garment_type = "skirt"

        # Auto-detect largest category if VLM failed
        if not garment_type:
            best_area = 0
            for name, cids in GARMENT_CLASSES.items():
                mask = extract_class_mask(seg_map, cids)
                area = mask.sum() // 255
                if area > best_area:
                    best_area = area
                    garment_type = name

        garment_class_ids = GARMENT_CLASSES.get(garment_type, [3])
        print(f"  Garment type resolved: {garment_type}")

        # Extract coarse masks
        garment_mask = extract_class_mask(seg_map, garment_class_ids)
        head_neck_mask = extract_class_mask(seg_map, HEAD_NECK_CLASSES)
        occlusion_mask = detect_occlusions(seg_map, garment_mask)

        cv2.imwrite(os.path.join(output_dir, "04_garment_mask.png"), garment_mask)
        cv2.imwrite(os.path.join(output_dir, "05_head_neck_mask.png"), head_neck_mask)
        cv2.imwrite(os.path.join(output_dir, "06_occlusion_mask.png"), occlusion_mask)

        # ── Build exclusion mask: FASHN coarse + SCHP fine (merged) ──
        from experiment_segmentation import get_schp_exclusion_mask

        # FASHN coarse exclusion (fallback baseline)
        if garment_type == "footwear":
            # For footwear, exclude face, hair, arms, and legs, but do NOT exclude feet (class 15)
            fashn_exclusion = extract_class_mask(seg_map, [1, 2, 12, 13, 14])
        else:
            fashn_exclusion = extract_class_mask(seg_map, HEAD_NECK_CLASSES + [12, 13, 14, 15, 16])

        # SCHP fine exclusion (separate left/right arms, finer boundaries)
        schp_checkpoint = os.environ.get(
            "SCHP_CHECKPOINT",
            "./checkpoints/exp-schp-201908261155-lip.pth"
        )
        schp_exclusion = None
        schp_map = None
        try:
            t0_schp = time.time()
            from experiment_segmentation import run_schp_parsing, SCHP_EXCLUSION_CLASSES
            schp_map = run_schp_parsing(image_path, checkpoint_path=schp_checkpoint)
            
            # Generate exclusion mask
            exclude_ids = SCHP_EXCLUSION_CLASSES.get(garment_type, [2, 13, 14, 15, 16, 17, 18, 19])
            schp_exclusion = np.zeros_like(schp_map, dtype=np.uint8)
            for cid in exclude_ids:
                schp_exclusion[schp_map == cid] = 255
            print(f"  [SCHP] Parsed and exclusion mask built in {(time.time()-t0_schp)*1000:.0f}ms")
        except Exception as e:
            print(f"  [SCHP] Failed ({e}), falling back to FASHN exclusion only")

        # Merge: union of FASHN + SCHP exclusions
        # Union = if either model says "this is skin/arm/leg" → exclude it
        if schp_exclusion is not None:
            exclusion_mask = cv2.bitwise_or(fashn_exclusion, schp_exclusion)
            print(f"  [Exclusion] FASHN+SCHP merged: "
                  f"{(exclusion_mask > 127).sum()} total excluded px")
        else:
            exclusion_mask = fashn_exclusion

        cv2.imwrite(os.path.join(output_dir, "06_exclusion_mask.png"), exclusion_mask)


        # ═══════════════════════════════════════════
        # STAGE 3: Mask Refining & Boundary Polish
        # ═══════════════════════════════════════════
        print(f"\n{'-'*40}")
        print(f"  STAGE 3: Mask Refining & Boundary Polish")
        print(f"{'-'*40}")

        t0_refine = time.time()
        refined_mask, sampled_bg = refine_garment_mask(
            image_path=image_path,
            coarse_garment_mask=garment_mask,
            exclusion_mask=exclusion_mask,
            category=garment_type,
            seg_map=seg_map,               # FASHN seg_map for hole punching
            schp_map=schp_map,             # Pass raw SCHP class map
            item_name=specific_type,
            output_dir=output_dir
        )
        refine_time = time.time() - t0_refine
        print(f"  Refinement completed in {refine_time:.2f}s")
        cv2.imwrite(os.path.join(output_dir, "07_refined_mask.png"), refined_mask)

        # ═══════════════════════════════════════════
        # STAGE 3b: Matting Model (edge quality + anti-bleed)
        # ═══════════════════════════════════════════
        print(f"\n{'-'*40}")
        print(f"  STAGE 3b: Matting Model ({matting_model})")
        print(f"{'-'*40}")

        matting_time_ms = 0
        if matting_model == "hybrid":
            from experiment_segmentation import refine_with_hybrid
            t0_matting = time.time()
            matted_alpha = refine_with_hybrid(
                image_path=image_path,
                fashn_gate_mask=garment_mask,
                exclusion_mask=exclusion_mask,
                seg_map=seg_map,
                garment_type=garment_type
            )
            matting_time_ms = int((time.time() - t0_matting) * 1000)
            print(f"  Hybrid (BiRefNet+ViTMatte) Matting completed in {matting_time_ms}ms")
            cv2.imwrite(os.path.join(output_dir, "07b_hybrid_alpha.png"), matted_alpha)
        elif matting_model == "vitmatte":
            from experiment_segmentation import refine_with_vitmatte
            t0_matting = time.time()
            matted_alpha = refine_with_vitmatte(
                image_path=image_path,
                fashn_gate_mask=garment_mask,
                exclusion_mask=exclusion_mask,
                seg_map=seg_map,
                garment_type=garment_type
            )
            matting_time_ms = int((time.time() - t0_matting) * 1000)
            print(f"  ViTMatte Matting completed in {matting_time_ms}ms")
            cv2.imwrite(os.path.join(output_dir, "07b_vitmatte_alpha.png"), matted_alpha)
        else:
            from experiment_segmentation import refine_with_birefnet
            t0_matting = time.time()
            matted_alpha = refine_with_birefnet(
                image_path=image_path,
                fashn_gate_mask=garment_mask,
            )
            matting_time_ms = int((time.time() - t0_matting) * 1000)
            print(f"  BiRefNet HR Matting completed in {matting_time_ms}ms")
            
            # Hard exclusion constraint for BiRefNet
            matted_alpha[exclusion_mask > 127] = 0
            cv2.imwrite(os.path.join(output_dir, "07b_birefnet_alpha.png"), matted_alpha)

        # Use matted_alpha instead of refined_mask for neck clip + RGBA extraction
        refined_mask = matted_alpha

        report["stages"]["segmentation"] = {
            "success": True,
            "coarse_time_ms": int(seg_time * 1000),
            "refinement_time_ms": int(refine_time * 1000),
            "matting_model": matting_model,
            "matting_time_ms": matting_time_ms,
            "garment_type": garment_type,
            "garment_area_px": int(refined_mask.sum() // 255)
        }

    except Exception as e:
        print(f"  [Error] Segmentation/Refinement failed: {e}")
        import traceback
        traceback.print_exc()
        report["stages"]["segmentation"] = {"success": False, "error": str(e)}
        with open(os.path.join(output_dir, "pipeline_report.json"), "w") as f:
            json.dump(report, f, indent=2)
        return

    # ═══════════════════════════════════════════
    # STAGE 4: Bézier Neck Clipping
    # ═══════════════════════════════════════════
    print(f"\n{'-'*40}")
    print(f"  STAGE 4: Bezier Neck Contour Clipping")
    print(f"{'-'*40}")

    t0 = time.time()
    # Apply Bézier clipping on the refined mask
    clipped_mask = bezier_neck_clip(refined_mask, head_neck_mask, collar_depth)
    clip_time = time.time() - t0

    pixels_removed = (refined_mask.sum() - clipped_mask.sum()) // 255
    print(f"  Collar clipping: removed {pixels_removed} px")
    print(f"  Time: {clip_time*1000:.1f}ms")

    cv2.imwrite(os.path.join(output_dir, "08_neck_clipped_mask.png"), clipped_mask)

    report["stages"]["neck_clip"] = {
        "success": True,
        "time_ms": int(clip_time * 1000),
        "pixels_removed": int(pixels_removed),
        "collar_depth": collar_depth
    }

    # ═══════════════════════════════════════════
    # STAGE 5: Final RGBA Extraction (with De-spill)
    # ═══════════════════════════════════════════
    print(f"\n{'-'*40}")
    print(f"  STAGE 5: Final Garment RGBA Extraction & De-spill")
    print(f"{'-'*40}")

    t0 = time.time()
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    clean_garment = extract_garment_rgba(image_rgb, clipped_mask, sampled_bg)
    clean_garment_bgr = cv2.cvtColor(clean_garment, cv2.COLOR_RGBA2BGRA)
    extract_time = time.time() - t0

    # Save the full-sized canvas without cropping (keeping original high resolution)
    cv2.imwrite(os.path.join(output_dir, "09_final_garment.png"), clean_garment_bgr)
    print(f"  [Info] Final garment saved at full size: {w}x{h}")
    report["stages"]["extraction"] = {
        "success": True,
        "time_ms": int(extract_time * 1000),
        "output_size": f"{w}x{h}"
    }

    # ═══════════════════════════════════════════
    # PIPELINE REPORT
    # ═══════════════════════════════════════════
    total_time = sum(
        s.get("time_ms", 0) or s.get("coarse_time_ms", 0) or 0
        for s in report["stages"].values() if isinstance(s, dict)
    )
    # add refinement time and matting time
    if "segmentation" in report["stages"]:
        seg_stage = report["stages"]["segmentation"]
        if "refinement_time_ms" in seg_stage:
            total_time += seg_stage["refinement_time_ms"]
        if "birefnet_time_ms" in seg_stage:
            total_time += seg_stage["birefnet_time_ms"]
        if "matting_time_ms" in seg_stage:
            total_time += seg_stage["matting_time_ms"]
        
    report["total_time_ms"] = total_time
    report["success"] = all(
        s.get("success", True) for name, s in report["stages"].items()
        if name != "vlm_classify" and isinstance(s, dict)
    )

    with open(os.path.join(output_dir, "pipeline_report.json"), "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  PIPELINE COMPLETE")
    print(f"{'='*60}")
    print(f"  Total time: {total_time}ms")
    print(f"  Success: {report['success']}")
    print(f"  Output directory: {os.path.abspath(output_dir)}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="Full Garment Extraction Pipeline (SAM2-Refined)")
    parser.add_argument("image_path", help="Path to input garment image")
    parser.add_argument("--output-dir", default="./output_pipeline", help="Output directory")
    parser.add_argument("--provider", default=None, choices=["gemini", "ollama", "openrouter"], help="VLM provider")
    parser.add_argument("--api-key", default=None, help="Gemini API key")
    parser.add_argument("--openrouter-key", default=None, help="OpenRouter API key")
    parser.add_argument("--openrouter-model", default="google/gemma-4-31b-it:free", help="OpenRouter model name")
    parser.add_argument("--ollama-model", default="gemma3:4b", help="Ollama model name")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434", help="Ollama API base URL")
    parser.add_argument("--collar-depth", type=float, default=0.03, help="Collar clip depth ratio")
    parser.add_argument("--matting-model", default="hybrid", choices=["hybrid", "vitmatte", "birefnet"], help="Matting model to refine edges (hybrid = BiRefNet fill + ViTMatte edges)")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY")
    openrouter_key = args.openrouter_key or os.environ.get("OPENROUTER_API_KEY")

    run_pipeline(
        args.image_path,
        args.output_dir,
        api_key=api_key,
        collar_depth=args.collar_depth,
        provider=args.provider,
        ollama_model=args.ollama_model,
        ollama_url=args.ollama_url,
        openrouter_key=openrouter_key,
        openrouter_model=args.openrouter_model,
        matting_model=args.matting_model
    )


if __name__ == "__main__":
    main()
