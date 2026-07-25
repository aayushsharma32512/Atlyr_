import os
import sys
import cv2
import urllib.request
import numpy as np
from datetime import datetime
from typing import Dict, Any

current_dir = os.path.dirname(os.path.abspath(__file__))
base_dir = os.path.dirname(current_dir)
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from .camera_registration import (
    load_image,
    standardize_to_canvas,
    remove_background,
    select_best_mannequin,
    warp_garment,
    alpha_composite,
    prepare_male_avatar,
)
from . import supabase_client
from . import db_store
from .types import PlacementResult


def download_image_from_url(url: str) -> np.ndarray:
    """Download image bytes from HTTP/HTTPS URL into OpenCV array."""
    req = urllib.request.urlopen(url)
    arr = np.asarray(bytearray(req.read()), dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Failed to decode image from URL: {url}")
    return img


def run_placement_pipeline_e2e(
    pipeline_job_id: str,
    segmented_image_url: str = None,
    vton_image_url: str = None,
    output_dir: str = "/tmp/placement_output"
) -> Dict[str, Any]:
    """
    End-to-End production placement pipeline execution.

    1. Fetches job details from DB if URLs are not passed directly.
    2. Downloads input segmented_garment RGBA & vton_image.
    3. Runs LoFTR feature matching to select Female vs Male mannequin.
    4. Computes 2x3 affine matrix with scale (1.03x) & Y-offset (0.7% / +21.5px down).
    5. Warps garment & refines alpha boundary edge feathering.
    6. Alpha composites warped garment onto winning mannequin.
    7. Uploads composite output to Supabase Storage ('placement/{pipeline_job_id}/final.png').
    8. Updates public.ingestion_pipeline_jobs DB state to 'completed'.
    """
    print(f"\n======================================================================")
    print(f"  PRODUCTION PLACEMENT PIPELINE: Job ID = {pipeline_job_id}")
    print(f"======================================================================")

    os.makedirs(output_dir, exist_ok=True)

    try:
        if not segmented_image_url or not vton_image_url:
            print(f"  [DB] Fetching job details for job_id: {pipeline_job_id}...")
            job = db_store.fetch_job(pipeline_job_id)
            segmented_image_url = segmented_image_url or job.get("segmented_image_url")
            vton_image_url = vton_image_url or job.get("vton_image_url")

        if not segmented_image_url or not vton_image_url:
            raise ValueError("Missing required segmented_image_url or vton_image_url for placement")

        print(f"  [Download] Fetching vton_image from: {vton_image_url}")
        vton_raw = download_image_from_url(vton_image_url)

        print(f"  [Download] Fetching segmented_garment from: {segmented_image_url}")
        garment_raw = download_image_from_url(segmented_image_url)

        female_path = os.path.join(base_dir, "assets", "avatar_clean.png")
        if not os.path.exists(female_path):
            female_path = os.path.join(base_dir, "assets", "mannequins", "avatar_clean.png")

        male_path = os.path.join(base_dir, "assets", "male_asset.jpg.jpeg")
        if not os.path.exists(male_path):
            male_path = os.path.join(base_dir, "assets", "mannequins", "male_asset.jpg.jpeg")

        female_avatar = load_image(female_path)
        h_av, w_av = female_avatar.shape[:2]
        male_avatar = prepare_male_avatar(male_path, w_av, h_av)

        candidates = {
            "Female": female_avatar,
            "Male": male_avatar,
        }

        std_gen = standardize_to_canvas(vton_raw, w_av, h_av)
        gen_avatar = remove_background(std_gen)
        garment_rgba = standardize_to_canvas(garment_raw, w_av, h_av)

        best_name, best_avatar, best_reg, scores = select_best_mannequin(gen_avatar, candidates)

        warp_matrix = best_reg.matrix.copy() if best_reg.matrix is not None else np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float64)

        garment_scale_multiplier = 1.03
        garment_y_offset_percent = 0.007

        if garment_scale_multiplier != 1.0 and best_reg.matrix is not None:
            k = garment_scale_multiplier
            cx, cy = w_av / 2.0, h_av / 2.0
            warp_matrix[0, 0] *= k
            warp_matrix[0, 1] *= k
            warp_matrix[0, 2] = k * best_reg.matrix[0, 2] + cx * (1.0 - k)
            warp_matrix[1, 0] *= k
            warp_matrix[1, 1] *= k
            warp_matrix[1, 2] = k * best_reg.matrix[1, 2] + cy * (1.0 - k)

        if garment_y_offset_percent != 0.0:
            y_shift = h_av * garment_y_offset_percent
            warp_matrix[1, 2] += y_shift

        garment_warped = warp_garment(garment_rgba, warp_matrix, (w_av, h_av))
        alpha = garment_warped[:, :, 3]
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        eroded_alpha = cv2.erode(alpha, kernel)
        smoothed_alpha = cv2.GaussianBlur(eroded_alpha, (3, 3), 0)
        garment_warped[:, :, 3] = smoothed_alpha

        composite = alpha_composite(best_avatar, garment_warped)

        out_path = os.path.join(output_dir, f"{pipeline_job_id}_final.png")
        cv2.imwrite(out_path, composite)

        storage_path = f"placement/{pipeline_job_id}/final.png"
        final_url = supabase_client.upload_file_to_storage(out_path, storage_path, "image/png")

        db_store.update_job_placement_result(pipeline_job_id, state="completed", placement_url=final_url)

        print(f"  [OK] Placement completed for job {pipeline_job_id}!")
        print(f"   -> Selected Mannequin: {best_name}")
        print(f"   -> Final Image URL:    {final_url}\n")

        return {
            "status": "completed",
            "pipeline_job_id": pipeline_job_id,
            "selected_mannequin": best_name,
            "final_image_url": final_url,
            "scale": float(best_reg.scale),
            "inliers": int(best_reg.n_inliers),
            "scores": scores,
        }

    except Exception as e:
        import traceback
        err_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"  [Pipeline Error] {err_msg}")
        try:
            db_store.update_job_placement_result(pipeline_job_id, state="failed", error=err_msg)
        except Exception as db_err:
            print(f"  [Warning] Failed updating DB error status: {db_err}")

        return {
            "status": "failed",
            "pipeline_job_id": pipeline_job_id,
            "error": err_msg
        }
