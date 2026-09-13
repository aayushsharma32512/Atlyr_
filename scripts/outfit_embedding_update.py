"""
Generates outfits.text_vector (from search_summary) and outfits.image_vector
(a flat-lay render of the outfit's top + bottom garment images on white, no
mannequin) - both 768 dimensions.
Three modes: no flag drains outfit_embedding_queue for the cron job;
--full-scan re-embeds every outfit with both garments set whose image_vector
is missing or stale; --backfill walks every outfit once, to move the whole
table onto the current image_vector (run with no --limit/--ids).
Needs products.image_url and products.placement per garment. Images are
cached under scripts/.cache/outfit_garments by default (see --cache-dir).
"""

import argparse
import math
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import numpy as np
import requests
import torch
import open_clip
from dotenv import load_dotenv
from PIL import Image
from supabase import create_client, Client

# ------------------------------------------------------------ constants ----

MODEL_NAME = "hf-hub:Marqo/marqo-fashionSigLIP"

# version 2 = flat-lay render of top+bottom garments on white, not the
# outfit's browser screenshot (outfit_images). See module docstring above.
CURRENT_VECTOR_VERSION = 2

# The app's own render canvas (PlacementAvatarRenderer.tsx). Placement tx/ty
# and the "fit" scale are all computed against this size, so it must match
# exactly even though we never draw a mannequin here.
CANVAS_W, CANVAS_H = 1800, 3072
ALPHA_CUTOFF = 12          # opaque-pixel threshold, matches the app's own scan
CENTROID_LONG_SIDE = 256   # downscale-before-alpha-scan size (perf only)
CANVAS_BG = (255, 255, 255)  # flatten every transparent pixel onto white

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent / ".cache" / "outfit_garments"  # gitignored; safe to delete

DOWNLOAD_RETRIES = 3
DOWNLOAD_TIMEOUT = 20.0
PRODUCT_FETCH_BATCH = 200   # products.id IN (...) chunk size
OUTFIT_FETCH_PAGE = 500     # pagination page size for unbounded outfit scans
QUEUE_DEFAULT_LIMIT = 100   # matches the original queue-drain page size


# --------------------------------------------------------------- embedder ----


class FashionEmbedder:
    """Fashion-SigLIP embedding generator using OpenCLIP."""

    def __init__(self):
        self.model = None
        self.preprocess_val = None
        self.tokenizer = None
        self.device = "cpu"

    def initialize_models(self):
        print("Loading Fashion-SigLIP models...")
        start_time = time.time()
        try:
            self.model, _, self.preprocess_val = open_clip.create_model_and_transforms(MODEL_NAME)
            self.tokenizer = open_clip.get_tokenizer(MODEL_NAME)
            self.model.eval()
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.model.to(self.device)
            duration = time.time() - start_time
            print(f"Models loaded ({duration:.1f}s) on device={self.device}")
            # Confirms there's no centre crop here - build_embed_input's square
            # pad only keeps proportions correct if the model just resizes.
            print(f"Preprocess transform: {self.preprocess_val}")
        except Exception as e:
            print(f"Error loading models: {e}")
            sys.exit(1)

    def generate_text_embedding(self, text):
        """Generate a 768-dim text embedding."""
        try:
            text_tokens = self.tokenizer([text]).to(self.device)
            with torch.no_grad():
                text_features = self.model.encode_text(text_tokens, normalize=True)
                return text_features[0].tolist()
        except Exception as e:
            print(f"Error generating text embedding: {e}")
            print(f"   Traceback: {traceback.format_exc()}")
            return None

    def encode_image(self, image: Image.Image, normalize=True):
        """Embed an already-rendered PIL image (the padded flat lay), 768-dim."""
        image_input = self.preprocess_val(image).unsqueeze(0).to(self.device)
        with torch.no_grad():
            image_features = self.model.encode_image(image_input, normalize=normalize)
            return image_features[0].tolist()


# ------------------------------------------------------- render geometry ----
# Reproduces the app's own placement recipe: apply each garment's saved
# translate/scale/rotate as an affine transform on a fixed-size canvas, so it
# lands exactly where the app would draw it - no mannequin needed.


