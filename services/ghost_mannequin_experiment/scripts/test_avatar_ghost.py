#!/usr/bin/env python3
"""
Avatar V-TON → Segmentation → Ghost Mannequin — test script

Pipeline:
  Stage 0: Fetch avatar from Supabase storage (same asset as ingestion service)
  Stage 1: Gemini text → extract GARMENT_PHYSICS (skip with --garment-physics)
  Stage 2: Gemini image gen → avatar wearing garment (per-category V-TON prompts)
  Stage 3: SegFormer clothing segmentation → clothing mask
  Output:  Clothing composited on white = ghost mannequin

Required env vars:
  GEMINI_API_KEY              (or GOOGLE_API_KEY)
  SUPABASE_URL                your project URL
  SUPABASE_SERVICE_ROLE_KEY   service role key (same as ingestion service)

Required args:
  --garment <path>   Product image (flatlay or product shot)

Optional args:
  --model-shot <path>    Model wearing item — improves Stage 1 physics accuracy
  --view                 front | back  (default: front)
  --category             topwear | bottomwear | footwear | dresses  (default: topwear)
  --gender               male | female  (default: female)
  --body-type            standard | athletic | slim | plus | petite
  --body-type-desc       Freeform body physics override
  --garment-physics      Paste GARMENT_PHYSICS text to skip Stage 1
  --geometry-skeleton    GEOMETRY_SKELETON text (used for back view Stage 1 bypass)
  --item-name            Product name (only needed when skipping Stage 1)
  --output-dir           Where to save outputs (default: ./ghost_output)
  --image-model          Gemini image model override
  --text-model           Gemini text model override
  --storage-bucket       Supabase bucket name (default: ingested_inventory)

Outputs in --output-dir:
  stage0_avatar.png              Avatar fetched from Supabase
  stage1_garment_physics.txt     Extracted physics JSON
  stage2_avatar_vton.png         Avatar wearing garment
  stage3_clothing_mask.png       Segmentation mask
  ghost_mannequin.png            Final ghost mannequin

Install deps:
  pip install google-genai pillow transformers torch torchvision requests scipy
"""

import os
import sys
import argparse
import json
import io
from pathlib import Path
from typing import Optional

import requests
import numpy as np
from PIL import Image
from google import genai
from google.genai import types

# Physics-informed SAM2 point-prompt module (Steps 2+3)
try:
    from avatar_anchors import detect_avatar_extent, compute_anchor_points, validate_mask as _validate_anchor_mask
    _ANCHOR_AVAILABLE = True
except ImportError:
    _ANCHOR_AVAILABLE = False

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_TEXT_MODEL   = "gemini-3.1-pro-preview"
DEFAULT_IMAGE_MODEL  = "gemini-3-pro-image-preview"
DEFAULT_BUCKET       = "ingested_inventory"

# Matches MANNEQUIN_ASSETS in ghostPrompts.ts
AVATAR_PATHS = {
    "male":   {"front": "avatars/male/bodytype1/male_asset.png",
               "back":  "avatars/male/bodytype1/male_asset.png"},
    "female": {"front": "avatars/female/bodytype1/female_asset.png",
               "back":  "avatars/female/bodytype1/female_asset.png"},
}

# SegFormer label indices — mattmdjaga/segformer_b2_clothes
# 0=Background 1=Hat 2=Hair 3=Sunglasses 4=Upper-clothes 5=Skirt
# 6=Pants 7=Dress 8=Belt 9=Left-shoe 10=Right-shoe 11=Face
# 12=Left-leg 13=Right-leg 14=Left-arm 15=Right-arm 16=Bag 17=Scarf
CLOTHING_LABELS = {
    "topwear":    [4, 7],   # upper-clothes or dress (SegFormer often labels peplum/long tops as dress)
    "bottomwear": [5, 6],
    "dresses":    [4, 7],
    "footwear":   [9, 10],
}

# SegFormer labels always vetoed from final mask regardless of category.
# 1=Hat 2=Hair 3=Glasses 11=Face 14=L-arm 15=R-arm 16=Bag 17=Scarf
# NOTE: 12=L-leg 13=R-leg intentionally EXCLUDED from base list — see CATEGORY_GARMENT_EXCLUSIONS.
#   Leg labels are only vetoed for topwear/dresses where exposed thigh is wrong.
#   For bottomwear, SegFormer mis-classifies dark trouser hems as leg-skin → false exclusion.
BODY_EXCLUSION_LABELS = [1, 2, 3, 11, 14, 15, 16, 17]

# Additional SegFormer garment labels vetoed per category.
# Prevents SAM2 mask bleeding into garment zones that belong to a different category.
# Rules: never include a label that resolve_labels() returns for that category.
CATEGORY_GARMENT_EXCLUSIONS: dict = {
    # topwear uses labels 4,7 → veto bottomwear(5,6) + shoes(9,10) + leg-skin(12,13) below hem
    "topwear":    [5, 6, 9, 10, 12, 13],
    # bottomwear uses labels 5,6 → veto upper(4), shoes(9,10); NOT belt(8) — belted jeans
    # 7 (dress) REMOVED: short skirts/mini skirts labeled as "dress" by SegFormer → false exclusion
    #   splits the garment mask. GDINO box already constrains SAM2 to garment; dress-label
    #   exclusion is redundant and harmful for short bottomwear.
    # 12/13 NOT vetoed: GDINO box constrains SAM2; mis-labelled ankle hems cause false notches.
    "bottomwear": [4, 9, 10],
    # dresses use labels 4,7 → veto only shoes; dress spans full body so leg labels OK
    "dresses":    [9, 10],
    # footwear uses labels 9,10 → veto all clothing above
    "footwear":   [4, 5, 6, 7, 8],
}

# ── GroundingDINO constants ───────────────────────────────────────────────────

GDINO_MODEL_ID          = "IDEA-Research/grounding-dino-base"
GDINO_BOX_THRESHOLD     = 0.25   # model-level threshold passed to post_process (lowered: synthetic V-ToN images score ~0.30-0.35)
GDINO_TEXT_THRESHOLD    = 0.20   # min token score for label assignment
GDINO_MIN_SCORE         = 0.28   # post-GDINO score filter (drops marginal false positives)
GDINO_NMS_IOU           = 0.65   # per-label NMS IoU threshold
GDINO_CROSS_NMS_IOU     = 0.50   # cross-label NMS: suppress lower-score box if IoU > this
GDINO_ACCESSORY_OVERLAP = 0.20   # min fraction of accessory bbox overlapping primary union

# Words that should NOT become standalone GDINO tokens when extracted from subcategory strings.
# These are anatomical parts, pure adjectives/descriptors, or prepositions that cause
# GDINO to detect garment PARTS rather than the full garment.
_SUBCATEGORY_WORD_BLOCKLIST: frozenset[str] = frozenset({
    # Anatomical parts / garment regions
    "sleeve", "sleeves", "neck", "neckline", "shoulder", "shoulders",
    "hem", "waist", "collar", "cuff", "cuffs", "chest", "back", "front",
    # Length / style adjectives
    "long", "short", "midi", "mini", "maxi", "full", "half", "cold", "off",
    # Fit / silhouette descriptors
    "fit", "flare", "flared", "cropped", "slim", "wide", "loose", "fitted",
    "open", "closed", "solid", "sheer", "lace", "lacy", "asymmetric",
    # Neckline shapes (too generic)
    "crew", "boat", "round", "square", "deep",
    # Materials used as adjectives (keep specific ones that GDINO knows)
    # "knit" is fine to keep; blocklist only ambiguous ones
    # Prepositions / function words
    "and", "the", "with", "for", "in", "of", "an",
    # Very short words already filtered by len>2, kept here for clarity
    "a", "v", "u",
    # Colour words  (colour is garment property, not garment type)
    "black", "white", "blue", "red", "green", "yellow", "pink",
    "gray", "grey", "beige", "brown", "orange", "purple", "navy",
})

# SegFormer labels that are ALWAYS excluded — even from the component guaranteed region.
# Face, hair, hat and glasses should never appear in the ghost regardless of any guarantee.
_HEAD_ALWAYS_EXCLUDE_LABELS: tuple[int, ...] = (1, 2, 3, 11)  # hat, hair, glasses, face

# Per-category text token sets for GDINO prompt construction
BASE_GDINO_TOKENS: dict = {
    "topwear": {
        "primary":   ["shirt", "top", "blouse", "jacket", "coat", "sweater",
                      "hoodie", "vest", "cardigan", "blazer", "tshirt", "tee",
                      "tunic", "polo", "pullover", "sweatshirt", "cape", "poncho",
                      "halter", "strap"],
        "accessory": ["belt", "scarf", "collar"],
    },
    "bottomwear": {
        "primary":   ["pants", "jeans", "trousers", "skirt", "shorts",
                      "leggings", "culottes", "chinos", "palazzos", "joggers"],
        "accessory": ["belt"],
    },
    "dresses": {
        "primary":   ["dress", "gown", "frock", "jumpsuit", "romper", "playsuit"],
        "accessory": ["belt", "sash"],
    },
    "footwear": {
        "primary":   ["shoe", "boot", "sneaker", "heel", "sandal", "loafer",
                      "oxford", "pump", "mule", "clog", "slipper", "wedge"],
        "accessory": [],
    },
}

# Maps Gemini-identified structural components → GDINO query token.
# None = no reliable GDINO token; falls back to spatially-scoped SegFormer guarantee.
COMPONENT_TO_GDINO_TOKEN: dict[str, str | None] = {
    "bib":               "bib",
    "shoulder strap":    "strap",
    "suspender":         "strap",
    "halter neck":       "halter",
    "belt":              "belt",
    "sash":              "sash",
    "scarf detail":      "scarf",
    "hood":              None,
    "cape":              "cape",
    "shawl collar":      None,
    "peplum":            None,
    "fringe hem":        None,
    "train":             None,
    "wrap panel":        None,
    "detachable collar": "collar",
}

# Recognized fashion nouns for item_name token extraction
FASHION_NOUNS: set = {
    "shirt", "blouse", "top", "tee", "tshirt", "tunic", "polo", "sweater",
    "pullover", "cardigan", "hoodie", "sweatshirt", "jacket", "blazer", "coat",
    "vest", "waistcoat", "parka", "anorak", "windbreaker", "cape", "poncho",
    "pants", "jeans", "trousers", "chinos", "slacks", "leggings", "tights",
    "skirt", "shorts", "culottes", "palazzos", "joggers", "sweatpants",
    "dress", "gown", "frock", "kaftan", "maxi", "midi", "mini",
    "jumpsuit", "romper", "playsuit", "catsuit", "overalls", "dungarees",
    "shoe", "shoes", "boot", "boots", "sneaker", "sneakers", "heel", "heels",
    "sandal", "sandals", "loafer", "loafers", "oxford", "mule", "mules",
    "pump", "pumps", "slipper", "slippers", "clog", "clogs", "wedge", "flatform",
    "belt", "sash", "scarf", "wrap",
}

BODY_TYPE_PRESETS = {
    "standard":  "Standard proportions, balanced shoulder-to-hip ratio, neutral stance, arms slightly away from body.",
    "athletic":  "Athletic build, broad shoulders, defined chest, narrower waist, muscular arms.",
    "slim":      "Slim build, narrow shoulders, lean frame, minimal shoulder-hip differential.",
    "plus":      "Fuller figure, wider shoulders and hips, voluminous torso — garment has more ease and drape.",
    "petite":    "Petite frame, shorter limbs, compact torso, reduced overall height proportions.",
}

# ── Stage 0: Fetch avatar from Supabase storage ───────────────────────────────

def fetch_supabase_avatar(gender: str, view: str, bucket: str) -> Image.Image:
    """
    Download avatar PNG from Supabase storage.
    Mirrors resolveImageBuffer(avatarPath) in ghostNode — same bucket, same path.
    """
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not service_key:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars "
            "to fetch the avatar from storage."
        )

    avatar_path = AVATAR_PATHS[gender][view]
    url = f"{supabase_url}/storage/v1/object/{bucket}/{avatar_path}"

    print(f"  Fetching: {url}")
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {service_key}"},
        timeout=30,
    )
    resp.raise_for_status()

    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    return img

# ── Stage 1: GARMENT_PHYSICS extraction ──────────────────────────────────────
# Mirrors garmentSummaryNode stage1 prompts from ghostPrompts.ts

STAGE1_SYSTEMS = {
    "topwear": """\
You are an expert Technical Fashion Designer for a high-end e-commerce platform. \
Your sole purpose is to analyze visual inputs (flatlay and on-model imagery) of TOPWEAR \
garments and extract precise, objective technical specifications.

Operational Rules:
1. Objective Analysis: Output only technical facts from the provided images. Do not hallucinate.
2. Exhaustive Check: Evaluate all 10 categories listed.
3. Handling Uncertainty: If a detail is not clearly visible, write 'unknown'.
4. Strict Formatting: Output [TECH_PACK], ITEM_NAME, GENDER, and [GARMENT_PHYSICS] in order.
5. Frontal Visual Bias: Focus exclusively on the front face of the garment.\
""",
    "bottomwear": """\
You are an expert Technical Fashion Designer for a high-end e-commerce platform. \
Your sole purpose is to analyze visual inputs of BOTTOMWEAR garments and extract \
precise, objective technical specifications.

Operational Rules:
1. Objective Analysis: Output only technical facts. Do not hallucinate.
2. Exhaustive Check: Evaluate all 10 categories.
3. Handling Uncertainty: Write 'unknown' for unclear details.
4. Strict Formatting: Output [TECH_PACK] then [GARMENT_PHYSICS].
5. Frontal Visual Bias: Focus on the front face only — ignore back pockets, rear yoke.\
""",
    "dresses": """\
You are an expert Technical Fashion Designer for a high-end e-commerce platform. \
Your sole purpose is to analyze visual inputs of DRESSES and extract precise, \
objective technical specifications.

Operational Rules:
1. Objective Analysis: Output only technical facts. Do not hallucinate.
2. Exhaustive Check: Evaluate all 11 categories.
3. Handling Uncertainty: Write 'unknown' for unclear details.
4. Strict Formatting: Output [TECH_PACK] then [GARMENT_PHYSICS].\
""",
    "footwear": """\
You are an expert Footwear Technologist and Product Developer for a luxury \
e-commerce platform. Your sole purpose is to analyze visual inputs of FOOTWEAR \
and extract precise, objective technical specifications.

Operational Rules:
1. Objective Analysis: Output only technical facts. Do not hallucinate.
2. Exhaustive Check: Evaluate all 10 categories.
3. Handling Uncertainty: Write 'unknown' for unclear details.
4. Strict Formatting: Output [TECH_PACK] then [SHOE_PHYSICS].
5. Front-Facing Bias: Describe the shoe from the front.\
""",
}

