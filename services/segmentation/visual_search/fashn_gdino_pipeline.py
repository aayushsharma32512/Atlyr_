"""FASHN + GroundingDINO visual-search hypothesis harness.

This module intentionally does not call SAM/SAM2, Supabase, Storage, or an
embedding model. It preserves intermediate masks and box visualizations so the
garment-localization and coarse background-removal assumptions can be inspected.
"""

from __future__ import annotations

import os
import time
from typing import Any

import numpy as np
from PIL import Image, ImageDraw


FASHN_LABELS = {
    0: "background",
    1: "face",
    2: "hair",
    3: "top",
    4: "dress",
    5: "skirt",
    6: "pants",
    7: "belt",
    8: "bag",
    9: "hat",
    10: "scarf",
    11: "glasses",
    12: "arms",
    13: "hands",
    14: "legs",
    15: "feet",
    16: "torso",
    17: "jewelry",
}

FASHN_COLORS = {
    0: (0, 0, 0),
    1: (255, 220, 180),
    2: (139, 69, 19),
    3: (255, 0, 0),
    4: (255, 0, 255),
    5: (255, 128, 0),
    6: (0, 128, 255),
    7: (128, 128, 0),
    8: (0, 200, 200),
    9: (255, 200, 0),
    10: (200, 200, 0),
    11: (0, 255, 255),
    12: (200, 180, 255),
    13: (200, 150, 150),
    14: (150, 150, 200),
    15: (100, 100, 100),
    16: (255, 200, 200),
    17: (150, 150, 150),
}

CATEGORY_CONFIG = {
    "upper": {
        "fashn_classes": [3],
        "dino_queries": [
            "shirt", "top", "blouse", "jacket", "coat", "sweater",
            "hoodie", "vest", "cardigan", "blazer", "tshirt", "tee",
            "tunic", "polo", "pullover", "sweatshirt",
        ],
    },
    "lower": {
        "fashn_classes": [5, 6],
        "dino_queries": [
            "pants", "jeans", "trousers", "skirt", "shorts", "leggings",
            "culottes", "chinos", "palazzos", "joggers",
        ],
    },
    "shoes": {
        # FASHN exposes feet rather than a dedicated shoe class. GroundingDINO
        # is therefore the primary box signal for this category.
        "fashn_classes": [15],
        "dino_queries": [
            "shoe", "boot", "sneaker", "heel", "sandal", "loafer",
            "oxford", "pump", "mule", "clog", "slipper", "wedge",
        ],
    },
}

_FASHN_PARSER = None
_GDINO_CACHE = None
GDINO_MODEL_ID = "IDEA-Research/grounding-dino-base"


def _get_fashn_parser():
    global _FASHN_PARSER
    if _FASHN_PARSER is None:
        from fashn_human_parser import FashnHumanParser

        print("[VisualSearchTest] Loading FASHN parser")
        _FASHN_PARSER = FashnHumanParser()
    return _FASHN_PARSER


def _load_grounding_dino():
    """Load GroundingDINO without importing the production pipeline package."""
    global _GDINO_CACHE
    if _GDINO_CACHE is not None:
        return _GDINO_CACHE

    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    print(f"[VisualSearchTest] Loading GroundingDINO ({GDINO_MODEL_ID})")
    processor = AutoProcessor.from_pretrained(GDINO_MODEL_ID)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(GDINO_MODEL_ID)
    model.eval()
    _GDINO_CACHE = (processor, model)
    return _GDINO_CACHE


def _save_rgb(array: np.ndarray, path: str) -> str:
    Image.fromarray(array.astype(np.uint8), mode="RGB").save(path, format="PNG")
    return path


def _save_mask(mask: np.ndarray, path: str) -> str:
    Image.fromarray(mask.astype(np.uint8), mode="L").save(path, format="PNG")
    return path


def _colorize_segmentation(seg_map: np.ndarray) -> np.ndarray:
    colored = np.zeros((*seg_map.shape, 3), dtype=np.uint8)
    for class_id, color in FASHN_COLORS.items():
        colored[seg_map == class_id] = color
    return colored