def opaque_centroid(img: Image.Image) -> tuple:
    """Opaque-pixel centroid in the image's own full-resolution pixel coords."""
    w, h = img.size
    scale = min(1.0, CENTROID_LONG_SIDE / max(w, h))
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    small = img.resize((sw, sh), Image.BILINEAR) if (sw, sh) != (w, h) else img
    alpha = np.asarray(small.getchannel("A"))
    ys, xs = np.nonzero(alpha > ALPHA_CUTOFF)
    if xs.size == 0:
        return w / 2.0, h / 2.0
    cx = float(xs.mean()) * (w / sw)
    cy = float(ys.mean()) * (h / sh)
    return cx, cy


def build_layer(garment: Image.Image, placement: dict) -> Image.Image:
    """Full-canvas RGBA layer with the garment placed per the app's recipe.

    An empty placement (no key for either gender) resolves to tx=0, ty=0,
    scale=1, rotationDeg=0 - "centred at fit scale", the required fallback.
    """
    tex_w, tex_h = garment.size
    cx, cy = opaque_centroid(garment)
    pivot_x, pivot_y = cx - tex_w / 2, cy - tex_h / 2
    fit = min(CANVAS_W / tex_w, CANVAS_H / tex_h)
    home_x = CANVAS_W / 2 + pivot_x * fit
    home_y = CANVAS_H / 2 + pivot_y * fit
    hx = home_x + placement.get("tx", 0)
    hy = home_y + placement.get("ty", 0)
    s = fit * placement.get("scale", 1)
    theta = math.radians(placement.get("rotationDeg", 0) or 0)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    # Inverse of: X = s*cos*(u-cx) - s*sin*(v-cy) + hx ; Y = s*sin*(u-cx) + s*cos*(v-cy) + hy
    a, b = cos_t / s, sin_t / s
    d, e = -sin_t / s, cos_t / s
    c = cx - a * hx - b * hy
    f = cy - d * hx - e * hy

    return garment.transform(
        (CANVAS_W, CANVAS_H), Image.AFFINE, (a, b, c, d, e, f),
        resample=Image.BICUBIC, fillcolor=(0, 0, 0, 0),
    )


def resolve_placement(placement_map: dict, gender: str, slot: str):
    """Gender fallback: primary gender key, else the other gender's key, else empty."""
    other = "male" if gender == "female" else "female"
    primary_key = f"{gender}:bodytype1"
    fallback_key = f"{other}:bodytype1"
    if primary_key in placement_map:
        return placement_map[primary_key], None
    if fallback_key in placement_map:
        return placement_map[fallback_key], f"{slot}: used fallback placement key {fallback_key}"
    return {}, f"{slot}: no placement for either gender, centred at fit scale"


def normalize_gender(gender) -> str:
    return gender if gender in ("female", "male") else "female"


def content_bbox(rgba: Image.Image) -> tuple:
    """Bounding box of non-transparent pixels; falls back to the full canvas."""
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.nonzero(alpha > ALPHA_CUTOFF)
    if xs.size == 0:
        return 0, 0, rgba.width, rgba.height
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def flatten_on_bg(rgba: Image.Image, bg: tuple) -> Image.Image:
    base = Image.new("RGBA", rgba.size, bg + (255,))
    base.alpha_composite(rgba)
    return base.convert("RGB")