STAGE1_PROMPTS = {
    "topwear": """\
Input Visuals: [Attached: Flatlay Image, Model Shot Image if provided]

Analyze the TOPWEAR garment across these 10 categories:
1. Material Physics: Fabric type/fiber, weight, stretch/recovery, opacity, lining.
2. Surface Micro-Texture: Surface character, sheen, embellishments.
3. Neckline Construction: Shape, collar type, depth/width, placket, finishing.
4. Closure: Type, placement, visibility, fastener details.
5. Sleeve: Length, cut, volume, cuff style.
6. Hemline: Length, shape, side details (vents/slits).
7. Fit Silhouette: Overall shape, structure, ease.
8. Color (Hex Codes): Dominant + secondary colors, hardware.
9. Pattern / Graphic Design: Type, scale, density, directionality.
10. Peculiar Notes: Distinctive construction or functional features.
11. Gender: Gender of the model.

Required Output:

[TECH_PACK]
Material_Physics: <clause>
Surface_Micro_Texture: <clause>
Neckline_Construction: <clause>
Closure: <clause>
Sleeve: <clause>
Hemline: <clause>
Fit_Silhouette: <clause>
Color: <clause with hex codes>
Pattern_Design: <clause>
Peculiar_Notes: <clause>

Gender: <male or female>
ITEM_NAME: <brand + merchandise name>

[GARMENT_PHYSICS]
<A single dense paragraph. Start: 'A direct front view of a...' Cover light interaction, \
fabric type, all 10 categories. No extra commentary.>

[SUBCATEGORY]
<Top 3 most specific garment sub-types, comma-separated, lowercase. Examples: dungarees/halter top/wrap dress/palazzo pants>

[COMPONENTS]
<Comma-separated list of segmentation-critical structural attachments ONLY. Choose from: bib, shoulder strap, suspender, halter neck, belt, sash, scarf detail, hood, cape, shawl collar, peplum, fringe hem, train, wrap panel, detachable collar. Leave blank if none apply.>\
""",
    "bottomwear": """\
Input Visuals: [Attached: Flatlay Image, Model Shot Image if provided]

Analyze the BOTTOMWEAR garment across these 10 categories:
1. Material Physics: Fabric type/fiber, weight, stretch, opacity, lining.
2. Surface Micro-Texture: Surface character, weave density, sheen.
3. Waistband & Rise Construction: Rise level, waistband style, closure visibility.
4. Closure Details: Fly type, hardware (buttons/zippers/hooks).
5. Leg/Skirt Shape & Drape Behavior: Silhouette and how fabric falls.
6. Hem Termination: Cuff style, stitching, raw edge.
7. Fit Silhouette & Tension: Ease through hip/thigh, tension wrinkles.
8. Color (Hex Codes): Dominant color, wash details, contrast stitching, hardware.
9. Pattern / Graphic Design: Type, scale, density.
10. Primary Embellishments & Pocketing: Surface applications and pocket layout.

Required Output:

[TECH_PACK]
Material_Physics: <clause>
Surface_Micro_Texture: <clause>
Waistband_Rise: <clause>
Closure: <clause>
Leg_Shape_Drape: <clause>
Hemline: <clause>
Fit_Silhouette: <clause>
Color: <clause with hex codes>
Pattern_Design: <clause>
Embellishments_Pocketing: <clause>

Gender: <male or female>
ITEM_NAME: <brand + merchandise name>

[GARMENT_PHYSICS]
<A single dense paragraph starting with weight, texture, and color. Describe fit, drape, \
gravity behavior, and all front-visible hardware. Do NOT mention back pockets or rear yoke.>

[SUBCATEGORY]
<Top 3 most specific garment sub-types, comma-separated, lowercase. Examples: dungarees/halter top/wrap dress/palazzo pants>

[COMPONENTS]
<Comma-separated list of segmentation-critical structural attachments ONLY. Choose from: bib, shoulder strap, suspender, halter neck, belt, sash, scarf detail, hood, cape, shawl collar, peplum, fringe hem, train, wrap panel, detachable collar. Leave blank if none apply.>\
""",
    "dresses": """\
Input Visuals: [Attached: Flatlay Image, Model Shot Image if provided]

Analyze the DRESS garment across these 11 categories:
1. Material Physics: Fabric type/fiber, weight, stretch, opacity, lining status.
2. Surface Micro-Texture: Surface character, sheen, embellishments.
3. Neckline Construction: Shape, collar type, depth/width, finishing.
4. Closure: Type, placement (critical: back zip, side zip, front buttons, pullover).
5. Sleeve: Length, cut, volume, cuff. Write 'sleeveless' if applicable.
6. Waistline Construction: Defined seam, elasticized, drawstring, belted, or shift.
7. Hemline (Length & Style): Mini/knee/midi/maxi/floor + shape + tiered/ruffled/slit.
8. Fit Silhouette: A-line, Shift, Sheath, Bodycon, Fit-and-Flare, Slip, Wrap, Empire.
9. Color (Hex Codes): Dominant + accent colors, hardware.
10. Pattern / Graphic Design: Type, scale, density, directionality.
11. Peculiar Notes: Cut-outs, twist details, layered effects, pockets.

Required Output:

[TECH_PACK]
Material_Physics: <clause>
Surface_Micro_Texture: <clause>
Neckline_Construction: <clause>
Closure: <clause>
Sleeve: <clause>
Waistline_Construction: <clause>
Hemline: <clause>
Fit_Silhouette: <clause>
Color: <clause with hex codes>
Pattern_Design: <clause>
Peculiar_Notes: <clause>

Gender: <male or female>
ITEM_NAME: <brand + merchandise name>

[GARMENT_PHYSICS]
<A single dense paragraph. Start with light interaction and fabric type. Cover all \
categories including skirt length and silhouette. No extra commentary.>

[SUBCATEGORY]
<Top 3 most specific garment sub-types, comma-separated, lowercase. Examples: dungarees/halter top/wrap dress/palazzo pants>

[COMPONENTS]
<Comma-separated list of segmentation-critical structural attachments ONLY. Choose from: bib, shoulder strap, suspender, halter neck, belt, sash, scarf detail, hood, cape, shawl collar, peplum, fringe hem, train, wrap panel, detachable collar. Leave blank if none apply.>\
""",
    "footwear": """\
Input Visuals: [Attached: Source Shoe Image(s)]

Analyze the FOOTWEAR item across these 10 categories:
1. Material & Finish: Upper material and finish (patent/matte/brushed).
2. Sole Construction: Outsole type, heel type, thickness/platform height.
3. Toe Box Shape: Pointed/Square/Round/Almond/Open-toe.
4. Shaft & Collar: Height (low-top/ankle/knee-high), padding, rigidity.
5. Closure System: Laces, zippers, buckles, or slip-on.
6. Surface Texture & Stitching: Grain, perforation, quilting, contrast stitching.
7. Rigidity & Form: How shoe holds its shape.
8. Color (Hex Codes): Dominant upper, sole, hardware.
9. Branding & Graphics: Logo placement, patterns, embossed details.
10. Hardware & Embellishments: Metal bits, studs, chains, eyelets, tassels.

Required Output:

[TECH_PACK]
Material_Finish: <clause>
Sole_Construction: <clause>
Toe_Box_Shape: <clause>
Shaft_Collar: <clause>
Closure_System: <clause>
Surface_Texture: <clause>
Rigidity_Form: <clause>
Color: <clause>
Branding: <clause>
Hardware_Embellishments: <clause>

Gender: <male or female>
ITEM_NAME: <brand + merchandise name>

[SHOE_PHYSICS]
<A single dense paragraph. Mention which foot and that both are symmetrical. Describe \
silhouette, material light reaction, structural rigidity, sole unit, and all visible \
hardware from a front-facing standing angle.>

[SUBCATEGORY]
<Top 3 most specific garment sub-types, comma-separated, lowercase. Examples: dungarees/halter top/wrap dress/palazzo pants>

[COMPONENTS]
<Comma-separated list of segmentation-critical structural attachments ONLY. Choose from: bib, shoulder strap, suspender, halter neck, belt, sash, scarf detail, hood, cape, shawl collar, peplum, fringe hem, train, wrap panel, detachable collar. Leave blank if none apply.>\
""",
}

def pil_to_part(img: Image.Image) -> types.Part:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")


def run_stage1(
    garment_path: Path,
    model_shot_path: Optional[Path],
    category: str,
    text_model: str,
    client: genai.Client,
) -> dict:
    print("[Stage 1] Extracting GARMENT_PHYSICS via Gemini...")

    system = STAGE1_SYSTEMS.get(category, STAGE1_SYSTEMS["topwear"])
    prompt = STAGE1_PROMPTS.get(category, STAGE1_PROMPTS["topwear"])

    contents: list = [pil_to_part(Image.open(garment_path))]
    if model_shot_path and model_shot_path.exists():
        contents.append(pil_to_part(Image.open(model_shot_path)))
    contents.append(prompt)

    response = client.models.generate_content(
        model=text_model,
        contents=contents,
        config=types.GenerateContentConfig(system_instruction=system),
    )
    text = response.text

    # Parse physics block — key differs for footwear
    physics_key = "[SHOE_PHYSICS]" if category == "footwear" else "[GARMENT_PHYSICS]"
    physics = ""
    if physics_key in text:
        raw = text.split(physics_key, 1)[1].strip()
        for stop in ["\n[", "\nITEM_NAME", "\nGENDER"]:
            if stop in raw:
                raw = raw[: raw.index(stop)]
        physics = raw.strip()

    item_name = "garment"
    gender = "female"
    for line in text.splitlines():
        if line.startswith("ITEM_NAME:"):
            item_name = line.split(":", 1)[1].strip()
        if line.startswith("Gender:") or line.startswith("GENDER:"):
            val = line.split(":", 1)[1].strip().lower()
            # check "female" first — "male" is a substring of "female"
            if "female" in val:
                gender = "female"
            elif "male" in val:
                gender = "male"

    if not physics:
        physics = text.strip()

    # Parse [SUBCATEGORY]
    subcategories = []
    if "[SUBCATEGORY]" in text:
        raw_sub = text.split("[SUBCATEGORY]", 1)[1].strip()
        for stop in ["\n[", "\nITEM_NAME", "\nGENDER"]:
            if stop in raw_sub:
                raw_sub = raw_sub[: raw_sub.index(stop)]
        subcategories = [s.strip().lower() for s in raw_sub.strip().split(",") if s.strip()]

    # Parse [COMPONENTS]
    components = []
    comp_key = "[COMPONENTS]"
    if comp_key in text:
        raw_comp = text.split(comp_key, 1)[1].strip()
        for stop in ["\n[", "\nITEM_NAME", "\nGENDER"]:
            if stop in raw_comp:
                raw_comp = raw_comp[: raw_comp.index(stop)]
        components = [c.strip().lower() for c in raw_comp.strip().split(",") if c.strip()]

    return {
        "garment_physics": physics,
        "item_name": item_name,
        "gender": gender,
        "flags": detect_garment_flags(physics, item_name),
        "subcategories": subcategories,
        "components": components,
    }

# ── Garment flag detection ────────────────────────────────────────────────────

import re as _re

_DISTRESSED_RE = _re.compile(
    r'\b(distress|rip|rips|ripped|torn|tear|tears|destroy|destroyed|hole|holes'
    r'|fray|frayed|shred|shredded|slash|slashed|worn|abraded|damage|damaged)\b',
    _re.IGNORECASE,
)
_BELT_RE = _re.compile(
    r'\b(belt|belted|cinch|cinched|sash|obi|waist\s*strap|tie\s*waist|self-tie)\b',
    _re.IGNORECASE,
)
_SHEER_RE = _re.compile(
    r'\b(sheer|transparent|see-through|mesh|lace|chiffon|voile|organza|gauze'
    r'|tulle|fishnet|crochet)\b',
    _re.IGNORECASE,
)
_CUTOUT_RE = _re.compile(
    r'\b(cut.?out|cut.?outs|cutout|keyhole|peekaboo|peek-a-boo|open.back'
    r'|backless|open.shoulder|cold.shoulder)\b',
    _re.IGNORECASE,
)
_FRINGE_RE = _re.compile(
    r'\b(fringe|fringed|tassel|tasseled|macram[eé])\b',
    _re.IGNORECASE,
)
_RAW_EDGE_RE = _re.compile(
    r'\b(raw[\s\-]?edge|raw[\s\-]?hem|deconstructed|unfinished[\s\-]?hem)\b',
    _re.IGNORECASE,
)
_WRAP_FRONT_RE = _re.compile(
    r'\b(wrap[\s\-]?dress|wrap[\s\-]?skirt|wrap[\s\-]?front|kimono[\s\-]?wrap|wrap[\s\-]?style)\b',
    _re.IGNORECASE,
)
_OPEN_FRONT_RE = _re.compile(
    r'\b(open[\s\-]?front|open[\s\-]?blazer|open[\s\-]?weave|cardigan)\b',
    _re.IGNORECASE,
)
_JUMPSUIT_RE = _re.compile(
    r'\b(jumpsuit|romper|playsuit|one[\s\-]?piece|onesie|catsuit|boilersuit|coverall)\b',
    _re.IGNORECASE,
)
_TWO_PIECE_RE = _re.compile(
    r'\b(two[\s\-]?piece|co[\s\-]?ord|coord[\s\-]?set|matching[\s\-]?set|crop[\s\-]?set'
    r'|top[\s\-]?and[\s\-]?skirt|top[\s\-]?and[\s\-]?short)\b',
    _re.IGNORECASE,
)
_PEPLUM_RE = _re.compile(
    r'\b(peplum|flounce[\s\-]?waist)\b',
    _re.IGNORECASE,
)
_OVERALLS_RE = _re.compile(
    r'\b(overalls|dungarees|bib[\s\-]?overall|bib[\s\-]?pant)\b',
    _re.IGNORECASE,
)


# ── Garment color → contrasting background ───────────────────────────────────

# Keyword → approximate sRGB  (R, G, B) 0-255
_COLOR_KEYWORDS: list[tuple[tuple, list[str]]] = [
    # Neutrals / achromatic
    ((0,   0,   0),   ["black", "jet", "onyx", "ebony", "charcoal", "graphite", "ink"]),
    ((255, 255, 255),  ["white", "ivory", "cream", "off-white", "ecru", "snow", "pearl"]),
    ((128, 128, 128),  ["gray", "grey", "silver", "ash", "slate", "stone", "heather"]),
    # Browns / earth
    ((101,  67,  33),  ["brown", "chocolate", "coffee", "espresso", "cocoa",
                        "dark brown", "mahogany", "walnut"]),
    ((205, 170, 125),  ["tan", "camel", "sand", "khaki", "beige", "taupe",
                        "champagne", "nude", "blush-nude"]),
    ((210, 180, 140),  ["beige", "linen", "wheat", "biscuit", "oat", "natural"]),
    ((205, 133,  63),  ["copper", "bronze", "rust", "amber", "caramel", "toffee",
                        "cognac", "ginger", "sienna"]),
    # Reds / pinks
    ((220,  20,  60),  ["red", "crimson", "scarlet", "cherry", "ruby", "wine", "burgundy",
                        "maroon", "oxblood"]),
    ((255, 105, 180),  ["pink", "blush", "rose", "salmon", "coral", "flamingo",
                        "hot pink", "fuchsia", "magenta", "bubblegum"]),
    ((150,   0,  50),  ["burgundy", "maroon", "wine", "merlot", "oxblood", "dark red"]),
    # Yellows / oranges
    ((255, 215,   0),  ["yellow", "gold", "mustard", "saffron", "sunshine",
                        "lemon", "canary", "daffodil"]),
    ((255, 165,   0),  ["orange", "tangerine", "apricot", "papaya", "peach",
                        "burnt orange", "pumpkin"]),
    # Greens
    ((0,  128,   0),   ["green", "olive", "khaki-green", "sage", "moss",
                        "hunter green", "forest green", "army green", "military green"]),
    ((0,  200, 100),   ["mint", "seafoam", "aqua green", "lime", "chartreuse"]),
    ((100, 150, 100),  ["sage", "dusty green", "eucalyptus", "fern"]),
    # Blues
    ((0,   0, 139),    ["navy", "dark navy", "navy blue", "midnight", "midnight blue"]),
    ((0,   0, 255),    ["blue", "cobalt", "royal blue", "electric blue"]),
    ((30, 144, 255),   ["sky blue", "cornflower", "periwinkle", "denim blue"]),
    ((135, 206, 235),  ["light blue", "powder blue", "ice blue", "baby blue"]),
    ((54,  90, 140),   ["medium blue", "medium blue wash", "indigo", "steel blue",
                        "chambray"]),
    # Purples
    ((128,   0, 128),  ["purple", "violet", "plum", "grape", "eggplant",
                        "lavender dark", "dark purple"]),
    ((216, 191, 216),  ["lavender", "lilac", "mauve", "orchid", "thistle"]),
    # Special
    ((54,  90, 140),   ["denim", "jean", "washed blue", "indigo wash"]),
    ((210, 180, 140),  ["khaki"]),
    ((0,  128, 128),   ["teal", "cyan dark"]),
    ((0,  255, 255),   ["cyan", "aqua", "turquoise"]),
]

_HEX_RE = _re.compile(r'#([0-9A-Fa-f]{6})\b')


