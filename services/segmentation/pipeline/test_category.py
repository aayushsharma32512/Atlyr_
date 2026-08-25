"""
Unit tests for category resolution.

Loaded by file path rather than `from pipeline.category import ...` because pipeline/__init__.py
pulls in the executor (cv2, torch, SAM2) — this way the tests run anywhere, no GPU needed:

    python services/segmentation/pipeline/test_category.py
"""
import importlib.util
import os
import sys

_spec = importlib.util.spec_from_file_location(
    "category", os.path.join(os.path.dirname(os.path.abspath(__file__)), "category.py")
)
category = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(category)
resolve_category = category.resolve_category

FAILURES = []


def check(name, got, want):
    if got != want:
        FAILURES.append(f"{name}: got {got!r}, want {want!r}")


def cat(requested, areas):
    return resolve_category(requested, areas)[0]


def src(requested, areas):
    return resolve_category(requested, areas)[1]["category_source"]


# ── The bug this fixes ──────────────────────────────────────────────────────────────────────
# Bikini/bralette: the tiny top is out-areaed by the bare pelvis the parser reads as `pants`.
bikini = {"top": 12000, "dress": 0, "skirt": 800, "pants": 41000, "footwear": 0}
check("bikini: unconstrained vote picks pants", max(bikini, key=bikini.get), "pants")
check("bikini: topwear now resolves to top", cat("top", bikini), "top")
check("bikini: via the service's 'bottom'-style alias casing", cat("TopWear", bikini), "top")

# ── The safety property: an in-set winner is untouched ───────────────────────────────────────
# If the unconstrained winner is already allowed, constraining must return exactly the same
# category. These mirror the four shapes that make up 383 of 400 measured production jobs.
tshirt = {"top": 90000, "dress": 3000, "skirt": 0, "pants": 1200, "footwear": 0}
check("t-shirt unchanged", cat("top", tshirt), "top")

long_top = {"top": 8000, "dress": 70000, "skirt": 0, "pants": 500, "footwear": 0}
check("long top parsing as dress stays dress", cat("top", long_top), "dress")

jeans = {"top": 2000, "dress": 0, "skirt": 400, "pants": 85000, "footwear": 0}
check("bottomwear -> pants", cat("bottom", jeans), "pants")

skirt_job = {"top": 1500, "dress": 0, "skirt": 60000, "pants": 900, "footwear": 0}
check("bottomwear -> skirt still wins", cat("bottom", skirt_job), "skirt")

dress_job = {"top": 5000, "dress": 95000, "skirt": 0, "pants": 0, "footwear": 0}
check("dress unchanged", cat("dress", dress_job), "dress")

# The alias is the whole point of that dict: 'bottom' must not fall through to top classes.
check("'bottom' aliases to pants", cat("bottom", jeans), "pants")
check("'bottomwear' aliases to pants", cat("bottomwear", jeans), "pants")

# ── Fallbacks: never trade a working parse for an empty mask ─────────────────────────────────
no_top_pixels = {"top": 0, "dress": 0, "skirt": 0, "pants": 30000, "footwear": 0}
check("no pixels in the requested set falls back", cat("top", no_top_pixels), "pants")
check("...and says so", src("top", no_top_pixels), "fallback_no_pixels")

check("unknown request behaves as before", cat("swimwear", bikini), "pants")
check("unknown request is flagged", src("swimwear", bikini), "unconstrained_unknown_request")
check("missing request behaves as before", cat(None, bikini), "pants")
check("empty request behaves as before", cat("   ", bikini), "pants")

all_zero = {"top": 0, "dress": 0, "skirt": 0, "pants": 0, "footwear": 0}
check("all-zero areas default to top", cat("top", all_zero), "top")
check("all-zero areas with no request default to top", cat(None, all_zero), "top")

# ── Debug payload is populated for auditing after deploy ────────────────────────────────────
_, dbg = resolve_category("top", bikini)
check("debug records the old vote", dbg["category_unconstrained"], "pants")
check("debug records the request", dbg["category_requested"], "top")
check("debug records the branch", dbg["category_source"], "constrained")


# ── should_remove_bare_torso ──────────────────────────────────────────────────────────────────────
# The gate that keeps the bare-torso subtraction off every path except skin-hued bottomwear.
torso = category.should_remove_bare_torso

# The case it exists for: beige trousers on a white background.
check("pants, skin-hued, white bg", torso("pants", True, False), True)
check("skirt, skin-hued, white bg", torso("skirt", True, False), True)
check("caller alias 'bottom' normalises", torso("bottom", True, False), True)
check("caller alias 'bottomwear' normalises", torso("bottomwear", True, False), True)

# Topwear and dresses must not be touched at all — this is the whole point of the gate.
check("top is never affected", torso("top", True, False), False)
check("dress is never affected", torso("dress", True, False), False)
check("footwear is never affected", torso("footwear", True, False), False)
check("alias 'tops' is never affected", torso("tops", True, False), False)
check("alias 'dresses' is never affected", torso("dresses", True, False), False)

# A normal-hued garment already runs the colour rule; it must keep its existing path.
check("normal-hued bottomwear unchanged", torso("pants", False, False), False)

# On green input the garment is not protected by its own mask subtraction, so the rule stays off.
check("green screen bottomwear unchanged", torso("pants", True, True), False)
check("green screen + normal hue unchanged", torso("pants", False, True), False)

# Degenerate input must not enable it.
check("missing category", torso(None, True, False), False)
check("unknown category", torso("outerwear", True, False), False)
check("empty category", torso("", True, False), False)
check("whitespace/case tolerated", torso("  PANTS ", True, False), True)

if FAILURES:
    print(f"FAILED ({len(FAILURES)}):")
    for f in FAILURES:
        print(f"  - {f}")
    sys.exit(1)
print("all category resolution + bare-torso gate tests passed")
