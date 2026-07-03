#!/usr/bin/env python3
"""test_run_pipeline.py
Post-scraping pipeline runner for ghost mannequin testing.

For each item in test_data/:
  1. Reads manifest.json (from test_scrape_collect.py)
  2. Runs full ghost mannequin pipeline (Stages 0→3) via test_avatar_ghost.py CLI
  3. Generates 3-panel comparison: model_photo | stage2_vton | ghost_mannequin

Usage:
    .venv312/bin/python test_run_pipeline.py [--item T4] [--vton-idx 2] [--stage3-only]

    --vton-idx N    : override which downloaded image to use as garment input (default: recommended)
    --stage3-only   : skip Stages 0-2 (Gemini), only re-run Stage 3 + ghost (needs prior run)

Outputs (per item):
    test_data/<item_id>/pipeline/stage0_avatar.png
    test_data/<item_id>/pipeline/stage1_garment_physics.txt
    test_data/<item_id>/pipeline/stage2_avatar_vton.png
    test_data/<item_id>/pipeline/stage3_clothing_mask.png
    test_data/<item_id>/pipeline/ghost_mannequin.png
    test_data/<item_id>/pipeline/comparison.png   ← model | vton | ghost
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import PIL.Image
import PIL.ImageDraw
import PIL.ImageFont

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).parent
TEST_DATA   = SCRIPT_DIR / "test_data"
AVATAR_DIR  = TEST_DATA / "avatars"
_ENV_CANDIDATES = [
    SCRIPT_DIR / "services" / "ingestion" / ".env",
    SCRIPT_DIR.parent.parent.parent / "services" / "ingestion" / ".env",
    Path(__file__).resolve().parents[4] / "services" / "ingestion" / ".env",
]
ENV_PATH = next((p for p in _ENV_CANDIDATES if p.exists()),
                SCRIPT_DIR / "services" / "ingestion" / ".env")

GHOST_SCRIPT   = SCRIPT_DIR / "test_avatar_ghost.py"
VENV_PYTHON    = SCRIPT_DIR / ".venv312" / "bin" / "python"
PYTHON         = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


# ── .env loader ─────────────────────────────────────────────────────────────────
def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.split("#")[0].strip().strip('"').strip("'")
        env[key.strip()] = val
    return env


# ── Manifest helpers ───────────────────────────────────────────────────────────

def load_manifest(item_id: str) -> dict:
    path = TEST_DATA / item_id / "manifest.json"
    if not path.exists():
        raise FileNotFoundError(f"No manifest for {item_id}. Run test_scrape_collect.py first.")
    return json.loads(path.read_text())


def resolve_garment_image(manifest: dict, vton_idx: int | None) -> Path:
    """Resolve the flatlay/product image to use as garment input."""
    item_id  = manifest["id"]
    item_dir = TEST_DATA / item_id
    images   = manifest.get("images", [])

    if not images:
        raise ValueError(f"[{item_id}] No images in manifest")

    if vton_idx is not None:
        if vton_idx >= len(images):
            raise ValueError(f"[{item_id}] --vton-idx={vton_idx} out of range (have {len(images)})")
        rel = images[vton_idx]
    else:
        rel = manifest.get("recommended_vton_image") or images[-1]

    full = item_dir / rel
    if not full.exists():
        raise FileNotFoundError(f"[{item_id}] Garment image not found: {full}")
    return full


def find_model_image(manifest: dict) -> Path | None:
    """
    Myntra ordering: idx 0 = model front shot.
    Use as the 'model photo' panel in comparison.
    """
    images = manifest.get("images", [])
    if not images:
        return None
    p = TEST_DATA / manifest["id"] / images[0]
    return p if p.exists() else None


# ── N-panel comparison ─────────────────────────────────────────────────────────

def make_comparison(
    panels_spec: list[tuple[str, "Path | None"]],
    out_path:    Path,
    label:       str = "",
) -> None:
    """
    Build an N-panel side-by-side comparison image.

    panels_spec: list of (panel_label, image_path_or_None)
    """
    TARGET_H = 900
    CHECKER_A = (200, 200, 200)   # light gray squares
    CHECKER_B = (255, 255, 255)   # white squares
    CHECKER_SZ = 20               # checkerboard tile size (px)

    def make_checkerboard(w: int, h: int) -> PIL.Image.Image:
        cb = PIL.Image.new("RGB", (w, h), CHECKER_B)
        draw_cb = PIL.ImageDraw.Draw(cb)
        for ty in range(0, h, CHECKER_SZ):
            for tx in range(0, w, CHECKER_SZ):
                if ((tx // CHECKER_SZ) + (ty // CHECKER_SZ)) % 2 == 0:
                    draw_cb.rectangle([tx, ty, tx + CHECKER_SZ - 1, ty + CHECKER_SZ - 1],
                                      fill=CHECKER_A)
        return cb

    def load_fit(p: "Path | None", placeholder_label: str = "",
                 transparent_bg: str = "white") -> PIL.Image.Image:
        if p is None or not p.exists():
            img = PIL.Image.new("RGB", (TARGET_H // 2, TARGET_H), color=(220, 220, 220))
            if placeholder_label:
                draw_ph = PIL.ImageDraw.Draw(img)
                draw_ph.text((img.width // 2, TARGET_H // 2), placeholder_label,
                              fill=(140, 140, 140), anchor="mm")
            return img
        raw = PIL.Image.open(p)
        if raw.mode == "RGBA":
            if transparent_bg == "checker":
                bg = make_checkerboard(raw.width, raw.height)
            else:
                bg = PIL.Image.new("RGB", raw.size, (255, 255, 255))
            bg.paste(raw, mask=raw.split()[3])
            img = bg
        else:
            img = raw.convert("RGB")
        w, h = img.size
        return img.resize((int(w * TARGET_H / h), TARGET_H), PIL.Image.LANCZOS)

    panels = [
        (lbl, load_fit(p, f"({lbl})",
                       transparent_bg="checker" if "ghost" in lbl.lower() or "Ghost" in lbl else "white"))
        for lbl, p in panels_spec
    ]

    label_h = 34
    total_w = sum(img.width for _, img in panels)
    total_h = TARGET_H + label_h + (label_h if label else 0)

    comp = PIL.Image.new("RGB", (total_w, total_h), color=(255, 255, 255))
    draw = PIL.ImageDraw.Draw(comp)

    try:
        font    = PIL.ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
        font_sm = PIL.ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except Exception:
        font    = PIL.ImageFont.load_default()
        font_sm = font

    x = 0
    for panel_label, img in panels:
        comp.paste(img, (x, label_h))
        draw.text((x + img.width // 2, 6), panel_label,
                  fill=(40, 40, 40), font=font, anchor="mt")
        x += img.width

    if label:
        draw.text((total_w // 2, TARGET_H + label_h + 4), label,
                  fill=(90, 90, 90), font=font_sm, anchor="mt")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    comp.save(out_path)
    print(f"  Comparison → {out_path.relative_to(SCRIPT_DIR)}")


# ── Ghost pipeline invocation ──────────────────────────────────────────────────

def run_ghost_pipeline(
    manifest:      dict,
    garment_path:  Path,
    pipeline_dir:  Path,
    env:           dict,
    stage3_only:   bool = False,
) -> dict[str, Path | None]:
    """
    Run test_avatar_ghost.py CLI. Returns dict of output paths.
    stage3_only=True: skip Stages 0-2 (reuse existing stage2_avatar_vton.png).
    """
    category = manifest["category"]
    gender   = manifest["gender"]
    item_id  = manifest["id"]

    # Build CLI args
    cmd = [
        PYTHON, str(GHOST_SCRIPT),
        "--garment",     str(garment_path),
        "--category",    category,
        "--gender",      gender,
        "--output-dir",  str(pipeline_dir),
    ]

    # Model shot: first image = model wearing garment
    model_p = find_model_image(manifest)
    if model_p and model_p != garment_path:
        cmd += ["--model-shot", str(model_p)]

    # Pass manifest flags as overrides so physics-detected flags don't miss co-ord, fringe, etc.
    manifest_flags = manifest.get("flags", {})
    if manifest_flags:
        cmd += ["--flag-overrides", json.dumps(manifest_flags)]

    # Stage 3 only: pass --use-existing-vton to skip Stages 0-2 entirely.
    # test_avatar_ghost.py loads stage2_avatar_vton.png + stage1_garment_physics.txt
    # from the output-dir — no Gemini calls, no Supabase fetch.
    if stage3_only:
        physics_txt = pipeline_dir / "stage1_garment_physics.txt"
        vton_vton   = pipeline_dir / "stage2_avatar_vton.png"
        if physics_txt.exists() and vton_vton.exists():
            cmd += ["--use-existing-vton"]
            print(f"  [stage3-only] --use-existing-vton: reusing {vton_vton.name}")
        else:
            print(f"  [WARN] --stage3-only requested but stage1/stage2 outputs missing; "
                  f"running full pipeline")

    # Inherit env + inject GOOGLE_API_KEY from .env
    run_env = {**os.environ}
    for key in ("GOOGLE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if key in env:
            run_env[key] = env[key]
    # GEMINI_API_KEY fallback
    if "GEMINI_API_KEY" not in run_env and "GOOGLE_API_KEY" in env:
        run_env["GEMINI_API_KEY"] = env["GOOGLE_API_KEY"]

    print(f"  Running: {' '.join(cmd[-6:])}")  # last 6 args to avoid flooding
    result = subprocess.run(cmd, env=run_env, capture_output=False, text=True)

    if result.returncode != 0:
        print(f"  [ERROR] Ghost pipeline exited with code {result.returncode}", file=sys.stderr)

    # Collect output paths
    outputs = {
        "vton":  pipeline_dir / "stage2_avatar_vton.png",
        "ghost": pipeline_dir / "ghost_mannequin.png",
        "mask":  pipeline_dir / "stage3_clothing_mask.png",
    }
    return {k: (v if v.exists() else None) for k, v in outputs.items()}


# ── Per-item runner ────────────────────────────────────────────────────────────

def run_item(
    manifest:    dict,
    vton_idx:    int | None,
    env:         dict,
    stage3_only: bool,
) -> None:
    item_id = manifest["id"]
    name    = manifest["name"]
    cat     = manifest["category"]
    gender  = manifest["gender"]
    flags   = manifest.get("flags", {})

    print(f"\n{'─'*60}")
    print(f"[{item_id}] {name}")
    print(f"  category={cat}  gender={gender}  flags={flags}")

    item_dir     = TEST_DATA / item_id
    # For stage3-only re-runs, prefer pipeline_v2 if it has fresh stage2 assets.
    # Full pipeline runs always write to pipeline/.
    _pv2 = item_dir / "pipeline_v2"
    if stage3_only and _pv2.exists() and (_pv2 / "stage2_avatar_vton.png").exists():
        pipeline_dir = _pv2
        print(f"  [stage3-only] Using pipeline_v2 (fresher V-ToN detected)")
    else:
        pipeline_dir = item_dir / "pipeline"
        pipeline_dir.mkdir(parents=True, exist_ok=True)

    try:
        garment_path = resolve_garment_image(manifest, vton_idx)
    except (ValueError, FileNotFoundError) as e:
        print(f"  [ERROR] {e}", file=sys.stderr)
        return

    print(f"  Garment input: {garment_path.relative_to(SCRIPT_DIR)}")

    # When re-running stage3 only, snapshot existing ghost so we can show before/after
    ghost_before_path: Path | None = None
    if stage3_only:
        existing_ghost = pipeline_dir / "ghost_mannequin.png"
        if existing_ghost.exists():
            ghost_before_path = pipeline_dir / "ghost_pre_bg_removal.png"
            import shutil
            shutil.copy2(existing_ghost, ghost_before_path)
            print(f"  Backed up existing ghost → ghost_pre_bg_removal.png")

    # Run ghost pipeline
    outputs = run_ghost_pipeline(manifest, garment_path, pipeline_dir, env, stage3_only)

    model_path = find_model_image(manifest)
    comp_label = f"{item_id} · {name} · {cat}/{gender}"

    if stage3_only and ghost_before_path is not None:
        # 4-panel: Model | V-ToN | Ghost (before) | Ghost (after bg removal)
        comp_path = pipeline_dir / "comparison_bg_removal.png"
        make_comparison(
            [
                ("Model Photo",         model_path),
                ("V-ToN (Stage 2)",     outputs.get("vton")),
                ("Ghost (before)",      ghost_before_path),
                ("Ghost (bg removed)",  outputs.get("ghost")),
            ],
            comp_path,
            comp_label,
        )
    else:
        # Standard 3-panel
        comp_path = pipeline_dir / "comparison.png"
        make_comparison(
            [
                ("Model Photo",      model_path),
                ("V-ToN (Stage 2)",  outputs.get("vton")),
                ("Ghost Mannequin",  outputs.get("ghost")),
            ],
            comp_path,
            comp_label,
        )

    # Summary for this item
    ghost_ok = outputs.get("ghost") is not None
    vton_ok  = outputs.get("vton") is not None
    print(f"  Status: vton={'OK' if vton_ok else 'MISSING'}  ghost={'OK' if ghost_ok else 'MISSING'}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Run full ghost mannequin pipeline on test items")
    parser.add_argument("--item",        help="Run only this item ID (e.g. T4)")
    parser.add_argument("--vton-idx",    type=int, default=None,
                        help="Override image index to use as garment input (0-based)")
    parser.add_argument("--stage3-only", action="store_true",
                        help="Skip Stages 0-2 (Gemini); reuse existing stage1/stage2 outputs")
    args = parser.parse_args()

    print("=" * 60)
    print("Ghost Mannequin Pipeline Test Runner")
    print("=" * 60)

    env = load_env(ENV_PATH)
    if not env.get("GOOGLE_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
        print("[ERROR] GOOGLE_API_KEY not found in .env or environment", file=sys.stderr)
        sys.exit(1)

    # Collect manifests
    if args.item:
        manifests = [load_manifest(args.item)]
    else:
        manifests = []
        for d in sorted(TEST_DATA.iterdir()):
            if not d.is_dir() or d.name == "avatars":
                continue
            mp = d / "manifest.json"
            if not mp.exists():
                continue
            try:
                m = json.loads(mp.read_text())
                if m.get("images"):
                    manifests.append(m)
            except Exception:
                pass

    if not manifests:
        print("[ERROR] No manifests with images found. Run test_scrape_collect.py first.", file=sys.stderr)
        sys.exit(1)

    print(f"Processing {len(manifests)} item(s)...")

    for m in manifests:
        try:
            run_item(m, args.vton_idx, env, args.stage3_only)
        except Exception as e:
            print(f"  [ERROR] {m.get('id')}: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()

    print("\n" + "=" * 60)
    print("Done. Comparisons at: test_data/*/pipeline/comparison.png")
    print("=" * 60)


if __name__ == "__main__":
    main()
