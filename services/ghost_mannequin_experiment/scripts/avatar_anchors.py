"""
avatar_anchors.py

Step 2: detect_avatar_extent()  — background subtraction on V-ToN → avatar bounding box
Step 3: compute_anchor_points() — physics-informed SAM2 point prompts

Calibration source: measure_avatar_anatomy.py → anatomy_landmarks.json
All fracs are (row - body_top) / body_height, measured from bare avatar silhouettes.
All x offsets are from body_cx (fraction of image width).
"""

from __future__ import annotations
import numpy as np

# ── Calibrated anatomy fracs ──────────────────────────────────────────────────
# Fraction of body height from head_top to each landmark.
# Measured from bare avatar silhouettes (measure_avatar_anatomy.py).
#
# female body_cx_norm = 0.529  (avatar right-shifted ~3%)
# male   body_cx_norm = 0.501  (nearly centered)

ANATOMY_FRACS: dict[str, dict[str, float]] = {
    "female": {
        "neck":     0.135,
        "shoulder": 0.247,
        "bust":     0.271,
        "waist":    0.407,
        "hip":      0.518,
        "crotch":   0.727,
        "knee":     0.800,   # estimated (no clean width minimum in legs)
        "ankle":    0.930,
    },
    "male": {
        "neck":     0.119,
        "shoulder": 0.233,
        "bust":     0.296,
        "waist":    0.474,
        "hip":      0.521,
        "crotch":   0.728,
        "knee":     0.820,
        "ankle":    0.940,
    },
}

# x offset of arm outermost edge from body_cx (fraction of image width, signed).
# Negative = left of center, positive = right.
# female arm span: xL=0.326, xR=0.732 (body_cx=0.529) → offsets ±0.203
# male   arm span: xL=0.240, xR=0.762 (body_cx=0.501) → offsets ±0.261
ARM_X_OFFSETS: dict[str, dict[str, float]] = {
    "female": {"left": -0.203, "right": +0.203},
    "male":   {"left": -0.261, "right": +0.261},
}

# Torso inner x offsets (shoulder inner edge from body_cx).
# female shoulder: xL=0.333, xR=0.724 → offsets from cx=0.529: -0.196, +0.195
# male   shoulder: xL=0.247, xR=0.752 → offsets from cx=0.501: -0.254, +0.251
SHOULDER_X_OFFSETS: dict[str, dict[str, float]] = {
    "female": {"left": -0.196, "right": +0.195},
    "male":   {"left": -0.254, "right": +0.251},
}

# Waist inner x offsets (narrowest torso x from body_cx).
# female: xL=0.319, xR=0.739 → offsets: -0.210, +0.210
# male:   xL=0.213, xR=0.787 → offsets: -0.288, +0.286
WAIST_X_OFFSETS: dict[str, dict[str, float]] = {
    "female": {"left": -0.210, "right": +0.210},
    "male":   {"left": -0.288, "right": +0.286},
}

# ── Step 2: detect avatar extent ──────────────────────────────────────────────

def detect_avatar_extent(
    vton_arr_rgb: np.ndarray,
    sampled_bg: tuple[int, int, int],
    threshold: int = 25,
) -> dict | None:
    """
    Background-subtract V-ToN image to locate avatar bounding box.

    Args:
        vton_arr_rgb: HxWx3 uint8 array (RGB)
        sampled_bg:   background colour tuple (R, G, B) — from Stage 1.5
        threshold:    per-channel deviation to count as non-background

    Returns dict with:
        body_top, body_bot, body_h  (pixel rows)
        body_cx                     (pixel column, horizontal center)
        body_top_y, body_bot_y      (normalized 0–1)
        body_cx_x                   (normalized 0–1)
    Returns None if avatar not found (< 10 body rows).
    """
    H, W = vton_arr_rgb.shape[:2]
    bg    = np.array(sampled_bg[:3], dtype=float)
    dist  = np.abs(vton_arr_rgb.astype(float) - bg).max(axis=2)
    body_mask = dist > threshold

    row_has_body = body_mask.any(axis=1)
    body_rows    = np.where(row_has_body)[0]

    if len(body_rows) < 10:
        return None

    body_top = int(body_rows[0])
    body_bot = int(body_rows[-1])
    body_h   = body_bot - body_top

    if body_h < 50:
        return None

    # Horizontal center: mean x in middle 40% of body (torso zone, avoids
    # arm-width bias at shoulder level and narrow-foot bias at bottom).
    mid_lo = body_top + int(0.30 * body_h)
    mid_hi = body_top + int(0.70 * body_h)
    mid_mask = body_mask[mid_lo:mid_hi, :]
    xs = np.where(mid_mask)[1]
    body_cx = float(xs.mean()) if len(xs) > 0 else W / 2.0

    return {
        "body_top":   body_top,
        "body_bot":   body_bot,
        "body_h":     body_h,
        "body_cx":    body_cx,
        "body_top_y": body_top / H,
        "body_bot_y": body_bot / H,
        "body_cx_x":  body_cx / W,
    }


