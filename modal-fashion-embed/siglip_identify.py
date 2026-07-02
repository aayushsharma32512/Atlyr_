import modal
import os

app = modal.App("siglip-identify")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .pip_install("fastapi[standard]", "torch", "transformers", "pillow", "numpy", "sentencepiece")
    .run_commands(
        "python -c \""
        "from transformers import AutoProcessor, AutoModel; "
        "AutoModel.from_pretrained('google/siglip-so400m-patch14-384'); "
        "AutoProcessor.from_pretrained('google/siglip-so400m-patch14-384'); "
        "print('weights baked')\""
    )
)

# ---------------------------------------------------------------------------
# Phrase helpers (inlined to keep single-file deploy)
# ---------------------------------------------------------------------------

PIECE_CATEGORIES = ("topwear", "bottomwear", "dress")
GENDER_LABELS = ("mens", "womens", "unisex")

CATEGORY_TERMS = {
    "topwear":    {"piece": "topwear",    "item": "upper-body garment"},
    "bottomwear": {"piece": "bottomwear", "item": "lower-body garment"},
    "dress":      {"piece": "dress",      "item": "dress"},
}


def gendered_phrases(phrases, gender):
    if gender == "unisex":
        return list(phrases)
    qualifier = "men's" if gender == "mens" else "women's"
    return [
        f"a {qualifier} {p}" if p.startswith("a ") else f"{qualifier} {p}"
        for p in phrases
    ]


def get_stage1_phrases(garment_category):
    t = CATEGORY_TERMS[garment_category]
    return [
        {
            "name": "Flat Lay",
            "phrases": [
                f"a product photo of a {t['item']} laid flat on a background or floating",
                f"an isolated flat lay shot of a {t['piece']}",
                f"e-commerce packshot of a {t['piece']} without a model",
                f"ghost mannequin or flat layout of an unworn {t['item']} on a plain studio background",
            ],
        },
        {
            "name": "Live Model",
            "phrases": [
                f"a model wearing a {t['item']}",
                f"a full shot of a {t['piece']} with a visible model body",
                f"an e-commerce catalog photo of a model in a {t['piece']}",
                f"fashion model wearing a {t['item']} lifestyle portrait",
            ],
        },
        {
            "name": "Macro Detail",
            "phrases": [
                f"a cropped close-up shot focusing on {t['item']} fabric print embroidery or neckline detail",
                f"a close-up shot of clothing material stitching weave or hem finish",
                f"a zoomed-in fabric swatch or localized detail of a {t['piece']}",
            ],
        },
    ]


def get_stage2_phrases(garment_category, stage1_type):
    t = CATEGORY_TERMS[garment_category]
    if stage1_type == "Flat Lay":
        return {
            "front": [
                f"the front panel view of a flat lay {t['item']}",
                f"flat lay front side of {t['piece']} displaying front design features",
                f"a flat lay {t['item']} facing up showing the front neck opening",
            ],
            "back": [
                f"the back panel of a flat lay {t['item']}",
                f"flat layout of the back side of a {t['item']}",
                f"back view of a flat lay {t['item']}",
            ],
            "labels": ("Front", "Back"),
        }
    return {
        "front": [
            f"the front view of a {t['item']}",
            f"a model facing front wearing a {t['piece']}",
        ],
        "back": [
            f"the back view of a {t['item']}",
            f"a model facing back wearing a {t['piece']}",
        ],
        "side": [
            f"the side profile of a {t['item']}",
            f"a model facing sideways wearing a {t['piece']}",
        ],
        "labels": ("Front", "Back", "Side"),
    }


def ensemble_vector(model, processor, phrases):
    import torch
    inputs = processor(text=phrases, return_tensors="pt", padding="max_length")
    with torch.no_grad():
        out = model.get_text_features(**inputs)
    vecs = out.pooler_output
    vecs = vecs / vecs.norm(dim=-1, keepdim=True)
    mean = vecs.mean(dim=0, keepdim=True)
    return mean / mean.norm(dim=-1, keepdim=True)


def to_probs(sims, scale):
    import torch
    return (torch.tensor(sims) * scale).softmax(dim=-1).tolist()


# ---------------------------------------------------------------------------
# Modal class
# ---------------------------------------------------------------------------

