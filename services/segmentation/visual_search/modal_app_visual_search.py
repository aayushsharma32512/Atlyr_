"""Isolated FASHN + GroundingDINO visual-search hypothesis endpoint.

Deploying this file creates the separate ``atlyr-visual-search-test`` Modal app.
It does not invoke the production segmentation app, Supabase, Storage, SAM2, or
an embedding model. All generated diagnostics are returned inline and the
per-request temporary directory is deleted after the response is prepared.
"""

import base64
import io
import os
import shutil
import sys
import time
import uuid
from urllib.parse import urlparse

import modal


SEGMENTATION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SEGMENTATION_ROOT not in sys.path:
    sys.path.insert(0, SEGMENTATION_ROOT)


def _get_modal_ignore_patterns():
    ignore_path = os.path.join(SEGMENTATION_ROOT, ".modalignore")
    if not os.path.exists(ignore_path):
        return []
    with open(ignore_path, "r") as ignore_file:
        return [
            line.strip()
            for line in ignore_file
            if line.strip() and not line.strip().startswith("#")
        ]


diagnostic_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "fashn-human-parser",
        "torch",
        "torchvision",
        "opencv-python-headless",
        "numpy",
        "Pillow",
        "scipy",
        "transformers",
        "requests",
        "fastapi[standard]",
    )
    .run_commands(
        "python -c 'from fashn_human_parser import FashnHumanParser; FashnHumanParser(device=\"cpu\")'",
        "python -c 'from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection; model=\"IDEA-Research/grounding-dino-base\"; AutoProcessor.from_pretrained(model); AutoModelForZeroShotObjectDetection.from_pretrained(model)'",
    )
    .add_local_dir(
        SEGMENTATION_ROOT,
        remote_path="/root",
        ignore=_get_modal_ignore_patterns(),
    )
)


app = modal.App("atlyr-visual-search-test")

ARTIFACT_DETAILS = {
    "source": (
        "Source image",
        "Normalized RGB input used by both models.",
    ),
    "fashnClassMap": (
        "Raw FASHN class map",
        "Grayscale pixel values are the raw FASHN class IDs.",
    ),
    "fashnColored": (
        "Colored FASHN segments",
        "Every FASHN class is rendered with a diagnostic color.",
    ),
    "fashnTargetMask": (
        "Selected garment mask",
        "Only the FASHN classes mapped to the requested category.",
    ),
    "fashnTargetOverlay": (
        "Selected garment overlay",
        "The FASHN target mask overlaid on the original image.",
    ),
    "fashnForegroundMask": (
        "All FASHN foreground",
        "Every non-background FASHN pixel; skin and occluders are retained.",
    ),
    "detectionBoxes": (
        "FASHN and GroundingDINO boxes",
        "Cyan: FASHN box. Yellow/orange: DINO boxes. Magenta: final padded crop.",
    ),
    "originalCrop": (
        "Original contextual crop",
        "Final square crop with all source pixels and rectangular background retained.",
    ),
    "fashnForegroundCrop": (
        "Background-removed foreground crop",
        "All non-background FASHN pixels inside the crop composited onto white.",
    ),
    "fashnTargetOnlyCrop": (
        "Target-only FASHN crop",
        "Only selected garment-class pixels; useful for seeing fragmentation and occlusion holes.",
    ),
    "fashnForegroundMaskCrop": (
        "Foreground mask crop",
        "The exact binary FASHN foreground mask used for background removal.",
    ),
}

SERPAPI_CATEGORY_QUERIES = {
    "upper": "clothing top",
    "lower": "pants skirt",
    "shoes": "shoes",
}
SERPAPI_MAX_IMAGE_BYTES = 500 * 1024


def _encode_file(path: str) -> str:
    with open(path, "rb") as artifact_file:
        encoded = base64.b64encode(artifact_file.read()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _prepare_serpapi_image(payload: bytes) -> bytes:
    """Strip metadata and fit a crop under SerpApi's 500 KB upload limit."""
    from PIL import Image

    with Image.open(io.BytesIO(payload)) as source:
        image = source.convert("RGB")

    image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    quality = 90
    while True:
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True)
        encoded = output.getvalue()
        if len(encoded) <= SERPAPI_MAX_IMAGE_BYTES:
            return encoded
        if quality > 50:
            quality -= 10
            continue

        next_width = max(1, round(image.width * 0.85))
        next_height = max(1, round(image.height * 0.85))
        if (next_width, next_height) == image.size:
            raise ValueError("Unable to fit garment crop within SerpApi's 500 KB limit")
        image = image.resize((next_width, next_height), Image.Resampling.LANCZOS)
        quality = 80