def square_pad(rgb: Image.Image, bg: tuple) -> Image.Image:
    """Pad to a square with bg-coloured margin. Never crops or scales."""
    w, h = rgb.size
    side = max(w, h)
    if (w, h) == (side, side):
        return rgb
    canvas = Image.new("RGB", (side, side), bg)
    canvas.paste(rgb, ((side - w) // 2, (side - h) // 2))
    return canvas


def render_flatlay(top_product: dict, bottom_product: dict, gender: str, cache_dir: Path):
    """Bottom-then-top garments on a transparent 1800x3072 canvas; returns
    (rgba, notes). Shoes are skipped - they add little to the picture and
    male shoes have no placement data."""
    gender = normalize_gender(gender)
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    notes = []
    for slot, product in (("bottom", bottom_product), ("top", top_product)):
        placement, note = resolve_placement(product.get("placement") or {}, gender, slot)
        if note:
            notes.append(note)
        garment = load_cached_garment(cache_dir, product["id"])
        layer = build_layer(garment, placement)
        canvas.alpha_composite(layer)
    return canvas, notes


def build_embed_input(rgba: Image.Image) -> Image.Image:
    """Crop to the garments, flatten onto white, pad to a square. The model's
    preprocess only resizes (no centre crop), so a non-square image would be
    squashed - cropping and square-padding keeps proportions correct."""
    box = content_bbox(rgba)
    cropped = rgba.crop(box)
    flat = flatten_on_bg(cropped, CANVAS_BG)
    return square_pad(flat, CANVAS_BG)


# ------------------------------------------------------------- download ----


def cache_path(cache_dir: Path, product_id: str) -> Path:
    return cache_dir / f"{product_id}.png"


def fetch_bytes_with_retry(session: requests.Session, url: str, retries=DOWNLOAD_RETRIES, timeout=DOWNLOAD_TIMEOUT) -> bytes:
    last_err = None
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=timeout)
            resp.raise_for_status()
            return resp.content
        except requests.RequestException as exc:
            last_err = exc
            if attempt < retries - 1:
                time.sleep(0.5 * (2 ** attempt))
    raise last_err


def ensure_cached(session: requests.Session, cache_dir: Path, product_id: str, image_url: str) -> None:
    path = cache_path(cache_dir, product_id)
    if path.exists():
        return
    data = fetch_bytes_with_retry(session, image_url)
    img = Image.open(BytesIO(data)).convert("RGBA")
    tmp = path.with_suffix(".tmp.png")
    img.save(tmp)
    tmp.replace(path)  # atomic-ish so a killed run never leaves a half-written cache file


def load_cached_garment(cache_dir: Path, product_id: str) -> Image.Image:
    return Image.open(cache_path(cache_dir, product_id)).convert("RGBA")


def download_missing_garments(product_ids: set, products: dict, cache_dir: Path, workers: int) -> set:
    """Downloads whatever isn't already cached. Returns the set of product ids that failed."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    to_download = [
        pid for pid in product_ids
        if pid in products and products[pid].get("image_url") and not cache_path(cache_dir, pid).exists()
    ]
    failed = set()
    if not to_download:
        return failed
    session = requests.Session()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(ensure_cached, session, cache_dir, pid, products[pid]["image_url"]): pid for pid in to_download}
        for fut in as_completed(futures):
            pid = futures[fut]
            try:
                fut.result()
            except Exception as exc:
                failed.add(pid)
                print(f"  download FAILED product {pid}: {exc}")
    return failed


# --------------------------------------------------------------------- db ----


def make_client(env_file: str) -> Client:
    if env_file:
        load_dotenv(env_file, override=True)
    else:
        load_dotenv(".env.local")

    url = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase credentials.")
        print("Required: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_* / --env-file)")
        sys.exit(1)
    return create_client(url, key)


def build_outfit_text(outfit):
    """Get search_summary for text embedding. No fallback."""
    search_sum = outfit.get('search_summary')
    if search_sum and search_sum.strip():
        return search_sum.strip()
    return None


def fetch_queue_rows(sb: Client, limit=None, ids=None):
    """Default mode: drain outfit_embedding_queue, same shape as today."""
    q = sb.table('outfit_embedding_queue').select(
        "id, outfit_id, needs_text_embedding, needs_image_embedding, "
        "outfits(id, gender, top_id, bottom_id, search_summary, text_vector, image_vector)"
    ).order('queued_at', desc=False)
    if ids:
        q = q.in_('outfit_id', ids)
    q = q.limit(limit or QUEUE_DEFAULT_LIMIT)
    resp = q.execute()

    rows = []
    for item in resp.data or []:
        outfit = item.get('outfits')
        if not outfit:
            continue
        outfit['queue_id'] = item['id']
        outfit['needs_text_embedding'] = item['needs_text_embedding']
        outfit['needs_image_embedding'] = item['needs_image_embedding']
        rows.append(outfit)
    return rows


def fetch_full_scan_outfits(sb: Client, limit=None, ids=None):
    """Every outfit with top+bottom set where image_vector is null or stale."""
    q = sb.table('outfits').select(
        "id, gender, top_id, bottom_id, image_vector, vector_version"
    ).not_.is_('top_id', 'null').not_.is_('bottom_id', 'null').or_(
        f"image_vector.is.null,vector_version.lt.{CURRENT_VECTOR_VERSION}"
    ).order('id')
    if ids:
        q = q.in_('id', ids)
    if limit:
        q = q.limit(limit)
    resp = q.execute()
    return resp.data or []


def fetch_all_outfits(sb: Client, limit=None, ids=None):
    """Backfill mode: every outfit, paginated. Honors --limit/--ids for test runs."""
    cols = "id, gender, top_id, bottom_id"
    if ids:
        resp = sb.table('outfits').select(cols).in_('id', ids).order('id').execute()
        return resp.data or []

    rows = []
    offset = 0
    while True:
        page_size = OUTFIT_FETCH_PAGE if not limit else min(OUTFIT_FETCH_PAGE, limit - len(rows))
        if page_size <= 0:
            break
        resp = sb.table('outfits').select(cols).order('id').range(offset, offset + page_size - 1).execute()
        page = resp.data or []
        rows.extend(page)
        if len(page) < page_size or (limit and len(rows) >= limit):
            break
        offset += page_size
    return rows[:limit] if limit else rows


def fetch_products_by_ids(sb: Client, product_ids, batch_size=PRODUCT_FETCH_BATCH) -> dict:
    products = {}
    ids = sorted({pid for pid in product_ids if pid})
    for i in range(0, len(ids), batch_size):
        chunk = ids[i:i + batch_size]
        resp = sb.table('products').select("id, image_url, placement, type").in_('id', chunk).execute()
        for p in resp.data or []:
            products[p['id']] = p
    return products


def write_outfit(sb: Client, outfit_id, updates: dict, dry_run: bool, stamp_version=True):
    """Writes to outfits.id, stamping embedded_at/vector_version unless
    stamp_version=False (used when nulling image_vector for an outfit that
    was never actually re-embedded)."""
    if stamp_version:
        updates = dict(updates)
        updates['embedded_at'] = datetime.now(timezone.utc).isoformat()
        updates['vector_version'] = CURRENT_VECTOR_VERSION
    if dry_run:
        print(f"  [dry-run] would update outfits.{outfit_id}: {sorted(updates.keys())}")
        return True
    try:
        sb.table('outfits').update(updates).eq('id', outfit_id).execute()
        return True
    except Exception as e:
        print(f"  Database update failed for {outfit_id}: {e}")
        return False


def delete_queue_row(sb: Client, queue_id, dry_run: bool):
    if dry_run:
        print(f"  [dry-run] would delete outfit_embedding_queue.id={queue_id}")
        return
    try:
        sb.table('outfit_embedding_queue').delete().eq('id', queue_id).execute()
    except Exception as e:
        print(f"  Queue delete failed for queue_id={queue_id}: {e}")


def clear_image_need_or_delete(sb: Client, outfit_id, dry_run: bool):
    """full-scan cleanup: a queue row that only needed the image is done now;
    one that also needs text stays (with needs_image_embedding cleared)."""
    if dry_run:
        print(f"  [dry-run] would clear/delete outfit_embedding_queue rows for outfit_id={outfit_id}")
        return
    try:
        resp = sb.table('outfit_embedding_queue').select('id, needs_text_embedding').eq('outfit_id', outfit_id).execute()
        for row in resp.data or []:
            if row['needs_text_embedding']:
                sb.table('outfit_embedding_queue').update({'needs_image_embedding': False}).eq('id', row['id']).execute()
            else:
                sb.table('outfit_embedding_queue').delete().eq('id', row['id']).execute()
    except Exception as e:
        print(f"  Queue cleanup failed for outfit_id={outfit_id}: {e}")


def backfill_queue_cleanup(sb: Client, dry_run: bool):
    """Run once at the end of an unrestricted backfill: drop queue rows that
    only needed the image (now done table-wide), and clear the image flag on
    rows that still need text too. Text vectors are never touched here."""
    try:
        drop = sb.table('outfit_embedding_queue').select('id', count='exact').eq('needs_image_embedding', True).eq('needs_text_embedding', False).execute()
        clear = sb.table('outfit_embedding_queue').select('id', count='exact').eq('needs_image_embedding', True).eq('needs_text_embedding', True).execute()
    except Exception as e:
        print(f"  Queue-wide cleanup lookup failed: {e}")
        return
    print(f"  queue-wide cleanup: {drop.count} image-only rows to delete, {clear.count} mixed rows to clear needs_image_embedding on")
    if dry_run:
        print("  [dry-run] queue-wide cleanup not executed")
        return
    sb.table('outfit_embedding_queue').delete().eq('needs_image_embedding', True).eq('needs_text_embedding', False).execute()
    sb.table('outfit_embedding_queue').update({'needs_image_embedding': False}).eq('needs_image_embedding', True).eq('needs_text_embedding', True).execute()


# ------------------------------------------------------------- pipeline ----


class Counters:
    def __init__(self):
        self.done = 0
        self.nulled = 0
        self.failed = 0
        self.skipped = 0
        self.text_generated = 0
        self.failures = []  # (outfit_id, error)


@dataclass
class OutfitResult:
    """What process_outfit found for one outfit; no database writes here."""
    text_vector: list = None
    text_ok: bool = False
    image_vector: list = None
    image_status: str = "skipped"  # "embedded" | "missing" | "download_failed" | "render_failed"
    image_error: str = ""
    embed_ms: float = 0.0
    notes: list = field(default_factory=list)


def embed_outfit_image(embedder: FashionEmbedder, outfit_id, gender, top_product, bottom_product, cache_dir: Path, save_renders_dir: Path):
    """Render the flat lay, embed it. Returns (vector, notes, embed_ms)."""
    rgba, notes = render_flatlay(top_product, bottom_product, gender, cache_dir)
    embed_input = build_embed_input(rgba)
    if save_renders_dir:
        save_renders_dir.mkdir(parents=True, exist_ok=True)
        flatten_on_bg(rgba, CANVAS_BG).save(save_renders_dir / f"{outfit_id}_flatlay.png")
        embed_input.save(save_renders_dir / f"{outfit_id}_embed_input.png")
    t0 = time.time()
    vector = embedder.encode_image(embed_input, normalize=True)
    embed_ms = (time.time() - t0) * 1000
    return vector, notes, embed_ms


def process_outfit(embedder, outfit, products, bad_products, want_text, want_image, cache_dir, save_renders_dir) -> OutfitResult:
    """Computes whatever vectors this outfit needs. image_status comes back
    "missing" (no top_id/bottom_id at all), "download_failed" (an id is set
    but the product row or its image isn't usable), "render_failed", or
    "embedded"."""
    result = OutfitResult()

    if want_text:
        text = build_outfit_text(outfit)
        if text:
            vec = embedder.generate_text_embedding(text)
            if vec:
                result.text_vector = vec
                result.text_ok = True

    if want_image:
        top_id, bottom_id = outfit.get('top_id'), outfit.get('bottom_id')
        if not top_id or not bottom_id:
            result.image_status = "missing"
        elif top_id in bad_products or bottom_id in bad_products:
            result.image_status = "download_failed"
            result.image_error = "garment product row/image missing or download failed"
        else:
            try:
                vec, notes, embed_ms = embed_outfit_image(
                    embedder, outfit['id'], outfit.get('gender'), products[top_id], products[bottom_id], cache_dir, save_renders_dir
                )
                result.image_vector = vec
                result.image_status = "embedded"
                result.embed_ms = embed_ms
                result.notes = notes
            except Exception as exc:
                result.image_status = "render_failed"
                result.image_error = str(exc)

    return result


def preflight_download(sb: Client, outfits_with_both, cache_dir: Path, workers: int):
    """Fetches product rows for every top_id/bottom_id in play and downloads
    whatever garment images aren't already cached. Returns (products, failed_products)."""
    product_ids = set()
    for o in outfits_with_both:
        product_ids.add(o['top_id'])
        product_ids.add(o['bottom_id'])
    products = fetch_products_by_ids(sb, product_ids)
    missing = [pid for pid in product_ids if pid not in products or not products[pid].get('image_url')]
    if missing:
        print(f"  WARNING: {len(missing)} product ids have no row/image_url (first 10): {missing[:10]}")
    failed = download_missing_garments(product_ids, products, cache_dir, workers)
    return products, set(missing) | failed


def describe_failure(result: OutfitResult) -> str:
    """Short label for a non-embedded OutfitResult, used in the one-line log."""
    if result.image_status == "download_failed":
        return "failed(download)"
    if result.image_status == "render_failed":
        return f"failed(render/embed): {result.image_error}"
    return "nulled(no top/bottom)"  # image_status == "missing"


def log_outfit(i, n, outfit_id, gender, top_id, bottom_id, bad_products, action, embed_ms=None, notes=None):
    """One line per outfit: position, garment status, embed time, outcome."""
    def slot(pid):
        if not pid:
            return "MISSING"
        return "FAIL" if pid in bad_products else "ok"
    ms = f"{embed_ms:.0f}" if embed_ms else "-"
    line = f"[{i + 1}/{n}] {outfit_id} gender={gender} top={slot(top_id)} bottom={slot(bottom_id)} embed_ms={ms} action={action}"
    if notes:
        line += " notes=" + "; ".join(notes)
    print(line)


def process_queue_mode(sb: Client, args, embedder, cache_dir, save_renders_dir):
    ids = args.ids.split(',') if args.ids else None
    rows = fetch_queue_rows(sb, limit=args.limit, ids=ids)
    print(f"queue mode: {len(rows)} rows fetched")
    counters = Counters()

    with_both = [o for o in rows if o.get('top_id') and o.get('bottom_id') and o.get('needs_image_embedding')]
    products, bad_products = preflight_download(sb, with_both, cache_dir, args.workers)

    for i, outfit in enumerate(rows):
        oid, gender = outfit['id'], outfit.get('gender')
        top_id, bottom_id = outfit.get('top_id'), outfit.get('bottom_id')
        queue_id = outfit['queue_id']

        want_text = bool(outfit.get('needs_text_embedding') and not outfit.get('text_vector'))
        want_image = bool(outfit.get('needs_image_embedding') and not outfit.get('image_vector'))

        if not want_text and not want_image:
            delete_queue_row(sb, queue_id, args.dry_run)
            counters.skipped += 1
            log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, "skipped(already has vectors)")
            continue

        result = process_outfit(embedder, outfit, products, bad_products, want_text, want_image, cache_dir, save_renders_dir)

        updates = {}
        actions = []
        if want_text:
            if result.text_ok:
                updates['text_vector'] = result.text_vector
                counters.text_generated += 1
                actions.append('text ok')
            else:
                actions.append('text skipped(no search_summary)')

        if want_image:
            if result.image_status == "missing":
                updates['image_vector'] = None
                write_outfit(sb, oid, updates, args.dry_run)
                delete_queue_row(sb, queue_id, args.dry_run)  # this row's need can never be met, drop it
                counters.nulled += 1
                log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, "nulled(no top/bottom)")
                continue
            if result.image_status != "embedded":
                counters.failed += 1
                counters.failures.append((oid, result.image_error))
                log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, describe_failure(result))
                continue
            updates['image_vector'] = result.image_vector
            actions.append(f"image ok ({result.embed_ms:.0f}ms)")

        log_outfit(
            i, len(rows), oid, gender, top_id, bottom_id, bad_products,
            "; ".join(actions) or "text-only, no change",
            embed_ms=result.embed_ms or None, notes=result.notes,
        )

        if updates:
            write_outfit(sb, oid, updates, args.dry_run)
            delete_queue_row(sb, queue_id, args.dry_run)  # any write drains the queue row
            counters.done += 1

    return counters


