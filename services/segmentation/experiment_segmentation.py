"""
Experiment 1: FASHN Human Parser — Garment Segmentation + Neck Clipping + SAM2 Refinement

Usage:
    python experiment_segmentation.py <image_path> [--output-dir ./output]

What this tests:
    1. FASHN Human Parser (SegFormer-B4) — 18-class body/clothing segmentation
    2. GroundingDINO + SAM2 BBox Prompted Refinement (with 8% padding)
    3. Category-Aware Morphological Closing + Debris Filter
    4. Head/neck mask subtraction & collar Bézier clipping
    5. Trapped background hole detection & border stripping
    6. Edge-preserved Gaussian feathering & boundary de-spill matting
    7. Clean garment RGBA extraction
"""

import argparse
import os
import sys
import time
import numpy as np
from PIL import Image
import cv2
from scipy.interpolate import splprep, splev
from scipy import ndimage
import torch
import torchvision
import requests
import io
from pathlib import Path
from typing import Optional, Union, Tuple, List, Set

# ── FASHN Human Parser class labels (18 classes) ──
# Actual mapping from FashnHumanParser.get_labels():
# 0: background, 1: face, 2: hair, 3: top, 4: dress, 5: skirt,
# 6: pants, 7: belt, 8: bag, 9: hat, 10: scarf, 11: glasses,
# 12: arms, 13: hands, 14: legs, 15: feet, 16: torso, 17: jewelry

GARMENT_CLASSES = {
    'top': [3],
    'dress': [4],
    'skirt': [5],
    'pants': [6],
    'footwear': [15],
}

HEAD_NECK_CLASSES = [1, 2]  # Face, Hair
OCCLUSION_CLASSES = [2, 8, 12, 13]  # Hair, Bag, Arms, Hands

# Colormap for visualization (class_id → RGB)
SEGMENTATION_COLORS = {
    0: (0, 0, 0),        # Background
    1: (255, 220, 180),  # Face
    2: (139, 69, 19),    # Hair
    3: (255, 0, 0),      # Top
    4: (255, 0, 255),    # Dress
    5: (255, 128, 0),    # Skirt
    6: (0, 128, 255),    # Pants
    7: (128, 128, 0),    # Belt
    8: (0, 200, 200),    # Bag
    9: (255, 200, 0),    # Hat
    10: (200, 200, 0),   # Scarf
    11: (0, 255, 255),   # Glasses
    12: (200, 180, 255), # Arms
    13: (200, 150, 150), # Hands
    14: (150, 150, 200), # Legs
    15: (100, 100, 100), # Feet
    16: (255, 200, 200), # Torso (skin)
    17: (150, 150, 150), # Jewelry
}

# ── GroundingDINO token configuration ──
GDINO_MODEL_ID = "IDEA-Research/grounding-dino-base"
BASE_GDINO_TOKENS = {
    "top": {
        "primary":   ["shirt", "top", "blouse", "jacket", "coat", "sweater",
                      "hoodie", "vest", "cardigan", "blazer", "tshirt", "tee",
                      "tunic", "polo", "pullover", "sweatshirt", "cape", "poncho",
                      "halter", "strap"],
        "accessory": ["belt", "scarf", "collar"],
    },
    "pants": {
        "primary":   ["pants", "jeans", "trousers", "skirt", "shorts",
                      "leggings", "culottes", "chinos", "palazzos", "joggers"],
        "accessory": ["belt"],
    },
    "skirt": {
        "primary":   ["skirt"],
        "accessory": ["belt"],
    },
    "dress": {
        "primary":   ["dress", "gown", "frock", "jumpsuit", "romper", "playsuit"],
        "accessory": ["belt", "sash"],
    },
    "footwear": {
        "primary":   ["shoe", "boot", "sneaker", "heel", "sandal", "loafer",
                      "oxford", "pump", "mule", "clog", "slipper", "wedge"],
        "accessory": [],
    },
}


SAM_CHECKPOINTS = {
    "sam2_large": (
        "sam2.1_hiera_large.pt",
        "configs/sam2.1/sam2.1_hiera_l.yaml",
        "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt",
    ),
    "sam2_base_plus": (
        "sam2.1_hiera_base_plus.pt",
        "configs/sam2.1/sam2.1_hiera_b+.yaml",
        "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt",
    ),
    "sam2_small": (
        "sam2.1_hiera_small.pt",
        "configs/sam2.1/sam2.1_hiera_s.yaml",
        "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt",
    ),
    "sam2_tiny": (
        "sam2.1_hiera_tiny.pt",
        "configs/sam2.1/sam2.1_hiera_t.yaml",
        "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt",
    ),
    "vit_h": (
        "sam_vit_h_4b8939.pth",
        "vit_h",
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
    )
}
SAM_CACHE_DIR = Path.home() / ".cache" / "sam"

# ── Helper functions ──

def colorize_segmentation(seg_map: np.ndarray) -> np.ndarray:
    """Convert class-id segmentation map to RGB visualization."""
    h, w = seg_map.shape
    colored = np.zeros((h, w, 3), dtype=np.uint8)
    for class_id, color in SEGMENTATION_COLORS.items():
        colored[seg_map == class_id] = color
    return colored


def extract_class_mask(seg_map: np.ndarray, class_ids: list) -> np.ndarray:
    """Extract binary mask for given class IDs."""
    mask = np.zeros_like(seg_map, dtype=np.uint8)
    for cid in class_ids:
        mask[seg_map == cid] = 255
    return mask


