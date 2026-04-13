import modal
import os
from fastapi import Request, HTTPException, status

app = modal.App("fashion-siglip-embed")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .pip_install(
        "fastapi[standard]", 
        "torch", 
        "open_clip_torch", 
        "transformers",     
        "pillow", 
        "numpy", 
        "huggingface_hub" 
    )
    .run_commands([
        # 1. Download Model Weights to Cache
        "python -c \""
        "from huggingface_hub import snapshot_download; "
        "print('⏳ Downloading Model Weights...');"
        "snapshot_download('Marqo/marqo-fashionSigLIP'); "
        "print('✅ Model weights baked into image');"
        "\""
    ])
)

@app.cls(
    image=image,
    cpu=4.0,
    timeout=120,
    enable_memory_snapshot=True, 
    scaledown_window=2, 
)
class FashionEmbedder:
    @modal.enter(snap=True)
    def load_weights(self):
        import torch
        import open_clip
        import gc

        MODEL_NAME = "hf-hub:Marqo/marqo-fashionSigLIP"
        print("🥶 Loading Weights (OpenCLIP)...")
        
        # 1. Load Model & Transforms
        self.model, _, self.preprocess_val = open_clip.create_model_and_transforms(MODEL_NAME)
        
        # 2. Load Tokenizer (Now works because 'transformers' is installed)
        self.tokenizer = open_clip.get_tokenizer(MODEL_NAME)
        
        # 3. Set to Eval Mode & CPU
        self.model.eval()
        self.model.to("cpu")
        
        gc.collect()

    @modal.enter(snap=False)
    def setup_device(self):
        self.model.to("cpu")

    @modal.method()
    def embed(self, payload):
        import json
        import base64
        import io
        import torch
        from PIL import Image

        if isinstance(payload, str): payload = json.loads(payload)
        
        vec = None

        # --- TEXT LOGIC ---
        if "text" in payload:
            text = payload["text"]
            text_tokens = self.tokenizer([text])
            with torch.no_grad():
                vec = self.model.encode_text(text_tokens, normalize=True)[0]

        # --- IMAGE LOGIC ---
        elif "image_b64" in payload:
            image_b64 = payload["image_b64"]
            img = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
            image_input = self.preprocess_val(img).unsqueeze(0)
            with torch.no_grad():
                vec = self.model.encode_image(image_input, normalize=True)[0]
        
        return vec.tolist()

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("my-api-secrets")],
    cpu=1.0,
    scaledown_window=2,
)
@modal.fastapi_endpoint(method="POST")
def api_embed(payload: dict, request: Request):
    token = request.headers.get("X-Modal-Token")
    expected = os.environ.get("MODAL_INTERNAL_SECRET")
    
    if not expected or token != expected:
        raise HTTPException(status_code=401, detail="Access Denied")
        
    return {"vector": FashionEmbedder().embed.remote(payload)}