# ── Step 3: compute anchor points ─────────────────────────────────────────────

def _y(frac: float, ext: dict) -> int:
    """Anatomy frac → absolute pixel row."""
    return int(ext["body_top"] + frac * ext["body_h"])

def _x(offset: float, ext: dict, img_w: int) -> int:
    """x offset from body_cx (fraction of img_w) → absolute pixel column."""
    return int(ext["body_cx"] + offset * img_w)

def _cx(ext: dict) -> int:
    return int(ext["body_cx"])


def compute_anchor_points(
    category:  str,
    flags:     dict,
    gender:    str,
    extent:    dict,
    img_shape: tuple[int, int],   # (H, W)
) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """
    Compute SAM2 foreground + background point prompts from anatomy anchors.

    All points are (x, y) pixel tuples (SAM2 convention).

    Returns: (fg_points, bg_points)
    """
    H, W  = img_shape
    fracs = ANATOMY_FRACS.get(gender, ANATOMY_FRACS["female"])
    arm_x = ARM_X_OFFSETS.get(gender, ARM_X_OFFSETS["female"])
    sho_x = SHOULDER_X_OFFSETS.get(gender, SHOULDER_X_OFFSETS["female"])
    wai_x = WAIST_X_OFFSETS.get(gender, WAIST_X_OFFSETS["female"])

    # ── Shorthand row helpers ─────────────────────────────────────────────────
    y_neck     = _y(fracs["neck"],     extent)
    y_shoulder = _y(fracs["shoulder"], extent)
    y_bust     = _y(fracs["bust"],     extent)
    y_waist    = _y(fracs["waist"],    extent)
    y_hip      = _y(fracs["hip"],      extent)
    y_crotch   = _y(fracs["crotch"],   extent)
    y_knee     = _y(fracs["knee"],     extent)
    y_ankle    = _y(fracs["ankle"],    extent)
    y_above    = max(0, extent["body_top"] - int(0.03 * H))  # above head

    cx         = _cx(extent)
    x_arm_L    = _x(arm_x["left"],  extent, W)
    x_arm_R    = _x(arm_x["right"], extent, W)
    x_sho_L    = _x(sho_x["left"],  extent, W)
    x_sho_R    = _x(sho_x["right"], extent, W)
    x_wai_L    = _x(wai_x["left"],  extent, W)
    x_wai_R    = _x(wai_x["right"], extent, W)

    # ── Universal background corners ──────────────────────────────────────────
    margin = max(10, int(0.02 * min(H, W)))
    bg = [
        (margin,   margin),        # top-left
        (W-margin, margin),        # top-right
        (margin,   H-margin),      # bottom-left
        (W-margin, H-margin),      # bottom-right
        (cx,       y_above),       # above head
    ]

    # ── Per-category foreground + supplemental background ─────────────────────

    if category == "topwear":
        fg = [
            (cx,              y_bust),              # chest center
            (cx + int(0.08*W), y_bust + int(0.04*H)),   # right of center, slightly lower
            (cx - int(0.08*W), y_bust + int(0.04*H)),   # left of center
        ]
        # Supplemental bg: below garment, far arms
        bg += [
            (cx,    y_hip),          # below typical top hem
            (cx,    y_knee),         # lower body
            (x_arm_L, y_bust),       # far left arm
            (x_arm_R, y_bust),       # far right arm
        ]
        # Open front / wrap: shift fg off center-line (gap in center)
        if flags.get("is_open_front") or flags.get("has_wrap_front"):
            fg = [
                (cx - int(0.10*W), y_bust),           # left panel
                (cx + int(0.10*W), y_bust),           # right panel
                (cx - int(0.08*W), y_waist - int(0.03*H)),
                (cx + int(0.08*W), y_waist - int(0.03*H)),
            ]

    elif category == "bottomwear":
        fg = [
            (cx,              y_waist + int(0.02*H)),  # just below waistband
            (cx - int(0.08*W), y_hip),                 # left hip
            (cx + int(0.08*W), y_hip),                 # right hip
            (cx - int(0.07*W), y_knee - int(0.05*H)), # left thigh
            (cx + int(0.07*W), y_knee - int(0.05*H)), # right thigh
        ]
        bg += [
            (cx,    y_shoulder),     # upper chest — not garment
            (cx,    y_neck),         # neck zone
            (x_arm_L, y_hip),        # far left of body
            (x_arm_R, y_hip),        # far right
        ]
        # Overalls / dungarees: bib is above waistline
        if flags.get("has_overalls"):
            fg += [
                (cx,               y_bust),   # bib chest zone
                (cx - int(0.07*W), y_bust),
                (cx + int(0.07*W), y_bust),
            ]
            # Remove the shoulder bg point (bib reaches near shoulder)
            bg = [p for p in bg if p[1] != y_shoulder]

    elif category == "dresses":
        # Mid-skirt y: between hip and knee for standard dresses,
        # between knee and ankle for maxi dresses.
        y_skirt_mid = int((y_hip + y_knee) / 2)

        fg = [
            (cx,              y_bust),           # chest
            (cx,              y_waist),          # waist
            (cx,              y_skirt_mid),      # skirt body
            (cx - int(0.07*W), y_hip),           # left hip
            (cx + int(0.07*W), y_hip),           # right hip
        ]
        bg += [
            (cx,    y_above),         # already in bg (double-OK)
            (x_arm_L, y_bust),        # far arms
            (x_arm_R, y_bust),
        ]
        # Jumpsuit: add lower leg fg, remove below-knee bg
        if flags.get("is_jumpsuit"):
            fg += [
                (cx - int(0.06*W), y_knee + int(0.03*H)),  # left shin
                (cx + int(0.06*W), y_knee + int(0.03*H)),  # right shin
                (cx - int(0.05*W), y_ankle - int(0.02*H)),
                (cx + int(0.05*W), y_ankle - int(0.02*H)),
            ]
        # Wrap front: shift bust fg off center
        if flags.get("has_wrap_front"):
            fg[0] = (cx - int(0.10*W), y_bust)   # left panel primary
            fg.insert(1, (cx + int(0.10*W), y_bust))

    elif category == "footwear":
        # Footwear V-ToN shows only feet/shoes — avatar body mostly background.
        # Foreground anchors at foot zone.
        y_foot_zone = int(extent["body_bot"] - 0.30 * extent["body_h"])
        fg = [
            (cx,              y_ankle),                        # center top of shoe
            (cx - int(0.10*W), extent["body_bot"] - int(0.05*H)),  # left shoe
            (cx + int(0.10*W), extent["body_bot"] - int(0.05*H)),  # right shoe
            (cx,               extent["body_bot"] - int(0.05*H)),  # center foot
        ]
        bg += [
            (cx,    y_knee),      # above shoes
            (cx,    y_waist),     # well above shoes
        ]

    else:
        # Unknown category — minimal safe anchors
        fg = [(cx, int(H / 2))]

    # ── Belt: extra fg points at waist line ───────────────────────────────────
    if flags.get("has_belt") and category in ("topwear", "dresses"):
        fg += [
            (cx,              y_waist),
            (cx - int(0.08*W), y_waist),
            (cx + int(0.08*W), y_waist),
        ]

    # ── Clamp all points to image bounds ─────────────────────────────────────
    def clamp(pts):
        return [(max(0, min(W-1, x)), max(0, min(H-1, y))) for x, y in pts]

    return clamp(fg), clamp(bg)


