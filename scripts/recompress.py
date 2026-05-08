"""
Bulk delete + recompress WebP images in Supabase storage.

Reads a text file where each line is:
    <webp_storage_path> <source_storage_path>

For each pair it will:
  1. Delete the existing WebP at webp_storage_path
  2. Download and compress the source file
  3. Re-upload the new WebP to the same webp_storage_path

Usage:
    python scripts/recompress.py <pairs.txt>

pairs.txt format (one pair per line, paths separated by a space):
    processed/ghost_mannequins/<uuid>/front/image.webp processed/ghost_mannequins/<uuid>/front/image.png
    processed/ghost_mannequins/<uuid2>/front/other.webp processed/ghost_mannequins/<uuid2>/front/other.png

Blank lines and lines starting with # are ignored.

Requirements:
    pip install Pillow supabase python-dotenv
"""

import argparse
import io
import os
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image
from supabase import create_client

load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET = "ingested_inventory"

THUMBNAIL_SIZE = (400, 400)
WEBP_QUALITY = 80


def compress_to_webp(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as img:
        img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=WEBP_QUALITY, optimize=True)
        return buf.getvalue()


def parse_pairs(txt_path: str) -> list[tuple[str, str]]:
    pairs = []
    with open(txt_path) as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) != 2:
                raise ValueError(f"Line {lineno}: expected 2 paths, got {len(parts)}: {line!r}")
            pairs.append((parts[0], parts[1]))
    return pairs


def process_pair(storage, webp_path: str, source_path: str):
    # 1. Delete existing WebP
    storage.remove([webp_path])

    # 2. Download source
    image_bytes = storage.download(source_path)
    original_kb = len(image_bytes) / 1024

    # 3. Compress
    webp_bytes = compress_to_webp(image_bytes)
    webp_kb = len(webp_bytes) / 1024
    reduction_pct = (1 - webp_kb / original_kb) * 100

    # 4. Re-upload to the same path
    storage.upload(
        webp_path,
        webp_bytes,
        {"content-type": "image/webp", "upsert": "true"},
    )

    return original_kb, webp_kb, reduction_pct


def main():
    parser = argparse.ArgumentParser(
        description="Bulk recompress WebP images from a text file of path pairs."
    )
    parser.add_argument("pairs_file", help="Text file with one 'webp_path source_path' pair per line")
    args = parser.parse_args()

    pairs = parse_pairs(args.pairs_file)
    if not pairs:
        print("No pairs found in file.")
        return

    print(f"Found {len(pairs)} pair(s) to process.\n")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    storage = supabase.storage.from_(BUCKET)

    ok, failed = 0, 0

    for i, (webp_path, source_path) in enumerate(pairs, 1):
        print(f"[{i}/{len(pairs)}] {webp_path}")
        try:
            original_kb, webp_kb, reduction_pct = process_pair(storage, webp_path, source_path)
            print(f"  {original_kb:.0f} KB → {webp_kb:.0f} KB ({reduction_pct:.0f}% smaller) — done")
            ok += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            failed += 1

    print(f"\nDone. {ok} succeeded, {failed} failed.")


if __name__ == "__main__":
    main()
