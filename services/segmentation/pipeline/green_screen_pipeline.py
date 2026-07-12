import os
import sys
import cv2
import urllib.request
import numpy as np
from datetime import datetime
from PIL import Image
import requests

# Path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
base_dir = os.path.dirname(current_dir)
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

os.environ["SCHP_ROOT"] = os.path.join(base_dir, "Utils", "Self-Correction-Human-Parsing")

from pipeline import supabase_client
from pipeline import db_store
from pipeline import result_store
from pipeline.types import StepResult

from pipeline.core_segmentation import (
    extract_class_mask,
    run_schp_parsing,
    refine_garment_mask,
    SCHP_EXCLUSION_CLASSES,
    SCHP_GARMENT_CLASSES,
)
from fashn_human_parser import FashnHumanParser

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
GARMENT_CLASSES_LOCAL = {
    "top": [3], "dress": [4], "skirt": [5], "pants": [6], "footwear": [8, 9, 15],
}
FASHN_GARMENT_CLASSES = {
    "top": [3, 7, 10, 11], "dress": [4, 7, 10, 11],
    "pants": [6, 7], "skirt": [5, 7], "footwear": [8, 9, 15],
}
FASHN_EXCLUSION_CLASSES = {
    "top": [1, 2, 12, 13, 14, 16], "dress": [1, 2, 12, 13, 14, 16],
    "pants": [1, 2, 12, 13, 14, 16], "skirt": [1, 2, 12, 13, 14, 16],
    "footwear": [1, 2, 12, 13, 16],
}


def upload_and_record_step(seg_job_id, config_id, step_name, step_order,
                           status, output_path=None, mask_path=None,
                           metadata=None, error=None, started_at=None,
                           skip_upload=False):
    """Uploads files to storage & writes a step result row."""
    completed_at = datetime.utcnow().isoformat() + "Z"
    remote_output = None
    remote_mask = None

    if status == "completed" and output_path and os.path.exists(output_path):
        if not skip_upload:
            ext = output_path.rsplit(".", 1)[-1]
            storage_path = f"segmentation/{seg_job_id}/steps/{step_name}.{ext}"
            remote_output = supabase_client.upload_file_to_storage(output_path, storage_path, f"image/{ext}")

    if status == "completed" and mask_path and os.path.exists(mask_path):
        if not skip_upload:
            ext = mask_path.rsplit(".", 1)[-1]
            storage_path = f"segmentation/{seg_job_id}/steps/{step_name}_mask.{ext}"
            remote_mask = supabase_client.upload_file_to_storage(mask_path, storage_path, f"image/{ext}")

    result = StepResult(
        step_name=step_name,
        step_order=step_order,
        parallel_group=None,
        status=status,
        output={
            "step_name": step_name,
            "output_path": remote_output or output_path,
            "mask_path": remote_mask or mask_path,
            "metadata": metadata or {},
        } if status == "completed" else None,
        error=error,
        started_at=started_at,
        completed_at=completed_at,
    )
    db_store.save_step_result_db(seg_job_id, config_id, result)
    return remote_output