def process_full_scan_mode(sb: Client, args, embedder, cache_dir, save_renders_dir):
    ids = args.ids.split(',') if args.ids else None
    rows = fetch_full_scan_outfits(sb, limit=args.limit, ids=ids)
    print(f"full-scan mode: {len(rows)} rows fetched (top+bottom set, image_vector null or stale)")
    counters = Counters()

    products, bad_products = preflight_download(sb, rows, cache_dir, args.workers)

    for i, outfit in enumerate(rows):
        oid, gender = outfit['id'], outfit.get('gender')
        top_id, bottom_id = outfit['top_id'], outfit['bottom_id']
        result = process_outfit(embedder, outfit, products, bad_products, want_text=False, want_image=True,
                                 cache_dir=cache_dir, save_renders_dir=save_renders_dir)

        if result.image_status != "embedded":
            counters.failed += 1
            counters.failures.append((oid, result.image_error or "no top/bottom set"))
            log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, describe_failure(result))
            continue

        write_outfit(sb, oid, {'image_vector': result.image_vector}, args.dry_run)
        clear_image_need_or_delete(sb, oid, args.dry_run)
        counters.done += 1
        log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, "embedded", embed_ms=result.embed_ms, notes=result.notes)

    return counters


def process_backfill_mode(sb: Client, args, embedder, cache_dir, save_renders_dir):
    ids = args.ids.split(',') if args.ids else None
    rows = fetch_all_outfits(sb, limit=args.limit, ids=ids)
    unrestricted = not args.limit and not ids
    print(f"backfill mode: {len(rows)} outfits fetched (unrestricted={unrestricted})")
    counters = Counters()

    with_both = [o for o in rows if o.get('top_id') and o.get('bottom_id')]
    products, bad_products = preflight_download(sb, with_both, cache_dir, args.workers)

    for i, outfit in enumerate(rows):
        oid, gender = outfit['id'], outfit.get('gender')
        top_id, bottom_id = outfit.get('top_id'), outfit.get('bottom_id')
        result = process_outfit(embedder, outfit, products, bad_products, want_text=False, want_image=True,
                                 cache_dir=cache_dir, save_renders_dir=save_renders_dir)

        if result.image_status == "missing":
            # No image was actually embedded, so leave vector_version/embedded_at
            # untouched instead of stamping a claim that this outfit reflects
            # the current pipeline version.
            write_outfit(sb, oid, {'image_vector': None}, args.dry_run, stamp_version=False)
            counters.nulled += 1
            log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, "nulled(no top/bottom)")
            continue

        if result.image_status != "embedded":
            # An old screenshot-era vector must not survive a failed render:
            # image_vector means one thing only now (the flat-lay render).
            write_outfit(sb, oid, {'image_vector': None}, args.dry_run, stamp_version=False)
            counters.failed += 1
            counters.failures.append((oid, result.image_error))
            log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, describe_failure(result) + ", image=NULL")
            continue

        write_outfit(sb, oid, {'image_vector': result.image_vector}, args.dry_run)  # stamps vector_version/embedded_at
        counters.done += 1
        log_outfit(i, len(rows), oid, gender, top_id, bottom_id, bad_products, "embedded", embed_ms=result.embed_ms, notes=result.notes)

    if unrestricted:
        backfill_queue_cleanup(sb, args.dry_run)
    else:
        print("  skipping queue-wide cleanup: --limit/--ids set (partial run, would be unsafe against the full queue)")

    return counters


