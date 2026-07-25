"""
Camera Registration Pipeline for Garment Compositing.

Recovers the global similarity transform (scale + rotation + translation)
between a Gemini-generated mannequin image and the clean avatar, then applies
that transform to the SAM2-segmented garment RGBA before compositing.

Uses LoFTR (dense transformer-based matcher via Kornia) for robust feature
matching on the textureless mannequin skin.

Pipeline:
  1. Standardize generated image to avatar canvas (1800x3072)
  2. Remove green background -> generated_avatar RGBA
  3. Extract skin masks for both avatars
  4. LoFTR dense matching on skin-masked regions
  5. estimateAffinePartial2D -> similarity matrix
  6. Warp garment RGBA with that matrix (garment_scale_multiplier = 1.03, garment_y_offset_percent = 0.007)
  7. Alpha-composite on clean avatar
"""

import os
import math
import json
import cv2
import numpy as np
import torch
from kornia.feature import LoFTR
from dataclasses import dataclass
from typing import Optional, Tuple, Dict, Any


@dataclass
class RegistrationResult:
    """Result of the avatar-to-avatar registration."""
    matrix: Optional[np.ndarray] = None       # 2x3 affine matrix
    scale: float = 1.0
    rotation_deg: float = 0.0
    translation: Tuple[float, float] = (0.0, 0.0)
    n_matches: int = 0
    n_inliers: int = 0
    inlier_ratio: float = 0.0
    mean_reproj_error: float = float('inf')
    accepted: bool = False
    rejection_reason: str = ""

    def summary(self) -> str:
        status = "ACCEPTED" if self.accepted else f"REJECTED ({self.rejection_reason})"
        return (
            f"Registration {status}\n"
            f"  Scale:        {self.scale:.4f}\n"
            f"  Rotation:     {self.rotation_deg:.2f} deg\n"
            f"  Translation:  ({self.translation[0]:.1f}, {self.translation[1]:.1f}) px\n"
            f"  Matches:      {self.n_matches}\n"
            f"  Inliers:      {self.n_inliers} ({self.inlier_ratio:.1%})\n"
            f"  Reproj Error: {self.mean_reproj_error:.2f} px"
        )


MIN_INLIERS = 10
MIN_INLIER_RATIO = 0.15
MAX_REPROJ_ERROR = 8.0
SCALE_RANGE = (0.5, 2.0)

_loftr_model = None

def _get_loftr():
    """Lazy-load LoFTR model (singleton)."""
    global _loftr_model
    if _loftr_model is None:
        print("  [LoFTR] Loading model...")
        _loftr_model = LoFTR(pretrained='outdoor')
        _loftr_model.eval()
        if torch.cuda.is_available():
            _loftr_model = _loftr_model.cuda()
            print("  [LoFTR] Using CUDA")
        else:
            print("  [LoFTR] Using CPU")
    return _loftr_model


def load_image(path: str) -> np.ndarray:
    """Load BGR or BGRA image from path safely."""
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Failed to read image at: {path}")
    return img


def standardize_to_canvas(
    image: np.ndarray,
    target_w: int = 1800,
    target_h: int = 3072
) -> np.ndarray:
    """
    Resize an image to fit the target canvas while preserving aspect ratio.
    The image is centered on the canvas with transparent padding if needed.
    """
    h, w = image.shape[:2]

    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        alpha = np.ones((h, w, 1), dtype=image.dtype) * 255
        image = np.concatenate([image, alpha], axis=2)

    scale = min(target_w / w, target_h / h)
    new_w = int(w * scale)
    new_h = int(h * scale)

    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    canvas = np.zeros((target_h, target_w, 4), dtype=np.uint8)
    y_offset = (target_h - new_h) // 2
    x_offset = (target_w - new_w) // 2
    canvas[y_offset:y_offset + new_h, x_offset:x_offset + new_w] = resized

    return canvas


def prepare_male_avatar(male_asset_path: str, target_w: int = 1800, target_h: int = 3072) -> np.ndarray:
    """Standardize and clean male mannequin avatar onto standard RGBA canvas."""
    male_raw = load_image(male_asset_path)
    male_std = standardize_to_canvas(male_raw, target_w, target_h)
    male_clean = remove_background(male_std)
    return male_clean


def remove_background(image: np.ndarray) -> np.ndarray:
    """Remove green chroma-key, solid white, or solid black background."""
    if image.shape[2] == 4:
        bgr = image[:, :, :3]
    else:
        bgr = image

    h_img, w_img = bgr.shape[:2]
    corners = [
        bgr[0, 0],
        bgr[0, w_img - 1],
        bgr[h_img - 1, 0],
        bgr[h_img - 1, w_img - 1]
    ]
    mean_corner = np.mean(corners, axis=0)
    corner_hsv = cv2.cvtColor(np.uint8([[mean_corner]]), cv2.COLOR_BGR2HSV)[0, 0]
    h, s, v = corner_hsv

    is_green = (30 <= h <= 90) and (s > 30) and (v > 30)
    is_white = (s < 30) and (v > 200)

    if is_green:
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        lower_green = np.array([30, 40, 40])
        upper_green = np.array([90, 255, 255])
        green_mask = cv2.inRange(hsv, lower_green, upper_green)
        fg_mask = cv2.bitwise_not(green_mask)
    elif is_white:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        _, fg_mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
    else:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        _, fg_mask = cv2.threshold(gray, 15, 255, cv2.THRESH_BINARY)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel, iterations=1)

    out = np.zeros((*bgr.shape[:2], 4), dtype=np.uint8)
    out[:, :, :3] = bgr
    out[:, :, 3] = fg_mask

    return out