@app.cls(
    image=image,
    cpu=4.0,
    timeout=120,
    enable_memory_snapshot=True,
    scaledown_window=300,
)
class SigLIPIdentifier:
    @modal.enter(snap=True)
    def load(self):
        from transformers import AutoProcessor, AutoModel

        self.model = AutoModel.from_pretrained("google/siglip-so400m-patch14-384")
        self.processor = AutoProcessor.from_pretrained("google/siglip-so400m-patch14-384")
        self.model.eval()

        import torch
        with torch.no_grad():
            self.scale = self.model.logit_scale.exp().item()

        # Pre-compute all text anchors for 3 categories × 3 genders
        self.anchors = {
            (cat, gender): self._build_anchors(cat, gender)
            for cat in PIECE_CATEGORIES
            for gender in GENDER_LABELS
        }

    def _build_anchors(self, category, gender):
        def vec(phrases):
            return ensemble_vector(self.model, self.processor, gendered_phrases(phrases, gender))

        s1_cfg = get_stage1_phrases(category)
        fl = get_stage2_phrases(category, "Flat Lay")
        md = get_stage2_phrases(category, "Model")

        return {
            "s1_names":  [c["name"] for c in s1_cfg],
            "s1_vecs":   [vec(c["phrases"]) for c in s1_cfg],
            "fl_front":  vec(fl["front"]),
            "fl_back":   vec(fl["back"]),
            "fl_labels": fl["labels"],
            "md_front":  vec(md["front"]),
            "md_back":   vec(md["back"]),
            "md_side":   vec(md["side"]),
            "md_labels": md["labels"],
        }

    @modal.method()
    def classify(self, image_b64: str, garment_category: str, gender: str) -> dict:
        import base64, io
        from PIL import Image

        img = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
        inputs = self.processor(images=img, return_tensors="pt")
        with torch.no_grad():
            out = self.model.get_image_features(**inputs)
        iv = out.pooler_output
        iv = iv / iv.norm(dim=-1, keepdim=True)

        a = self.anchors[(garment_category, gender)]
        scale = self.scale

        # Stage 1
        probs_s1 = to_probs([(iv @ v.T).item() for v in a["s1_vecs"]], scale)
        ranked_s1 = sorted(enumerate(probs_s1), key=lambda x: x[1], reverse=True)
        s1_idx = ranked_s1[0][0]
        s1_margin = ranked_s1[0][1] - ranked_s1[1][1]
        s1_name = a["s1_names"][s1_idx]

        # Stage 2
        if s1_name == "Macro Detail":
            return {
                "stage1": {"labels": a["s1_names"], "probs": probs_s1, "winner": s1_name, "margin": s1_margin},
                "stage2": None,
                "category": "Macro Detail",
                "uncertain": s1_margin < 0.05,
            }

        if s1_name == "Flat Lay":
            sims = [(iv @ a["fl_front"].T).item(), (iv @ a["fl_back"].T).item()]
            labels = a["fl_labels"]
        else:
            sims = [(iv @ a["md_front"].T).item(), (iv @ a["md_back"].T).item(), (iv @ a["md_side"].T).item()]
            labels = a["md_labels"]

        probs_s2 = to_probs(sims, scale)
        ranked_s2 = sorted(enumerate(probs_s2), key=lambda x: x[1], reverse=True)
        s2_idx = ranked_s2[0][0]
        s2_margin = ranked_s2[0][1] - ranked_s2[1][1]
        s2_name = labels[s2_idx]

        return {
            "stage1": {"labels": a["s1_names"], "probs": probs_s1, "winner": s1_name, "margin": s1_margin},
            "stage2": {"labels": list(labels), "probs": probs_s2, "winner": s2_name, "margin": s2_margin},
            "category": f"{s1_name} ({s2_name})",
            "uncertain": s1_margin < 0.05 or s2_margin < 0.05,
        }


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("my-api-secrets")],
    cpu=1.0,
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="POST")
def api_classify(payload: dict, request):
    from fastapi import HTTPException
    token = request.headers.get("X-Modal-Token")
    if token != os.environ.get("MODAL_INTERNAL_SECRET"):
        raise HTTPException(status_code=401, detail="Access Denied")

    return SigLIPIdentifier().classify.remote(
        payload["image_b64"],
        payload.get("garment_category", "topwear"),
        payload.get("gender", "unisex"),
    )