def _normalize_serpapi_matches(matches: list[dict]) -> list[dict]:
    products = []
    seen_links = set()
    for index, match in enumerate(matches):
        link = match.get("link")
        title = match.get("title")
        image_url = match.get("image") or match.get("thumbnail")
        if (
            not link
            or not title
            or not image_url
            or urlparse(link).scheme not in {"http", "https"}
            or urlparse(image_url).scheme not in {"http", "https"}
            or link in seen_links
        ):
            continue
        seen_links.add(link)

        price = match.get("price")
        if isinstance(price, dict):
            display_price = price.get("value")
            price_value = price.get("extracted_value")
            currency = price.get("currency")
        else:
            display_price = price
            price_value = match.get("extracted_price")
            currency = match.get("currency")

        products.append({
            "position": match.get("position", index + 1),
            "title": title,
            "link": link,
            "source": match.get("source"),
            "image": image_url,
            "thumbnail": match.get("thumbnail"),
            "displayPrice": display_price,
            "price": price_value,
            "currency": currency,
            "inStock": match.get("in_stock"),
            "rating": match.get("rating"),
            "reviews": match.get("reviews"),
            "condition": match.get("condition"),
            "exactMatch": match.get("exact_matches", False),
        })
        if len(products) >= 30:
            break
    return products


