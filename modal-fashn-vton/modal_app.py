# Self-hosted FASHN VTON v1.5 on Modal (Apache-2.0 weights).
#
# Garment-region swap: given a locked avatar image + a garment image, returns
# the avatar wearing the garment with pose preserved. One garment per call.
#
# Deploy: python3 -m modal deploy modal-fashn-vton/modal_app.py
# Requires the Modal secret "my-api-secrets" (key "MODAL_INTERNAL_SECRET") for endpoint auth.

import base64
import io

from fastapi import Request
import os

import modal

app = modal.App("fashn-vton-1-5")

REPO = "https://github.com/fashn-AI/fashn-vton-1.5.git"
WEIGHTS_DIR = "/weights"

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.10"
    )
    .apt_install("git", "libgl1", "libglib2.0-0", "libsm6", "libxext6")
    .run_commands(
        f"git clone {REPO} /app/fashn-vton-1.5",
        "cd /app/fashn-vton-1.5 && pip install -e .",
        f"cd /app/fashn-vton-1.5 && python scripts/download_weights.py --weights-dir {WEIGHTS_DIR}",
    )
    .env({"WEIGHTS_DIR": WEIGHTS_DIR})
    .pip_install("fastapi[standard]")
)

# Validated recipe (services/ingestion-automated fashn-vton adapter relies on these
# defaults — see vton_intern_pack/02_MODEL_LEARNINGS.md §1).
CATEGORY_MAP = {
    "tops": "tops",
    "bottoms": "bottoms",
    "dresses": "one-pieces",
    "one-pieces": "one-pieces",
}


@app.cls(
    image=image,
    gpu="L4",
    timeout=180,
    scaledown_window=15,
)
class FashnVton:
    @modal.enter()
    def load(self):
        from fashn_vton import TryOnPipeline

        self.pipeline = TryOnPipeline(weights_dir=WEIGHTS_DIR)

    @modal.method()
    def render(
        self,
        person_b64: str,
        garment_b64: str,
        category: str = "tops",
        garment_photo_type: str = "model",
        num_timesteps: int = 50,
        guidance_scale: float = 2.0,
        seed: int = 42,
    ) -> str:
        from PIL import Image

        cat = CATEGORY_MAP.get(category.lower())
        if cat is None:
            raise ValueError(f"category must be one of {list(CATEGORY_MAP)}, got {category!r}")

        def decode_img(b64: str) -> Image.Image:
            raw = Image.open(io.BytesIO(base64.b64decode(b64)))
            if raw.mode == "RGBA":
                bg = Image.new("RGB", raw.size, (255, 255, 255))
                bg.paste(raw, mask=raw.split()[3])
                return bg
            return raw.convert("RGB")

        result = self.pipeline(
            person_image=decode_img(person_b64),
            garment_image=decode_img(garment_b64),
            category=cat,
            garment_photo_type=garment_photo_type,
            num_timesteps=num_timesteps,
            guidance_scale=guidance_scale,
            seed=seed,
        )
        out = result.images[0]

        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("my-api-secrets")],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def api_render(payload: dict, request: Request):
    from fastapi import HTTPException

    token = request.headers.get("X-Modal-Token")
    expected = os.environ.get("MODAL_INTERNAL_SECRET")
    if not expected or token != expected:
        raise HTTPException(status_code=401, detail="Access Denied")

    image_b64 = FashnVton().render.remote(
        payload["person_b64"],
        payload["garment_b64"],
        payload.get("category", "tops"),
    )
    return {"image_b64": image_b64}