def _bbox_from_mask(mask: np.ndarray) -> list[int] | None:
    ys, xs = np.where(mask > 127)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def _clip_box(box, width: int, height: int) -> list[int] | None:
    if box is None or len(box) != 4:
        return None
    x1 = max(0, min(width - 1, int(np.floor(box[0]))))
    y1 = max(0, min(height - 1, int(np.floor(box[1]))))
    x2 = max(x1 + 1, min(width, int(np.ceil(box[2]))))
    y2 = max(y1 + 1, min(height, int(np.ceil(box[3]))))
    return [x1, y1, x2, y2]


def _box_area(box: list[int]) -> int:
    return max(1, (box[2] - box[0]) * (box[3] - box[1]))


def _union_boxes(first: list[int], second: list[int]) -> list[int]:
    return [
        min(first[0], second[0]),
        min(first[1], second[1]),
        max(first[2], second[2]),
        max(first[3], second[3]),
    ]


def _pad_box(box: list[int], width: int, height: int, ratio: float = 0.15) -> list[int]:
    box_width = box[2] - box[0]
    box_height = box[3] - box[1]
    pad_x = max(4, int(round(box_width * ratio)))
    pad_y = max(4, int(round(box_height * ratio)))
    return [
        max(0, box[0] - pad_x),
        max(0, box[1] - pad_y),
        min(width, box[2] + pad_x),
        min(height, box[3] + pad_y),
    ]