def extract_skin_mask(image_bgra: np.ndarray) -> np.ndarray:
    """Isolate mannequin skin pixels using HSV thresholds for beige/peach skin."""
    bgr = image_bgra[:, :, :3]
    alpha = image_bgra[:, :, 3]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    lower_skin1 = np.array([0, 10, 80])
    upper_skin1 = np.array([25, 180, 255])

    lower_skin2 = np.array([160, 10, 80])
    upper_skin2 = np.array([180, 180, 255])

    mask1 = cv2.inRange(hsv, lower_skin1, upper_skin1)
    mask2 = cv2.inRange(hsv, lower_skin2, upper_skin2)
    skin_mask = cv2.bitwise_or(mask1, mask2)
    skin_mask = cv2.bitwise_and(skin_mask, alpha)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    return skin_mask


def extract_foreground_mask(image_bgra: np.ndarray) -> np.ndarray:
    """Extract visible foreground mask (alpha > 128)."""
    return image_bgra[:, :, 3]


def compute_registration(
    avatar_clean: np.ndarray,
    generated_avatar: np.ndarray,
    mask_clean: np.ndarray,
    mask_gen: np.ndarray
) -> RegistrationResult:
    """
    Find 2D similarity matrix (scale + rotation + translation) using LoFTR.
    Matches clean avatar to generated avatar in masked regions.
    """
    loftr = _get_loftr()

    gray_clean = cv2.cvtColor(avatar_clean[:, :, :3], cv2.COLOR_BGR2GRAY)
    gray_gen = cv2.cvtColor(generated_avatar[:, :, :3], cv2.COLOR_BGR2GRAY)

    masked_clean = cv2.bitwise_and(gray_clean, mask_clean)
    masked_gen = cv2.bitwise_and(gray_gen, mask_gen)

    h, w = gray_clean.shape[:2]
    scale_factor = 840.0 / max(h, w)
    new_w = int(w * scale_factor)
    new_h = int(h * scale_factor)

    new_w = (new_w // 8) * 8
    new_h = (new_h // 8) * 8

    img0_small = cv2.resize(masked_clean, (new_w, new_h))
    img1_small = cv2.resize(masked_gen, (new_w, new_h))

    t0 = torch.from_numpy(img0_small).float() / 255.0
    t1 = torch.from_numpy(img1_small).float() / 255.0
    t0 = t0.unsqueeze(0).unsqueeze(0)
    t1 = t1.unsqueeze(0).unsqueeze(0)

    if torch.cuda.is_available():
        t0, t1 = t0.cuda(), t1.cuda()

    with torch.no_grad():
        correspondences = loftr({'image0': t0, 'image1': t1})

    mkpts0 = correspondences['keypoints0'].cpu().numpy()
    mkpts1 = correspondences['keypoints1'].cpu().numpy()
    confidence = correspondences['confidence'].cpu().numpy()

    conf_mask = confidence > 0.5
    mkpts0 = mkpts0[conf_mask]
    mkpts1 = mkpts1[conf_mask]
    n_matches = len(mkpts0)

    if n_matches < 4:
        conf_mask = confidence > 0.3
        mkpts0 = correspondences['keypoints0'].cpu().numpy()[conf_mask]
        mkpts1 = correspondences['keypoints1'].cpu().numpy()[conf_mask]
        n_matches = len(mkpts0)

    if n_matches < 4:
        return RegistrationResult(accepted=False, rejection_reason="Too few matches found")

    sx = w / new_w
    sy = h / new_h
    pts0 = mkpts0 * np.array([sx, sy])
    pts1 = mkpts1 * np.array([sx, sy])

    matrix, inliers = cv2.estimateAffinePartial2D(
        pts1, pts0,
        method=cv2.RANSAC,
        ransacReprojThreshold=5.0,
        maxIters=2000,
        confidence=0.99
    )

    if matrix is None:
        return RegistrationResult(n_matches=n_matches, accepted=False, rejection_reason="RANSAC failed")

    inliers_mask = (inliers.ravel() == 1) if inliers is not None else np.zeros(n_matches, dtype=bool)
    n_inliers = int(np.sum(inliers_mask))
    inlier_ratio = n_inliers / n_matches if n_matches > 0 else 0.0

    if n_inliers > 0:
        pts1_in = pts1[inliers_mask]
        pts0_in = pts0[inliers_mask]
        pts1_h = np.hstack([pts1_in, np.ones((n_inliers, 1))])
        pts0_proj = (matrix @ pts1_h.T).T
        reproj_errors = np.linalg.norm(pts0_proj - pts0_in, axis=1)
        mean_reproj_error = float(np.mean(reproj_errors))
    else:
        mean_reproj_error = float('inf')

    scale = float(np.sqrt(matrix[0, 0]**2 + matrix[1, 0]**2))
    rotation_deg = float(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0])))
    translation = (float(matrix[0, 2]), float(matrix[1, 2]))

    accepted = True
    rejection_reason = ""

    if n_inliers < MIN_INLIERS:
        accepted = False
        rejection_reason = f"Too few inliers ({n_inliers} < {MIN_INLIERS})"
    elif inlier_ratio < MIN_INLIER_RATIO:
        accepted = False
        rejection_reason = f"Low inlier ratio ({inlier_ratio:.1%} < {MIN_INLIER_RATIO:.0%})"
    elif mean_reproj_error > MAX_REPROJ_ERROR:
        accepted = False
        rejection_reason = f"High reproj error ({mean_reproj_error:.1f} > {MAX_REPROJ_ERROR})"

    return RegistrationResult(
        matrix=matrix,
        scale=scale,
        rotation_deg=rotation_deg,
        translation=translation,
        n_matches=n_matches,
        n_inliers=n_inliers,
        inlier_ratio=inlier_ratio,
        mean_reproj_error=mean_reproj_error,
        accepted=accepted,
        rejection_reason=rejection_reason
    )


