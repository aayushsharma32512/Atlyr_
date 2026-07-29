"""
Modal deployment for the Altyr LaMa Eraser (single-model, production).

This serves ONLY the big-lama TorchScript model (`big-lama.pt`) — the same
FFCResNetGenerator math as the previous multi-model comparison, but with none
of the heavy deps (no saicinpainting / pytorch-lightning / hydra / kornia).
The .pt takes a 4-channel input [masked_img(3) | mask(1)] and returns an
RGB tensor in [0, 1]. Output is identical to the old "LaMa (Normal)" path.

--------------------------------------------------------------------------
ONE-TIME SETUP  (uploads the 197 MB weight into a persistent Modal Volume)
--------------------------------------------------------------------------
    modal volume create lama-weights
    modal volume put lama-weights ./big-lama.pt big-lama.pt

DEPLOY
    modal deploy services/segmentation/eraser/modal_app_eraser.py

LOCAL DEV (hot-reload, ephemeral URL)
    modal serve services/segmentation/eraser/modal_app_eraser.py

CALL
    curl -X POST "https://<user>--eraser-lamaeraser-web.modal.run/inpaint" \
         -F "image=@photo.png" -F "mask=@mask.png" -o result.png
--------------------------------------------------------------------------
"""

import io

import modal

# --------------------------------------------------------------------------
# 1. App, weight volume, and container image
# --------------------------------------------------------------------------
app = modal.App("eraser")

# Persistent volume holding big-lama.pt. Upload once (see header), then it is
# mounted read-only into every container — keeps image builds fast & cheap.
weights = modal.Volume.from_name("lama-weights", create_if_missing=True)
WEIGHTS_DIR = "/weights"
MODEL_PATH = f"{WEIGHTS_DIR}/big-lama.pt"

# CPU-only torch wheel keeps the image small; we still request a GPU at runtime
# and the CUDA build is pulled by torchvision. If you prefer, swap to the
# default index. Pillow/numpy/opencv cover pre/post-processing.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")  # OpenCV/Pillow runtime libs
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        "numpy",
        "Pillow",
        "opencv-python-headless",
        "fastapi[standard]",
        "python-multipart",  # required for multipart/form-data uploads
    )
)


# --------------------------------------------------------------------------
# 2. Model server
# --------------------------------------------------------------------------
@app.cls(
    image=image,
    gpu="T4",                       # T4 is plenty for LaMa & cheapest GPU; bump to "L4" for more headroom
    volumes={WEIGHTS_DIR: weights},
    scaledown_window=60,            # keep a warm container 60s after last request
    timeout=300,
    min_containers=0,               # set to 1 to eliminate cold starts (always-warm; costs idle GPU)
    max_containers=5,               # autoscaling ceiling — tune to your traffic
)
@modal.concurrent(max_inputs=4)     # batch a few concurrent requests per GPU container
class LamaEraser:
    @modal.enter()
    def load_model(self):
        """Runs once per container start — load weights onto the GPU."""
        import torch

        self.torch = torch
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = torch.jit.load(MODEL_PATH, map_location=self.device)
        self.model.eval()
        # Warm up CUDA kernels so the first real request isn't slow.
        with torch.no_grad():
            dummy = torch.zeros(1, 4, 256, 256, device=self.device)
            self.model(dummy)
        print(f"[LamaEraser] big-lama loaded on {self.device}")

    # ---- core inference -------------------------------------------------
    def _inpaint(self, image, mask):
        """
        image: PIL.Image RGB, mask: PIL.Image L (white = erase).
        Pads to a multiple of 8 (FFC downsampling requirement) via reflection,
        which preserves native resolution — no lossy resize.
        """
        import numpy as np
        from PIL import Image

        torch = self.torch
        orig_w, orig_h = image.size

        if mask.size != image.size:
            mask = mask.resize(image.size, Image.NEAREST)

        img_np = np.array(image).astype(np.float32) / 255.0            # H,W,3
        mask_np = np.array(mask).astype(np.float32) / 255.0            # H,W
        mask_np = (mask_np >= 0.5).astype(np.float32)                  # binarize

        img_t = torch.from_numpy(img_np).permute(2, 0, 1).unsqueeze(0)  # 1,3,H,W
        mask_t = torch.from_numpy(mask_np).unsqueeze(0).unsqueeze(0)     # 1,1,H,W

        # Reflect-pad to next multiple of 8.
        pad_h = (8 - orig_h % 8) % 8
        pad_w = (8 - orig_w % 8) % 8
        if pad_h or pad_w:
            img_t = torch.nn.functional.pad(img_t, (0, pad_w, 0, pad_h), mode="reflect")
            mask_t = torch.nn.functional.pad(mask_t, (0, pad_w, 0, pad_h), mode="constant", value=0.0)

        img_t = img_t.to(self.device)
        mask_t = mask_t.to(self.device)

        with torch.no_grad():
            masked = img_t * (1.0 - mask_t)
            inp = torch.cat([masked, mask_t], dim=1)                  # 1,4,H,W
            out = self.model(inp)                                     # 1,3,H,W in [0,1]
            # composite: keep original pixels outside the mask
            out = mask_t * out + (1.0 - mask_t) * img_t

        out = out[0].permute(1, 2, 0).clamp(0, 1).mul(255).byte().cpu().numpy()
        out = out[:orig_h, :orig_w]                                   # remove padding
        return Image.fromarray(out)

    # ---- HTTP surface (keeps the old /inpaint contract) -----------------
    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, File, HTTPException, UploadFile
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import JSONResponse, Response
        from PIL import Image

        api = FastAPI(title="Altyr LaMa Eraser")
        api.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],          # lock down to your domains in production
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @api.get("/health")
        def health():
            return {"status": "ok", "model": "big-lama", "device": str(self.device)}

        @api.post("/inpaint")
        async def inpaint(
            image: UploadFile = File(...),
            mask: UploadFile = File(...),
        ):
            try:
                img = Image.open(io.BytesIO(await image.read())).convert("RGB")
                msk = Image.open(io.BytesIO(await mask.read())).convert("L")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid image/mask: {e}")

            result = self._inpaint(img, msk)
            buf = io.BytesIO()
            result.save(buf, format="PNG")
            return Response(content=buf.getvalue(), media_type="image/png")

        @api.exception_handler(Exception)
        async def _err(_, exc):
            return JSONResponse(status_code=500, content={"detail": str(exc)})

        return api