def find_collar_points(garment_mask: np.ndarray, head_neck_mask: np.ndarray):
    """Find the left and right collar intersection points."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    dilated_neck = cv2.dilate(head_neck_mask, kernel, iterations=1)
    overlap = cv2.bitwise_and(garment_mask, dilated_neck)
    if overlap.sum() == 0:
        return None, None
    contours, _ = cv2.findContours(overlap, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None
    all_points = np.vstack(contours).squeeze()
    if all_points.ndim == 1:
        return None, None
    left_idx = np.argmin(all_points[:, 0])
    right_idx = np.argmax(all_points[:, 0])
    return tuple(all_points[left_idx]), tuple(all_points[right_idx])


def bezier_neck_clip(garment_mask: np.ndarray, head_neck_mask: np.ndarray,
                      collar_depth_ratio: float = 0.03) -> np.ndarray:
    """Clip back-neck collar using a quadratic Bézier curve."""
    clipped = garment_mask.copy()
    h, w = garment_mask.shape
    left_pt, right_pt = find_collar_points(garment_mask, head_neck_mask)
    if left_pt is None or right_pt is None:
        print("  [Warning] Could not find collar points, skipping neck clip")
        return clipped

    collar_depth_px = int(h * collar_depth_ratio)
    mid_x = (left_pt[0] + right_pt[0]) // 2
    mid_y = min(left_pt[1], right_pt[1]) + collar_depth_px

    t = np.linspace(0, 1, 200)
    P0 = np.array(left_pt, dtype=float)
    P1 = np.array([mid_x, mid_y], dtype=float)
    P2 = np.array(right_pt, dtype=float)

    curve_x = ((1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t ** 2 * P2[0]).astype(int)
    curve_y = ((1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t ** 2 * P2[1]).astype(int)

    for cx, cy in zip(curve_x, curve_y):
        if 0 <= cx < w and 0 <= cy < h:
            clipped[0:cy, cx] = 0

    top_boundary = min(left_pt[1], right_pt[1]) - collar_depth_px
    if top_boundary > 0:
        above_zone = clipped[0:top_boundary, left_pt[0]:right_pt[0]]
        if above_zone.sum() > 0:
            clipped[0:top_boundary, left_pt[0]:right_pt[0]] = 0
    return clipped


def detect_occlusions(seg_map: np.ndarray, garment_mask: np.ndarray) -> np.ndarray:
    """Detect areas where hair/arms overlap the garment using closing."""
    occlusion_raw = extract_class_mask(seg_map, OCCLUSION_CLASSES)
    face_mask = extract_class_mask(seg_map, [1])
    torso_skin = extract_class_mask(seg_map, [16])
    base_blob = cv2.bitwise_or(cv2.bitwise_or(garment_mask, face_mask), torso_skin)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (151, 151))
    closed = cv2.morphologyEx(base_blob, cv2.MORPH_CLOSE, kernel)
    missing = cv2.subtract(closed, base_blob)
    return cv2.bitwise_and(missing, occlusion_raw)


# ── Background Sampling & Post-Processing ──

def sample_background_color(image: np.ndarray, corner_size: int = 20) -> np.ndarray:
    """Sample the dominant background color from the 4 corners of the image (RGB)."""
    h, w = image.shape[:2]
    corners = np.concatenate([
        image[:corner_size, :corner_size].reshape(-1, 3),
        image[:corner_size, -corner_size:].reshape(-1, 3),
        image[-corner_size:, :corner_size].reshape(-1, 3),
        image[-corner_size:, -corner_size:].reshape(-1, 3)
    ], axis=0)
    return corners.mean(axis=0)


def sample_background_color_local(image: np.ndarray, mask: np.ndarray, sample_band_px: int = 8, corner_size: int = 20) -> np.ndarray:
    """Sample background color from pixels just OUTSIDE the garment mask boundary.
    Falls back to corner sampling if not enough boundary pixels found.
    """
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (sample_band_px * 2 + 1, sample_band_px * 2 + 1)
    )
    dilated = cv2.dilate(mask, kernel, iterations=1)
    ring = (dilated > 127) & (mask < 128)

    if ring.sum() < 50:
        return sample_background_color(image, corner_size)

    boundary_pixels = image[ring]
    return boundary_pixels.mean(axis=0)


def _texture_aware_alpha_tighten(alpha_arr: np.ndarray, image_rgb: np.ndarray, texture_threshold: float = 12.0) -> np.ndarray:
    """In the semi-transparent boundary zone, force high-texture
    pixels (scalloped lace, embroidery) to fully opaque.
    High local std = fabric detail, not transparency transition.
    """
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    local_mean = cv2.GaussianBlur(gray, (9, 9), 0)
    local_sq_mean = cv2.GaussianBlur(gray ** 2, (9, 9), 0)
    local_var = local_sq_mean - local_mean ** 2
    local_std = np.sqrt(np.maximum(local_var, 0))

    # Semi-transparent zone: alpha between 10 and 240
    semi_zone = (alpha_arr > 10) & (alpha_arr < 240)
    high_texture = local_std > texture_threshold

    out = alpha_arr.copy()
    force_fg = semi_zone & high_texture
    out[force_fg] = 255
    return out



def _ensure_sam_checkpoint(variant: str) -> Optional[Path]:
    """Download SAM/SAM2 checkpoint to ~/.cache/sam/ if not present."""
    ckpt_name, _, url = SAM_CHECKPOINTS[variant]
    ckpt_path = SAM_CACHE_DIR / ckpt_name
    if ckpt_path.exists():
        return ckpt_path
    SAM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"  [Info] Downloading checkpoint ({variant}) from Meta...")
    try:
        with requests.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(ckpt_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
        return ckpt_path
    except Exception as exc:
        print(f"\n  [Error] Download failed: {exc}")
        if ckpt_path.exists():
            ckpt_path.unlink()
        return None


_SAM2_PREDICTOR_CACHE = {}
_SAM_PREDICTOR_CACHE = {}

def _load_sam2_predictor(variant: str, img_array: np.ndarray):
    """Load SAM2, call set_image, return predictor."""
    global _SAM2_PREDICTOR_CACHE
    if variant in _SAM2_PREDICTOR_CACHE:
        predictor = _SAM2_PREDICTOR_CACHE[variant]
        predictor.set_image(img_array)
        return predictor

    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    ckpt_path = _ensure_sam_checkpoint(variant)
    if ckpt_path is None:
        raise RuntimeError(f"SAM2 checkpoint unavailable: {variant}")
    _, model_cfg, _ = SAM_CHECKPOINTS[variant]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sam2 = build_sam2(model_cfg, str(ckpt_path), device=device)
    predictor = SAM2ImagePredictor(sam2)
    predictor.set_image(img_array)
    
    _SAM2_PREDICTOR_CACHE[variant] = predictor
    return predictor


def _select_best_mask_by_iou(masks: np.ndarray, coarse_mask: np.ndarray) -> np.ndarray:
    """Select the mask that has the highest Intersection-over-Union (IoU) with the coarse mask."""
    coarse_bool = coarse_mask > 127
    best_mask = masks[0]
    best_iou = -1.0
    for m in masks:
        inter = np.logical_and(m, coarse_bool).sum()
        union = np.logical_or(m, coarse_bool).sum()
        iou = inter / union if union > 0 else 0.0
        if iou > best_iou:
            best_iou = iou
            best_mask = m
    print(f"  [SAM] Selected mask by IoU vs coarse: {best_iou:.3f}")
    return (best_mask * 255).astype(np.uint8)


def _build_prompt_points(mask_array: np.ndarray, exclusion_mask: np.ndarray, img_h: int, img_w: int):
    """Derive positive/negative SAM prompt points from coarse mask and exclusion mask."""
    ys, xs = np.where(mask_array > 127)
    if len(xs) == 0:
        return None, None

    # Sample positive points directly from actual mask coordinates to guarantee they are inside
    # We select 5 points evenly spread across the coordinate arrays
    indices = np.linspace(0, len(xs) - 1, 5, dtype=int)
    pos_points = []
    for idx in indices:
        pos_points.append([int(xs[idx]), int(ys[idx])])

    neg_points = [
        [10, 10], [img_w - 10, 10],
        [10, img_h - 10], [img_w - 10, img_h - 10],
    ]
    
    # Sample negative points from FASHN exclusion mask (arms, legs, skin, hair, etc.)
    ys_excl, xs_excl = np.where(exclusion_mask > 127)
    if len(xs_excl) > 0:
        # Sample 6 points evenly spread across the exclusion mask
        indices = np.linspace(0, len(xs_excl) - 1, 6, dtype=int)
        for idx in indices:
            nx, ny = int(xs_excl[idx]), int(ys_excl[idx])
            # Only add negative point if it does not fall inside the coarse garment mask!
            if mask_array[ny, nx] == 0:
                neg_points.append([nx, ny])
            
    point_coords = np.array(pos_points + neg_points)
    point_labels = np.array([1] * len(pos_points) + [0] * len(neg_points))
    return point_coords, point_labels


def _sam2_point_mask(predictor, point_coords: np.ndarray, point_labels: np.ndarray, coarse_mask: np.ndarray) -> np.ndarray:
    """Run SAM2 with point prompts. Returns best mask selected by IoU against coarse mask."""
    import torch
    with torch.inference_mode():
        masks, scores, _ = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )
    return _select_best_mask_by_iou(masks, coarse_mask)


def _load_sam_v1_predictor(variant: str, img_array: np.ndarray):
    """Load SAM v1 fallback predictor."""
    global _SAM_PREDICTOR_CACHE
    if variant in _SAM_PREDICTOR_CACHE:
        predictor = _SAM_PREDICTOR_CACHE[variant]
        predictor.set_image(img_array)
        return predictor

    from segment_anything import sam_model_registry, SamPredictor
    ckpt_path = _ensure_sam_checkpoint(variant)
    if ckpt_path is None:
        raise RuntimeError(f"SAM v1 checkpoint unavailable: {variant}")
    _, model_type, _ = SAM_CHECKPOINTS[variant]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sam = sam_model_registry[model_type](checkpoint=str(ckpt_path))
    sam.to(device=device)
    predictor = SamPredictor(sam)
    predictor.set_image(img_array)
    
    _SAM_PREDICTOR_CACHE[variant] = predictor
    return predictor


def _sam_v1_point_mask(predictor, point_coords: np.ndarray, point_labels: np.ndarray, coarse_mask: np.ndarray) -> np.ndarray:
    """Run SAM v1 with point prompts. Returns best mask selected by IoU against coarse mask."""
    import torch
    with torch.inference_mode():
        masks, scores, _ = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )
    return _select_best_mask_by_iou(masks, coarse_mask)


def _detect_trapped_bg_holes(
    mask_arr: np.ndarray,
    image_arr: np.ndarray,
    bg_color: np.ndarray,
    color_tolerance: float = 30.0,
    min_hole_px: int = 300,
) -> Optional[np.ndarray]:
    """Find background-colored interior gaps (e.g. neck voids)."""
    bg_region = mask_arr < 128
    labeled, n = ndimage.label(bg_region)
    if n == 0:
        return None
    h, w = mask_arr.shape
    trapped = np.zeros((h, w), dtype=bool)
    found = 0
    img_f = image_arr.astype(float)
    for cid in range(1, n + 1):
        comp = labeled == cid
        px = int(comp.sum())
        if px < min_hole_px:
            continue
        diff = np.abs(img_f[comp] - bg_color)
        bg_frac = (diff.max(axis=1) < color_tolerance).mean()
        if bg_frac < 0.60:
            continue
        border = (comp[0, :].any() or comp[-1, :].any() or comp[:, 0].any() or comp[:, -1].any())
        if border:
            continue
        trapped |= comp
        found += 1
    return trapped if found > 0 else None


def _strip_border_bg_from_mask(
    mask_arr: np.ndarray,
    image_arr: np.ndarray,
    bg_color: np.ndarray,
    color_tolerance: float = 30.0,
    min_px: int = 200,
) -> np.ndarray:
    """Remove background-colored mask pixels connected to the image border."""
    mask_bool = mask_arr > 127
    diff = np.abs(image_arr.astype(float) - bg_color)
    bg_match = diff.max(axis=2) < color_tolerance
    candidates = bg_match & mask_bool
    if not candidates.any():
        return mask_arr
    labeled, n = ndimage.label(candidates)
    out_arr = mask_arr.copy()
    for cid in range(1, n + 1):
        comp = labeled == cid
        if int(comp.sum()) < min_px:
            continue
        if comp[0, :].any() or comp[-1, :].any() or comp[:, 0].any() or comp[:, -1].any():
            out_arr[comp] = 0
    return out_arr


def _polish_mask_hard(
    mask_arr: np.ndarray,
    closing_size: int = 2,
    fill_holes: bool = True,
    smooth_contours: bool = True,
) -> np.ndarray:
    """Contour smoothing -> morphological closing -> fill holes -> debris filter."""
    arr = mask_arr > 127
    result = (arr * 255).astype(np.uint8)

    # ── Smooth jagged contours with spline interpolation ──
    if smooth_contours:
        contours, hierarchy = cv2.findContours(
            result, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
        )
        smooth_canvas = np.zeros_like(result)
        for i, cnt in enumerate(contours):
            if len(cnt) < 8:
                cv2.drawContours(smooth_canvas, [cnt], -1, 255, -1)
                continue
            pts = cnt[:, 0, :].astype(float)  # (N, 2)
            try:
                tck, u = splprep([pts[:, 0], pts[:, 1]], s=len(pts) * 2.0, k=3, per=True)
                u_new = np.linspace(0, 1, len(pts) * 4)
                x_new, y_new = splev(u_new, tck)
                smooth_pts = np.array([x_new, y_new], dtype=np.int32).T
                smooth_pts = smooth_pts.reshape((-1, 1, 2))
                is_hole = (hierarchy is not None and hierarchy[0][i][3] != -1)
                color = 0 if is_hole else 255
                cv2.drawContours(smooth_canvas, [smooth_pts], -1, color, -1)
            except Exception:
                cv2.drawContours(smooth_canvas, [cnt], -1, 255, -1)
        result = smooth_canvas

    # Morphological closing
    struct = ndimage.generate_binary_structure(2, 2)
    arr2 = result > 127
    closed = ndimage.binary_closing(
        arr2,
        structure=ndimage.iterate_structure(struct, closing_size)
    ) if closing_size > 0 else arr2

    filled = ndimage.binary_fill_holes(closed) if fill_holes else closed

    # Debris filter
    labeled, n = ndimage.label(filled)
    if n > 1:
        sizes = ndimage.sum(filled, labeled, range(1, n + 1))
        max_size = max(sizes)
        keep_ids = {i + 1 for i, s in enumerate(sizes) if s >= max(500, max_size * 0.05)}
        filled = np.isin(labeled, list(keep_ids))

    return (filled * 255).astype(np.uint8)


def _feather_mask(
    mask_arr: np.ndarray,
    feather_radius: int = 1,
    image_long_side: int = None,
) -> np.ndarray:
    """
    Smooth borders with adaptive Gaussian blur based on image resolution.
    Preserves fully opaque interior core via erosion.
    """
    if feather_radius <= 0:
        return mask_arr

    # ── Adaptive radius: scale with image resolution ──
    if image_long_side is not None:
        # At 512px -> radius ~2, at 1024px -> radius ~4, at 2048px -> radius ~8
        feather_radius = max(feather_radius, int(image_long_side / 256))
        feather_radius = min(feather_radius, 12)  # cap to avoid over-blurring

    arr = mask_arr > 127

    # Gaussian blur for smooth falloff
    blur_ksize = feather_radius * 2 + 1  # must be odd
    blurred = cv2.GaussianBlur(
        (arr * 255).astype(np.uint8),
        (blur_ksize, blur_ksize), 0
    )

    # Keep eroded interior opaque
    struct = ndimage.generate_binary_structure(2, 2)
    interior = ndimage.binary_erosion(
        arr,
        structure=ndimage.iterate_structure(struct, feather_radius + 1)
    )
    blurred[interior] = 255
    return blurred


def _despill_rgba(
    rgb_arr: np.ndarray,
    alpha_arr: np.ndarray,
    bg_color: np.ndarray,
    min_alpha_threshold: float = 0.15,
) -> np.ndarray:
    """Algebraic despill to cancel background colors at soft transparency boundaries."""
    a = alpha_arr / 255.0
    feather = (a > min_alpha_threshold) & (a < 0.95)
    if not feather.any():
        return rgb_arr
    rgb = rgb_arr.astype(np.float32)
    out = rgb.copy()
    for c, bg in enumerate(bg_color):
        channel = rgb[:, :, c]
        de_spilled = (channel - bg * (1.0 - a)) / np.where(a > min_alpha_threshold, a, 1.0)
        out[:, :, c] = np.where(feather, np.clip(de_spilled, 0, 255), channel)
    return out.astype(np.uint8)


def resolve_closing_size(category: str, flags: dict) -> int:
    if flags is None:
        flags = {}
    if flags.get("has_fringe"):     return 8
    if flags.get("has_raw_edges"):  return 0
    if flags.get("is_sheer"):       return 0
    if flags.get("has_cutouts"):    return 0
    if flags.get("is_two_piece"):   return 1
    if flags.get("has_holes"):      return 8
    if flags.get("has_belt"):       return 6
    if flags.get("has_wrap_front"): return 4
    if flags.get("is_open_front"):  return 4
    if flags.get("has_peplum"):     return 3
    if flags.get("is_jumpsuit"):    return 2
    if flags.get("has_overalls"):   return 2
    defaults = {"top": 2, "pants": 2, "skirt": 2, "dress": 1}
    return defaults.get(category, 2)


_GDINO_CACHE = None

def _load_grounding_dino():
    global _GDINO_CACHE
    if _GDINO_CACHE is not None:
        return _GDINO_CACHE

    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
    print(f"  [Info] Loading GroundingDINO ({GDINO_MODEL_ID})...")
    processor = AutoProcessor.from_pretrained(GDINO_MODEL_ID)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(GDINO_MODEL_ID)
    model.eval()
    
    _GDINO_CACHE = (processor, model)
    return _GDINO_CACHE


def _run_grounding_dino_detect(
    image_pil,
    positive_queries: List[str],
    negative_queries: List[str],
    box_threshold: float = 0.35,
    text_threshold: float = 0.25,
) -> Tuple[List[np.ndarray], List[np.ndarray]]:
    """
    Run Grounding DINO on the PIL image to detect positive (garment) and negative (skin, neck, face) boxes.
    Returns:
        positive_boxes: list of np.ndarray [x1, y1, x2, y2]
        negative_boxes: list of np.ndarray [x1, y1, x2, y2]
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor, model = _load_grounding_dino()
    model = model.to(device)

    combined_queries = positive_queries + negative_queries
    text_prompt = " . ".join(combined_queries) + " ."

    print(f"  [DINO] Running zero-shot detect with prompt: '{text_prompt}'")
    
    inputs = processor(images=image_pil, text=text_prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
        
    results = processor.post_process_grounded_object_detection(
        outputs,
        inputs.input_ids,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        target_sizes=[image_pil.size[::-1]]
    )[0]

    positive_boxes = []
    negative_boxes = []
    
    boxes = results["boxes"].cpu().numpy()
    labels = results["labels"]
    scores = results["scores"].cpu().numpy()

    for box, label, score in zip(boxes, labels, scores):
        is_pos = False
        is_neg = False
        
        for pq in positive_queries:
            if pq.lower() in label.lower():
                is_pos = True
                break
        for nq in negative_queries:
            if nq.lower() in label.lower():
                is_neg = True
                break
                
        box_coords = np.array(box, dtype=np.float32)
        if is_pos and not is_neg:
            positive_boxes.append(box_coords)
            print(f"  [DINO] Detected garment '{label}' (score={score:.2f}): {box_coords.tolist()}")
        elif is_neg:
            negative_boxes.append(box_coords)
            print(f"  [DINO] Detected exclude '{label}' (score={score:.2f}): {box_coords.tolist()}")

    return positive_boxes, negative_boxes


def _punch_skin_holes_into_mask(
    mask: np.ndarray,
    seg_map: np.ndarray,
    garment_type: str,
) -> np.ndarray:
    """
    Re-punch skin/torso pixels that are enclosed INSIDE the garment mask
    (e.g. V-neck chest opening, open-front gaps).
    
    FASHN correctly identifies these as torso (class 16) but SAM fills over them.
    We find connected torso regions that are fully surrounded by garment mask
    and zero them out.
    """
    result = mask.copy()
    
    # Only relevant for topwear/dress with open necklines
    if garment_type not in ['top', 'dress']:
        return result
    
    # Get torso skin mask
    torso_mask = (seg_map == 16).astype(np.uint8) * 255
    
    # Find torso pixels that are INSIDE the garment mask region
    # i.e., torso AND currently covered by mask
    torso_inside_mask = (torso_mask > 127) & (mask > 127)
    
    if not torso_inside_mask.any():
        return result
    
    # Label connected components of torso-inside-mask
    labeled, n = ndimage.label(torso_inside_mask)
    h, w = mask.shape
    
    for cid in range(1, n + 1):
        comp = labeled == cid
        px = int(comp.sum())
        
        # Skip tiny components (noise)
        if px < 100:
            continue
        
        # Check: is this component touching the image border?
        # If yes — it's NOT an enclosed hole, it's edge skin (skip)
        touches_border = (
            comp[0, :].any() or comp[-1, :].any() or
            comp[:, 0].any() or comp[:, -1].any()
        )
        if touches_border:
            continue
        
        # This is enclosed torso skin inside the garment — punch it out
        result[comp] = 0
        print(f"  [SkinHole] Punched {px}px torso hole (V-neck/opening)")
    
    return result


def punch_vneck_skin_final(
    mask: np.ndarray,
    image_bgr: np.ndarray,
    seg_map: np.ndarray,
    category: str,
    garment_mask: np.ndarray,
    head_neck_mask: np.ndarray = None,
    schp_map: np.ndarray = None,
) -> np.ndarray:
    """
    Final V-neck skin removal. Three-layer approach:
    
    Layer 1: FASHN class 16 enclosed holes (works for fully enclosed torso gaps)
    Layer 2: Color-based punch in neck zone (works for ghost shots + open V-necks)
    Layer 3: Head/neck mask ceiling dilution (works for model shots, projects chin downwards)
    
    Each layer is independent — if one fails, the others still catch it.
    Uses a combination of FASHN and SCHP to identify non-garment/skin areas robustly.
    """
    if category not in ['top', 'dress']:
        return mask

    result = mask.copy()
    h, w = mask.shape

    # ── Shared: garment bounding box top zone (top 35%) ──
    ys, xs = np.where(garment_mask > 127)
    if len(ys) == 0:
        return result

    garment_top    = int(ys.min())
    garment_bottom = int(ys.max())
    garment_left   = int(xs.min())
    garment_right  = int(xs.max())
    garment_h      = garment_bottom - garment_top
    neck_zone_bottom = garment_top + int(garment_h * 0.35)

    neck_zone = np.zeros((h, w), dtype=bool)
    neck_zone[garment_top:neck_zone_bottom,
              garment_left:garment_right] = True

    # ════════════════════════════════════════
    # LAYER 1: FASHN class 16 — enclosed torso holes
    # Works when skin is fully surrounded by garment (e.g. button-front gap)
    # ════════════════════════════════════════
    torso = (seg_map == 16)
    torso_inside = torso & (result > 127)

    if torso_inside.any():
        labeled, n = ndimage.label(torso_inside)
        for cid in range(1, n + 1):
            comp = labeled == cid
            if comp.sum() < 80:
                continue
            # Fully enclosed — no border contact at all
            touches_border = (
                comp[0,:].any() or comp[-1,:].any() or
                comp[:,0].any() or comp[:,-1].any()
            )
            if not touches_border:
                result[comp] = 0
                print(f"  [L1-Enclosed] Punched {comp.sum()}px torso hole")

    # ════════════════════════════════════════
    # LAYER 2: Color + FASHN/SCHP confirm in neck zone
    # Works for ghost shots + open V-necks where skin isn't enclosed
    # ════════════════════════════════════════
    B = image_bgr[:,:,0].astype(float)
    G = image_bgr[:,:,1].astype(float)
    R = image_bgr[:,:,2].astype(float)

    skin_color = (
        (R > 60) & (G > 40) & (B > 20) &
        (R > G) & (G > B) &
        (R - G > 8) &
        (R - B > 15) &
        ((R / (G + 1)) < 1.8) &
        (np.abs(R.astype(int) - G.astype(int)) < 80)
    )

    # Non-garment FASHN classes (background, face, hair, arms, hands, legs, feet, torso skin, jewelry, bag)
    non_garment_cls = [0, 1, 2, 8, 11, 12, 13, 14, 15, 16, 17]
    fashn_non_garment = np.isin(seg_map, non_garment_cls)
    
    # Non-garment SCHP classes (anything that is NOT: upper_clothes=5, dress=6, coat=7, skirt=12)
    if schp_map is not None:
        # Robustly handle binary mask vs raw class map
        unique_vals = np.unique(schp_map)
        is_binary = len(unique_vals) <= 2 and (255 in unique_vals or 127 in unique_vals)
        if is_binary:
            schp_non_garment = (schp_map > 127)
        else:
            schp_non_garment = ~np.isin(schp_map, [5, 6, 7, 12])
        combined_non_garment = fashn_non_garment | schp_non_garment
    else:
        combined_non_garment = fashn_non_garment

    skin_candidates = skin_color & (result > 127) & neck_zone

    if skin_candidates.any():
        labeled, n = ndimage.label(skin_candidates)
        for cid in range(1, n + 1):
            comp = labeled == cid
            if comp.sum() < 50:
                continue
            # Cross-check: FASHN/SCHP must agree >40% is non-garment
            non_garment_frac = combined_non_garment[comp].mean()
            if non_garment_frac > 0.4:
                result[comp] = 0
                print(f"  [L2-Color] Punched {comp.sum()}px "
                      f"neck-zone skin (non_garment_conf={non_garment_frac:.2f})")

    # ════════════════════════════════════════
    # LAYER 3: Head/neck mask ceiling
    # Works for model shots where head_neck_mask is available
    # Catches skin that connects upward through neck gap
    # ════════════════════════════════════════
    if head_neck_mask is not None and head_neck_mask.any():
        # Build a "ceiling" — dilate head/neck mask downward
        # This creates a forbidden zone just below the head
        kernel_down = np.zeros((30, 1), dtype=np.uint8)
        kernel_down[:] = 1  # vertical kernel — project downward only
        neck_ceiling = cv2.dilate(
            (head_neck_mask > 127).astype(np.uint8) * 255,
            kernel_down, iterations=3
        )
        # Any skin in this ceiling zone that's inside current mask → punch
        skin_under_neck = (
            (neck_ceiling > 127) &
            (result > 127) &
            combined_non_garment
        )
        if skin_under_neck.any():
            result[skin_under_neck] = 0
            print(f"  [L3-NeckCeiling] Punched "
                  f"{skin_under_neck.sum()}px under neck mask")

    return result



# ══════════════════════════════════════════════════════════════
# ── SCHP (Self-Correction Human Parsing) — Fine Exclusion Mask
# ══════════════════════════════════════════════════════════════

# SCHP LIP label map (20 classes)
SCHP_LIP_LABELS = {
    0:  "background",
    1:  "hat",
    2:  "hair",
    3:  "glove",
    4:  "sunglasses",
    5:  "upper_clothes",
    6:  "dress",
    7:  "coat",
    8:  "socks",
    9:  "pants",
    10: "jumpsuits",
    11: "scarf",
    12: "skirt",
    13: "face",
    14: "left_arm",
    15: "right_arm",
    16: "left_leg",
    17: "right_leg",
    18: "left_shoe",
    19: "right_shoe",
}

# Color palette for SCHP classes (class_id → BGR)
SCHP_COLORS = {
    0:  (0, 0, 0),        # background
    1:  (128, 0, 0),      # hat
    2:  (0, 128, 0),      # hair
    3:  (128, 128, 0),    # glove
    4:  (0, 0, 128),      # sunglasses
    5:  (128, 0, 128),    # upper_clothes
    6:  (0, 128, 128),    # dress
    7:  (128, 128, 128),  # coat
    8:  (64, 0, 0),       # socks
    9:  (192, 0, 0),      # pants
    10: (64, 128, 0),     # jumpsuits
    11: (192, 128, 0),    # scarf
    12: (64, 0, 128),     # skirt
    13: (192, 0, 128),    # face
    14: (64, 128, 128),   # left_arm
    15: (192, 128, 128),  # right_arm
    16: (0, 64, 0),       # left_leg
    17: (0, 192, 0),      # right_leg
    18: (0, 64, 128),     # left_shoe
    19: (0, 192, 128),    # right_shoe
}

def colorize_schp(schp_map: np.ndarray) -> np.ndarray:
    """Convert class-id SCHP map to BGR visualization."""
    h, w = schp_map.shape
    colored = np.zeros((h, w, 3), dtype=np.uint8)
    for class_id, color in SCHP_COLORS.items():
        colored[schp_map == class_id] = color
    return colored


# Classes to EXCLUDE per garment type (don't include in garment mask)
# Key insight: left/right arm are SEPARATE — finer than FASHN's merged class 12
SCHP_EXCLUSION_CLASSES = {
    "top": [2, 13, 14, 15, 16, 17, 18, 19],    # hair, face, both arms, both legs, both shoes
    "dress": [2, 13, 14, 15, 16, 17, 18, 19],  # same
    "pants": [2, 13, 14, 15, 16, 17, 18, 19],  # same
    "skirt": [2, 13, 14, 15, 16, 17, 18, 19],  # same
    "footwear": [2, 13, 14, 15, 16, 17],        # hair, face, arms, legs — NOT shoes
}

# SCHP garment classes (for cross-checking with FASHN)
SCHP_GARMENT_CLASSES = {
    "top": [5, 7],       # upper_clothes + coat
    "dress": [6],        # dress
    "pants": [9],        # pants
    "skirt": [12],       # skirt
    "footwear": [18, 19] # left_shoe + right_shoe
}

_SCHP_MODEL_CACHE = {}

def _load_schp_model(
    checkpoint_path: str = None,
    num_classes: int = 20,
):
    """Load SCHP model from checkpoint. Cached after first load."""
    global _SCHP_MODEL_CACHE
    current_dir = os.path.dirname(os.path.abspath(__file__))
    if checkpoint_path is None:
        checkpoint_path = os.path.join(current_dir, "checkpoints", "exp-schp-201908261155-lip.pth")
    else:
        if not os.path.isabs(checkpoint_path):
            checkpoint_path = os.path.abspath(os.path.join(current_dir, checkpoint_path))

    if checkpoint_path in _SCHP_MODEL_CACHE:
        return _SCHP_MODEL_CACHE[checkpoint_path]

    import sys
    # Add SCHP repo to path — adjust this to wherever you cloned it
    schp_root = os.environ.get("SCHP_ROOT", os.path.join(current_dir, "Self-Correction-Human-Parsing"))
    if schp_root not in sys.path:
        sys.path.insert(0, schp_root)

    from networks import init_model  # from SCHP repo
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = init_model(
        "resnet101",
        num_classes=num_classes,
        pretrained=None
    )

    state = torch.load(checkpoint_path, map_location=device)
    # SCHP checkpoints are saved as {'model': state_dict, ...} or {'state_dict': state_dict, ...}
    state_dict = state.get("model", state.get("state_dict", state))
    
    # Strip 'module.' prefix if present (since checkpoint is saved from DataParallel training)
    from collections import OrderedDict
    new_state_dict = OrderedDict()
    for k, v in state_dict.items():
        name = k[7:] if k.startswith('module.') else k
        new_state_dict[name] = v

    model.load_state_dict(new_state_dict, strict=False)
    model.eval()
    model.to(device)

    _SCHP_MODEL_CACHE[checkpoint_path] = (model, device)
    print(f"  [SCHP] Loaded model from {checkpoint_path}")
    return model, device


def run_schp_parsing(
    image_path: str,
    checkpoint_path: str = None,
    input_size: int = 473,  # LIP default size is 473
) -> np.ndarray:
    """
    Run SCHP inference on image.
    Returns seg_map: HxW uint8 with class IDs (0-19 for LIP).
    Output is at NATIVE image resolution (upsampled with INTER_NEAREST).
    """
    import torch
    import torch.nn.functional as F

    model, device = _load_schp_model(checkpoint_path)

    # Load in BGR order (matching cv2.imread and SCHP training dataset)
    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise ValueError(f"Could not read image: {image_path}")
    orig_h, orig_w = img_bgr.shape[:2]

    # Resize to input_size
    img_resized = cv2.resize(img_bgr, (input_size, input_size), interpolation=cv2.INTER_LINEAR)
    
    # Convert BGR to float32 [0.0, 1.0]
    img_arr = img_resized.astype(np.float32) / 255.0
    
    # Normalize same as SCHP training (BGR order mean/std)
    mean = np.array([0.406, 0.456, 0.485], dtype=np.float32)  # BGR order
    std  = np.array([0.225, 0.224, 0.229], dtype=np.float32)
    img_arr = (img_arr - mean) / std
    
    img_tensor = torch.from_numpy(
        img_arr.transpose(2, 0, 1)  # HWC → CHW (still BGR order)
    ).unsqueeze(0).float().to(device)

    with torch.no_grad():
        output = model(img_tensor)
        # SCHP returns [[parsing_result, fusion_result], [edge_result]]
        # We extract the fusion_result tensor (the last item in the first list)
        if isinstance(output, (list, tuple)):
            output = output[0][-1]
        # output shape: (1, num_classes, H, W)
        output = F.interpolate(
            output,
            size=(orig_h, orig_w),
            mode="bilinear",
            align_corners=True
        )
        seg_map = output.argmax(dim=1).squeeze(0).cpu().numpy().astype(np.uint8)

    print(f"  [SCHP] Parsed {orig_w}x{orig_h}, "
          f"unique classes: {np.unique(seg_map).tolist()}")
    return seg_map


def get_schp_exclusion_mask(
    image_path: str,
    garment_type: str,
    checkpoint_path: str = None,
) -> np.ndarray:
    """
    Run SCHP and return a fine-grained exclusion mask for the given garment type.
    Uses separate left/right arm classes for precise arm exclusion.
    Returns binary mask (0/255) at native image resolution.
    """
    schp_map = run_schp_parsing(image_path, checkpoint_path)

    exclude_ids = SCHP_EXCLUSION_CLASSES.get(garment_type, [2, 13, 14, 15, 16, 17, 18, 19])
    excl_mask = np.zeros_like(schp_map, dtype=np.uint8)
    for cid in exclude_ids:
        excl_mask[schp_map == cid] = 255

    print(f"  [SCHP] Exclusion mask: {(excl_mask > 127).sum()} px excluded "
          f"for garment_type='{garment_type}'")
    return excl_mask


def get_schp_torso_mask(image_path: str,
                        checkpoint_path: str = None
                        ) -> np.ndarray:
    """
    Returns SCHP's skin/torso region — everything that is NOT a garment and NOT background.
    Used for V-neck hole punching with higher precision than FASHN class 16.
    """
    schp_map = run_schp_parsing(image_path, checkpoint_path)
    # Skin = face + both arms (the exposed skin regions)
    skin_ids = [13, 14, 15]  # face, left_arm, right_arm
    skin_mask = np.zeros_like(schp_map, dtype=np.uint8)
    for cid in skin_ids:
        skin_mask[schp_map == cid] = 255
    return skin_mask


# ── Main Refinement Orchestrator ──

def refine_garment_mask(
    image_path: str,
    coarse_garment_mask: np.ndarray,
    exclusion_mask: np.ndarray,
    category: str,
    seg_map: np.ndarray = None,
    schp_map: np.ndarray = None,    # ← ADD: SCHP exclusion for V-neck punch
    item_name: str = "garment",
    subcategories: Optional[List[str]] = None,
    components: Optional[List[str]] = None,
    flags: Optional[dict] = None,
    sam2_variant: str = "sam2_large",
    output_dir: Optional[str] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Run FASHN Parser + SAM Point Prompts (constrained by FASHN body exclusion points)
    to extract a high-resolution, refined clothing mask.
    """
    if flags is None:
        flags = {}
        
    if not category:
        category = "top"
        
    closing_size = resolve_closing_size(category, flags)
    
    # Load input RGB image
    pil_img = Image.open(image_path).convert("RGB")
    img_arr = np.array(pil_img)
    img_h, img_w = img_arr.shape[:2]
    
    # Sample background color locally using the coarse mask
    sampled_bg = sample_background_color_local(img_arr, coarse_garment_mask)
    print(f"  [Refine] Sampled background color: RGB({sampled_bg[0]:.0f}, {sampled_bg[1]:.0f}, {sampled_bg[2]:.0f})")
    
    # ── Run Grounding DINO Bounding Box Detection ──
    positive_queries = BASE_GDINO_TOKENS.get(category, {}).get("primary", ["clothing"])
    # Remove mannequin as it overlaps heavily with the garment and degrades mask quality
    negative_queries = ["neck", "chest skin", "face", "arms", "legs", "hands", "feet"]
    
    pos_boxes, neg_boxes = [], []
    try:
        pos_boxes, neg_boxes = _run_grounding_dino_detect(
            image_pil=pil_img,
            positive_queries=positive_queries,
            negative_queries=negative_queries,
        )
        # Visualizer: draw detected boxes if output_dir is provided
        if output_dir is not None and len(pos_boxes) + len(neg_boxes) > 0:
            os.makedirs(output_dir, exist_ok=True)
            vis_img = cv2.imread(image_path)
            for box in pos_boxes:
                x1, y1, x2, y2 = map(int, box)
                cv2.rectangle(vis_img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(vis_img, "Garment", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            for box in neg_boxes:
                x1, y1, x2, y2 = map(int, box)
                cv2.rectangle(vis_img, (x1, y1), (x2, y2), (0, 0, 255), 2)
                cv2.putText(vis_img, "Exclude", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
            cv2.imwrite(os.path.join(output_dir, "dino_detected_boxes.png"), vis_img)
            print(f"  [DINO] Saved boxes visualization to dino_detected_boxes.png")
    except Exception as e:
        print(f"  [DINO] Failed to run detection/visualization: {e}")

    # Build SAM Point Prompts
    point_coords_list = []
    point_labels_list = []
    
    # 1. Add FASHN/SCHP baseline points
    fashn_coords, fashn_labels = _build_prompt_points(coarse_garment_mask, exclusion_mask, img_h, img_w)
    if fashn_coords is not None:
        point_coords_list.append(fashn_coords)
        point_labels_list.append(fashn_labels)

    # 2. Add Grounding DINO negative box points (guided by FASHN mask to prevent fabric erasure)
    if len(neg_boxes) > 0:
        dino_neg_pts = []
        for box in neg_boxes:
            x1, y1, x2, y2 = box
            x1_c = max(0, min(img_w - 1, int(x1)))
            y1_c = max(0, min(img_h - 1, int(y1)))
            x2_c = max(0, min(img_w - 1, int(x2)))
            y2_c = max(0, min(img_h - 1, int(y2)))
            
            cx, cy = (x1_c + x2_c) // 2, (y1_c + y2_c) // 2
            
            # Place negative point only if it falls OUTSIDE the garment mask
            if coarse_garment_mask[cy, cx] == 0:
                dino_neg_pts.append([cx, cy])
                
            w = x2_c - x1_c
            h = y2_c - y1_c
            if w > 10 and h > 10:
                offsets = [
                    (cx - int(w*0.2), cy),
                    (cx + int(w*0.2), cy),
                    (cx, cy - int(h*0.2)),
                    (cx, cy + int(h*0.2))
                ]
                for ox, oy in offsets:
                    ox_c = max(0, min(img_w - 1, ox))
                    oy_c = max(0, min(img_h - 1, oy))
                    if coarse_garment_mask[oy_c, ox_c] == 0:
                        dino_neg_pts.append([ox_c, oy_c])
                        
        if len(dino_neg_pts) > 0:
            dino_neg_coords = np.array(dino_neg_pts, dtype=np.float32)
            dino_neg_labels = np.zeros(len(dino_neg_pts), dtype=np.int32)  # 0 represents background
            point_coords_list.append(dino_neg_coords)
            point_labels_list.append(dino_neg_labels)

    if len(point_coords_list) > 0:
        point_coords = np.concatenate(point_coords_list, axis=0)
        point_labels = np.concatenate(point_labels_list, axis=0)
    else:
        point_coords, point_labels = None, None

    # ALWAYS use the coarse garment mask's bounding box with 15% padding as the positive box prompt.
    # Grounding DINO's positive garment box prompts are often too tight and crop garment sections (sleeves, hemlines).
    best_pos_box = None
    ys, xs = np.where(coarse_garment_mask > 127)
    if len(ys) > 0:
        ymin, ymax = int(ys.min()), int(ys.max())
        xmin, xmax = int(xs.min()), int(xs.max())
        pad_y = int((ymax - ymin) * 0.15)
        pad_x = int((xmax - xmin) * 0.15)
        x1 = max(0, xmin - pad_x)
        y1 = max(0, ymin - pad_y)
        x2 = min(img_w - 1, xmax + pad_x)
        y2 = min(img_h - 1, ymax + pad_y)
        best_pos_box = np.array([x1, y1, x2, y2], dtype=np.float32)
        print(f"  [Refine] Padded FASHN garment box prompt: {best_pos_box.tolist()}")

    # Run SAM2 (or fallback to SAM v1)
    sam_mask = None
    try:
        print("  [Refine] Loading SAM2 Predictor...")
        predictor = _load_sam2_predictor(sam2_variant, img_arr)
        
        # Predict using hybrid prompt (points + box)
        with torch.inference_mode():
            masks, scores, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=best_pos_box,
                multimask_output=True,
            )
        sam_mask = _select_best_mask_by_iou(masks, coarse_garment_mask)
    except Exception as e:
        print(f"  [Refine] SAM2 hybrid failed/unavailable ({e}) — falling back to SAM v1...")
        try:
            predictor = _load_sam_v1_predictor("vit_h", img_arr)
            sam_mask = _sam_v1_point_mask(predictor, point_coords, point_labels, coarse_garment_mask)
        except Exception as e_v1:
            print(f"  [Refine] SAM v1 failed ({e_v1}) — falling back to coarse mask")
            sam_mask = coarse_garment_mask.copy()
            
    # Apply FASHN SegFormer exclusion mask (zero out face/legs/arms/hair in SAM mask)
    sam_mask[exclusion_mask > 127] = 0
    
    # Fill in any interior tears/holes in the SAM mask by taking the union with the FASHN garment mask body
    # (excluding any regions that are skin/face/hair/arms/legs)
    coarse_clean = (coarse_garment_mask > 127) & (exclusion_mask <= 127)
    sam_mask = np.where(coarse_clean, 255, sam_mask)
    
    # ── Layered V-neck skin punch (FASHN + SCHP + Color + Ceiling) ──
    if seg_map is not None:
        head_neck_mask = extract_class_mask(seg_map, HEAD_NECK_CLASSES)
        sam_mask = punch_vneck_skin_final(
            mask=sam_mask,
            image_bgr=img_arr[:, :, ::-1].copy(),  # Convert PIL RGB to BGR
            seg_map=seg_map,
            category=category,
            garment_mask=coarse_garment_mask,
            head_neck_mask=head_neck_mask,
            schp_map=schp_map
        )
    
    # Trapped background hole detection (run pre-polish)
    trapped_holes = _detect_trapped_bg_holes(sam_mask, img_arr, bg_color=sampled_bg)
    
    # Polish mask (morphological closing + fill_holes + debris filter)
    polished = _polish_mask_hard(sam_mask, closing_size=closing_size)
    
    # Re-punch trapped background holes
    if trapped_holes is not None:
        polished[trapped_holes] = 0
        print(f"  [Refine] Re-punched {trapped_holes.sum():,} trapped background pixels")
        
    # Strip border-adjacent bg bleed
    polished = _strip_border_bg_from_mask(polished, img_arr, bg_color=sampled_bg)
    
    # Soft Gaussian feathering (adaptive radius)
    image_long_side = max(img_h, img_w)
    feathered = _feather_mask(polished, feather_radius=2, image_long_side=image_long_side)
    
    return feathered, sampled_bg



# ── Final RGBA Extraction ──

def extract_garment_rgba(image: np.ndarray, mask: np.ndarray, sampled_bg: np.ndarray = None) -> np.ndarray:
    """
    Extract garment as RGBA image using the mask.
    Transparent background where mask == 0.
    Applies de-spill matting if sampled_bg is provided.
    """
    if image.shape[2] == 3:
        rgba = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    else:
        rgba = image.copy()
        
    refined_mask = mask.copy()
    if sampled_bg is not None:
        # Fix 3: Erase faint fringe pixels
        refined_mask[refined_mask < 15] = 0
        
        # Fix 4: Texture-aware alpha tightening
        refined_mask = _texture_aware_alpha_tighten(refined_mask, image, texture_threshold=12.0)
        
        # Fix 2: despill with min_alpha_threshold guard
        rgba_rgb = rgba[:, :, :3]
        clean_rgb = _despill_rgba(rgba_rgb, refined_mask, sampled_bg, min_alpha_threshold=0.15)
        rgba[:, :, :3] = clean_rgb
        print(f"  [RGBA] Applied edge despill matting against RGB({sampled_bg[0]:.0f}, {sampled_bg[1]:.0f}, {sampled_bg[2]:.0f})")
        
    rgba[:, :, 3] = refined_mask
    return rgba


# ── BiRefNet HR Matting Stage ──

_BIREFNET_CACHE = {}

def _load_birefnet(variant: str = "ZhengPeng7/BiRefNet_HR-matting"):
    global _BIREFNET_CACHE
    if variant in _BIREFNET_CACHE:
        return _BIREFNET_CACHE[variant]
    
    from transformers import AutoModelForImageSegmentation
    import torch
    
    print(f"  [BiRefNet] Loading {variant}...")
    model = AutoModelForImageSegmentation.from_pretrained(
        variant, trust_remote_code=True
    )
    model.eval()
    if torch.cuda.is_available():
        model = model.half().cuda()
    
    _BIREFNET_CACHE[variant] = model
    return model


def _run_birefnet_raw(
    image_path: str,
    variant: str = "ZhengPeng7/BiRefNet_HR-matting",
    input_size: int = 1024,
) -> np.ndarray:
    """
    Run BiRefNet inference and return the RAW (ungated) alpha at native resolution.
    This is the pure salient-object mask before any FASHN gating.
    """
    import torch
    from torchvision import transforms
    from PIL import Image as PILImage

    model = _load_birefnet(variant)
    
    pil_img = PILImage.open(image_path).convert("RGB")
    orig_w, orig_h = pil_img.size
    
    transform = transforms.Compose([
        transforms.Resize((input_size, input_size)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406],
                             [0.229, 0.224, 0.225])
    ])
    
    inp = transform(pil_img).unsqueeze(0)
    if torch.cuda.is_available():
        inp = inp.half().cuda()
    
    with torch.no_grad():
        preds = model(inp)[-1].sigmoid().cpu()
    
    pred = preds[0].squeeze()
    alpha_pil = transforms.ToPILImage()(pred)
    alpha_pil = alpha_pil.resize((orig_w, orig_h), PILImage.LANCZOS)
    return np.array(alpha_pil)   # 0–255 soft alpha, native res


def refine_with_birefnet(
    image_path: str,
    fashn_gate_mask: np.ndarray,          # FASHN binary mask — used as logical gate
    variant: str = "ZhengPeng7/BiRefNet_HR-matting",
    input_size: int = 1024,
) -> np.ndarray:
    """
    Run BiRefNet_HR-matting on the original image, then gate with FASHN mask.
    Returns a soft alpha mask at native image resolution — no bleeding, no jagged edges.
    """
    birefnet_alpha = _run_birefnet_raw(image_path, variant, input_size)
    orig_h, orig_w = birefnet_alpha.shape[:2]
    
    # ── Gate with FASHN semantic mask ──
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    dilated_gate = cv2.dilate(fashn_gate_mask, kernel, iterations=1)
    outside = dilated_gate == 0
    
    leaked_px = np.sum((birefnet_alpha > 128) & outside)
    print(f"  [BiRefNet] Leaked skin/background pixels before gating: {leaked_px}")
    
    gated_alpha = birefnet_alpha.copy()
    gated_alpha[outside] = 0
    
    print(f"  [BiRefNet] Alpha computed at {orig_w}x{orig_h}, "
          f"coverage: {(gated_alpha > 127).sum() / (orig_w * orig_h) * 100:.1f}%")
    
    return gated_alpha


# ── ViTMatte Matting Stage ──

_VITMATTE_CACHE = {}

def _load_vitmatte(variant: str = "hustvl/vitmatte-base-composition-1k"):
    global _VITMATTE_CACHE
    if variant in _VITMATTE_CACHE:
        return _VITMATTE_CACHE[variant]
    
    from transformers import VitMatteImageProcessor, VitMatteForImageMatting
    import torch
    
    print(f"  [ViTMatte] Loading {variant}...")
    processor = VitMatteImageProcessor.from_pretrained(variant)
    model = VitMatteForImageMatting.from_pretrained(variant)
    model.eval()
    if torch.cuda.is_available():
        model = model.cuda()
        
    _VITMATTE_CACHE[variant] = (processor, model)
    return processor, model


def generate_trimap(mask: np.ndarray, erode_size: int = 11, dilate_size: int = 15) -> np.ndarray:
    """Generate a standard 3-value trimap (0: bg, 128: unknown, 255: fg)."""
    # Erode to get certain foreground
    kernel_erode = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_size, erode_size))
    fg = cv2.erode(mask, kernel_erode, iterations=1)
    
    # Dilate to get boundary
    kernel_dilate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_size, dilate_size))
    dilated = cv2.dilate(mask, kernel_dilate, iterations=1)
    
    trimap = np.zeros_like(mask)
    trimap[dilated > 127] = 128
    trimap[fg > 127] = 255
    return trimap


def refine_with_vitmatte(
    image_path: str,
    fashn_gate_mask: np.ndarray,          # FASHN binary mask — used as logical gate
    exclusion_mask: np.ndarray,           # body parts exclusion mask (to force trimap bg)
    seg_map: np.ndarray = None,
    garment_type: str = "top",
    variant: str = "hustvl/vitmatte-base-composition-1k",
    erode_size: int = 5,
    dilate_size: int = 5,
) -> np.ndarray:
    """
    Run ViTMatte on the original image using a dynamically generated trimap from FASHN gate mask.
    Returns a soft alpha mask at native image resolution.
    """
    import torch
    from PIL import Image as PILImage
    
    processor, model = _load_vitmatte(variant)
    
    pil_img = PILImage.open(image_path).convert("RGB")
    orig_w, orig_h = pil_img.size
    
    # Generate trimap from FASHN gate
    trimap = generate_trimap(fashn_gate_mask, erode_size=erode_size, dilate_size=dilate_size)
    
    # Force body parts we definitely do NOT want (e.g. face, arms, hair) to be background (0) in the trimap
    trimap[exclusion_mask > 127] = 0

    # ── NEW: Force enclosed torso skin (V-neck gap) to definite BG in trimap ──
    if seg_map is not None:
        torso_inside = (seg_map == 16) & (fashn_gate_mask > 127)
        labeled, n = ndimage.label(torso_inside)
        for cid in range(1, n + 1):
            comp = labeled == cid
            if comp.sum() < 100:
                continue
            touches_border = (
                comp[0, :].any() or comp[-1, :].any() or
                comp[:, 0].any() or comp[:, -1].any()
            )
            if not touches_border:
                trimap[comp] = 0   # definite background — not unknown
    
    pil_trimap = PILImage.fromarray(trimap).convert("L")
    
    inputs = processor(images=pil_img, trimaps=pil_trimap, return_tensors="pt")
    if torch.cuda.is_available():
        inputs = {k: v.cuda() for k, v in inputs.items()}
        
    with torch.no_grad():
        outputs = model(**inputs)
        
    alpha = outputs.alphas[0, 0].cpu().numpy()
    if alpha.shape != (orig_h, orig_w):
        alpha = cv2.resize(alpha, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)
    alpha = (alpha * 255).astype(np.uint8)
    
    # Post-matting hard constraints
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_size, dilate_size))
    dilated_gate = cv2.dilate(fashn_gate_mask, kernel, iterations=1)
    
    alpha[dilated_gate == 0] = 0
    alpha[exclusion_mask > 127] = 0
    
    # Clean up faint background outlines/noise
    alpha[alpha < 10] = 0
    
    print(f"  [ViTMatte] Alpha computed at {orig_w}x{orig_h}, "
          f"coverage: {(alpha > 127).sum() / (orig_w * orig_h) * 100:.1f}%")
          
    return alpha


# ── Hybrid BiRefNet + ViTMatte Fusion ──

def refine_with_hybrid(
    image_path: str,
    fashn_gate_mask: np.ndarray,          # FASHN binary mask — used as logical gate
    exclusion_mask: np.ndarray,           # body parts exclusion mask
    seg_map: np.ndarray = None,
    garment_type: str = "top",
    birefnet_variant: str = "ZhengPeng7/BiRefNet_HR-matting",
    vitmatte_variant: str = "hustvl/vitmatte-base-composition-1k",
    erode_size: int = 5,
    dilate_size: int = 5,
    interior_erode_px: int = 15,
    blend_sigma: float = 7.0,
) -> np.ndarray:
    """
    Hybrid fusion of BiRefNet (interior fill) + ViTMatte (edge quality).

    Uses the RAW (ungated) BiRefNet alpha for interior fill — this is critical because
    the FASHN gate itself removes the sleeve-torso gap pixels. BiRefNet's salient object
    detection naturally fills those regions as part of the garment silhouette.

    ViTMatte provides superior edge quality at the garment boundary.
    A Gaussian-blurred blend weight smoothly transitions between the two.

    Returns a soft alpha mask at native image resolution.
    """
    # ── Step 1: Raw BiRefNet (ungated — fills sleeve gaps) ──
    print("  [Hybrid] Running BiRefNet (raw, ungated) for interior fill...")
    raw_birefnet = _run_birefnet_raw(
        image_path=image_path,
        variant=birefnet_variant,
    )

    # ── Step 2: ViTMatte (trimap-guided — great edges) ──
    print("  [Hybrid] Running ViTMatte for edge quality...")
    vitmatte_alpha = refine_with_vitmatte(
        image_path=image_path,
        fashn_gate_mask=fashn_gate_mask,
        exclusion_mask=exclusion_mask,
        seg_map=seg_map,
        garment_type=garment_type,
        variant=vitmatte_variant,
        erode_size=erode_size,
        dilate_size=dilate_size,
    )

    # ── Step 3: Build blend zones ──
    # Interior zone: well inside the garment boundary (eroded FASHN mask)
    kernel_interior = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (interior_erode_px * 2 + 1, interior_erode_px * 2 + 1)
    )
    interior_mask = cv2.erode(fashn_gate_mask, kernel_interior, iterations=1)

    # Gaussian-blurred blend weight: 1.0 deep interior, 0.0 at boundary
    blend_weight = cv2.GaussianBlur(
        (interior_mask / 255.0).astype(np.float32),
        (0, 0),
        sigmaX=blend_sigma,
        sigmaY=blend_sigma,
    )
    blend_weight = np.clip(blend_weight, 0.0, 1.0)

    # ── Step 4: Prepare safe BiRefNet for interior fill ──
    # Use raw BiRefNet but exclude face/hair (classes 1,2) and torso (16)
    # to prevent neck/head skin from leaking. Keep arms (12) ALLOWED in the
    # interior so BiRefNet can fill the sleeve-torso gap regions.
    # Build a "boundary-only" exclusion: head, hair, torso — NOT arms/legs
    head_only_exclusion = np.zeros_like(exclusion_mask)
    head_only_exclusion[exclusion_mask > 127] = 255
    # We need to preserve the gap-fill capability: in the interior zone,
    # only exclude head/face/hair (which never appear between sleeves)
    # The full exclusion_mask is applied only at the boundary

    safe_birefnet = raw_birefnet.astype(np.float32)
    vitmatte_f = vitmatte_alpha.astype(np.float32)

    # ── Step 5: Fuse ──
    # Interior: max(safe_birefnet, vitmatte) — BiRefNet fills sleeve gaps
    # Boundary: min(safe_birefnet, vitmatte) — suppresses ViTMatte's background/skin bleed while retaining soft details
    interior_alpha = np.maximum(safe_birefnet, vitmatte_f)
    boundary_alpha = np.minimum(safe_birefnet, vitmatte_f)
    hybrid = blend_weight * interior_alpha + (1.0 - blend_weight) * boundary_alpha

    # ── Step 6: Hard constraints ──
    # Gate: nothing outside the dilated FASHN mask (broader gate for BiRefNet fill)
    kernel_gate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    dilated_gate = cv2.dilate(fashn_gate_mask, kernel_gate, iterations=1)
    hybrid[dilated_gate == 0] = 0

    # Exclusion mask constraint: zero out definite body parts (face, hair, head)
    # For arms: only exclude where blend_weight < 0.5 (boundary zone)
    # This lets BiRefNet fill arm-gap pixels in the interior while preventing
    # arm skin from leaking at edges
    boundary_exclusion = (exclusion_mask > 127) & (blend_weight < 0.5)
    hybrid[boundary_exclusion] = 0

    # Suppress background leakage (white shite): if BiRefNet is highly confident it's background
    # (raw_birefnet < 10) AND we are in the boundary zone (blend_weight < 0.9), force alpha to 0
    leakage_mask = (raw_birefnet < 10) & (blend_weight < 0.9)
    hybrid[leakage_mask] = 0

    # Faint alpha threshold
    hybrid[hybrid < 10] = 0

    hybrid = np.clip(hybrid, 0, 255).astype(np.uint8)

    orig_h, orig_w = hybrid.shape[:2]
    fill_diff = int((hybrid > 127).sum()) - int((vitmatte_alpha > 127).sum())
    print(f"  [Hybrid] Alpha computed at {orig_w}x{orig_h}, "
          f"coverage: {(hybrid > 127).sum() / (orig_w * orig_h) * 100:.1f}%")
    print(f"  [Hybrid] BiRefNet filled {fill_diff} additional pixels vs ViTMatte-only")

    return hybrid


# ── Main function (standalone compatibility) ──

def main():
    parser = argparse.ArgumentParser(description="Segment garment and refine boundaries (GroundingDINO+SAM2)")
    parser.add_argument("image_path", help="Path to input garment image")
    parser.add_argument("--output-dir", default="./output_segmentation", help="Output directory")
    parser.add_argument("--collar-depth", type=float, default=0.03, help="Collar clip depth ratio")
    parser.add_argument("--garment-type", default="auto",
                        choices=["auto", "top", "dress", "pants", "skirt"],
                        help="Which garment class to extract (default: auto)")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    print(f"\n[Info] Loading image: {args.image_path}")
    image = cv2.imread(args.image_path)
    if image is None:
        print(f"❌ Could not read image: {args.image_path}")
        sys.exit(1)
    h, w = image.shape[:2]
    cv2.imwrite(os.path.join(args.output_dir, "original.png"), image)
    
    # ── SegFormer Coarse Prediction ──
    print("\n[Info] Running FASHN Human Parser...")
    try:
        from fashn_human_parser import FashnHumanParser
        parser_model = FashnHumanParser()
    except ImportError:
        print("❌ fashn-human-parser not installed. Run: pip install fashn-human-parser")
        sys.exit(1)
        
    seg_map = parser_model.predict(image)
    
    colored_seg = colorize_segmentation(seg_map)
    cv2.imwrite(os.path.join(args.output_dir, "segmentation_map.png"), colored_seg)
    
    # Determine Category
    if args.garment_type == "auto":
        best_class = None
        best_area = 0
        for name, class_ids in GARMENT_CLASSES.items():
            mask = extract_class_mask(seg_map, class_ids)
            area = mask.sum() // 255
            if area > best_area:
                best_area = area
                best_class = name
        garment_type = best_class
    else:
        garment_type = args.garment_type
        
    print(f"  Category: {garment_type}")
    
    coarse_garment_mask = extract_class_mask(seg_map, GARMENT_CLASSES[garment_type])
    cv2.imwrite(os.path.join(args.output_dir, "garment_mask.png"), coarse_garment_mask)
    
    # Head & Body parts exclusion
    exclusion_mask = extract_class_mask(seg_map, HEAD_NECK_CLASSES + [12, 13, 14, 15, 16])
    cv2.imwrite(os.path.join(args.output_dir, "neck_mask.png"), exclusion_mask)
    
    # ── Refine with GroundingDINO + SAM2 ──
    print("\n[Info] Refining mask using GroundingDINO + SAM2...")
    refined_mask, sampled_bg = refine_garment_mask(
        image_path=args.image_path,
        coarse_garment_mask=coarse_garment_mask,
        exclusion_mask=exclusion_mask,
        category=garment_type
    )
    
    # ── Bézier Neck Clip ──
    print(f"\n[Info] Applying Bezier collar clipping...")
    neck_mask = extract_class_mask(seg_map, HEAD_NECK_CLASSES)
    clipped_refined_mask = bezier_neck_clip(refined_mask, neck_mask, args.collar_depth)
    cv2.imwrite(os.path.join(args.output_dir, "neck_clipped_mask.png"), clipped_refined_mask)
    
    # ── Final RGBA Extraction with De-spill ──
    print("\n[Info] Extracting clean RGBA...")
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    clean_garment = extract_garment_rgba(image_rgb, clipped_refined_mask, sampled_bg)
    clean_garment_bgr = cv2.cvtColor(clean_garment, cv2.COLOR_RGBA2BGRA)
    
    coords = cv2.findNonZero(clipped_refined_mask)
    if coords is not None:
        x, y, bw, bh = cv2.boundingRect(coords)
        cropped = clean_garment_bgr[y:y+bh, x:x+bw]
        cv2.imwrite(os.path.join(args.output_dir, "clean_garment.png"), cropped)
        print(f"  Saved: clean_garment.png ({bw}x{bh})")
    else:
        cv2.imwrite(os.path.join(args.output_dir, "clean_garment.png"), clean_garment_bgr)
        print(f"  Saved: clean_garment.png (full size)")


if __name__ == "__main__":
    main()
