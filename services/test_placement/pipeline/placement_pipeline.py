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
    SCALE_RANGE,
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


GARMENT_SCALE_MULTIPLIER = 1.01
GARMENT_Y_OFFSET_PERCENT = 0.0035


def apply_garment_calibration(matrix: np.ndarray, w_av: int, h_av: int) -> np.ndarray:
    """
    Apply the fixed garment scale + Y nudge about the canvas centre.

    Kept in one place because it has to match `warp_garment`'s internal maths exactly -- the exported
    transform must describe the pixels that were actually composited, not the pre-warp matrix.
    """
    out = matrix.copy()
    k = GARMENT_SCALE_MULTIPLIER
    cx, cy = w_av / 2.0, h_av / 2.0
    if k != 1.0:
        out[0, 0] *= k
        out[0, 1] *= k
        out[0, 2] = k * matrix[0, 2] + cx * (1.0 - k)
        out[1, 0] *= k
        out[1, 1] *= k
        out[1, 2] = k * matrix[1, 2] + cy * (1.0 - k)
    if GARMENT_Y_OFFSET_PERCENT != 0.0:
        out[1, 2] += h_av * GARMENT_Y_OFFSET_PERCENT
    return out


def editor_transform_from(
    reg_matrix: np.ndarray,
    garment_rgba: np.ndarray,
    w_av: int,
    h_av: int,
) -> Dict[str, float]:
    """
    Decompose a REGISTRATION matrix into the mesh editor's {scale, rotationDeg, tx, ty}.

    Both sides live in the same 1800x3072 standardize_to_canvas space and the matrix is a similarity,
    so it decomposes cleanly. Translation is expressed relative to the garment's alpha-bbox centre
    ("home"), which is the editor's own origin convention.

    Note the calibration is applied TWICE, and that is deliberate: the pipeline calibrates the matrix
    before handing it to `warp_garment`, and `warp_garment` then applies its own identical defaults
    (scale_multiplier=1.01, y_offset_percent=0.0035) on top. The effective values in the composited
    pixels are therefore 1.01^2 and 0.007 -- so the exported transform has to match that, or the mesh
    editor would reopen a garment slightly off from where it was actually drawn.
    """
    eff = apply_garment_calibration(apply_garment_calibration(reg_matrix, w_av, h_av), w_av, h_av)
    cx, cy = w_av / 2.0, h_av / 2.0

    ys, xs = np.where(garment_rgba[:, :, 3] > 0)
    if xs.size and ys.size:
        home_x = float((int(xs.min()) + int(xs.max())) / 2.0)
        home_y = float((int(ys.min()) + int(ys.max())) / 2.0)
    else:
        home_x, home_y = cx, cy

    placed_x = eff[0, 0] * home_x + eff[0, 1] * home_y + eff[0, 2]
    placed_y = eff[1, 0] * home_x + eff[1, 1] * home_y + eff[1, 2]
    return {
        "scale": float(np.hypot(eff[0, 0], eff[1, 0])),
        "rotationDeg": float(np.degrees(np.arctan2(eff[1, 0], eff[0, 0]))),
        "tx": float(placed_x - home_x),
        "ty": float(placed_y - home_y),
    }


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

        best_name, best_avatar, best_reg, scores, all_regs = select_best_mannequin(gen_avatar, candidates)

        if best_reg.matrix is not None:
            warp_matrix = apply_garment_calibration(best_reg.matrix, w_av, h_av)
        else:
            warp_matrix = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float64)

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

        # --- Editor-space transform export ---------------------------------------------------
        # So the mesh editor (PlacementMeshEditor.tsx) can reconstruct this exact auto-placement
        # instead of defaulting the garment to canvas-centre.
        editor_transform = editor_transform_from(best_reg.matrix, garment_rgba, w_av, h_av) \
            if best_reg.matrix is not None else None

        # Every mannequin this garment registered against acceptably, not just the winner.
        #
        # Both registrations always ran -- select_best_mannequin loops over Female and Male -- so this
        # costs nothing extra and is what lets the studio show a user THEIR OWN body instead of
        # whichever mannequin the garment happened to score best against. A unisex top registers
        # against both, so both entries get stored and either user sees themselves.
        #
        # The loser is a real registration, not a guess, but it scored lower -- so it has to clear the
        # same acceptance bar as the winner before being persisted. Where it does not, only one entry
        # is returned and behaviour is exactly as it was.
        transforms: Dict[str, Dict[str, float]] = {}

        # The winner always goes in, accepted or not, so `transforms` is a strict superset of
        # `transform`. Gating it would be a regression: today the winner is persisted regardless of
        # `accepted`, and an empty `transforms` would leave the caller with nothing to write.
        if editor_transform is not None:
            transforms[best_name] = editor_transform

        for name, reg in all_regs.items():
            if name == best_name or reg.matrix is None:
                continue
            # `accepted` covers inliers, inlier ratio and reprojection error, but NOT scale -- so
            # check the scale band too. A runner-up that squeaks past the match quality bar with an
            # implausible scale would place the garment at the wrong size on that mannequin.
            if not reg.accepted:
                print(f"  [Skip] {name}: {reg.rejection_reason}")
                continue
            if not (SCALE_RANGE[0] <= reg.scale <= SCALE_RANGE[1]):
                print(f"  [Skip] {name}: scale {reg.scale:.3f} outside {SCALE_RANGE}")
                continue
            transforms[name] = editor_transform_from(reg.matrix, garment_rgba, w_av, h_av)

        print(f"   -> Transforms stored for: {', '.join(transforms.keys()) or 'none'}")

        return {
            "status": "completed",
            "pipeline_job_id": pipeline_job_id,
            "selected_mannequin": best_name,
            "final_image_url": final_url,
            "scale": float(best_reg.scale),
            "inliers": int(best_reg.n_inliers),
            "scores": scores,
            # Consumed by placement.handler.ts -> persisted so the mesh editor reconstructs placement.
            # Unchanged on purpose: usePlacementImage.ts, the mesh editor and the backfill read it.
            "transform": editor_transform,
            # Keyed by mannequin name ("Female" / "Male"). Superset of `transform`.
            "transforms": transforms,
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
