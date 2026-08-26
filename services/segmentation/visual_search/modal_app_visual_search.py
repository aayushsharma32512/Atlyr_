"""Isolated FASHN + GroundingDINO visual-search hypothesis endpoint.

Deploying this file creates the separate ``atlyr-visual-search-test`` Modal app.
It does not invoke the production segmentation app, Supabase, Storage, SAM2, or
an embedding model. All generated diagnostics are returned inline and the
per-request temporary directory is deleted after the response is prepared.
"""

import base64
import os
import shutil
import sys
import time
import uuid

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


def _encode_file(path: str) -> str:
    with open(path, "rb") as artifact_file:
        encoded = base64.b64encode(artifact_file.read()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


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

        api = FastAPI(title="Atlyr FASHN + GroundingDINO test", version="0.2.0")
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

        return api