def run_green_screen_pipeline_e2e(
    seg_job_id: str,
    pipeline_job_id: str,
    vton_image_url: str,
    category: str = "top",
    output_dir: str = None,
    skip_intermediate_uploads: bool = False
) -> dict:
    """
    Runs the exact green-screen SAM2 pipeline end-to-end,
    syncing steps and output directly to Supabase DB and Storage.
    """
    if not output_dir:
        output_dir = os.path.join(os.getcwd(), "output_green_screen_pipeline")
    os.makedirs(output_dir, exist_ok=True)

    try:
        # Resolve config ID from active pipeline configuration
        url = f"{supabase_client.SUPABASE_URL}/rest/v1/segmentation_pipeline_config?select=id,name&is_active=eq.true"
        resp = requests.get(url, headers=supabase_client.get_headers())
        if resp.status_code != 200 or not resp.json():
            raise RuntimeError(f"Could not fetch segmentation pipeline config: {resp.text}")
        config_id = resp.json()[0]["id"]

        # Ensure local image path (download if it's a remote URL)
        img_path = result_store.ensure_local_file(vton_image_url, output_dir)
        if not os.path.exists(img_path):
            raise FileNotFoundError(f"Input VTON image not found at: {img_path}")

        # Update database state to running
        db_store.update_job_db_state(seg_job_id, "running")

        # ------------------------------------------------------------------
        # STEP 1: FASHN Parse
        # ------------------------------------------------------------------
        step_order = 1
        step_start = datetime.utcnow().isoformat() + "Z"
        print(f"\n--- Step {step_order}: FASHN Parse ---")
        img_bgr = cv2.imread(img_path)
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        h, w = img_rgb.shape[:2]

        cv2.imwrite(os.path.join(output_dir, "01_original.png"), img_bgr)

        fashn = FashnHumanParser()
        seg_map = fashn.predict(img_rgb)

        # Resolve category
        category = "top"
        best_area = 0
        for cat, class_ids in GARMENT_CLASSES_LOCAL.items():
            mask = extract_class_mask(seg_map, class_ids)
            area = mask.sum() // 255
            if area > best_area:
                best_area = area
                category = cat
        print(f"  Resolved category: {category}")

        fashn_g_ids = FASHN_GARMENT_CLASSES.get(category, [3])
        coarse_garment_mask = extract_class_mask(seg_map, fashn_g_ids)
        garment_path = os.path.join(output_dir, "02_fashn_garment.png")
        cv2.imwrite(garment_path, coarse_garment_mask)

        fashn_s_ids = FASHN_EXCLUSION_CLASSES.get(category, [1, 2, 12, 13, 14, 16])
        skin_mask = extract_class_mask(seg_map, fashn_s_ids)
        exclusion_path = os.path.join(output_dir, "02_fashn_exclusion.png")
        cv2.imwrite(exclusion_path, skin_mask)

        upload_and_record_step(seg_job_id, config_id, "fashn_parse", step_order,
                               "completed", garment_path, exclusion_path,
                               {"category": category}, started_at=step_start,
                               skip_upload=skip_intermediate_uploads)

        # ------------------------------------------------------------------
        # STEP 2: SCHP Parse
        # ------------------------------------------------------------------
        step_order = 2
        step_start = datetime.utcnow().isoformat() + "Z"
        print(f"\n--- Step {step_order}: SCHP Parse ---")
        schp_map = None
        try:
            schp_map = run_schp_parsing(img_path)
            schp_s_ids = SCHP_EXCLUSION_CLASSES.get(category, [2, 13, 14, 15, 16, 17, 18, 19])
            schp_skin = np.zeros_like(schp_map, dtype=np.uint8)
            for cid in schp_s_ids:
                schp_skin[schp_map == cid] = 255
            skin_mask = np.maximum(skin_mask, schp_skin)

            schp_mask_path = os.path.join(output_dir, "03_schp_exclusion.png")
            cv2.imwrite(schp_mask_path, skin_mask)

            upload_and_record_step(seg_job_id, config_id, "schp_parse", step_order,
                                   "completed", schp_mask_path, None,
                                   {"schp_classes": str(schp_s_ids)}, started_at=step_start,
                                   skip_upload=skip_intermediate_uploads)
        except Exception as e:
            print(f"  [Warning] SCHP failed: {e} (continuing without it)")
            upload_and_record_step(seg_job_id, config_id, "schp_parse", step_order,
                                   "completed", None, None,
                                   {"status": "skipped", "reason": str(e)}, started_at=step_start,
                                   skip_upload=skip_intermediate_uploads)

        # ------------------------------------------------------------------
        # STEP 3: Chroma Key
        # ------------------------------------------------------------------
        step_order = 3
        step_start = datetime.utcnow().isoformat() + "Z"
        print(f"\n--- Step {step_order}: Chroma Key ---")
        hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
        lower_green = np.array([35, 40, 30])
        upper_green = np.array([90, 255, 255])
        green_mask = cv2.inRange(hsv, lower_green, upper_green)

        kernel_morph = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        green_mask_clean = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, kernel_morph)
        green_mask_clean = cv2.morphologyEx(green_mask_clean, cv2.MORPH_OPEN, kernel_morph)
        foreground_mask = cv2.bitwise_not(green_mask_clean)

        green_coverage = np.sum(green_mask_clean > 0) / (h * w)
        # Check green coverage at the border area of the image (outer 5% border) to distinguish 
        # a green garment in the center from an actual green screen background.
        border_mask = np.ones((h, w), dtype=np.uint8) * 255
        border_mask[int(h*0.05):int(h*0.95), int(w*0.05):int(w*0.95)] = 0
        green_border_pixels = cv2.bitwise_and(green_mask_clean, border_mask)
        green_border_coverage = np.sum(green_border_pixels > 0) / np.sum(border_mask > 0)
        is_green_screen = (green_coverage > 0.05) and (green_border_coverage > 0.15)

        if is_green_screen:
            print(f"  Green screen detected ({green_coverage:.1%}). Keeping full exclusion mask.")
        else:
            skin_mask = cv2.bitwise_and(skin_mask, cv2.bitwise_not(coarse_garment_mask))
            print(f"  Non-green-screen ({green_coverage:.1%}). Protecting garment from exclusion.")

        parser_skin_mask = skin_mask.copy()

        # Dynamic skin color detection
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
                skin_mask = np.maximum(skin_mask, color_skin.astype(np.uint8) * 255)
                color_skin_mask = color_skin.astype(np.uint8) * 255
            else:
                color_skin_clean = cv2.bitwise_and(color_skin.astype(np.uint8) * 255, cv2.bitwise_not(coarse_garment_mask))
                skin_mask = np.maximum(skin_mask, color_skin_clean)
                color_skin_mask = color_skin_clean
        else:
            color_skin_mask = np.zeros_like(parser_skin_mask)

        exclusion_final_path = os.path.join(output_dir, "06_exclusion_mask.png")
        cv2.imwrite(exclusion_final_path, skin_mask)

        upload_and_record_step(seg_job_id, config_id, "chroma_key", step_order,
                               "completed", exclusion_final_path, None,
                               {"is_green_screen": bool(is_green_screen), "green_coverage": round(float(green_coverage), 4),
                                "is_garment_skin_colored": bool(is_garment_skin_colored)},
                               started_at=step_start, skip_upload=skip_intermediate_uploads)

        # ------------------------------------------------------------------
        # STEP 4: SAM2 Refinement
        # ------------------------------------------------------------------
        step_order = 4
        step_start = datetime.utcnow().isoformat() + "Z"
        print(f"\n--- Step {step_order}: SAM2 Point-Interactive Refinement ---")
        sam_refined_mask, sampled_bg = refine_garment_mask(
            image_path=img_path,
            coarse_garment_mask=coarse_garment_mask,
            exclusion_mask=skin_mask,
            category=category,
            seg_map=seg_map,
            schp_map=schp_map,
            output_dir=output_dir,
        )
        sam_path = os.path.join(output_dir, "03_sam_and_fashn.png")
        cv2.imwrite(sam_path, sam_refined_mask)

        sam_meta = {}
        if sampled_bg is not None:
            try:
                sam_meta["sampled_bg"] = [int(x) for x in sampled_bg]
            except (TypeError, ValueError):
                sam_meta["sampled_bg"] = str(sampled_bg)

        upload_and_record_step(seg_job_id, config_id, "sam2_refine", step_order,
                               "completed", sam_path, None,
                               sam_meta, started_at=step_start,
                               skip_upload=skip_intermediate_uploads)

        # ------------------------------------------------------------------
        # STEP 5: Post-Processing
        # ------------------------------------------------------------------
        step_order = 5
        step_start = datetime.utcnow().isoformat() + "Z"
        print(f"\n--- Step {step_order}: Post-Processing ---")
        if is_green_screen:
            sam2_only_alpha = cv2.bitwise_and(sam_refined_mask, foreground_mask)
        else:
            sam2_only_alpha = sam_refined_mask.copy()

        # Head/neck guided skin subtraction
        fashn_hn = extract_class_mask(seg_map, [1, 2, 16])
        schp_hn = np.zeros_like(schp_map, dtype=np.uint8) if schp_map is not None else None
        if schp_map is not None:
            for cid in [2, 13]:
                schp_hn[schp_map == cid] = 255
        head_neck_mask = np.maximum(fashn_hn, schp_hn) if schp_hn is not None else fashn_hn
        kernel_hn = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
        dilated_hn = cv2.dilate(head_neck_mask, kernel_hn)
        color_skin_guided = cv2.bitwise_and(color_skin_mask, dilated_hn)
        combined_exclusion = cv2.bitwise_or(parser_skin_mask, color_skin_guided)
        sam2_only_alpha[combined_exclusion > 127] = 0

        # Multi-component cleanup
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            (sam2_only_alpha > 127).astype(np.uint8), connectivity=8
        )
        if num_labels > 1:
            cleaned = np.zeros_like(sam2_only_alpha)
            for i in range(1, num_labels):
                if stats[i, cv2.CC_STAT_AREA] > 1000:
                    cleaned[labels == i] = 255
            sam2_only_alpha = cleaned

        sam2_only_alpha_binary = np.zeros_like(sam2_only_alpha)
        sam2_only_alpha_binary[sam2_only_alpha >= 128] = 255

        # Adaptive inpainting
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

        # Distance transform feathering
        dist = cv2.distanceTransform(sam2_only_alpha_binary, cv2.DIST_L2, 5)
        feather_width = 3.0
        alpha = np.clip((dist / feather_width) * 255.0, 0, 255).astype(np.uint8)

        # Boundary despill
        boundary_mask = (dist > 0) & (dist <= 5)
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

        if bg_sat > 30:
            spill_mask = boundary_mask & (dist_bg < 120)
        else:
            spill_mask = boundary_mask & (sat < 15) & (dist_bg < 120)

        alpha[spill_mask] = (alpha[spill_mask] * 0.3).astype(np.uint8)

        weight = np.clip(dist / feather_width, 0.0, 1.0)
        weight[spill_mask] = 0.0
        weight_3d = np.expand_dims(weight, axis=-1)
        blended_rgb = (weight_3d * img_rgb + (1.0 - weight_3d) * img_rgb_inpainted).astype(np.uint8)

        # Green despill
        blended_r = blended_rgb[:, :, 0].astype(np.float32)
        blended_g = blended_rgb[:, :, 1].astype(np.float32)
        blended_b = blended_rgb[:, :, 2].astype(np.float32)
        green_spill_pixels = boundary_mask & (blended_g > blended_r) & (blended_g > blended_b)
        blended_g[green_spill_pixels] = np.maximum(blended_r[green_spill_pixels], blended_b[green_spill_pixels])
        blended_rgb = np.dstack([blended_r, blended_g, blended_b]).astype(np.uint8)

        alpha_path = os.path.join(output_dir, "07b_sam2_alpha.png")
        cv2.imwrite(alpha_path, alpha)

        upload_and_record_step(seg_job_id, config_id, "post_process", step_order,
                               "completed", alpha_path, None,
                               {"feather_width": feather_width}, started_at=step_start,
                               skip_upload=skip_intermediate_uploads)

        # ------------------------------------------------------------------
        # STEP 6: Final RGBA Output
        # ------------------------------------------------------------------
        step_order = 6
        step_start = datetime.utcnow().isoformat() + "Z"
        print(f"\n--- Step {step_order}: Final RGBA Output ---")
        rgba = np.dstack([blended_rgb, alpha])
        final_path = os.path.join(output_dir, "09_final_garment.png")
        cv2.imwrite(final_path, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))

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
        checker_path = os.path.join(output_dir, "09_final_garment_checker.png")
        cv2.imwrite(checker_path, cv2.cvtColor(vis_bgr, cv2.COLOR_RGB2BGR))

        # Upload final image to storage
        final_url = supabase_client.upload_file_to_storage(
            final_path,
            f"segmentation/{seg_job_id}/final.png",
            "image/png",
        )
        supabase_client.upload_file_to_storage(
            checker_path,
            f"segmentation/{seg_job_id}/final_checker.png",
            "image/png",
        )

        upload_and_record_step(seg_job_id, config_id, "final_output", step_order,
                               "completed", final_path, None,
                               {"final_url": final_url}, started_at=step_start)

        # Update job as completed with final URL
        db_store.update_job_db_state(seg_job_id, "completed", final_image_url=final_url)
        db_store.update_parent_job_url(pipeline_job_id, final_url)

        return {
            "status": "completed",
            "final_image_path": final_path,
            "final_image_url": final_url
        }

    except Exception as e:
        import traceback
        err_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"[Pipeline Error] {err_msg}")
        
        # Try updating status to failed in DB
        try:
            db_store.update_job_db_state(seg_job_id, "failed", error=err_msg)
        except:
            pass
            
        return {
            "status": "failed",
            "error": err_msg
        }
