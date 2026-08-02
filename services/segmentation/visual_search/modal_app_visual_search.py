"""Stateless visual-search test endpoint.

Deploy:
    modal secret create visual-search-test VISUAL_SEARCH_TEST_TOKEN=<token>
    modal deploy services/segmentation/visual_search/modal_app_visual_search.py

The endpoint intentionally creates no job rows and uploads no artifacts. It returns
the segmented cutout inline, embeds it with the deployed fashion-siglip-embed app,
and queries the existing match_products_image RPC.
"""

import base64
import io
import os
import shutil
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import modal

SEGMENTATION_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SEGMENTATION_ROOT not in sys.path:
    sys.path.insert(0, SEGMENTATION_ROOT)

# Production segmentation historically bypassed optional GDINO work by default.
# The test endpoint needs it enabled for flatlays/no-person inputs.
os.environ["SKIP_DINO"] = "0"

from modal_app import image as segmentation_image


app = modal.App("atlyr-visual-search-test")

CATEGORY_TO_PRODUCT_TYPE = {
    "upper": "top",
    "lower": "bottom",
    "shoes": "shoes",
}


def _supabase_headers():
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "Content-Type": "application/json",
    }


def _match_catalog(vector, category: str, threshold: float, count: int):
    import requests

    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    product_type = CATEGORY_TO_PRODUCT_TYPE[category]
    rpc_response = requests.post(
        f"{supabase_url}/rest/v1/rpc/match_products_image",
        headers=_supabase_headers(),
        json={
            "query_embedding": vector,
            "filters": {"typeCategories": [product_type]},
            "match_threshold": threshold,
            "match_count": count,
        },
        timeout=30,
    )
    rpc_response.raise_for_status()
    return rpc_response.json()


def _fetch_products(ids):
    import requests

    if not ids:
        return {}
    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    product_response = requests.get(
        f"{supabase_url}/rest/v1/products",
        headers=_supabase_headers(),
        params={
            "id": f"in.({','.join(ids)})",
            "select": (
                "id,product_name,brand,price,currency,image_url,thumbnail_url,"
                "product_url,type,type_category,color"
            ),
        },
        timeout=30,
    )
    product_response.raise_for_status()
    return {str(row["id"]): row for row in product_response.json()}


def _hydrate_candidates(matches, products_by_id, category: str):
    product_type = CATEGORY_TO_PRODUCT_TYPE[category]

    candidates = []
    for match in matches:
        product = products_by_id.get(str(match["id"]), {})
        candidates.append({
            "id": str(match["id"]),
            "product_name": None,
            "brand": None,
            "price": None,
            "currency": None,
            "image_url": None,
            "thumbnail_url": None,
            "product_url": None,
            "type": product_type,
            "type_category": None,
            "color": None,
            **product,
            **match,
        })
    return candidates


def _fuse_candidates(original_candidates, cutout_candidates, count: int):
    """Weighted reciprocal-rank fusion; the contextual crop is the primary signal."""
    weights = {"original_crop": 0.75, "segmented_cutout": 0.25}
    fused = {}
    for source, candidates in (
        ("original_crop", original_candidates),
        ("segmented_cutout", cutout_candidates),
    ):
        for rank, candidate in enumerate(candidates, start=1):
            candidate_id = str(candidate["id"])
            entry = fused.setdefault(candidate_id, {
                **candidate,
                "fused_score": 0.0,
                "original_crop_similarity": None,
                "segmented_cutout_similarity": None,
                "original_crop_rank": None,
                "segmented_cutout_rank": None,
            })
            similarity = float(candidate.get("similarity") or 0.0)
            entry["fused_score"] += weights[source] / (60 + rank)
            entry[f"{source}_similarity"] = similarity
            entry[f"{source}_rank"] = rank
            entry["similarity"] = max(float(entry.get("similarity") or 0.0), similarity)

    return sorted(
        fused.values(),
        key=lambda item: (item["fused_score"], item["similarity"]),
        reverse=True,
    )[:count]


def _square_crop(image, bbox, fill):
    """Crop an exclusive XYXY box and pad to square without distorting the garment."""
    from PIL import Image

    x1, y1, x2, y2 = [int(value) for value in bbox]
    width = max(1, x2 - x1)
    height = max(1, y2 - y1)
    side = max(width, height)
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    square_x1 = int(round(center_x - side / 2))
    square_y1 = int(round(center_y - side / 2))
    square_x2 = square_x1 + side
    square_y2 = square_y1 + side

    source_x1 = max(0, square_x1)
    source_y1 = max(0, square_y1)
    source_x2 = min(image.width, square_x2)
    source_y2 = min(image.height, square_y2)
    crop = image.crop((source_x1, source_y1, source_x2, source_y2))
    canvas = Image.new("RGB", (side, side), fill)
    canvas.paste(crop, (source_x1 - square_x1, source_y1 - square_y1))
    return canvas