def select_best_mannequin(
    generated_avatar: np.ndarray,
    candidate_mannequins: Dict[str, np.ndarray]
) -> Tuple[str, np.ndarray, RegistrationResult, Dict[str, Any]]:
    """
    Runs LoFTR registration against candidate mannequin avatars (Female vs Male)
    and picks the winner based on inliers, ratio, and reprojection error.
    """
    scores = {}
    best_name = None
    best_avatar = None
    best_result = None
    max_score = -1.0

    gen_skin = extract_skin_mask(generated_avatar)
    gen_fg = extract_foreground_mask(generated_avatar)

    for name, candidate_avatar in candidate_mannequins.items():
        cand_skin = extract_skin_mask(candidate_avatar)

        reg_result = compute_registration(candidate_avatar, generated_avatar, cand_skin, gen_skin)

        if not reg_result.accepted:
            cand_fg = extract_foreground_mask(candidate_avatar)
            reg_result = compute_registration(candidate_avatar, generated_avatar, cand_fg, gen_fg)

        score = (reg_result.n_inliers * reg_result.inlier_ratio) if reg_result.accepted else 0.0
        scores[name] = {
            "score": score,
            "inliers": reg_result.n_inliers,
            "inlier_ratio": reg_result.inlier_ratio,
            "accepted": reg_result.accepted,
            "scale": reg_result.scale,
        }

        if score > max_score:
            max_score = score
            best_name = name
            best_avatar = candidate_avatar
            best_result = reg_result

    if best_name is None:
        first_name = list(candidate_mannequins.keys())[0]
        best_name = first_name
        best_avatar = candidate_mannequins[first_name]
        best_result = RegistrationResult(accepted=False, rejection_reason="No candidate accepted")

    return best_name, best_avatar, best_result, scores


def warp_garment(
    garment_rgba: np.ndarray,
    matrix: np.ndarray,
    target_size: Tuple[int, int],
    scale_multiplier: float = 1.03,
    y_offset_percent: float = 0.007
) -> np.ndarray:
    """Warp garment RGBA with affine matrix, applying 1.03x scale and 0.7% Y-offset down."""
    w, h = target_size
    warp_m = matrix.copy() if matrix is not None else np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float64)

    if scale_multiplier != 1.0 and matrix is not None:
        k = scale_multiplier
        cx, cy = w / 2.0, h / 2.0
        warp_m[0, 0] *= k
        warp_m[0, 1] *= k
        warp_m[0, 2] = k * matrix[0, 2] + cx * (1.0 - k)
        warp_m[1, 0] *= k
        warp_m[1, 1] *= k
        warp_m[1, 2] = k * matrix[1, 2] + cy * (1.0 - k)

    if y_offset_percent != 0.0:
        y_shift = h * y_offset_percent
        warp_m[1, 2] += y_shift

    warped = cv2.warpAffine(
        garment_rgba,
        warp_m,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0)
    )
    return warped


def alpha_composite(avatar_bgra: np.ndarray, garment_warped_bgra: np.ndarray) -> np.ndarray:
    """Alpha blend warped garment over avatar canvas."""
    avatar = avatar_bgra.astype(np.float32)
    garment = garment_warped_bgra.astype(np.float32)

    alpha_g = garment[:, :, 3:4] / 255.0
    alpha_a = avatar[:, :, 3:4] / 255.0

    out_rgb = garment[:, :, :3] * alpha_g + avatar[:, :, :3] * (1.0 - alpha_g)
    out_alpha = np.maximum(alpha_g, alpha_a) * 255.0

    out = np.dstack([out_rgb, out_alpha]).astype(np.uint8)
    return out
