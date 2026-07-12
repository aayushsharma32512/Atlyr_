import modal
import os

app = modal.App("siglip-embed")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .pip_install(
        "fastapi[standard]", "torch", "transformers",
        "pillow", "numpy", "sentencepiece", "protobuf",
    )
    .run_commands(
        "python -c \""
        "from transformers import AutoProcessor, AutoModel; "
        "AutoModel.from_pretrained('google/siglip-so400m-patch14-384'); "
        "AutoProcessor.from_pretrained('google/siglip-so400m-patch14-384'); "
        "print('weights baked')\""
    )
)


@app.cls(image=image, cpu=0.5, timeout=120, enable_memory_snapshot=True, scaledown_window=15)
class SigLIPEmbed:
    @modal.enter(snap=True)
    def load(self):
        import torch
        from transformers import AutoProcessor, AutoModel
        self.model = AutoModel.from_pretrained("google/siglip-so400m-patch14-384")
        self.processor = AutoProcessor.from_pretrained("google/siglip-so400m-patch14-384")
        self.model.eval()
        with torch.no_grad():
            self.logit_scale = self.model.logit_scale.exp().item()

    @modal.method()
    def embed_image(self, image_b64: str) -> list[float]:
        import torch, base64, io
        from PIL import Image
        img = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
        inputs = self.processor(images=img, return_tensors="pt")
        with torch.no_grad():
            out = self.model.get_image_features(**inputs)
        v = out.pooler_output
        v = v / v.norm(dim=-1, keepdim=True)
        return v[0].tolist()

    @modal.method()
    def embed_texts(self, phrases: list[str]) -> list[float]:
        """Mean-pools a list of phrases into a single normalized anchor vector."""
        import torch
        inputs = self.processor(text=phrases, return_tensors="pt", padding="max_length")
        with torch.no_grad():
            out = self.model.get_text_features(**inputs)
        vecs = out.pooler_output
        vecs = vecs / vecs.norm(dim=-1, keepdim=True)
        mean = vecs.mean(dim=0, keepdim=True)
        mean = mean / mean.norm(dim=-1, keepdim=True)
        return mean[0].tolist()


@app.function(image=image, cpu=0.125, scaledown_window=15)
@modal.fastapi_endpoint(method="POST")
def api_embed(payload: dict):
    from fastapi import HTTPException

    embedder = SigLIPEmbed()

    if "image_b64" in payload:
        return {"vector": embedder.embed_image.remote(payload["image_b64"])}

    if "phrases" in payload:
        return {"vector": embedder.embed_texts.remote(payload["phrases"])}

    raise HTTPException(status_code=400, detail="Provide image_b64 or phrases")