@app.cls(
    image=diagnostic_image,
    gpu="L4",
    cpu=4.0,
    secrets=[modal.Secret.from_name("visual-search-test")],
    timeout=600,
    scaledown_window=60,
    min_containers=0,
    max_containers=2,
)
@modal.concurrent(max_inputs=1)
class VisualSearchTest:
    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
        from fastapi.middleware.cors import CORSMiddleware

        api = FastAPI(title="Atlyr FASHN + GroundingDINO test", version="0.3.0")
        allowed_origins = [
            origin.strip()
            for origin in os.environ.get(
                "VISUAL_SEARCH_ALLOWED_ORIGINS",
                "http://localhost:8080,http://127.0.0.1:8080",
            ).split(",")
            if origin.strip()
        ]
        api.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )

        @api.get("/health")
        def health():
            return {
                "ok": True,
                "pipeline": "fashn-groundingdino-diagnostics",
                "usesSam2": False,
                "generatesEmbeddings": False,
                "writesDatabase": False,
                "onlineSearchConfigured": bool(os.environ.get("SERPAPI_API_KEY")),
            }

        @api.post("/analyze")
        async def analyze(
            image: UploadFile = File(...),
            category: str = Form(...),
            x_visual_search_token: str | None = Header(None),
        ):
            expected_token = os.environ.get("VISUAL_SEARCH_TEST_TOKEN")
            if not expected_token or x_visual_search_token != expected_token:
                raise HTTPException(status_code=401, detail="Invalid visual-search test token")

            normalized_category = category.strip().lower()
            if normalized_category not in {"upper", "lower", "shoes"}:
                raise HTTPException(status_code=400, detail="category must be upper, lower, or shoes")
            if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise HTTPException(status_code=415, detail="image must be JPEG, PNG, or WebP")

            payload = await image.read()
            if not payload or len(payload) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="image must be between 1 byte and 10 MB")

            request_id = str(uuid.uuid4())
            work_dir = f"/tmp/visual-search/{request_id}"
            os.makedirs(work_dir, exist_ok=True)
            extension = {
                "image/jpeg": "jpg",
                "image/png": "png",
                "image/webp": "webp",
            }[image.content_type]
            input_path = os.path.join(work_dir, f"input.{extension}")

            try:
                with open(input_path, "wb") as input_file:
                    input_file.write(payload)

                started = time.perf_counter()
                from visual_search.fashn_gdino_pipeline import run_fashn_gdino_diagnostics

                diagnostics = run_fashn_gdino_diagnostics(
                    image_path=input_path,
                    category=normalized_category,
                    output_dir=work_dir,
                )
                analysis_ms = round((time.perf_counter() - started) * 1000)
                stage_timings = diagnostics.pop("stageTimingsMs")

                artifacts = []
                for key, path in diagnostics.pop("artifacts").items():
                    title, description = ARTIFACT_DETAILS[key]
                    artifacts.append({
                        "key": key,
                        "title": title,
                        "description": description,
                        "filename": os.path.basename(path),
                        "dataUrl": _encode_file(path),
                    })

                return {
                    "requestId": request_id,
                    "category": normalized_category,
                    **diagnostics,
                    "artifacts": artifacts,
                    "timingsMs": {
                        **stage_timings,
                        "total": analysis_ms,
                    },
                    "constraints": {
                        "usesSam2": False,
                        "generatesEmbeddings": False,
                        "writesDatabase": False,
                        "persistsArtifacts": False,
                    },
                }
            except HTTPException:
                raise
            except Exception as error:
                raise HTTPException(status_code=500, detail=str(error)) from error
            finally:
                shutil.rmtree(work_dir, ignore_errors=True)

        @api.post("/search-online")
        async def search_online(
            image: UploadFile = File(...),
            category: str = Form(...),
            country: str = Form("in"),
            x_visual_search_token: str | None = Header(None),
        ):
            import requests

            expected_token = os.environ.get("VISUAL_SEARCH_TEST_TOKEN")
            if not expected_token or x_visual_search_token != expected_token:
                raise HTTPException(status_code=401, detail="Invalid visual-search test token")

            serpapi_key = os.environ.get("SERPAPI_API_KEY")
            if not serpapi_key:
                raise HTTPException(
                    status_code=503,
                    detail="SERPAPI_API_KEY is not configured on the visual-search-test Modal secret",
                )

            normalized_category = category.strip().lower()
            if normalized_category not in SERPAPI_CATEGORY_QUERIES:
                raise HTTPException(status_code=400, detail="category must be upper, lower, or shoes")
            normalized_country = country.strip().lower()
            if len(normalized_country) != 2 or not normalized_country.isalpha():
                raise HTTPException(status_code=400, detail="country must be a two-letter country code")
            if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise HTTPException(status_code=415, detail="image must be JPEG, PNG, or WebP")

            payload = await image.read()
            if not payload or len(payload) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="image must be between 1 byte and 10 MB")

            try:
                started = time.perf_counter()
                upload_payload = _prepare_serpapi_image(payload)
                upload_started = time.perf_counter()
                upload_response = requests.post(
                    "https://serpapi.com/image",
                    data={"api_key": serpapi_key},
                    files={"image": ("08_fashn_foreground_crop.jpg", upload_payload, "image/jpeg")},
                    timeout=30,
                )
                upload_ms = round((time.perf_counter() - upload_started) * 1000)
                upload_data = upload_response.json()
                if not upload_response.ok or upload_data.get("error"):
                    detail = upload_data.get("error") or f"SerpApi image upload failed ({upload_response.status_code})"
                    raise HTTPException(status_code=502, detail=detail)

                image_id = upload_data.get("image_id")
                if not image_id:
                    raise HTTPException(status_code=502, detail="SerpApi image upload returned no image_id")

                lens_started = time.perf_counter()
                lens_response = requests.get(
                    "https://serpapi.com/search.json",
                    params={
                        "engine": "google_lens",
                        "image_id": image_id,
                        "type": "products",
                        "q": SERPAPI_CATEGORY_QUERIES[normalized_category],
                        "country": normalized_country,
                        "hl": "en",
                        "safe": "active",
                        "auto_crop": "false",
                        "api_key": serpapi_key,
                    },
                    timeout=90,
                )
                lens_ms = round((time.perf_counter() - lens_started) * 1000)
                lens_data = lens_response.json()
                if not lens_response.ok or lens_data.get("error"):
                    detail = lens_data.get("error") or f"SerpApi Lens search failed ({lens_response.status_code})"
                    raise HTTPException(status_code=502, detail=detail)

                raw_matches = lens_data.get("visual_matches") or []
                products = _normalize_serpapi_matches(raw_matches)
                return {
                    "provider": "serpapi_google_lens",
                    "queryArtifactKey": "fashnForegroundCrop",
                    "category": normalized_category,
                    "country": normalized_country,
                    "query": SERPAPI_CATEGORY_QUERIES[normalized_category],
                    "products": products,
                    "rawMatchCount": len(raw_matches),
                    "searchId": lens_data.get("search_metadata", {}).get("id"),
                    "timingsMs": {
                        "imageUpload": upload_ms,
                        "lens": lens_ms,
                        "total": round((time.perf_counter() - started) * 1000),
                    },
                    "constraints": {
                        "writesDatabase": False,
                        "persistsResults": False,
                        "generatesEmbeddings": False,
                    },
                }
            except HTTPException:
                raise
            except requests.RequestException as error:
                raise HTTPException(status_code=502, detail="Unable to reach SerpApi") from error
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            except Exception as error:
                raise HTTPException(status_code=500, detail=str(error)) from error

        return api