def _srgb_to_lab_l(r: float, g: float, b: float) -> float:
    """Approximate CIELAB L* from linear sRGB (0-255). Used only for light/dark decision."""
    def linearize(c: float) -> float:
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    rl, gl, bl = linearize(r), linearize(g), linearize(b)
    # CIE Y (luminance relative to D65 white)
    y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
    # f(Y/Yn), Yn=1
    fy = y ** (1 / 3) if y > 0.008856 else (7.787 * y + 16 / 116)
    return 116 * fy - 16  # L* in [0, 100]


def _parse_garment_color_from_physics(physics_text: str) -> tuple[str, np.ndarray]:
    """
    Extract dominant garment color from Stage 1 physics text.

    Strategy:
      1. Regex for explicit hex codes (#RRGGBB) — Gemini often includes these.
      2. Fallback: keyword search against _COLOR_KEYWORDS table.
      3. Fallback: assume mid-tone (L~50) → use dark bg.

    Returns:
      (bg_hex, bg_rgb_array)  — contrasting background to use for Stage 2 V-ToN render.
      Light garment  (L > 55) → dark bg  #3C3C3C
      Dark garment   (L ≤ 55) → light bg #C8C8C8
    """
    text = physics_text or ""

    # ── 1. Try explicit hex codes ──────────────────────────────────────────────
    hex_matches = _HEX_RE.findall(text)
    if hex_matches:
        # Use the first hex code found (typically dominant color described first)
        h = hex_matches[0]
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        lab_l = _srgb_to_lab_l(r, g, b)
        src = f"hex #{h}"
    else:
        # ── 2. Keyword search ─────────────────────────────────────────────────
        text_lower = text.lower()
        best_rgb: tuple | None = None
        best_len = 0
        for rgb, keywords in _COLOR_KEYWORDS:
            for kw in keywords:
                if kw in text_lower and len(kw) > best_len:
                    best_rgb = rgb
                    best_len = len(kw)
        if best_rgb:
            r, g, b = best_rgb
            lab_l = _srgb_to_lab_l(r, g, b)
            src = f"keyword (L={lab_l:.0f})"
        else:
            # ── 3. Default: assume dark garment ──────────────────────────────
            lab_l = 40.0
            r, g, b = 60, 60, 60
            src = "default (no color found)"

    # Contrasting bg selection
    if lab_l > 55:
        bg_hex = "#3C3C3C"
        bg_rgb = np.array([60.0, 60.0, 60.0])
        contrast = "dark"
    else:
        bg_hex = "#C8C8C8"
        bg_rgb = np.array([200.0, 200.0, 200.0])
        contrast = "light"

    print(f"  Garment color: {src}, L*={lab_l:.1f} → {contrast} bg {bg_hex}")
    return bg_hex, bg_rgb


def detect_garment_flags(physics_text: str, item_name: str = "") -> dict:
    """Parse Stage 1 physics text → structural flags that drive segmentation behaviour."""
    corpus = f"{physics_text} {item_name}"
    return {
        "has_holes":      bool(_DISTRESSED_RE.search(corpus)),
        "has_belt":       bool(_BELT_RE.search(corpus)),
        "is_sheer":       bool(_SHEER_RE.search(corpus)),
        "has_cutouts":    bool(_CUTOUT_RE.search(corpus)),
        "has_fringe":     bool(_FRINGE_RE.search(corpus)),
        "has_raw_edges":  bool(_RAW_EDGE_RE.search(corpus)),
        "has_wrap_front": bool(_WRAP_FRONT_RE.search(corpus)),
        "is_open_front":  bool(_OPEN_FRONT_RE.search(corpus)),
        "is_jumpsuit":    bool(_JUMPSUIT_RE.search(corpus)),
        "is_two_piece":   bool(_TWO_PIECE_RE.search(corpus)),
        "has_peplum":     bool(_PEPLUM_RE.search(corpus)),
        "has_overalls":   bool(_OVERALLS_RE.search(corpus)),
    }


# Override hierarchy (top = highest priority, first match wins):
#   has_fringe / has_raw_edges / is_sheer / has_cutouts  → 0  (preserve structure)
#   is_two_piece                                         → 1  (per-component, no fill_holes)
#   has_holes                                            → 8  (bridge rips)
#   has_belt                                             → 6  (bridge belt gap)
#   has_wrap_front / is_open_front                       → 4  (moderate skin gap)
#   has_peplum                                           → 3  (minor shadow gap)
#   is_jumpsuit / has_overalls                           → 2  (combined labels, normal closing)
#   category default                                     → 2/1

def resolve_closing_size(category: str, flags: dict) -> int:
    if flags.get("has_fringe"):     return 8   # bridge thin fringe strips
    if flags.get("has_raw_edges"):  return 0
    if flags.get("is_sheer"):       return 0
    if flags.get("has_cutouts"):    return 0
    if flags.get("is_two_piece"):   return 1   # per-component closing handled in _refine_two_piece
    if flags.get("has_holes"):      return 8
    if flags.get("has_belt"):       return 6
    if flags.get("has_wrap_front"): return 4
    if flags.get("is_open_front"):  return 4
    if flags.get("has_peplum"):     return 3
    if flags.get("is_jumpsuit"):    return 2
    if flags.get("has_overalls"):   return 2
    defaults = {"topwear": 2, "bottomwear": 2, "dresses": 1, "footwear": 1}
    return defaults.get(category, 2)


def resolve_labels(category: str, flags: dict) -> list:
    """Determine SegFormer label indices to capture based on category + flags."""
    if flags.get("is_jumpsuit") or flags.get("is_two_piece"):
        return [4, 5, 6, 7]   # full top+bottom union
    if flags.get("has_overalls"):
        base = CLOTHING_LABELS.get(category, [5, 6])
        return sorted(set(base + [4]))   # add upper-clothes for bib/straps
    base = CLOTHING_LABELS.get(category, [4])
    if flags.get("has_belt") and category in ("dresses", "topwear", "bottomwear"):
        # Include Belt(8) directly — morphological closing alone can't bridge the belt gap
        base = sorted(set(base + [8]))
    return base


# ── Stage 2: Avatar V-TON via Gemini image generation ────────────────────────
# Same structure as CATEGORY_PROMPTS stage2 in ghostPrompts.ts
# but instruction is "dress the avatar" not "generate hollow shell"

VTON_SYSTEM_BASE = """\
You are a virtual try-on rendering engine. Your task is to dress the provided avatar \
body in the specified garment with photorealistic accuracy.

STRICT RULES:
1. POSE LOCK / GEOMETRY LOCK: The avatar's pose, body position, limb placement, proportions, \
and camera angle in image_0 must remain EXACTLY unchanged. The outer silhouette and camera \
framing of your output MUST match image_0 precisely. Do not rotate, shift, or re-angle \
the figure in any way. The camera stays at 0° azimuth — direct front view only.
2. GARMENT SOURCE: Render the garment from image_1 onto the avatar's body. \
Match the exact color, texture, pattern, and all hardware precisely.
3. FABRIC PHYSICS: Apply realistic gravity and tension at seams. Natural fold behavior \
based on fabric weight and fit described in GARMENT_PHYSICS.
4. OUTPUT: Photorealistic e-commerce product photoshoot. Seamless studio background \
({BG_HEX}). Front-facing key light (soft box, straight-on) with gentle fill light from \
each side — replicating a professional studio product shoot. No harsh shadows. \
Fabric texture and surface detail must be clearly visible under this lighting.
5. SOLID BODY: The avatar body is solid beneath the clothing. \
Do NOT make any part of the garment hollow or transparent.\
"""

VTON_PROMPTS = {
    "topwear": {
        "front": {
            "system": VTON_SYSTEM_BASE + """

TOPWEAR SPECIFIC:
- Collar/neckline must sit naturally on the avatar's neck — no floating, no gap.
- Sleeve ends terminate exactly at the avatar's wrist position.
- Hem falls at the anatomically correct level relative to the avatar's hip.
- The shoulder seam aligns with the avatar's shoulder break point.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED): This avatar's exact silhouette, pose, and proportions \
are the rigid form. Dress this figure. Do not change the body in any way.
- image_1 (GARMENT SOURCE): Dress the avatar in this exact topwear. \
Match all color, texture, pattern, and hardware precisely.

Body Type:
{BODY_TYPE_DESC}

Garment Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT FRONT VIEW. Camera at 0° azimuth, perfectly level. Shoulders perfectly leveled.
2. GEOMETRY LOCK: Avatar pose, body position, and camera framing from image_0 are FIXED. No rotation, no shift, no re-angling.
3. Collar sits on avatar neck naturally; sleeve cuffs at avatar wrists.
4. Fabric weight drives drape — heavy fabric structured, light fabric flowing.
5. All surface details (buttons, zippers, graphics, stitching) rendered photorealistic.
6. Mid-gray seamless background (#808080). Front key light (soft box, straight-on) + gentle side fills. Product photoshoot quality. 1:1 square crop.

Item: {ITEM_NAME}

NEGATIVE: ghost mannequin, hollow collar void, empty neck hole, invisible body, \
floating fabric, disembodied garment, side view, 3/4 view, three-quarter angle, \
profile shot, rotated pose, angled view, turned body, \
two figures, side by side, split image, comparison image, diptych, before after, \
multiple avatars, duplicate figure.\
""",
        },
        "back": {
            "system": VTON_SYSTEM_BASE + """

TOPWEAR REAR VIEW SPECIFIC:
- Show the back of the garment on the avatar — shoulder blades, yoke, center back seam.
- The back collar/neckline sits at the avatar's nape naturally.
- Any back construction (hood attachment, zipper, ties) must be realistically rendered.
- Subtle lighting gradient over the shoulder blade area to show volume.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED, REAR VIEW): Avatar's rear-facing pose is the rigid form.
- image_1 (GARMENT SOURCE): Dress the avatar in this topwear — render the REAR face.

Body Type:
{BODY_TYPE_DESC}

Geometry Skeleton:
{GEOMETRY_SKELETON}

Garment Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT REAR VIEW. Shoulders level. We see only the back of the garment.
2. Back neckline construction is the focal point — collar stand, hood, or plain crew.
3. Fabric drapes realistically over shoulder blades (show subtle volume hump).
4. Any back-specific details (yoke seams, box pleats, zipper) rendered accurately.
5. Mid-gray seamless background (#808080). Front key light (soft box) + gentle side fills. Product photoshoot quality.

Item: {ITEM_NAME}

NEGATIVE: front neckline visible, chest pockets, front graphics, hollow shell, \
ghost effect, face, skin.\
""",
        },
    },
    "bottomwear": {
        "front": {
            "system": VTON_SYSTEM_BASE + """

BOTTOMWEAR SPECIFIC:
- Waistband sits at the anatomically correct rise on the avatar's waist/hips.
- Leg fabric falls realistically with gravity according to the specified fabric weight.
- The waist opening is clean — front waistband is slightly higher than the back.
- Embellishments (studs, hardware, cargo pockets) rendered with metallic reflections.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED): Avatar lower-body silhouette and pose are fixed.
- image_1 (GARMENT SOURCE): Dress the avatar in this exact bottomwear.

Body Type:
{BODY_TYPE_DESC}

Garment Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT FRONT VIEW. Camera level with avatar waist, 0° azimuth.
2. GEOMETRY LOCK: Avatar pose and framing from image_0 are FIXED. No rotation, no shift, no re-angling.
3. Waistband at the correct rise — sits naturally on avatar's hip bones.
4. Leg/skirt falls with realistic gravity matching fabric weight in specs.
   (Wide-leg: soft columnar draping. Skinny: tension rolls at knee. A-line: structured flare.)
5. Front waistband hides the inner back — we do NOT see inner label or interior.
6. All hardware (buttons, zippers, studs) has realistic metallic reflections.
7. Mid-gray seamless background (#808080). Front key light (soft box) + gentle side fills. Product photoshoot quality. 1:1 crop.

Item: {ITEM_NAME}

NEGATIVE: ghost mannequin, hollow waist opening, empty leg tubes, visible mannequin legs, \
solid interior, back pockets visible from front, side view, 3/4 view, three-quarter angle, \
profile shot, rotated pose, rear view, angled view, \
two figures, side by side, split image, comparison image, diptych, before after, \
multiple avatars, duplicate figure.\
""",
        },
        "back": {
            "system": VTON_SYSTEM_BASE + """

BOTTOMWEAR REAR VIEW SPECIFIC:
- Rear waistband is the highest edge — solid arc shape.
- Show back pockets, yoke seam, and seat volume.
- Convex lighting gradient over the glute area to show 3D volume.
- Do NOT show fly, front pockets, or coin pockets.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED, REAR VIEW): Avatar rear-facing pose is the rigid form.
- image_1 (GARMENT SOURCE): Dress the avatar — render the REAR face of the bottomwear.

Body Type:
{BODY_TYPE_DESC}

Geometry Skeleton:
{GEOMETRY_SKELETON}

Garment Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT REAR VIEW. Camera level with avatar waist.
2. Rear waistband forms a solid, slight upward arc — it is the highest visible edge.
3. Show yoke seam and back pocket placement accurately.
4. Convex lighting over seat to show volume — not a flat 2D cutout.
5. Key light top-left to accentuate pocket depth.

Item: {ITEM_NAME}

NEGATIVE: zipper fly, front pockets, button closure, groin details, ghost effect, \
hollow shell, flat texture.\
""",
        },
    },
    "footwear": {
        "front": {
            "system": VTON_SYSTEM_BASE + """

FOOTWEAR SPECIFIC:
- Shoes fitted onto the avatar's feet at the EXACT coordinates from image_0.
- Camera is at ground level, positioned directly in front of the toe box — we see \
the front face of both shoes with toes pointing toward the camera. Camera is NOT elevated.
- Stop rendering at the shoe collar/rim — ankle opening is clean. No skin above the rim.
- Soles are flat on the floor. No contact shadows.
- Render both shoes (left and right) with correct side-by-side gap matching avatar stance.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED): Avatar's foot position, stance width, and gap are fixed.
- image_1 (GARMENT SOURCE): Fit these exact shoes onto the avatar's feet.

Body Type:
{BODY_TYPE_DESC}

Shoe Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT FRONT VIEW. Camera at floor level, 0° azimuth, aimed straight at the toe box. \
Both shoes face the camera — toes pointing toward viewer. Camera is NOT elevated or tilted down.
2. GEOMETRY LOCK: Avatar foot position, stance width, and framing from image_0 are FIXED. \
No rotation, no shift, no re-angling of either shoe.
3. No skin visible above the shoe collar/rim — ankle opening terminates cleanly at the rim.
4. Soles flat on floor. No shadows. Background: {BG_HEX}.
5. Shoe structure inflated per rigidity spec — stiff leather stands upright, \
soft suede has slight collapse.
6. All hardware (buckles, studs, eyelets, metal bits) with realistic reflections.

Item: {ITEM_NAME}

NEGATIVE: human legs, human skin, ankle skin, foot skin, socks, mannequin legs, \
contact shadows, elevated camera angle, bird's eye view, looking down at shoes, \
top-down view, feet seen from above, tilted camera, angled camera, \
side view, 3/4 view, three-quarter angle, profile shot, rotated pose, angled view, \
single shoe, one shoe only, collapsed shape, ghost effect, \
two figures, side by side, split image, comparison image, diptych, before after, \
multiple avatars, duplicate figure.\
""",
        },
        "back": {
            "system": VTON_SYSTEM_BASE + """

FOOTWEAR REAR VIEW SPECIFIC:
- Direct rear view — we see the heels, heel counters, and back tabs.
- Shoes are side-by-side, heels closest to camera, toes pointing away.
- Ankle opening visible at top. Interior white.
- Do NOT show toe box unless shoe is extremely wide.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED, REAR VIEW): Avatar's foot stance is fixed.
- image_1 (GARMENT SOURCE): Render the REAR view of these shoes on the avatar's feet.

Body Type:
{BODY_TYPE_DESC}

Shoe Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT REAR VIEW. We see heels, heel counters, back tabs.
2. Focal point is the vertical back seam and heel counter.
3. Ankle opening visible at top — interior is white.
4. Soles flat on ground. Rim lighting to highlight heel cup curve.
5. Symmetrical heel rendering.

Item: {ITEM_NAME}

NEGATIVE: toe box, laces tongue, front view, side view, human ankles, socks, \
ghost effect, hollow shell.\
""",
        },
    },
    "dresses": {
        "front": {
            "system": VTON_SYSTEM_BASE + """

DRESSES SPECIFIC:
- Full-body garment — must cover from shoulder/neckline all the way to the hem.
- Neckline/collar sits naturally on the avatar's neck.
- Waistline construction (defined seam, elastic, drawstring) follows avatar's waist.
- Skirt falls with gravity from the hip — tiered, A-line, wrap, or bodycon per specs.
- Sleeve (or sleeveless armhole) terminates at the correct position on the avatar.
- FLAT FRONT PROJECTION: The avatar in image_0 is a flat-on, perfectly symmetrical manikin
  facing the camera at 0° yaw. Both shoulders are at identical height and identical distance
  from the vertical center-line. Replicate this exact bilateral symmetry — no lean, no twist.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED): Full-body avatar pose is the rigid form — head to feet.
  This avatar faces the camera DEAD-ON: shoulders level, body axis vertical, zero rotation.
- image_1 (GARMENT SOURCE): Dress the avatar in this exact dress, full-body.

Body Type:
{BODY_TYPE_DESC}

Garment Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT FRONT VIEW. Camera at 0° azimuth, eye level. Full body from neckline to hem visible.
   The figure is bilaterally symmetrical left-to-right. Both shoulders at equal height.
2. GEOMETRY LOCK: Avatar pose, body position, and camera framing from image_0 are FIXED. No rotation, no shift, no re-angling.
3. Neckline sits naturally on avatar neck; any waist seam aligns with avatar waist.
4. Skirt falls with realistic gravity appropriate to fabric weight and silhouette type.
5. Hem is a clean line at the correct length relative to avatar height.
6. All surface details (closures, embellishments, tiering) rendered photorealistic.
7. Mid-gray seamless background (#808080). Front key light (soft box) + gentle side fills. Product photoshoot quality. 1:1 crop.

Item: {ITEM_NAME}

NEGATIVE: ghost mannequin, hollow neckline, empty hem, invisible body, \
floating dress, no avatar visible, disembodied garment, side view, 3/4 view, \
three-quarter angle, profile shot, rotated pose, angled view, turned body, \
leaning figure, twisted torso, asymmetric shoulders, perspective distortion, \
two figures, side by side, split image, comparison image, diptych, before after, \
multiple avatars, duplicate figure.\
""",
        },
        "back": {
            "system": VTON_SYSTEM_BASE + """

DRESSES REAR VIEW SPECIFIC:
- Show the back of the dress — back neckline (low-back vs high neck), closure, back drape.
- Back zipper (invisible or exposed) must be rendered straight and realistic.
- Fabric drapes from the avatar's shoulder blades down to the hem.
- Any back construction (smocking, darts, princess seams) rendered accurately.\
""",
            "prompt": """\
Images:
- image_0 (AVATAR — POSE LOCKED, REAR VIEW): Avatar rear full-body pose is the rigid form.
- image_1 (GARMENT SOURCE): Dress the avatar — render the REAR face of the dress.

Body Type:
{BODY_TYPE_DESC}

Geometry Skeleton:
{GEOMETRY_SKELETON}

Garment Physics:
{GARMENT_PHYSICS}

Rendering Rules:
1. DIRECT REAR VIEW.
2. Back neckline depth is the focal point — low back vs high collar.
3. Zipper/hardware rendered accurately — metal zipper pull catches studio light.
4. Skirt falls from glutes/hips with natural drape.
5. Mid-gray seamless background (#808080). Front key light (soft box) — fabric sheen must be visible. Product photoshoot quality.
6. Hem is a clean line.

Item: {ITEM_NAME}

NEGATIVE: cleavage, front darts, front buttons, ghost effect, hollow shell, \
face, toes, mannequin feet, artifacts.\
""",
        },
    },
}