def _encode_png(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _prepare_query_images(input_path: str, cutout_path: str, bbox):
    from PIL import Image

    source = Image.open(input_path).convert("RGB")
    cutout = Image.open(cutout_path).convert("RGBA")
    if not bbox:
        alpha_bbox = cutout.getchannel("A").point(lambda value: 255 if value > 16 else 0).getbbox()
        if alpha_bbox is None:
            raise RuntimeError("Segmented garment mask is empty")
        bbox = list(alpha_bbox)

    original_crop = _square_crop(source, bbox, fill=(255, 255, 255))
    white = Image.new("RGBA", cutout.size, (255, 255, 255, 255))
    composited_cutout = Image.alpha_composite(white, cutout).convert("RGB")
    cutout_crop = _square_crop(composited_cutout, bbox, fill=(255, 255, 255))
    return bbox, original_crop, cutout_crop


@app.cls(
    image=segmentation_image,
    gpu="L4",
    cpu=4.0,
    secrets=[
        modal.Secret.from_name("supabase-secret"),
        modal.Secret.from_name("visual-search-test"),
    ],
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

        api = FastAPI(title="Atlyr visual-search test", version="0.1.0")
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
            return {"ok": True, "pipeline": "segment-embed-catalog-search"}

        @api.post("/search")
        async def search(
            image: UploadFile = File(...),
            category: str = Form(...),
            threshold: float = Form(0.75),
            count: int = Form(12),
            x_visual_search_token: str | None = Header(None),
        ):
            expected_token = os.environ.get("VISUAL_SEARCH_TEST_TOKEN")
            if not expected_token or x_visual_search_token != expected_token:
                raise HTTPException(status_code=401, detail="Invalid visual-search test token")

            normalized_category = category.strip().lower()
            if normalized_category not in CATEGORY_TO_PRODUCT_TYPE:
                raise HTTPException(status_code=400, detail="category must be upper, lower, or shoes")
            if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise HTTPException(status_code=415, detail="image must be JPEG, PNG, or WebP")
            threshold = min(1.0, max(0.0, threshold))
            count = min(30, max(1, count))

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

                segment_started = time.perf_counter()
                from pipeline.green_screen_pipeline import run_green_screen_pipeline_e2e

                segmentation = run_green_screen_pipeline_e2e(
                    seg_job_id=request_id,
                    pipeline_job_id="",
                    vton_image_url=input_path,
                    category=normalized_category,
                    output_dir=work_dir,
                    skip_intermediate_uploads=True,
                    persist_results=False,
                )
                if segmentation.get("status") != "completed":
                    raise RuntimeError(segmentation.get("error") or "Segmentation failed")
                segment_ms = round((time.perf_counter() - segment_started) * 1000)

                with open(segmentation["final_image_path"], "rb") as cutout_file:
                    cutout_bytes = cutout_file.read()
                cutout_b64 = base64.b64encode(cutout_bytes).decode("ascii")

                prepare_started = time.perf_counter()
                search_bbox, original_crop, cutout_crop = _prepare_query_images(
                    input_path,
                    segmentation["final_image_path"],
                    segmentation.get("search_bbox"),
                )
                original_crop_b64 = _encode_png(original_crop)
                cutout_crop_b64 = _encode_png(cutout_crop)
                query_preparation_ms = round((time.perf_counter() - prepare_started) * 1000)

                embed_started = time.perf_counter()
                Embedder = modal.Cls.from_name("fashion-siglip-embed", "FashionEmbedder")
                original_vector, cutout_vector = Embedder().embed.remote({
                    "images_b64": [original_crop_b64, cutout_crop_b64],
                })
                embed_ms = round((time.perf_counter() - embed_started) * 1000)

                search_started = time.perf_counter()
                with ThreadPoolExecutor(max_workers=2) as executor:
                    original_matches_future = executor.submit(
                        _match_catalog,
                        original_vector,
                        normalized_category,
                        threshold,
                        count,
                    )
                    cutout_matches_future = executor.submit(
                        _match_catalog,
                        cutout_vector,
                        normalized_category,
                        threshold,
                        count,
                    )
                    original_matches = original_matches_future.result()
                    cutout_matches = cutout_matches_future.result()

                matched_ids = list(dict.fromkeys(
                    str(match["id"])
                    for match in [*original_matches, *cutout_matches]
                ))
                products_by_id = _fetch_products(matched_ids)
                original_candidates = _hydrate_candidates(
                    original_matches,
                    products_by_id,
                    normalized_category,
                )
                cutout_candidates = _hydrate_candidates(
                    cutout_matches,
                    products_by_id,
                    normalized_category,
                )
                candidates = _fuse_candidates(original_candidates, cutout_candidates, count)
                search_ms = round((time.perf_counter() - search_started) * 1000)
                total_ms = segment_ms + query_preparation_ms + embed_ms + search_ms

                return {
                    "requestId": request_id,
                    "category": normalized_category,
                    "detector": segmentation.get("detector"),
                    "searchBox": search_bbox,
                    "cutoutDataUrl": f"data:image/png;base64,{cutout_b64}",
                    "queryImages": {
                        "originalCropDataUrl": f"data:image/png;base64,{original_crop_b64}",
                        "segmentedCutoutDataUrl": f"data:image/png;base64,{cutout_crop_b64}",
                    },
                    "candidates": candidates,
                    "candidateSets": {
                        "originalCrop": original_candidates,
                        "segmentedCutout": cutout_candidates,
                    },
                    "timingsMs": {
                        "segmentation": segment_ms,
                        "queryPreparation": query_preparation_ms,
                        "embedding": embed_ms,
                        "catalogSearch": search_ms,
                        "total": total_ms,
                    },
                }
            except HTTPException:
                raise
            except Exception as error:
                raise HTTPException(status_code=500, detail=str(error)) from error
            finally:
                shutil.rmtree(work_dir, ignore_errors=True)

        return api