# ── Validation helpers ────────────────────────────────────────────────────────

CATEGORY_QA: dict[str, dict] = {
    "topwear":    {"min_frac": 0.05, "max_frac": 0.55,
                   "centroid_y_max": 0.70},
    "bottomwear": {"min_frac": 0.08, "max_frac": 0.65,
                   "centroid_y_min": 0.35},
    "dresses":    {"min_frac": 0.10, "max_frac": 0.85,
                   "centroid_y_min": 0.25, "centroid_y_max": 0.80},
    "footwear":   {"min_frac": 0.01, "max_frac": 0.30,
                   "centroid_y_min": 0.60},
}


def validate_mask(mask: np.ndarray, category: str) -> tuple[bool, str]:
    """
    Quick sanity check: coverage fraction + centroid position.
    Returns (ok, reason_string).
    """
    qa       = CATEGORY_QA.get(category, {})
    img_area = mask.size
    frac     = mask.sum() / img_area

    if "min_frac" in qa and frac < qa["min_frac"]:
        return False, f"coverage {frac:.2%} < min {qa['min_frac']:.0%}"
    if "max_frac" in qa and frac > qa["max_frac"]:
        return False, f"coverage {frac:.2%} > max {qa['max_frac']:.0%}"

    ys, _ = np.where(mask)
    if len(ys) == 0:
        return False, "empty mask"
    cy = ys.mean() / mask.shape[0]

    if "centroid_y_max" in qa and cy > qa["centroid_y_max"]:
        return False, f"centroid y={cy:.2f} too low (>{qa['centroid_y_max']})"
    if "centroid_y_min" in qa and cy < qa["centroid_y_min"]:
        return False, f"centroid y={cy:.2f} too high (<{qa['centroid_y_min']})"

    return True, "OK"