def run_stage2(
    avatar_img: Image.Image,
    garment_path: Path,
    physics: dict,
    body_type_desc: str,
    geometry_skeleton: str,
    category: str,
    view: str,
    image_model: str,
    output_dir: Path,
    client: genai.Client,
    bg_hex: str = "#808080",
    flags: dict = None,
) -> Image.Image:
    print(f"[Stage 2] Generating Avatar V-TON — {category} / {view} ...")
    print(f"  Background: {bg_hex}")

    cat_prompts = VTON_PROMPTS.get(category, VTON_PROMPTS["topwear"])
    view_prompts = cat_prompts.get(view, cat_prompts["front"])

    system_instruction = view_prompts["system"].replace("{BG_HEX}", bg_hex).replace("#808080", bg_hex)
    prompt = (
        view_prompts["prompt"]
        .replace("{BODY_TYPE_DESC}",    body_type_desc)
        .replace("{GARMENT_PHYSICS}",   physics["garment_physics"])
        .replace("{GEOMETRY_SKELETON}", geometry_skeleton)
        .replace("{ITEM_NAME}",         physics["item_name"])
        .replace("#808080",             bg_hex)
    )

    # Two-piece co-ord: explicitly instruct to render BOTH top + bottom.
    if flags and flags.get("is_two_piece"):
        prompt += (
            "\n\nIMPORTANT — CO-ORD SET: The reference image shows a two-piece co-ord set. "
            "Dress the avatar in BOTH pieces simultaneously — the top piece on the upper body "
            "AND the matching bottom piece (skirt/pants) on the lower body. "
            "Do NOT omit either piece. The complete outfit must appear on the avatar."
        )

    garment_img = Image.open(garment_path)
    # Order: avatar first (image_0), garment second (image_1) — matches gemini-image.ts
    contents = [pil_to_part(avatar_img), pil_to_part(garment_img), prompt]

    response = client.models.generate_content(
        model=image_model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            system_instruction=system_instruction,
        ),
    )

    candidates = response.candidates or []
    if not candidates or not candidates[0].content or not candidates[0].content.parts:
        finish = candidates[0].finish_reason if candidates else "no_candidates"
        raise RuntimeError(
            f"Stage 2: Gemini returned no candidates (finish_reason={finish}). "
            "Possible causes: safety filter block, unsupported image, model quota."
        )

    for part in candidates[0].content.parts:
        if part.inline_data:
            vton_img = Image.open(io.BytesIO(part.inline_data.data)).convert("RGB")
            out_path = output_dir / "stage2_avatar_vton.png"
            vton_img.save(out_path)
            print(f"  Saved: {out_path}")
            return vton_img

    raise RuntimeError("Stage 2: Gemini returned no image — check model name and API access")

# ── Stage 3: Clothing segmentation — SegFormer coarse → SAM2 refinement ──────
# SAM2 (segment-anything-2) from Meta — requires Python 3.10+
# Falls back to SAM v1 if SAM2 not available

SAM_CHECKPOINTS = {
    # SAM2 variants (preferred) — name → (filename, model_cfg, download_url)
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
    # SAM v1 fallback variants — name → (filename, model_type, download_url)
    "vit_h": (
        "sam_vit_h_4b8939.pth",
        "vit_h",
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
    ),
    "vit_l": (
        "sam_vit_l_0b3195.pth",
        "vit_l",
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth",
    ),
    "vit_b": (
        "sam_vit_b_01ec64.pth",
        "vit_b",
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
    ),
}
SAM_CACHE_DIR = Path.home() / ".cache" / "sam"


def _ensure_sam_checkpoint(variant: str) -> Optional[Path]:
    """Download SAM/SAM2 checkpoint to ~/.cache/sam/ if not present."""
    ckpt_name = SAM_CHECKPOINTS[variant][0]
    url = SAM_CHECKPOINTS[variant][2]
    ckpt_path = SAM_CACHE_DIR / ckpt_name
    if ckpt_path.exists():
        return ckpt_path
    SAM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"  Downloading checkpoint ({variant}) from Meta...")
    try:
        with requests.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            downloaded = 0
            with open(ckpt_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded * 100 // total
                        print(f"\r  {pct}% ({downloaded >> 20} MB / {total >> 20} MB)", end="", flush=True)
        print()
        return ckpt_path
    except Exception as exc:
        print(f"\n  Download failed: {exc}")
        if ckpt_path.exists():
            ckpt_path.unlink()
        return None


def _build_prompt_points(mask_array: np.ndarray, img_h: int, img_w: int):
    """Derive positive/negative SAM prompt points from SegFormer coarse mask."""
    ys, xs = np.where(mask_array > 127)
    if len(xs) == 0:
        return None, None

    cx, cy = int(xs.mean()), int(ys.mean())
    pos_points = [
        [cx, cy],
        [int(np.percentile(xs, 25)), int(np.percentile(ys, 25))],
        [int(np.percentile(xs, 75)), int(np.percentile(ys, 75))],
        [int(np.percentile(xs, 50)), int(np.percentile(ys, 10))],
        [int(np.percentile(xs, 50)), int(np.percentile(ys, 90))],
    ]
    neg_points = [
        [10, 10], [img_w - 10, 10],
        [10, img_h - 10], [img_w - 10, img_h - 10],
    ]
    point_coords = np.array(pos_points + neg_points)
    point_labels = np.array([1] * len(pos_points) + [0] * len(neg_points))
    return point_coords, point_labels


def _best_iou_mask(masks, coarse_bool: np.ndarray) -> np.ndarray:
    """Pick mask with highest IoU against SegFormer coarse mask."""
    best_mask, best_iou = masks[0], -1.0
    for m in masks:
        inter = np.logical_and(m, coarse_bool).sum()
        union = np.logical_or(m, coarse_bool).sum()
        iou = inter / union if union > 0 else 0.0
        if iou > best_iou:
            best_iou, best_mask = iou, m
    print(f"  Best mask IoU vs SegFormer: {best_iou:.3f}")
    return best_mask


def _refine_with_sam2(
    vton_img: Image.Image,
    coarse_mask: Image.Image,
    variant: str,
) -> Optional[Image.Image]:
    """SAM2 refinement — requires Python 3.10+ and sam2 package."""
    try:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError:
        return None

    ckpt_path = _ensure_sam_checkpoint(variant)
    if ckpt_path is None:
        return None

    _, model_cfg, _ = SAM_CHECKPOINTS[variant]
    device = "cuda" if __import__("torch").cuda.is_available() else "cpu"
    print(f"  SAM2 device: {device} | variant: {variant}")

    sam2 = build_sam2(model_cfg, str(ckpt_path), device=device)
    predictor = SAM2ImagePredictor(sam2)

    img_array = np.array(vton_img.convert("RGB"))
    predictor.set_image(img_array)

    mask_array = np.array(coarse_mask)
    point_coords, point_labels = _build_prompt_points(mask_array, *img_array.shape[:2])
    if point_coords is None:
        print("  SAM2: coarse mask empty, skipping")
        return None

    import torch
    with torch.inference_mode():
        masks, _, _ = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )

    best = _best_iou_mask(masks, mask_array > 127)
    return Image.fromarray((best * 255).astype(np.uint8), mode="L")


def _refine_with_sam_v1(
    vton_img: Image.Image,
    coarse_mask: Image.Image,
    variant: str,
) -> Optional[Image.Image]:
    """SAM v1 fallback — Python 3.9 compatible."""
    try:
        import torch
        from segment_anything import sam_model_registry, SamPredictor
    except ImportError:
        print("  SAM v1 not installed — pip install git+https://github.com/facebookresearch/segment-anything.git")
        return None

    ckpt_path = _ensure_sam_checkpoint(variant)
    if ckpt_path is None:
        return None

    _, model_type, _ = SAM_CHECKPOINTS[variant]
    device = "cuda" if __import__("torch").cuda.is_available() else "cpu"
    print(f"  SAM v1 device: {device} | variant: {variant}")

    sam = sam_model_registry[model_type](checkpoint=str(ckpt_path))
    sam.to(device=device)
    predictor = SamPredictor(sam)

    img_array = np.array(vton_img.convert("RGB"))
    predictor.set_image(img_array)

    mask_array = np.array(coarse_mask)
    point_coords, point_labels = _build_prompt_points(mask_array, *img_array.shape[:2])
    if point_coords is None:
        print("  SAM v1: coarse mask empty, skipping")
        return None

    import torch
    with torch.inference_mode():
        masks, _, _ = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True,
        )

    best = _best_iou_mask(masks, mask_array > 127)
    return Image.fromarray((best * 255).astype(np.uint8), mode="L")


def _refine_mask(
    vton_img: Image.Image,
    coarse_mask: Image.Image,
    variant: str,
) -> Optional[Image.Image]:
    """Try SAM2 first, fall back to SAM v1."""
    if variant.startswith("sam2"):
        result = _refine_with_sam2(vton_img, coarse_mask, variant)
        if result is not None:
            print("  SAM2 refinement applied.")
            return result
        print("  SAM2 unavailable — trying SAM v1 (vit_h)...")
        return _refine_with_sam_v1(vton_img, coarse_mask, "vit_h")
    else:
        result = _refine_with_sam_v1(vton_img, coarse_mask, variant)
        if result is not None:
            print("  SAM v1 refinement applied.")
        return result


def _refine_two_piece(
    vton_img: Image.Image,
    coarse_mask_arr: np.ndarray,
    variant: str,
    closing_size: int = 1,
    min_area_frac: float = 0.005,
    exclusion_mask: np.ndarray = None,  # applied before _polish_mask, not as SAM2 prompts
) -> Image.Image:
    """
    Two-piece set: run SAM2 separately per connected component, merge masks.
    Skips binary_fill_holes on the merged result so the midriff gap stays transparent.
    """
    from scipy import ndimage
    labeled, n = ndimage.label(coarse_mask_arr > 127)
    total_px = coarse_mask_arr.size
    merged = np.zeros_like(coarse_mask_arr, dtype=np.uint8)
    found = 0
    for cid in range(1, n + 1):
        comp = (labeled == cid).astype(np.uint8) * 255
        if (comp > 0).sum() < total_px * min_area_frac:
            continue   # skip tiny noise
        found += 1
        print(f"    Two-piece component {found}/{n}: {(comp > 0).sum()} px")
        comp_img = Image.fromarray(comp, mode="L")
        refined = _refine_mask(vton_img, comp_img, variant)
        src = np.array(refined) if refined is not None else comp
        merged = np.maximum(merged, src)
    if found == 0:
        print("    Two-piece: no significant components, using raw coarse mask")
        return Image.fromarray(coarse_mask_arr, mode="L")
    # Veto body-part pixels before polishing
    if exclusion_mask is not None:
        merged[exclusion_mask] = 0
    return _polish_mask(
        Image.fromarray(merged, mode="L"),
        closing_size=closing_size,
        fill_holes=False,   # preserve midriff gap
    )


# ── GroundingDINO + SAM2 helpers ─────────────────────────────────────────────

def _extract_item_tokens(item_name: str) -> set:
    """Extract recognized fashion nouns from item_name for GDINO prompt enrichment."""
    words = _re.sub(r'[^a-zA-Z\s]', ' ', item_name.lower()).split()
    return {w for w in words if w in FASHION_NOUNS}