def _square_crop(image: Image.Image, box: list[int], fill) -> Image.Image:
    x1, y1, x2, y2 = box
    width = max(1, x2 - x1)
    height = max(1, y2 - y1)
    side = max(width, height)
    crop = image.crop((x1, y1, x2, y2))
    canvas = Image.new(image.mode, (side, side), fill)
    canvas.paste(crop, ((side - width) // 2, (side - height) // 2))
    return canvas


def _run_grounding_dino(image: Image.Image, queries: list[str]) -> list[dict[str, Any]]:
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor, model = _load_grounding_dino()
    model = model.to(device)
    prompt = " . ".join(queries) + " ."
    print(f"[VisualSearchTest] GroundingDINO prompt: {prompt}")

    inputs = processor(images=image, text=prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    result = processor.post_process_grounded_object_detection(
        outputs,
        inputs.input_ids,
        threshold=0.35,
        text_threshold=0.25,
        target_sizes=[image.size[::-1]],
    )[0]

    labels = result.get("text_labels")
    if labels is None:
        # Transformers versions before 4.51 returned text names in `labels`.
        labels = result["labels"]

    detections = []
    for box, label, score in zip(result["boxes"], labels, result["scores"]):
        label_text = str(label)
        if not any(query.lower() in label_text.lower() for query in queries):
            continue
        clipped = _clip_box(box.detach().cpu().tolist(), image.width, image.height)
        if clipped is None:
            continue
        detections.append({
            "box": clipped,
            "label": label_text,
            "score": round(float(score.detach().cpu()), 4),
        })
    detections.sort(key=lambda item: item["score"], reverse=True)
    return detections


def _score_detections(
    detections: list[dict[str, Any]],
    target_mask: np.ndarray,
    fashn_box: list[int] | None,
) -> tuple[list[dict[str, Any]], int | None]:
    mask_pixels = max(1, int((target_mask > 127).sum()))
    fashn_area = _box_area(fashn_box) if fashn_box else 0
    best_index = None
    best_overlap_score = -1.0

    for index, detection in enumerate(detections):
        x1, y1, x2, y2 = detection["box"]
        overlap_pixels = int((target_mask[y1:y2, x1:x2] > 127).sum())
        box_area = _box_area(detection["box"])
        mask_coverage = overlap_pixels / mask_pixels if fashn_box else 0.0
        box_precision = overlap_pixels / box_area if fashn_box else 0.0
        area_ratio = box_area / fashn_area if fashn_area else None
        overlap_score = mask_coverage + box_precision
        eligible = fashn_box is None or (
            overlap_pixels > 0 and area_ratio is not None and area_ratio <= 4.0
        )
        detection.update({
            "overlapPixels": overlap_pixels,
            "maskCoverage": round(mask_coverage, 4),
            "boxPrecision": round(box_precision, 4),
            "areaRatioToFashnBox": round(area_ratio, 4) if area_ratio is not None else None,
            "eligible": eligible,
        })

        selection_score = overlap_score if fashn_box else detection["score"]
        if eligible and selection_score > best_overlap_score:
            best_overlap_score = selection_score
            best_index = index

    for index, detection in enumerate(detections):
        detection["selected"] = index == best_index
    return detections, best_index


def _draw_box_overlay(
    image: Image.Image,
    detections: list[dict[str, Any]],
    fashn_box: list[int] | None,
    final_box: list[int],
) -> Image.Image:
    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for detection in detections:
        color = (255, 128, 0) if detection["selected"] else (255, 215, 0)
        width = 5 if detection["selected"] else 2
        draw.rectangle(detection["box"], outline=color, width=width)
        label = f'{detection["label"]} {detection["score"]:.2f}'
        draw.text((detection["box"][0] + 4, detection["box"][1] + 4), label, fill=color)
    if fashn_box:
        draw.rectangle(fashn_box, outline=(0, 220, 255), width=4)
    draw.rectangle(final_box, outline=(255, 0, 255), width=5)
    return overlay


def _overlay_mask(image: np.ndarray, mask: np.ndarray, color=(0, 255, 255)) -> np.ndarray:
    result = image.astype(np.float32).copy()
    selected = mask > 127
    result[selected] = result[selected] * 0.55 + np.array(color, dtype=np.float32) * 0.45
    return np.clip(result, 0, 255).astype(np.uint8)


def run_fashn_gdino_diagnostics(
    image_path: str,
    category: str,
    output_dir: str,
) -> dict[str, Any]:
    if category not in CATEGORY_CONFIG:
        raise ValueError("category must be upper, lower, or shoes")
    os.makedirs(output_dir, exist_ok=True)

    source = Image.open(image_path).convert("RGB")
    source_array = np.array(source)
    height, width = source_array.shape[:2]
    artifacts: dict[str, str] = {}

    artifacts["source"] = _save_rgb(source_array, os.path.join(output_dir, "00_source.png"))

    fashn_started = time.perf_counter()
    parser = _get_fashn_parser()
    seg_map = np.asarray(parser.predict(source_array))
    if seg_map.shape != (height, width):
        seg_map = np.array(
            Image.fromarray(seg_map.astype(np.uint8), mode="L").resize(
                (width, height),
                resample=Image.Resampling.NEAREST,
            )
        )
    fashn_ms = round((time.perf_counter() - fashn_started) * 1000)

    raw_class_map_path = os.path.join(output_dir, "01_fashn_class_map.png")
    Image.fromarray(seg_map.astype(np.uint8), mode="L").save(raw_class_map_path, format="PNG")
    artifacts["fashnClassMap"] = raw_class_map_path
    artifacts["fashnColored"] = _save_rgb(
        _colorize_segmentation(seg_map),
        os.path.join(output_dir, "02_fashn_colored.png"),
    )

    target_classes = CATEGORY_CONFIG[category]["fashn_classes"]
    target_mask = np.isin(seg_map, target_classes).astype(np.uint8) * 255
    foreground_mask = (seg_map != 0).astype(np.uint8) * 255
    artifacts["fashnTargetMask"] = _save_mask(
        target_mask,
        os.path.join(output_dir, "03_fashn_target_mask.png"),
    )
    artifacts["fashnTargetOverlay"] = _save_rgb(
        _overlay_mask(source_array, target_mask),
        os.path.join(output_dir, "04_fashn_target_overlay.png"),
    )
    artifacts["fashnForegroundMask"] = _save_mask(
        foreground_mask,
        os.path.join(output_dir, "05_fashn_foreground_mask.png"),
    )

    target_pixels = int((target_mask > 127).sum())
    minimum_target_pixels = max(256, int(width * height * 0.0005))
    fashn_usable = target_pixels >= minimum_target_pixels
    fashn_box = _bbox_from_mask(target_mask) if fashn_usable else None
    dino_started = time.perf_counter()
    detections = _run_grounding_dino(source, CATEGORY_CONFIG[category]["dino_queries"])
    grounding_dino_ms = round((time.perf_counter() - dino_started) * 1000)
    detections, selected_index = _score_detections(detections, target_mask, fashn_box)
    selected_dino_box = detections[selected_index]["box"] if selected_index is not None else None

    if fashn_box and selected_dino_box:
        unpadded_box = _union_boxes(fashn_box, selected_dino_box)
        box_source = "fashn_union_dino"
    elif fashn_box:
        unpadded_box = fashn_box
        box_source = "fashn_only"
    elif selected_dino_box:
        unpadded_box = selected_dino_box
        box_source = "dino_only"
    else:
        raise RuntimeError(f"Neither FASHN nor GroundingDINO detected a {category} garment")

    final_box = _pad_box(unpadded_box, width, height)
    box_overlay = _draw_box_overlay(source, detections, fashn_box, final_box)
    box_overlay_path = os.path.join(output_dir, "06_detection_boxes.png")
    box_overlay.save(box_overlay_path, format="PNG")
    artifacts["detectionBoxes"] = box_overlay_path

    original_crop = _square_crop(source, final_box, fill=(255, 255, 255))
    original_crop_path = os.path.join(output_dir, "07_original_crop.png")
    original_crop.save(original_crop_path, format="PNG")
    artifacts["originalCrop"] = original_crop_path

    foreground_composite = np.full_like(source_array, 255)
    foreground_composite[foreground_mask > 127] = source_array[foreground_mask > 127]
    foreground_crop = _square_crop(
        Image.fromarray(foreground_composite, mode="RGB"),
        final_box,
        fill=(255, 255, 255),
    )
    foreground_crop_path = os.path.join(output_dir, "08_fashn_foreground_crop.png")
    foreground_crop.save(foreground_crop_path, format="PNG")
    artifacts["fashnForegroundCrop"] = foreground_crop_path

    target_composite = np.full_like(source_array, 255)
    target_composite[target_mask > 127] = source_array[target_mask > 127]
    target_crop = _square_crop(
        Image.fromarray(target_composite, mode="RGB"),
        final_box,
        fill=(255, 255, 255),
    )
    target_crop_path = os.path.join(output_dir, "09_fashn_target_only_crop.png")
    target_crop.save(target_crop_path, format="PNG")
    artifacts["fashnTargetOnlyCrop"] = target_crop_path

    foreground_mask_crop = _square_crop(
        Image.fromarray(foreground_mask, mode="L"),
        final_box,
        fill=0,
    )
    foreground_mask_crop_path = os.path.join(output_dir, "10_fashn_foreground_mask_crop.png")
    foreground_mask_crop.save(foreground_mask_crop_path, format="PNG")
    artifacts["fashnForegroundMaskCrop"] = foreground_mask_crop_path

    class_counts = {
        FASHN_LABELS[class_id]: int((seg_map == class_id).sum())
        for class_id in sorted(FASHN_LABELS)
        if np.any(seg_map == class_id)
    }
    foreground_pixels = int((foreground_mask > 127).sum())

    return {
        "imageSize": {"width": width, "height": height},
        "targetClasses": [
            {"id": class_id, "label": FASHN_LABELS[class_id]}
            for class_id in target_classes
        ],
        "classPixelCounts": class_counts,
        "fashn": {
            "targetPixels": target_pixels,
            "minimumTargetPixels": minimum_target_pixels,
            "usable": fashn_usable,
            "targetCoverage": round(target_pixels / (width * height), 6),
            "foregroundPixels": foreground_pixels,
            "foregroundCoverage": round(foreground_pixels / (width * height), 6),
            "box": fashn_box,
        },
        "groundingDino": {
            "queries": CATEGORY_CONFIG[category]["dino_queries"],
            "detections": detections,
            "selectedIndex": selected_index,
        },
        "finalBox": final_box,
        "boxSource": box_source,
        "stageTimingsMs": {
            "fashn": fashn_ms,
            "groundingDino": grounding_dino_ms,
        },
        "artifacts": artifacts,
    }
