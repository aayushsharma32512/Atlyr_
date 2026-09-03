"""Isolated asynchronous detector for the user-facing Inspiration Import flow.

This is a new Modal app and is intentionally not deployed by repository setup.
It does not modify any existing segmentation, embedding, VTON, or diagnostic app.
"""

import hashlib
import hmac
import json
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
    with open(ignore_path, "r", encoding="utf-8") as ignore_file:
        return [
            line.strip()
            for line in ignore_file
            if line.strip() and not line.strip().startswith("#")
        ]


detector_image = (
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
    )
    .run_commands(
        "python -c 'from fashn_human_parser import FashnHumanParser; FashnHumanParser(device=\"cpu\")'",
        "python -c 'from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection; model=\"IDEA-Research/grounding-dino-base\"; AutoProcessor.from_pretrained(model); AutoModelForZeroShotObjectDetection.from_pretrained(model)'",
    )
    .add_local_dir(SEGMENTATION_ROOT, remote_path="/root", ignore=_get_modal_ignore_patterns())
)

api_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]")
app = modal.App("atlyr-inspiration-import")
app_secret = modal.Secret.from_name("inspiration-import")


def _signed_callback(payload: dict) -> tuple[str, dict[str, str]]:
    secret = os.environ.get("INSPIRATION_MODAL_CALLBACK_SECRET")
    if not secret:
        raise RuntimeError("INSPIRATION_MODAL_CALLBACK_SECRET is not configured")
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    timestamp = str(int(time.time()))
    signature = hmac.new(
        secret.encode("utf-8"), f"{timestamp}.{body}".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return body, {
        "Content-Type": "application/json",
        "X-Inspiration-Timestamp": timestamp,
        "X-Inspiration-Signature": signature,
    }


def _post_callback(callback_url: str, payload: dict) -> None:
    import requests

    body, headers = _signed_callback(payload)
    response = requests.post(callback_url, data=body, headers=headers, timeout=30)
    response.raise_for_status()


@app.function(
    image=detector_image,
    gpu=["L4", "A10", "L40S"],
    cpu=4.0,
    secrets=[app_secret],
    timeout=180,
    scaledown_window=60,
)
def process_detection_job(job: dict) -> None:
    import requests

    request_id = str(uuid.uuid4())
    work_dir = f"/tmp/inspiration-import/{request_id}"
    input_path = os.path.join(work_dir, "source")
    callback = {
        "version": 1,
        "importId": job["importId"],
        "detectionAttemptId": job["detectionAttemptId"],
    }
    os.makedirs(work_dir, exist_ok=True)
    try:
        with requests.get(job["sourceUrl"], stream=True, timeout=30, allow_redirects=True) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";")[0]
            if content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise ValueError("Source must be JPEG, PNG, or WebP")
            size = 0
            with open(input_path, "wb") as target:
                for chunk in response.iter_content(64 * 1024):
                    size += len(chunk)
                    if size > 10 * 1024 * 1024:
                        raise ValueError("Source image exceeds 10 MB")
                    target.write(chunk)
        if size == 0:
            raise ValueError("Source image is empty")

        from visual_search.inspiration_candidate_pipeline import run_inspiration_candidate_detection

        result = run_inspiration_candidate_detection(input_path)
        _post_callback(job["callbackUrl"], {
            **callback,
            "status": "succeeded",
            "candidates": result["candidates"],
            "imageSize": result["imageSize"],
            "timingsMs": result["timingsMs"],
        })
    except Exception:
        # Never send internal model, URL, or dependency details over the callback boundary.
        _post_callback(job["callbackUrl"], {
            **callback,
            "status": "failed",
            "errorCode": "detector_failed",
            "errorMessage": "Garment detection failed",
        })
        raise
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@app.function(image=api_image, secrets=[app_secret], timeout=60)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel, HttpUrl

    api = FastAPI(title="Atlyr Inspiration Import detector", version="2.0.0")

    class DetectJobRequest(BaseModel):
        importId: uuid.UUID
        detectionAttemptId: uuid.UUID
        sourceUrl: HttpUrl
        callbackUrl: HttpUrl

    @api.get("/health")
    def health():
        return {
            "ok": True,
            "mode": "asynchronous-callback",
            "pipeline": "fashn-groundingdino-multi-candidate",
            "usesSam2": False,
            "generatesEmbeddings": False,
        }

    @api.post("/detect-jobs", status_code=202)
    def create_detection_job(
        body: DetectJobRequest,
        x_inspiration_token: str | None = Header(None),
    ):
        expected_token = os.environ.get("INSPIRATION_MODAL_TOKEN")
        if not expected_token or not hmac.compare_digest(x_inspiration_token or "", expected_token):
            raise HTTPException(status_code=401, detail="Invalid detector token")
        source_url = str(body.sourceUrl)
        callback_url = str(body.callbackUrl)
        source = urlparse(source_url)
        callback = urlparse(callback_url)
        allowed_host = os.environ.get("INSPIRATION_SUPABASE_HOST")
        if source.scheme != "https" or callback.scheme != "https":
            raise HTTPException(status_code=400, detail="URLs must use HTTPS")
        if not allowed_host or source.hostname != allowed_host or callback.hostname != allowed_host:
            raise HTTPException(status_code=400, detail="URLs must use the configured Supabase host")
        call = process_detection_job.spawn({
            "importId": str(body.importId),
            "detectionAttemptId": str(body.detectionAttemptId),
            "sourceUrl": source_url,
            "callbackUrl": callback_url,
        })
        return {"accepted": True, "detectorJobId": call.object_id}

    return api