def _build_gdino_context(category: str, flags: dict, item_name: str = "",
                         subcategories=None, components=None) -> tuple:
    """
    Build GDINO text prompt + token sets.
    Returns: (gdino_text, primary_tokens_set, accessory_tokens_set, component_tokens_set)
    gdino_text format: "token1 . token2 . token3 ." (GroundingDINO expects period-separated tokens)
    """
    base = BASE_GDINO_TOKENS.get(category, BASE_GDINO_TOKENS["topwear"])
    primary   = set(base["primary"])
    accessory = set(base["accessory"])

    if flags.get("is_jumpsuit"):
        primary.update(["jumpsuit", "romper", "playsuit", "catsuit", "boilersuit"])
    if flags.get("is_two_piece"):
        primary.update(["top", "skirt", "shorts", "pants"])
    if flags.get("has_overalls"):
        primary.update(["overalls", "dungarees"])
    if flags.get("has_belt"):
        accessory.add("belt")
    if flags.get("has_wrap_front"):
        primary.add("wrap")
    if flags.get("is_open_front"):
        primary.update(["cardigan", "blazer"])

    # Item-name tokens: add to primary ONLY if they are NOT already an accessory token.
    # Prevents "scarf" in "Scarf-Neck Top" from overriding the accessory classification.
    item_tokens = _extract_item_tokens(item_name) - accessory
    primary.update(item_tokens)

    # Subcategory tokens: add to primary (same rule as item_name tokens).
    # Blocklist anatomical/descriptor words to prevent GDINO detecting garment PARTS
    # (e.g. "sleeve" from "long sleeve top" → GDINO detects only the sleeve arm).
    for sub in (subcategories or []):
        sub_words = {
            w for w in sub.replace("-", " ").split()
            if len(w) > 2 and w not in _SUBCATEGORY_WORD_BLOCKLIST
        }
        primary.update(sub_words - accessory)

    # Component tokens from COMPONENT_TO_GDINO_TOKEN map
    component_tokens: set[str] = set()
    for comp in (components or []):
        token = None
        # Try exact match first
        for key, val in COMPONENT_TO_GDINO_TOKEN.items():
            if key in comp or comp in key:
                token = val
                break
        if token:
            component_tokens.add(token)
    # Disjoint sets: primary wins over component; component wins over accessory.
    component_tokens -= primary        # primary wins
    accessory -= component_tokens      # component wins over accessory

    all_tokens = sorted(primary | accessory | component_tokens)
    gdino_text = " . ".join(all_tokens) + " ."
    return gdino_text, primary, accessory, component_tokens


def _load_grounding_dino():
    """Load GroundingDINO processor + model (cached to ~/.cache/huggingface/)."""
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
    print(f"  Loading GroundingDINO ({GDINO_MODEL_ID})...")
    processor = AutoProcessor.from_pretrained(GDINO_MODEL_ID)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(GDINO_MODEL_ID)
    model.eval()
    return processor, model


def _run_grounding_dino(vton_img: Image.Image, gdino_text: str, processor, model) -> list:
    """
    Run GroundingDINO → list of {"label": str, "box": [x0,y0,x1,y1], "score": float}.
    box is in pixel coords (xyxy).
    """
    import torch
    inputs = processor(images=vton_img, text=gdino_text, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
    results = processor.post_process_grounded_object_detection(
        outputs,
        inputs["input_ids"],
        threshold=GDINO_BOX_THRESHOLD,
        text_threshold=GDINO_TEXT_THRESHOLD,
        target_sizes=[vton_img.size[::-1]],  # (height, width)
    )[0]
    dets = []
    label_key = "text_labels" if "text_labels" in results else "labels"
    for score, label, box in zip(results["scores"], results[label_key], results["boxes"]):
        dets.append({
            "label": str(label).strip().rstrip(".").lower(),
            "box":   [float(x) for x in box.tolist()],
            "score": float(score),
        })
    return dets


def _iou_boxes(a: list, b: list) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0 = max(ax0, bx0); iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1); iy1 = min(ay1, by1)
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    ua = (ax1 - ax0) * (ay1 - ay0)
    ub = (bx1 - bx0) * (by1 - by0)
    union = ua + ub - inter
    return inter / union if union > 0 else 0.0