# ---------------------------------------------------------------- main ----


def main():
    parser = argparse.ArgumentParser(description='Update outfit embeddings (flat-lay image vector + text vector)')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--full-scan', action='store_true', help='Every outfit with top+bottom set whose image_vector is null or stale')
    mode.add_argument('--backfill', action='store_true', help='One-time: every outfit in the table (see module docstring for the null-out rule)')
    parser.add_argument('--dry-run', action='store_true', help='Render and embed, log what would be written, write nothing')
    parser.add_argument('--limit', type=int, default=None, help='Process at most N outfits')
    parser.add_argument('--ids', type=str, default=None, help='Comma-separated outfit ids to process')
    parser.add_argument('--save-renders', type=str, default=None, metavar='DIR', help='Write <id>_flatlay.png and <id>_embed_input.png here')
    parser.add_argument('--workers', type=int, default=4, help='Concurrent garment-image downloads (rendering/embedding stays single-threaded)')
    parser.add_argument('--cache-dir', type=str, default=str(DEFAULT_CACHE_DIR), help='Garment image download cache directory')
    parser.add_argument('--env-file', type=str, default=None, help='Load Supabase credentials from this .env file instead of .env.local')
    args = parser.parse_args()

    mode_str = "BACKFILL" if args.backfill else ("FULL-SCAN" if args.full_scan else "QUEUE")
    print(f"Mode: {mode_str}  dry_run={args.dry_run}  started={datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Python: {sys.version.split()[0]}  torch: {torch.__version__}  open_clip: {open_clip.__version__}")

    sb = make_client(args.env_file)
    cache_dir = Path(args.cache_dir)
    save_renders_dir = Path(args.save_renders) if args.save_renders else None

    embedder = FashionEmbedder()
    embedder.initialize_models()

    start_time = time.time()
    if args.backfill:
        counters = process_backfill_mode(sb, args, embedder, cache_dir, save_renders_dir)
    elif args.full_scan:
        counters = process_full_scan_mode(sb, args, embedder, cache_dir, save_renders_dir)
    else:
        counters = process_queue_mode(sb, args, embedder, cache_dir, save_renders_dir)
    wall = time.time() - start_time

    n = counters.done + counters.nulled + counters.failed + counters.skipped
    per_outfit_ms = (wall * 1000 / n) if n else 0.0
    print("\nSummary:")
    print(f"  mode={mode_str} dry_run={args.dry_run}")
    print(f"  done={counters.done} nulled={counters.nulled} failed={counters.failed} skipped={counters.skipped} text_generated={counters.text_generated}")
    print(f"  wall_time={wall:.1f}s  per_outfit={per_outfit_ms:.0f}ms")
    if counters.failures:
        print(f"  failures ({len(counters.failures)}):")
        for oid, err in counters.failures:
            print(f"    {oid}: {err}")


if __name__ == "__main__":
    main()