def _overlap_fraction(inner: list, outer: list) -> float:
    """Fraction of inner bbox area that overlaps with outer bbox."""
    ix0 = max(inner[0], outer[0]); iy0 = max(inner[1], outer[1])
    ix1 = min(inner[2], outer[2]); iy1 = min(inner[3], outer[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    area = (inner[2] - inner[0]) * (inner[3] - inner[1])
    return inter / area if area > 0 else 0.0


def _nms_detections(dets: list, iou_threshold: float = GDINO_NMS_IOU) -> list:
    """Per-label greedy NMS — keeps highest-score box, suppresses overlapping lower ones."""
    by_label: dict = {}
    for d in dets:
        by_label.setdefault(d["label"], []).append(d)
    kept = []
    for label_dets in by_label.values():
        sorted_dets = sorted(label_dets, key=lambda x: x["score"], reverse=True)
        alive = [True] * len(sorted_dets)
        for i in range(len(sorted_dets)):
            if not alive[i]:
                continue
            kept.append(sorted_dets[i])
            for j in range(i + 1, len(sorted_dets)):
                if alive[j] and _iou_boxes(sorted_dets[i]["box"], sorted_dets[j]["box"]) > iou_threshold:
                    alive[j] = False
    return kept


def _cross_label_nms(dets: list, iou_threshold: float = GDINO_CROSS_NMS_IOU,
                     protected_tokens=None) -> list:
    """
    Cross-label NMS: suppress a lower-score detection if it overlaps significantly
    with a higher-score detection of a *different* label.
    Catches cases where GDINO emits a wide/spurious bbox (e.g. 'joggers' overlapping 'jeans').
    protected_tokens: set of labels that should never be suppressed (e.g. component detections).
    """
    protected_tokens = protected_tokens or set()
    sorted_dets = sorted(dets, key=lambda x: x["score"], reverse=True)
    alive = [True] * len(sorted_dets)
    for i in range(len(sorted_dets)):
        if not alive[i]: continue
        for j in range(i + 1, len(sorted_dets)):
            if not alive[j]: continue
            if sorted_dets[i]["label"] == sorted_dets[j]["label"]: continue
            # Never suppress a protected (component) detection
            if sorted_dets[j]["label"] in protected_tokens: continue
            if _iou_boxes(sorted_dets[i]["box"], sorted_dets[j]["box"]) > iou_threshold:
                alive[j] = False
                print(f"    Cross-NMS: suppressed [{sorted_dets[j]['label']} ...]")
    return [d for d, a in zip(sorted_dets, alive) if a]


def _filter_and_classify(dets: list, primary_tokens: set, accessory_tokens: set,
                         component_tokens=None) -> tuple:
    """Split detections into (primary_dets, accessory_dets, component_dets) by label membership."""
    component_tokens = component_tokens or set()
    primary, accessory, component = [], [], []
    for d in dets:
        lbl = d["label"]
        if lbl in primary_tokens:
            primary.append(d)
        elif lbl in component_tokens:
            component.append(d)
        elif lbl in accessory_tokens:
            accessory.append(d)
        else:
            # Substring match for compound labels GDINO sometimes emits
            matched = False
            for tok in primary_tokens:
                if tok in lbl or lbl in tok:
                    primary.append(d); matched = True; break
            if not matched:
                for tok in component_tokens:
                    if tok in lbl or lbl in tok:
                        component.append(d); matched = True; break
            if not matched:
                for tok in accessory_tokens:
                    if tok in lbl or lbl in tok:
                        accessory.append(d); matched = True; break
            if not matched:
                print(f"    Unclassified det [{lbl}] → treated as primary")
                primary.append(d)
    return primary, accessory, component


def _load_sam2_predictor(variant: str, img_array: np.ndarray):
    """Load SAM2, call set_image once, return ready predictor."""
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    ckpt_path = _ensure_sam_checkpoint(variant)
    if ckpt_path is None:
        raise RuntimeError(f"SAM2 checkpoint unavailable: {variant}")

    _, model_cfg, _ = SAM_CHECKPOINTS[variant]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"  SAM2 device: {device} | variant: {variant}")

    sam2 = build_sam2(model_cfg, str(ckpt_path), device=device)
    predictor = SAM2ImagePredictor(sam2)
    predictor.set_image(img_array)
    return predictor


def _sam2_box_mask(predictor, bbox_xyxy: list) -> np.ndarray:
    """Run SAM2 with a single bounding box prompt. Returns uint8 mask (H×W)."""
    import torch
    box = np.array(bbox_xyxy, dtype=np.float32)
    with torch.inference_mode():
        masks, scores, _ = predictor.predict(box=box, multimask_output=True)
    best_idx = int(scores.argmax())
    return (masks[best_idx] * 255).astype(np.uint8)


def _sam2_point_mask(
    predictor,
    fg_points: list[tuple[int, int]],
    bg_points: list[tuple[int, int]],
) -> np.ndarray:
    """Run SAM2 with fg/bg point prompts. Returns uint8 mask (H×W).

    fg_points, bg_points: lists of (x, y) pixel tuples (SAM2 convention).
    Returns the highest-scoring mask from multimask_output=True.
    """
    import torch
    all_pts = fg_points + bg_points
    all_lbl = [1] * len(fg_points) + [0] * len(bg_points)
    coords = np.array(all_pts, dtype=np.float32)   # (N, 2) — x, y
    labels = np.array(all_lbl, dtype=np.int32)
    with torch.inference_mode():
        masks, scores, _ = predictor.predict(
            point_coords=coords,
            point_labels=labels,
            multimask_output=True,
        )
    best_idx = int(scores.argmax())
    return (masks[best_idx] * 255).astype(np.uint8)


def run_stage3(
    vton_img: Image.Image,
    category: str,
    output_dir: Path,
    flags: dict = None,
    use_sam2: bool = True,
    sam2_variant: str = "sam2_large",
    item_name: str = "",
    subcategories=None,
    components=None,
    gender: str = "female",
) -> Image.Image:
    if flags is None:
        flags = {}

    closing_size = resolve_closing_size(category, flags)
    is_two_piece  = flags.get("is_two_piece", False)

    # ── Flag-based component fallback (when Gemini hasn't output components) ─────
    # Fires when physics JSON predates the new Stage 1 structured output.
    # Maps known flags → structural components so the GDINO component path still runs.
    if not components:
        _derived: list[str] = []
        if flags.get("has_belt"):       _derived.append("belt")
        if flags.get("has_overalls"):   _derived.extend(["bib", "shoulder strap"])
        if flags.get("has_wrap_front"): _derived.append("wrap panel")
        if _derived:
            components = _derived
            print(f"  [flag→component fallback] derived components: {components}")

    if not subcategories:
        _derived_sub: list[str] = []
        if flags.get("has_overalls"):   _derived_sub.extend(["dungarees", "overalls"])
        if flags.get("is_jumpsuit"):    _derived_sub.extend(["jumpsuit", "romper"])
        if flags.get("is_two_piece"):   _derived_sub.extend(["co-ord", "set"])
        if _derived_sub:
            subcategories = _derived_sub

    print("[Stage 3] Segmenting clothing (GroundingDINO + SAM2 box prompts)...")
    print(f"  closing={closing_size}  two_piece={is_two_piece}  item={item_name!r}")
    print(f"  subcategories={subcategories}  components={components}")

    # ── SegFormer — always runs for exclusion mask only ────────────────────────
    try:
        import torch
        import torch.nn.functional as F
        from transformers import SegformerImageProcessor, SegformerForSemanticSegmentation
    except ImportError:
        print("\nMissing deps. Run: pip install transformers torch torchvision")
        sys.exit(1)

    print("  SegFormer (exclusion mask only)...")
    sf_proc  = SegformerImageProcessor.from_pretrained("mattmdjaga/segformer_b2_clothes")
    sf_model = SegformerForSemanticSegmentation.from_pretrained("mattmdjaga/segformer_b2_clothes")
    sf_model.eval()

    sf_inputs = sf_proc(images=vton_img, return_tensors="pt")
    with torch.no_grad():
        sf_out = sf_model(**sf_inputs)
    upsampled = F.interpolate(
        sf_out.logits, size=(vton_img.height, vton_img.width),
        mode="bilinear", align_corners=False,
    )
    pred = upsampled.argmax(dim=1).squeeze().numpy()

    # For full-body garments (jumpsuit/two-piece/overalls) resolve_labels returns [4,5,6,7].
    # Use dresses-level garment exclusion (shoes only) to avoid vetoing wanted labels.
    full_body = flags.get("is_jumpsuit") or flags.get("is_two_piece") or flags.get("has_overalls")
    excl_cat  = "dresses" if full_body else category
    cat_extra = CATEGORY_GARMENT_EXCLUSIONS.get(excl_cat, [])

    exclusion_mask = np.zeros(pred.shape, dtype=bool)
    if category == "footwear":
        # SegFormer is unreliable on isolated shoe images: it labels white/light shoe
        # pixels as upper-clothes, pants, hat, etc. — skip general body exclusion.
        # BUT: still exclude visible leg/foot skin (l-leg=12, r-leg=13) so open-sandal
        # strap gaps don't expose avatar foot skin in the ghost composite.
        for lbl in [12, 13]:   # l-leg, r-leg
            exclusion_mask |= (pred == lbl)
        excl_px = exclusion_mask.sum()
        print(f"  Footwear exclusion: {excl_px} px leg-skin only (labels 12,13)")
    else:
        base_excl = list(BODY_EXCLUSION_LABELS)
        # has_overalls: shoulder straps cross arm region — SegFormer labels straps as
        # L-arm(14)/R-arm(15) → exclusion punches holes in strap.  Drop arm labels.
        if flags.get("has_overalls"):
            base_excl = [l for l in base_excl if l not in (14, 15)]
        for lbl in base_excl:
            exclusion_mask |= (pred == lbl)
        for lbl in cat_extra:
            exclusion_mask |= (pred == lbl)
        excl_px = exclusion_mask.sum()
        print(f"  Exclusion: {excl_px} px ({excl_px / pred.size * 100:.1f}%) — body-parts + cat-garments{cat_extra}")

    # ── Sample actual VToN background color from image corners ───────────────
    vton_arr_rgb = np.array(vton_img.convert("RGB")).astype(float)
    h_v, w_v = vton_arr_rgb.shape[:2]
    corner_sz = 20
    corners = np.concatenate([
        vton_arr_rgb[:corner_sz,  :corner_sz ].reshape(-1, 3),
        vton_arr_rgb[:corner_sz, -corner_sz: ].reshape(-1, 3),
        vton_arr_rgb[-corner_sz:, :corner_sz ].reshape(-1, 3),
        vton_arr_rgb[-corner_sz:, -corner_sz:].reshape(-1, 3),
    ], axis=0)
    sampled_bg = corners.mean(axis=0)
    print(f"  Sampled VToN bg color: ({sampled_bg[0]:.0f}, {sampled_bg[1]:.0f}, {sampled_bg[2]:.0f})")

    # ── Primary path: physics-informed SAM2 point prompts ────────────────────
    # Uses calibrated avatar anatomy fracs + background subtraction to derive
    # precise fg/bg point prompts — no ML detector needed for the bounding box.
    # Falls through to GDINO if: module unavailable, extent not found, or QA fails.
    anchor_success = False
    final_mask     = None

    # Anchor path (point-SAM2) disabled as primary — GDINO+box prompts give tighter,
    # spatially-constrained masks. Anchor kept in code for potential future use as
    # a post-GDINO enhancement or fallback, but currently never fires as primary.
    _anchor_skip = True   # REVERTED: was (is_two_piece or has_overalls or is_sheer or footwear)
    if _ANCHOR_AVAILABLE and use_sam2 and not _anchor_skip:
        try:
            vton_arr_uint8 = np.array(vton_img.convert("RGB"))
            bg_tuple = (int(sampled_bg[0]), int(sampled_bg[1]), int(sampled_bg[2]))
            extent = detect_avatar_extent(vton_arr_uint8, bg_tuple, threshold=25)
            if extent is None:
                print("  [anchor] Avatar extent not found — skipping point-SAM2.")
            else:
                print(f"  [anchor] body_top={extent['body_top']}  body_bot={extent['body_bot']}"
                      f"  body_h={extent['body_h']}  body_cx={extent['body_cx']:.0f}")
                fg_pts, bg_pts = compute_anchor_points(
                    category, flags, gender, extent, (vton_img.height, vton_img.width)
                )
                print(f"  [anchor] fg={len(fg_pts)} pts  bg={len(bg_pts)} pts")
                sam2_pred_anchor = _load_sam2_predictor(sam2_variant, vton_arr_uint8)
                raw_mask = _sam2_point_mask(sam2_pred_anchor, fg_pts, bg_pts)
                # Apply exclusion
                raw_mask[exclusion_mask] = 0
                # QA gate
                qa_ok, qa_reason = _validate_anchor_mask(raw_mask > 127, category)
                print(f"  [anchor] QA: {qa_reason}")
                if qa_ok:
                    # Post-process same as GDINO path.
                    # Exceptions — skip trapped-bg punch-out and/or fill_holes for:
                    #   is_sheer  : crochet/lace holes are interior bg voids; punching shatters
                    #   footwear  : gaps between sandal straps are intentional openings;
                    #               fill_holes creates a false solid blob; punch then fragments it
                    _is_sheer    = flags.get("is_sheer", False)
                    _is_footwear = (category == "footwear")
                    trapped = (None if (_is_sheer or _is_footwear)
                               else _detect_trapped_bg_holes(raw_mask, vton_arr_rgb, bg_color=sampled_bg))
                    final_mask = _polish_mask_hard(
                        Image.fromarray(raw_mask, mode="L"),
                        closing_size=closing_size,
                        fill_holes=(not _is_footwear),  # preserve open strap gaps
                    )
                    if trapped is not None and trapped.any():
                        arr = np.array(final_mask)
                        to_zero = trapped & (arr > 127)
                        if to_zero.any():
                            arr[to_zero] = 0
                            final_mask = Image.fromarray(arr, mode="L")
                            print(f"  [anchor] Punched out {to_zero.sum():,} trapped-bg px")
                    anchor_success = True
                    print("  Point-SAM2 (anchor) path succeeded.")
                else:
                    print(f"  [anchor] QA failed ({qa_reason}) — falling through to GDINO.")
        except Exception as _exc:
            print(f"  [anchor] Point-SAM2 path failed ({_exc}) — falling through to GDINO.")

    # ── Secondary path: GroundingDINO → SAM2 box prompts ─────────────────────
    # Skipped automatically when anchor path already produced a valid mask.
    gdino_success = anchor_success  # True = already have a good mask

    try:
        if anchor_success:
            raise RuntimeError("anchor path succeeded — skipping GDINO")
        gdino_proc, gdino_model = _load_grounding_dino()

        gdino_text, primary_tokens, accessory_tokens, component_tokens = _build_gdino_context(
            category, flags, item_name,
            subcategories=subcategories, components=components,
        )
        print(f"  GDINO query: {gdino_text!r}")
        print(f"  GDINO component tokens: {sorted(component_tokens)}")

        dets = _run_grounding_dino(vton_img, gdino_text, gdino_proc, gdino_model)
        print(f"  GDINO raw: {len(dets)} detections")
        for d in dets:
            print(f"    [{d['score']:.2f}] {d['label']} {[int(x) for x in d['box']]}")

        # Score filter: drop marginal detections below GDINO_MIN_SCORE
        dets_pre_filter = dets  # save for marginal rescue if Primary=0
        dets = [d for d in dets if d["score"] >= GDINO_MIN_SCORE]
        print(f"  After score filter (>={GDINO_MIN_SCORE}): {len(dets)}")

        dets = _nms_detections(dets)
        dets = _cross_label_nms(dets, protected_tokens=component_tokens)
        print(f"  After NMS + cross-label NMS: {len(dets)}")

        primary_dets, accessory_dets, component_dets = _filter_and_classify(
            dets, primary_tokens, accessory_tokens, component_tokens
        )
        print(f"  Primary={len(primary_dets)}  Accessory={len(accessory_dets)}  Component={len(component_dets)}")

        if not primary_dets:
            # Marginal rescue: accept detections between BOX_THRESHOLD and MIN_SCORE when
            # nothing survived the strict filter. Only fires before SegFormer fallback.
            marginal = [d for d in dets_pre_filter
                        if GDINO_BOX_THRESHOLD <= d["score"] < GDINO_MIN_SCORE]
            marginal_primary, _, marginal_component = _filter_and_classify(
                marginal, primary_tokens, accessory_tokens, component_tokens
            )
            if marginal_primary or marginal_component:
                primary_dets = marginal_primary
                component_dets = marginal_component
                rescued = [(d['label'], round(d['score'],2)) for d in marginal_primary + marginal_component]
                print(f"  GDINO: rescued marginal dets: {rescued}")
            else:
                print("  GDINO: 0 primary detections — falling back to SegFormer.")

        if primary_dets or accessory_dets or component_dets:
            img_array = np.array(vton_img.convert("RGB"))
            sam2_pred = _load_sam2_predictor(sam2_variant, img_array)
            merged    = np.zeros((vton_img.height, vton_img.width), dtype=np.uint8)
            primary_boxes = []

            # Use only the highest-confidence primary detection for the SAM2 mask.
            # Secondary detections of the same garment (e.g. "pants" + "trousers") are
            # redundant and their wider/looser bboxes bleed into feet/arms/background.
            #
            # EXEMPTIONS — use union of all primary detections when:
            #   is_two_piece / has_overalls : genuinely two spatial regions (top + bottom)
            #   footwear                    : left shoe + right shoe = two separate objects
            #
            # TODO(jackets/overcoats): open-front / wrap-front / layered outerwear often
            # fires two detections for left and right panels of the same garment. When
            # jacket/overcoat support is added, add `is_open_front` here so both panel
            # detections are OR'd together.
            use_top1_primary = not (flags.get("is_two_piece") or flags.get("has_overalls")
                                    or flags.get("has_fringe") or flags.get("is_jumpsuit")
                                    or category == "footwear")
            if use_top1_primary and primary_dets:
                # Selection strategy is category-dependent:
                #
                # TOPWEAR / DRESSES → prefer LARGEST AREA.
                #   Part-detections ("sleeve", "collar") have smaller boxes than the
                #   full garment. Area correctly selects the full garment even when a
                #   part-token scores marginally higher (sleeve 0.40 vs jacket 0.38).
                #
                # BOTTOMWEAR → prefer HIGHEST SCORE.
                #   Over-inclusive detections ("joggers" = full-body box) score LOWER
                #   than tight-fit "pants/trousers" detections. Area would wrongly pick
                #   the full-body box. Score correctly picks the tight pants box.
                def _box_area(d):
                    b = d["box"]
                    return (b[2] - b[0]) * (b[3] - b[1])

                # Filter out spurious full-image detections before top-1 selection.
                # A box covering >80% of image area is almost never a precise garment
                # localization — GDINO occasionally assigns full-scene labels this way.
                # Keep these only if they are the sole detection.
                _img_area = h_v * w_v
                _SPURIOUS_FRAC = 0.80
                _non_spurious = [d for d in primary_dets
                                 if _box_area(d) / _img_area < _SPURIOUS_FRAC]
                if _non_spurious:
                    if len(_non_spurious) < len(primary_dets):
                        _dropped_sp = [d["label"] for d in primary_dets
                                       if d not in _non_spurious]
                        print(f"    Spurious full-image box filter: dropped {_dropped_sp}")
                    primary_dets = _non_spurious

                if category in ("topwear", "dresses"):
                    active_primary = [max(primary_dets, key=_box_area)]
                    mode = f"largest area={int(_box_area(active_primary[0]))}"
                else:
                    active_primary = [primary_dets[0]]   # already sorted by score DESC
                    mode = f"highest score={active_primary[0]['score']:.2f}"

                if len(primary_dets) > 1:
                    dropped = [f"{d['label']}({d['score']:.2f},A={int(_box_area(d))})"
                               for d in primary_dets if d is not active_primary[0]]
                    print(f"    Top-1 ({mode}): {active_primary[0]['label']}; dropped {dropped}")
            else:
                active_primary = primary_dets

            if category == "footwear" and len(active_primary) > 1:
                # Select avatar's right shoe = leftmost in image (smallest x-center)
                active_primary = sorted(active_primary,
                                        key=lambda d: (d["box"][0] + d["box"][2]) / 2)[:1]
                print(f"    Footwear: selected avatar-right shoe (min x-center): "
                      f"{active_primary[0]['label']} @ box {[int(x) for x in active_primary[0]['box']]}")

            for d in active_primary:
                box = list(d["box"])
                m = _sam2_box_mask(sam2_pred, box)
                merged = np.maximum(merged, m)
                primary_boxes.append(box)
                print(f"    SAM2 [{d['label']} {d['score']:.2f}]: {(m > 127).sum()} px")

            if primary_boxes:
                p_union = [
                    min(b[0] for b in primary_boxes),
                    min(b[1] for b in primary_boxes),
                    max(b[2] for b in primary_boxes),
                    max(b[3] for b in primary_boxes),
                ]
            else:
                p_union = [0, 0, vton_img.width, vton_img.height]

            for d in accessory_dets:
                ov = _overlap_fraction(d["box"], p_union)
                if ov >= GDINO_ACCESSORY_OVERLAP:
                    m = _sam2_box_mask(sam2_pred, d["box"])
                    merged = np.maximum(merged, m)
                    print(f"    SAM2 acc [{d['label']} {d['score']:.2f}] ov={ov:.2f}: {(m > 127).sum()} px")
                else:
                    print(f"    Skip acc [{d['label']}] ov={ov:.2f} < {GDINO_ACCESSORY_OVERLAP}")

            # ── Component guarantee: GDINO-detected components → SAM2 box masks ────
            guaranteed_region = np.zeros((vton_img.height, vton_img.width), dtype=bool)
            if component_dets:
                print(f"  Component guarantees: {len(component_dets)} GDINO-detected")
                for cd in component_dets:
                    cm = _sam2_box_mask(sam2_pred, cd["box"])
                    cm_bool = cm > 127
                    guaranteed_region |= cm_bool
                    merged = np.maximum(merged, cm)
                    print(f"    Component [{cd['label']} {cd['score']:.2f}]: {cm_bool.sum()} px")

            # ── SegFormer fallback for undetected components ──────────────────────────
            # Fires when a needed component wasn't picked up by GDINO.
            # Uses spatially-scoped SegFormer labels as last resort.
            if components:
                from scipy import ndimage as _ndi_comp
                _comp_struct = _ndi_comp.generate_binary_structure(2, 2)
                detected_comp_labels = {cd["label"] for cd in component_dets}

                # Belt fallback: SegFormer label 8 (belt) — very reliable
                needs_belt = any(
                    c in ("belt", "sash") for c in components
                ) and "belt" not in detected_comp_labels and "sash" not in detected_comp_labels
                if needs_belt:
                    belt_raw = (pred == 8)
                    if belt_raw.any():
                        belt_dilated = _ndi_comp.binary_dilation(
                            belt_raw, structure=_ndi_comp.iterate_structure(_comp_struct, 5)
                        )
                        belt_bool = belt_dilated
                        guaranteed_region |= belt_bool
                        merged[belt_dilated] = 255
                        print(f"  [SegFormer fallback] Belt: {belt_raw.sum()} raw → {belt_dilated.sum()} dilated px")

                # Bib/strap fallback: for overalls/dungarees, use SAM2 directly on
                # the bib region (above primary bbox top). More reliable than SegFormer
                # because SegFormer often labels denim bib as "pants" (label 6) instead
                # of "upper-clothes" (label 4), giving very few fallback pixels.
                needs_upper = any(
                    c in ("bib", "shoulder strap", "suspender", "halter neck", "hood", "cape")
                    for c in components
                ) and not any(
                    cd["label"] in ("bib", "strap", "halter", "hood", "cape")
                    for cd in component_dets
                )
                if needs_upper and primary_boxes:
                    p_top  = min(b[1] for b in primary_boxes)
                    scope_mask = np.zeros(pred.shape, dtype=bool)
                    scope_mask[:int(p_top), :] = True

                    if flags.get("has_overalls"):
                        # Overalls/dungarees: SegFormer labels shoulder straps as background
                        # (label 0) because straps are narrow dark strips on gray V-ToN bg.
                        # SegFormer-label approach always misses straps → use bg-subtraction:
                        #   1. Find non-background pixels above p_top (scope_mask)
                        #   2. Remove body-colour pixels (skin/mannequin) from that set
                        #   3. Remaining = garment (bib + straps)
                        # vton_arr_rgb and sampled_bg are available at this scope.
                        _bg_arr = np.array(sampled_bg[:3], dtype=float)
                        _non_bg = (np.abs(vton_arr_rgb.astype(float) - _bg_arr).max(axis=2) > 30)
                        # Sample body colour from head zone (top 18%, center 60% width)
                        _h_tmp, _w_tmp = vton_arr_rgb.shape[:2]
                        _hr = int(_h_tmp * 0.18)
                        _hcl, _hcr = int(_w_tmp * 0.20), int(_w_tmp * 0.80)
                        _head_px = vton_arr_rgb[:_hr, _hcl:_hcr]
                        _not_bg_head = np.abs(_head_px.astype(float) - _bg_arr).max(axis=2) > 25
                        _body_cands = _head_px[_not_bg_head]
                        if len(_body_cands) > 50:
                            _body_rgb = np.median(_body_cands, axis=0)
                            _is_body = np.abs(vton_arr_rgb.astype(float) - _body_rgb).max(axis=2) < 55
                            bib_raw = _non_bg & ~_is_body & scope_mask
                        else:
                            bib_raw = _non_bg & scope_mask
                        if bib_raw.any():
                            bib_dilated = _ndi_comp.binary_dilation(
                                bib_raw, structure=_ndi_comp.iterate_structure(_comp_struct, 3)
                            )
                            guaranteed_region |= bib_dilated
                            merged[bib_dilated] = 255
                            print(f"  [overalls bib+strap bg-sub] above y={int(p_top)}: "
                                  f"{bib_raw.sum()} raw → {bib_dilated.sum()} dilated px (guaranteed)")
                        else:
                            print(f"  [overalls bib+strap bg-sub] no non-bg pixels found above y={int(p_top)}")
                    else:
                        # Other upper-components (halter, hood, cape): label 4 scoped above p_top.
                        upper_raw = (pred == 4) & scope_mask
                        if upper_raw.any():
                            upper_dilated = _ndi_comp.binary_dilation(
                                upper_raw, structure=_ndi_comp.iterate_structure(_comp_struct, 3)
                            )
                            guaranteed_region |= upper_dilated
                            merged[upper_dilated] = 255
                            print(f"  [SegFormer fallback] Upper-component above y={int(p_top)}: "
                                  f"{upper_raw.sum()} raw → {upper_dilated.sum()} dilated px")

            # Save pre-exclusion SAM2 mask for sheer post-exclusion repair
            _sam2_pre_excl = (merged > 127).copy() if flags.get("is_sheer") else None

            # ── Exclusion: body labels, but NOT on guaranteed component pixels ─────────
            merged[exclusion_mask & ~guaranteed_region] = 0
            if guaranteed_region.any():
                merged[guaranteed_region] = 255  # immune to exclusion
                print(f"  Exclusion applied; {guaranteed_region.sum():,} guaranteed px immune")
            else:
                print(f"  Exclusion applied (no guaranteed region)")

            # ── Overalls bib: body-colour exclusion in arm-hole zone ─────────────────
            # Problem: bib_dilated (3-iteration dilation) extends into arm-hole skin areas.
            # Body-category exclusion can't touch guaranteed_region pixels, so arm body
            # colour leaks into the ghost.
            # Fix: sample the mannequin body colour from the head/neck zone of the V-ToN
            # image (top 18% of image, center strip), excluding background-coloured pixels.
            # This works for both real-skin avatars and featureless mannequins (no face label).
            # Then remove any body-colour-matched pixels from the bib guaranteed zone.
            # Scoped to bib zone only (above primary bbox top).
            if flags.get("has_overalls") and primary_boxes:
                _bib_p_top = min(b[1] for b in primary_boxes)
                _bib_zone = np.zeros(pred.shape, dtype=bool)
                _bib_zone[:int(_bib_p_top), :] = True
                # Sample mannequin body colour from head zone: top 18% of image,
                # center 60% width (avoids edge background pixels).
                _h_v, _w_v = vton_arr_rgb.shape[:2]
                _head_r = int(_h_v * 0.18)
                _head_cl = int(_w_v * 0.20)
                _head_cr = int(_w_v * 0.80)
                _head_zone_px = vton_arr_rgb[:_head_r, _head_cl:_head_cr]
                _bg_rgb = np.array(sampled_bg[:3], dtype=float)
                _head_not_bg = np.abs(_head_zone_px.astype(float) - _bg_rgb).max(axis=2) > 25
                _body_candidates = _head_zone_px[_head_not_bg]
                if len(_body_candidates) > 100:
                    _bib_body_rgb = np.median(_body_candidates, axis=0)
                    _bib_body_tol = 50.0
                    _bib_body_match = (
                        (np.abs(vton_arr_rgb.astype(float) - _bib_body_rgb).max(axis=2) < _bib_body_tol)
                        & _bib_zone
                        & (merged > 127)
                    )
                    if _bib_body_match.any():
                        merged[_bib_body_match] = 0
                        guaranteed_region[_bib_body_match] = False
                        print(f"  Overalls bib body exclusion: body≈RGB{_bib_body_rgb.astype(int).tolist()} "
                              f"tol={_bib_body_tol:.0f} → removed {int(_bib_body_match.sum()):,} px from bib zone")
                else:
                    print(f"  Overalls bib body exclusion: insufficient head-zone samples ({len(_body_candidates)}), skipped")

            # ── Head-always exclusion: face/hair/hat NEVER appear in ghost ────────────
            # Guaranteed region protects component pixels from garment-category exclusion,
            # but head labels are ALWAYS zeroed — scarf/collar SAM2 boxes can overlap face.
            # Skipped for footwear: SegFormer misidentifies shoe pixels as hat/hair (label 1)
            # since we skip SegFormer exclusion entirely for footwear.
            if category != "footwear":
                head_mask = np.zeros(pred.shape, dtype=bool)
                for _hl in _HEAD_ALWAYS_EXCLUDE_LABELS:
                    head_mask |= (pred == _hl)
                if head_mask.any():
                    head_px_removed = int((head_mask & (merged > 127)).sum())
                    merged[head_mask] = 0
                    if head_px_removed:
                        print(f"  Head-always exclusion: removed {head_px_removed:,} face/hair/hat px")

            # ── Skin-colour exclusion (topwear / dresses) ─────────────────────────────
            # Only fires when a COMPONENT GUARANTEE reaches the face zone (top 30%).
            # Problem: component SAM2 boxes (scarf, collar) extend into face area;
            # SegFormer often labels the avatar head as bg/upper (not face label 11),
            # so head-always exclusion misses those skin-toned pixels.
            # Fix: sample the avatar's actual skin colour from SegFormer face pixels
            # then remove ANY mask pixel that colour-matches skin — regardless of label.
            # This removes face/neck skin WITHOUT cutting garment pixels whose colour
            # is far from skin (e.g. dark scarf, bright blouse).
            # Risk: only fails for flesh-toned garments; acceptable given the narrow
            # trigger condition (component guarantee must reach face zone).
            if category in ("topwear", "dresses"):
                h_pred = pred.shape[0]
                face_zone_limit = int(h_pred * 0.30)
                if guaranteed_region[:face_zone_limit, :].any():
                    face_sf_top = (pred[:int(h_pred * 0.25), :] == 11)
                    face_px_count = int(face_sf_top.sum())
                    if face_px_count > 200:
                        # Sample avatar skin colour from SegFormer-labelled face pixels
                        skin_rgb = vton_arr_rgb[:int(h_pred * 0.25), :][face_sf_top].mean(axis=0)
                        skin_tol = 60.0  # max per-channel deviation to count as "skin"
                        skin_match = np.abs(vton_arr_rgb.astype(float) - skin_rgb).max(axis=2) < skin_tol
                        removed = int((skin_match & (merged > 127)).sum())
                        if removed > 0:
                            merged[skin_match] = 0
                            guaranteed_region[skin_match] = False
                            print(f"  Skin-colour exclusion: skin≈RGB{skin_rgb.astype(int).tolist()} "
                                  f"tol={skin_tol:.0f} → removed {removed:,} px")

            # ── Sheer/openwork: restore interior SAM2 pixels removed by body exclusion ──
            # For is_sheer (crochet, pointelle, lace), body exclusion can fragment the
            # mask: openwork holes expose body pixels (legs through crochet) that
            # SegFormer labels as body parts → exclusion creates voids → disconnects.
            # Fix: erode the pre-exclusion SAM2 mask to get the "interior" region, then
            # restore any body-excluded pixels within that interior zone.
            # Erosion boundary = EDGE_GUARD pixels, keeping edge pixels (where actual
            # body overlap like arms can occur) still subject to exclusion.
            # This bridges crochet-hole gaps for openwork without restoring arm-bleed
            # for long-sleeve sheer tops (arms are at the mask edge, not interior).
            if flags.get("is_sheer") and _sam2_pre_excl is not None and _sam2_pre_excl.any():
                import scipy.ndimage as _snd_sheer
                _EDGE_GUARD = 40   # px eroded from SAM2 boundary = "safe interior"
                _erosion_struct = _snd_sheer.generate_binary_structure(2, 1)
                _erosion_struct = _snd_sheer.iterate_structure(_erosion_struct, _EDGE_GUARD)
                _interior = _snd_sheer.binary_erosion(_sam2_pre_excl, structure=_erosion_struct)
                # Voids = pixels that SAM2 had but body exclusion removed
                _voids_in_interior = _interior & ~(merged > 127)
                if _voids_in_interior.any():
                    merged[_voids_in_interior] = 255
                    print(f"  Sheer interior restore (guard={_EDGE_GUARD}px): "
                          f"restored {_voids_in_interior.sum():,} void px within interior")

            # Detect bg-colored interior holes BEFORE fill_holes seals them
            trapped_holes = _detect_trapped_bg_holes(merged, vton_arr_rgb, bg_color=sampled_bg)

            # Cutout detection: for has_cutouts, detect enclosed body-labeled holes.
            # has_cutouts: cold-shoulder / keyhole gaps showing skin
            if flags.get("has_cutouts"):
                cutout_holes = _detect_cutout_holes(merged, exclusion_mask)
                if cutout_holes is not None:
                    trapped_holes = (trapped_holes | cutout_holes) if trapped_holes is not None else cutout_holes

            if is_two_piece:
                final_mask = _polish_mask_hard(
                    Image.fromarray(merged, mode="L"),
                    closing_size=closing_size, fill_holes=False,
                )
            else:
                final_mask = _polish_mask_hard(
                    Image.fromarray(merged, mode="L"),
                    closing_size=closing_size,
                )

            # Punch trapped holes back out — only pixels fill_holes actually sealed (now 255)
            if trapped_holes is not None and trapped_holes.any():
                arr = np.array(final_mask)
                to_zero = trapped_holes & (arr > 127)   # outer bg stays 0 already → skip
                if to_zero.any():
                    arr[to_zero] = 0
                    final_mask = Image.fromarray(arr, mode="L")
                    print(f"  Punched out {to_zero.sum():,} filled trapped-bg px from final mask")

            gdino_success = True
            print("  GDINO+SAM2 path succeeded.")
        else:
            print("  GDINO: no relevant detections — falling back to SegFormer.")

    except Exception as exc:
        if not anchor_success:
            print(f"  GDINO path failed ({exc}) — falling back to SegFormer+SAM2.")

    # ── Fallback: SegFormer coarse → SAM2 point prompts ───────────────────────
    if not gdino_success:
        target_labels = resolve_labels(category, flags)
        print(f"  Fallback: labels={target_labels} closing={closing_size}")

        mask = np.zeros_like(pred, dtype=np.uint8)
        for lbl in target_labels:
            mask[pred == lbl] = 255

        belt_guarantee = None
        if flags.get("has_belt") and 8 in target_labels:
            from scipy import ndimage as _ndi
            belt_raw = (pred == 8)
            if belt_raw.any():
                struct = _ndi.generate_binary_structure(2, 2)
                belt_dilated = _ndi.binary_dilation(
                    belt_raw, structure=_ndi.iterate_structure(struct, 5)
                )
                belt_guarantee = belt_dilated
                print(f"  Belt guarantee: {belt_raw.sum()} → {belt_dilated.sum()} px")

        if not is_two_piece:
            try:
                from scipy import ndimage as _ndi2
                mask = (_ndi2.binary_fill_holes(mask.astype(bool)) * 255).astype(np.uint8)
            except ImportError:
                pass

        coarse_mask = Image.fromarray(mask, mode="L")
        coarse_mask.save(output_dir / "stage3_coarse_mask.png")

        if use_sam2:
            if is_two_piece:
                final_mask = _refine_two_piece(
                    vton_img, mask, sam2_variant,
                    closing_size=closing_size, exclusion_mask=exclusion_mask,
                )
            else:
                refined = _refine_mask(vton_img, coarse_mask, sam2_variant)
                if refined is not None:
                    refined_arr = np.array(refined)
                    refined_arr[exclusion_mask] = 0
                    if belt_guarantee is not None:
                        refined_arr[belt_guarantee] = 255
                    trapped_holes_fb = _detect_trapped_bg_holes(refined_arr, vton_arr_rgb, bg_color=sampled_bg)
                    final_mask = _polish_mask_hard(
                        Image.fromarray(refined_arr, mode="L"), closing_size=closing_size
                    )
                    if trapped_holes_fb is not None and trapped_holes_fb.any():
                        arr = np.array(final_mask)
                        to_zero = trapped_holes_fb & (arr > 127)
                        if to_zero.any():
                            arr[to_zero] = 0
                            final_mask = Image.fromarray(arr, mode="L")
                            print(f"  Punched out {to_zero.sum():,} filled trapped-bg px (fallback)")
                else:
                    coarse_arr = np.array(coarse_mask)
                    coarse_arr[exclusion_mask] = 0
                    if belt_guarantee is not None:
                        coarse_arr[belt_guarantee] = 255
                    trapped_holes_fb = _detect_trapped_bg_holes(coarse_arr, vton_arr_rgb, bg_color=sampled_bg)
                    final_mask = _polish_mask_hard(
                        Image.fromarray(coarse_arr, mode="L"), closing_size=closing_size
                    )
                    if trapped_holes_fb is not None and trapped_holes_fb.any():
                        arr = np.array(final_mask)
                        to_zero = trapped_holes_fb & (arr > 127)
                        if to_zero.any():
                            arr[to_zero] = 0
                            final_mask = Image.fromarray(arr, mode="L")
                            print(f"  Punched out {to_zero.sum():,} filled trapped-bg px (fallback coarse)")
        else:
            coarse_arr = np.array(coarse_mask)
            coarse_arr[exclusion_mask] = 0
            trapped_holes_fb = _detect_trapped_bg_holes(coarse_arr, vton_arr_rgb, bg_color=sampled_bg) if not is_two_piece else None
            final_mask = _polish_mask_hard(
                Image.fromarray(coarse_arr, mode="L"),
                closing_size=closing_size, fill_holes=not is_two_piece,
            )
            if trapped_holes_fb is not None and trapped_holes_fb.any():
                arr = np.array(final_mask)
                to_zero = trapped_holes_fb & (arr > 127)
                if to_zero.any():
                    arr[to_zero] = 0
                    final_mask = Image.fromarray(arr, mode="L")
                    print(f"  Punched out {to_zero.sum():,} filled trapped-bg px (no-sam2)")

    # ── Strip border-adjacent bg pixels from final mask ──────────────────────
    final_mask = _strip_border_bg_from_mask(final_mask, vton_arr_rgb, bg_color=sampled_bg)

    # ── Feather last — after ALL structural exclusions are done ───────────────
    # All edges (original garment boundary + punched holes + stripped border)
    # get uniform soft feathering in one pass.
    print("  Feathering mask (final step)...")
    final_mask = _feather_mask(final_mask, feather_radius=1)

    out_path = output_dir / "stage3_clothing_mask.png"
    final_mask.save(out_path)
    print(f"  Saved final mask: {out_path}")
    return final_mask, sampled_bg


def _strip_border_bg_from_mask(
    mask_img: Image.Image,
    vton_arr: np.ndarray,
    bg_color: np.ndarray = None,
    color_tolerance: float = 30.0,
    min_px: int = 200,
) -> Image.Image:
    """
    Remove background-colored mask pixels that are connected to the image border.

    Targets: SAM2 mask bleed into the gray bg at image edges (bottom strip, sides).
    Safe because legitimate garment pixels at the border are garment-colored, not #808080.
    """
    from scipy import ndimage

    if bg_color is None:
        bg_color = _VTON_BG

    mask_arr  = np.array(mask_img)
    mask_bool = mask_arr > 127

    diff      = np.abs(vton_arr.astype(float) - bg_color)
    bg_match  = diff.max(axis=2) < color_tolerance

    # bg-colored pixels that are inside the mask
    candidates = bg_match & mask_bool
    if not candidates.any():
        return mask_img

    labeled, n = ndimage.label(candidates)
    out_arr    = mask_arr.copy()
    removed    = 0

    for cid in range(1, n + 1):
        comp = labeled == cid
        px   = int(comp.sum())
        if px < min_px:
            continue
        # Only strip if connected to image border
        if not (comp[0, :].any() or comp[-1, :].any() or comp[:, 0].any() or comp[:, -1].any()):
            continue
        out_arr[comp] = 0
        removed += 1
        print(f"    Border bg strip #{cid}: {px:,} px — removed from mask")

    if removed:
        print(f"  Border-bg strip: removed {removed} region(s)")
    else:
        print(f"  Border-bg strip: nothing found")

    return Image.fromarray(out_arr, mode="L")


def _detect_cutout_holes(
    mask_arr: np.ndarray,
    exclusion_mask: np.ndarray,
    min_hole_px: int = 100,
    body_frac_threshold: float = 0.50,
) -> np.ndarray | None:
    """
    Detect design cutout holes: enclosed mask=0 regions that are predominantly
    body-labeled (exclusion_mask=True). Used for cold-shoulder gaps, keyhole
    necklines, etc. where mannequin skin shows through, not background gray.
    Must be called pre-polish (holes still exist as mask=0).
    """
    from scipy import ndimage

    bg_region = mask_arr < 128
    labeled, n = ndimage.label(bg_region)
    if n == 0:
        return None

    h, w    = mask_arr.shape
    trapped = np.zeros((h, w), dtype=bool)
    found   = 0

    for cid in range(1, n + 1):
        comp = labeled == cid
        px   = int(comp.sum())
        if px < min_hole_px:
            continue
        if comp[0, :].any() or comp[-1, :].any() or comp[:, 0].any() or comp[:, -1].any():
            continue   # touches border → outer bg, not a cutout

        # Check: predominantly body/skin-labeled pixels
        body_frac = exclusion_mask[comp].mean()
        if body_frac < body_frac_threshold:
            continue

        trapped |= comp
        found   += 1
        print(f"    Cutout hole #{cid}: {px:,} px  body_frac={body_frac:.0%} — will punch out")

    if found:
        print(f"  Cutout holes detected: {found} region(s) ({trapped.sum():,} px)")
        return trapped

    print("  Cutout hole check: none found")
    return None


def _detect_trapped_bg_holes(
    mask_arr: np.ndarray,
    vton_arr: np.ndarray,
    bg_color: np.ndarray = None,
    color_tolerance: float = 30.0,
    min_hole_px: int = 300,
) -> np.ndarray | None:
    """
    Detect interior background-colored holes in a pre-polish mask.

    Must be called BEFORE _polish_mask (before fill_holes seals the gaps).
    At that point, arm-waist gaps are still mask=0 (holes). This function
    finds connected components of mask=0 that:
      (a) do NOT touch the image border  →  interior holes, not outer bg
      (b) are background-colored in the V-ToN image

    Returns a boolean array marking those trapped hole pixels, or None if none found.
    The caller re-zeros those pixels in the final mask after polish.
    """
    from scipy import ndimage

    if bg_color is None:
        bg_color = _VTON_BG

    bg_region = mask_arr < 128                  # holes + outer background
    labeled, n = ndimage.label(bg_region)
    if n == 0:
        return None

    h, w    = mask_arr.shape
    trapped = np.zeros((h, w), dtype=bool)
    found   = 0

    vton_f = vton_arr.astype(float)

    for cid in range(1, n + 1):
        comp = labeled == cid
        px   = int(comp.sum())
        if px < min_hole_px:
            continue

        # Check: are these pixels background-colored in the V-ToN image?
        diff    = np.abs(vton_f[comp] - bg_color)          # (N, 3)
        bg_frac = (diff.max(axis=1) < color_tolerance).mean()
        if bg_frac < 0.60:
            continue   # not predominantly background-colored — skip (shadow, detail)

        border  = (comp[0, :].any() or comp[-1, :].any() or comp[:, 0].any() or comp[:, -1].any())
        if border:
            continue   # outer background — not interior hole, do not punch
        trapped |= comp
        found   += 1
        print(f"    Trapped bg hole #{cid}: {px:,} px  bg_match={bg_frac:.0%}  border=False — will punch out")

    if found:
        print(f"  Detected {found} trapped bg hole(s) ({trapped.sum():,} px total)")
        return trapped

    print("  Trapped-bg check: no interior bg holes found")
    return None


def _polish_mask_hard(
    mask_img: Image.Image,
    closing_size: int = 2,
    fill_holes: bool = True,
) -> Image.Image:
    """
    Morphological closing (remove jags, close small gaps) + optional fill_holes.
    Returns a hard 0/255 mask — NO feathering.
    Feathering is applied separately at the end of run_stage3 via _feather_mask(),
    after ALL exclusions (trapped holes, border strip) are complete.
    fill_holes=False for two-piece sets — preserves intentional midriff gap.
    """
    from scipy import ndimage

    arr = np.array(mask_img).astype(bool)
    struct = ndimage.generate_binary_structure(2, 2)

    closed = ndimage.binary_closing(arr, structure=ndimage.iterate_structure(struct, closing_size)) \
             if closing_size > 0 else arr
    filled = ndimage.binary_fill_holes(closed) if fill_holes else closed

    # ── Debris filter: keep only components ≥ 5% of the largest component ──
    # Drops isolated stray islands (arm-region noise, shoulder artifacts, etc.)
    # while preserving legitimate secondary regions (e.g. two-piece skirt, wide hems).
    labeled, n = ndimage.label(filled)
    if n > 1:
        sizes    = ndimage.sum(filled, labeled, range(1, n + 1))
        max_size = max(sizes)
        keep_ids = {i + 1 for i, s in enumerate(sizes) if s >= max(500, max_size * 0.05)}
        filled   = np.isin(labeled, list(keep_ids))

    return Image.fromarray((filled * 255).astype(np.uint8), mode="L")


def _feather_mask(
    mask_img: Image.Image,
    feather_radius: int = 2,
) -> Image.Image:
    """
    Gaussian feather: soft anti-aliased boundary on a hard 0/255 mask.
    Interior pixels stay fully opaque (255); only the boundary zone softens.
    Call this LAST — after all structural exclusions are done.
    """
    from scipy import ndimage
    from PIL import ImageFilter

    if feather_radius <= 0:
        return mask_img

    arr    = np.array(mask_img).astype(bool)
    struct = ndimage.generate_binary_structure(2, 2)

    hard_img  = Image.fromarray((arr * 255).astype(np.uint8), mode="L")
    feathered = hard_img.filter(ImageFilter.GaussianBlur(radius=feather_radius))

    # Interior pixels (eroded core) stay fully opaque; only boundary gets the blur
    interior = ndimage.binary_erosion(arr, structure=ndimage.iterate_structure(struct, max(1, feather_radius + 1)))
    result   = np.array(feathered)
    result[interior] = 255
    return Image.fromarray(result, mode="L")


# Keep _polish_mask as a convenience alias used by _refine_two_piece and _refine_mask callers
def _polish_mask(
    mask_img: Image.Image,
    feather_radius: int = 0,   # default 0 — callers in run_stage3 now go through _polish_mask_hard
    closing_size: int = 2,
    fill_holes: bool = True,
) -> Image.Image:
    """Structural polish only (closing + fill_holes). Feathering moved to _feather_mask."""
    return _polish_mask_hard(mask_img, closing_size=closing_size, fill_holes=fill_holes)

# ── Composite: ghost mannequin ────────────────────────────────────────────────

_VTON_BG = np.array([128.0, 128.0, 128.0])  # #808080 — fallback default


def _despill_rgba(
    rgb_arr: np.ndarray,
    alpha_arr: np.ndarray,
    bg_color: np.ndarray | None = None,
) -> np.ndarray:
    """
    Remove background contamination from feathered boundary pixels.

    The V-TON image was rendered on a known background color, so boundary pixels encode:
      pixel = garment_color * a + bg * (1 - a)
    Recover: garment_color = (pixel - bg * (1 - a)) / a.
    Full interior (a=1) and fully transparent (a=0) pixels are untouched.

    bg_color: RGB array [R, G, B] matching actual V-ToN background (sampled from corners).
              Falls back to _VTON_BG (#808080) if None.
    """
    if bg_color is None:
        bg_color = _VTON_BG

    a = alpha_arr / 255.0                          # (H, W) float in [0,1]
    feather = (a > 0.0) & (a < 1.0)               # only the soft boundary zone
    if not feather.any():
        return rgb_arr

    rgb = rgb_arr.astype(np.float32)
    out = rgb.copy()
    for c, bg in enumerate(bg_color):
        channel = rgb[:, :, c]
        de_spilled = (channel - bg * (1.0 - a)) / np.where(a > 0, a, 1.0)
        out[:, :, c] = np.where(feather, np.clip(de_spilled, 0, 255), channel)
    return out.astype(np.uint8)


def create_ghost(
    vton_img: Image.Image,
    mask_img: Image.Image,
    output_dir: Path,
    sampled_bg: np.ndarray | None = None,
) -> Image.Image:
    print("[Composite] Creating ghost mannequin...")

    rgb_arr   = np.array(vton_img.convert("RGB"))
    alpha_arr = np.array(mask_img)                 # feathered, 0-255

    # De-spill: recover garment color from boundary pixels contaminated by bg blend
    rgb_clean = _despill_rgba(rgb_arr, alpha_arr, bg_color=sampled_bg)
    r = Image.fromarray(rgb_clean[:, :, 0], mode="L")
    g = Image.fromarray(rgb_clean[:, :, 1], mode="L")
    b = Image.fromarray(rgb_clean[:, :, 2], mode="L")
    rgba = Image.merge("RGBA", (r, g, b, mask_img))

    # Tight crop anchored at top of garment (pad=8 all sides)
    hard_arr = alpha_arr > 64
    ys, xs = np.where(hard_arr)
    bbox = None
    x0 = y0 = x1 = y1 = 0
    if len(xs):
        pad = 8
        x0 = max(0, int(xs.min()) - pad)
        y0 = max(0, int(ys.min()) - pad)   # top anchor — tight to garment top
        x1 = min(rgba.width,  int(xs.max()) + pad)
        y1 = min(rgba.height, int(ys.max()) + pad)
        rgba = rgba.crop((x0, y0, x1, y1))
        bbox = (x0, y0, x1, y1)

    # Save transparent PNG (RGBA)
    out_path = output_dir / "ghost_mannequin.png"
    rgba.save(out_path)
    print(f"  Saved (RGBA transparent): {out_path}")

    # White-bg version for preview
    white_bg = Image.new("RGB", rgba.size, (255, 255, 255))
    white_bg.paste(rgba, mask=rgba.split()[3])
    white_path = output_dir / "ghost_mannequin_white.png"
    white_bg.save(white_path)
    print(f"  Saved (white bg preview): {white_path}")

    # Side-by-side comparison: V-TON | ghost on white
    vton_crop = vton_img.crop((x0, y0, x1, y1)) if bbox else vton_img
    w, h = white_bg.width, white_bg.height
    comparison = Image.new("RGB", (w * 2 + 8, h), (200, 200, 200))
    comparison.paste(vton_crop.resize((w, h)), (0, 0))
    comparison.paste(white_bg, (w + 8, 0))
    comp_path = output_dir / "comparison.png"
    comparison.save(comp_path)
    print(f"  Saved: {comp_path}")

    return rgba

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Avatar V-TON → Ghost Mannequin test script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--garment", required=True,
        help="Product image path (flatlay or on-figure shot)")
    parser.add_argument("--model-shot",
        help="Photo of model wearing item — improves Stage 1 physics accuracy")
    parser.add_argument("--view", choices=["front", "back"], default="front")
    parser.add_argument("--category",
        choices=["topwear", "bottomwear", "footwear", "dresses"], default="topwear")
    parser.add_argument("--gender", choices=["male", "female"], default="female")
    parser.add_argument("--body-type",
        choices=list(BODY_TYPE_PRESETS.keys()), default="standard")
    parser.add_argument("--body-type-desc",
        help="Freeform body physics override (takes priority over --body-type)")

    # Stage 1 bypass
    parser.add_argument("--garment-physics",
        help="GARMENT_PHYSICS text — skips Stage 1")
    parser.add_argument("--geometry-skeleton", default="",
        help="GEOMETRY_SKELETON text — used for back view when skipping Stage 1")
    parser.add_argument("--item-name", default="garment",
        help="Product name — used when skipping Stage 1")
    parser.add_argument("--flag-overrides", default=None,
        help="JSON dict of flag overrides merged on top of physics-detected flags (e.g. '{\"is_two_piece\":true}')")

    parser.add_argument("--output-dir", default="./ghost_output")
    parser.add_argument("--text-model",  default=DEFAULT_TEXT_MODEL)
    parser.add_argument("--image-model", default=DEFAULT_IMAGE_MODEL)
    parser.add_argument("--storage-bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--no-sam2", action="store_true",
        help="Skip SAM refinement — use SegFormer coarse mask only")
    parser.add_argument("--sam2-variant",
        choices=list(SAM_CHECKPOINTS.keys()), default="sam2_large",
        help="SAM variant (default: sam2_large). SAM2 requires Python 3.10+; v1 fallbacks: vit_h/vit_l/vit_b")
    parser.add_argument("--use-existing-vton", action="store_true",
        help="Skip Stages 0-2 entirely — load stage2_avatar_vton.png + stage1_garment_physics.txt "
             "from --output-dir and run only Stage 3 + composite")

    args = parser.parse_args()

    # ── API key (not needed for --use-existing-vton) ──────────────────────────
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key and not args.use_existing_vton:
        print("Error: set GEMINI_API_KEY environment variable")
        sys.exit(1)
    client = genai.Client(api_key=api_key) if api_key else None

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Avatar V-TON Ghost Mannequin ===")
    print(f"Category : {args.category}")
    print(f"View     : {args.view}")
    print(f"Gender   : {args.gender}")
    print(f"Output   : {output_dir.resolve()}\n")

    # ── --use-existing-vton: skip Stages 0-2, load from disk ─────────────────
    if args.use_existing_vton:
        existing_vton = output_dir / "stage2_avatar_vton.png"
        existing_phys = output_dir / "stage1_garment_physics.txt"
        if not existing_vton.exists():
            print(f"[ERROR] --use-existing-vton: {existing_vton} not found", file=sys.stderr)
            sys.exit(1)
        vton_img = Image.open(existing_vton).convert("RGB")
        print(f"[Stages 0-2] Skipped — loaded {existing_vton.name}")

        if existing_phys.exists():
            physics = json.loads(existing_phys.read_text())
            # Rebuild flags in case detect_garment_flags logic changed
            physics["flags"] = detect_garment_flags(
                physics.get("garment_physics", ""), physics.get("item_name", "")
            )
            print(f"  Physics : {existing_phys.name} → item='{physics.get('item_name','?')}'")
        else:
            # Minimal fallback — use CLI args for flags
            physics = {
                "garment_physics": args.garment_physics or "",
                "item_name":       args.item_name,
                "gender":          args.gender,
                "flags":           detect_garment_flags(args.garment_physics or "", args.item_name),
            }
            print("  [WARN] stage1_garment_physics.txt not found — using minimal physics from CLI args")

        flags = physics.get("flags", {})
        if args.flag_overrides:
            overrides = json.loads(args.flag_overrides)
            flags.update(overrides)
            print(f"  Flag overrides: {overrides}")
        print(f"  Flags   : {flags}")
        mask_img, sampled_bg = run_stage3(
            vton_img, args.category, output_dir,
            flags=flags,
            use_sam2=not args.no_sam2,
            sam2_variant=args.sam2_variant,
            item_name=physics.get("item_name", ""),
            subcategories=physics.get("subcategories", []),
            components=physics.get("components", []),
            gender=physics.get("gender", args.gender),
        )
        create_ghost(vton_img, mask_img, output_dir, sampled_bg=sampled_bg)
        print(f"\nDone. All outputs in: {output_dir.resolve()}")
        return

    # ── Stage 0: Fetch avatar from Supabase (same as ingestion service) ───────
    print("[Stage 0] Fetching avatar from Supabase storage...")
    avatar_img = fetch_supabase_avatar(args.gender, args.view, args.storage_bucket)
    avatar_path = output_dir / "stage0_avatar.png"
    avatar_img.save(avatar_path)
    print(f"  Saved: {avatar_path}")

    body_type_desc = args.body_type_desc or BODY_TYPE_PRESETS[args.body_type]

    # ── Stage 1: GARMENT_PHYSICS ──────────────────────────────────────────────
    if args.garment_physics:
        physics = {
            "garment_physics": args.garment_physics,
            "item_name": args.item_name,
            "gender": args.gender,
            "flags": detect_garment_flags(args.garment_physics, args.item_name),
        }
        geometry_skeleton = args.geometry_skeleton
        print("[Stage 1] Skipped — using provided --garment-physics")
    else:
        physics = run_stage1(
            garment_path=Path(args.garment),
            model_shot_path=Path(args.model_shot) if args.model_shot else None,
            category=args.category,
            text_model=args.text_model,
            client=client,
        )
        geometry_skeleton = args.geometry_skeleton  # back view — user provides if needed
        physics_path = output_dir / "stage1_garment_physics.txt"
        physics_path.write_text(json.dumps(physics, indent=2, ensure_ascii=False))
        print(f"  Saved : {physics_path}")
        print(f"  Item  : {physics['item_name']}")
        print(f"  Gender: {physics['gender']}")

    # ── Apply manifest flag overrides (before stage2 + stage3) ──────────────
    flags = physics.get("flags", {})
    if args.flag_overrides:
        overrides = json.loads(args.flag_overrides)
        flags.update(overrides)
        print(f"  Flag overrides: {overrides}")
    print(f"  Flags   : {flags}")

    # ── Stage 1.5: Garment color → contrasting bg for V-ToN render ──────────
    print("[Stage 1.5] Selecting contrasting background from garment physics...")
    bg_hex, _bg_rgb_hint = _parse_garment_color_from_physics(physics["garment_physics"])

    # ── Stage 2: Avatar V-TON ─────────────────────────────────────────────────
    vton_img = run_stage2(
        avatar_img=avatar_img,
        garment_path=Path(args.garment),
        physics=physics,
        body_type_desc=body_type_desc,
        geometry_skeleton=geometry_skeleton,
        category=args.category,
        view=args.view,
        image_model=args.image_model,
        output_dir=output_dir,
        client=client,
        bg_hex=bg_hex,
        flags=flags,
    )

    # ── Stage 3: Segmentation ─────────────────────────────────────────────────
    mask_img, sampled_bg = run_stage3(
        vton_img, args.category, output_dir,
        flags=flags,
        use_sam2=not args.no_sam2,
        sam2_variant=args.sam2_variant,
        item_name=physics.get("item_name", ""),
        subcategories=physics.get("subcategories", []),
        components=physics.get("components", []),
        gender=physics.get("gender", args.gender),
    )

    # ── Composite ─────────────────────────────────────────────────────────────
    create_ghost(vton_img, mask_img, output_dir, sampled_bg=sampled_bg)

    print(f"\nDone. All outputs in: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
