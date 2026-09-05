"""Multi-candidate FASHN + GroundingDINO localization for Inspiration Import.

This module deliberately keeps contextual foreground pixels for retrieval. It
does not use SAM/SAM2, remove skin, generate embeddings, or write remote state.
"""

from __future__ import annotations

import base64
import io
import time
from typing import Any

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

from visual_search.fashn_gdino_pipeline import (
    CATEGORY_CONFIG,
    _bbox_from_mask,
    _box_area,
    _clip_box,
    _get_fashn_parser,
    _pad_box,
    _run_grounding_dino,
    _square_crop,
    _union_boxes,
)


CATEGORY_CLASSES = {"top": [3], "bottom": [5, 6]}
CATEGORY_QUERIES = {
    "top": CATEGORY_CONFIG["upper"]["dino_queries"],
    "bottom": CATEGORY_CONFIG["lower"]["dino_queries"],
}
PERSON_QUERY = "person"
MAX_CROP_EDGE = 512


def _category_for_label(label: str) -> str | None:
    normalized = label.lower()
    for category, queries in CATEGORY_QUERIES.items():
        if any(query in normalized for query in queries):
            return category
    return None


def _component_masks(mask: np.ndarray, minimum_pixels: int) -> list[np.ndarray]:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    components = []
    for component_id in range(1, count + 1):
        component = labels == component_id
        if int(component.sum()) >= minimum_pixels:
            components.append(component)
    return components


def _intersection_area(first: list[int], second: list[int]) -> int:
    x1 = max(first[0], second[0])
    y1 = max(first[1], second[1])
    x2 = min(first[2], second[2])
    y2 = min(first[3], second[3])
    return max(0, x2 - x1) * max(0, y2 - y1)


def _iou(first: list[int], second: list[int]) -> float:
    intersection = _intersection_area(first, second)
    if not intersection:
        return 0.0
    return intersection / (_box_area(first) + _box_area(second) - intersection)


def _intersection_over_smaller(first: list[int], second: list[int]) -> float:
    """Return how completely the smaller box is contained by the larger one."""
    intersection = _intersection_area(first, second)
    if not intersection:
        return 0.0
    return intersection / min(_box_area(first), _box_area(second))


def _intersection_box(first: list[int], second: list[int]) -> list[int] | None:
    box = [
        max(first[0], second[0]),
        max(first[1], second[1]),
        min(first[2], second[2]),
        min(first[3], second[3]),
    ]
    return box if box[0] < box[2] and box[1] < box[3] else None


def _deduplicate_detections(
    detections: list[dict[str, Any]],
    iou_threshold: float = 0.65,
) -> list[dict[str, Any]]:
    kept = []
    for detection in sorted(detections, key=lambda item: item["score"], reverse=True):
        if any(_iou(detection["box"], existing["box"]) >= iou_threshold for existing in kept):
            continue
        kept.append(detection)
    return kept


def _person_scopes(
    detections: list[dict[str, Any]],
    width: int,
    height: int,
) -> list[dict[str, Any]]:
    people = _deduplicate_detections([
        detection
        for detection in detections
        if PERSON_QUERY in detection["label"].lower()
    ])
    return [
        {
            "id": f"person:{index}",
            "box": _pad_box(detection["box"], width, height, ratio=0.05),
        }
        for index, detection in enumerate(people)
    ]


def _partition_component_by_scopes(
    component: np.ndarray,
    scopes: list[dict[str, Any]],
    minimum_pixels: int,
) -> list[tuple[np.ndarray, str | None, list[int] | None]]:
    """Partition a FASHN component that connects garments on nearby people."""
    if not scopes:
        return [(component, None, None)]

    ys, xs = np.where(component)
    component_pixels = len(xs)
    matching = []
    for scope in scopes:
        x1, y1, x2, y2 = scope["box"]
        inside = (xs >= x1) & (xs < x2) & (ys >= y1) & (ys < y2)
        overlap = int(inside.sum())
        if overlap >= minimum_pixels:
            matching.append({**scope, "inside": inside, "overlap": overlap})

    if not matching:
        return [(component, None, None)]

    if len(matching) == 1:
        scope = matching[0]
        if scope["overlap"] / component_pixels < 0.5:
            return [(component, None, None)]
        scoped = np.zeros_like(component, dtype=bool)
        scoped[ys[scope["inside"]], xs[scope["inside"]]] = True
        return [(scoped, scope["id"], scope["box"])]

    assignments = np.full(component_pixels, -1, dtype=np.int16)
    best_distance = np.full(component_pixels, np.inf, dtype=np.float32)
    for scope_index, scope in enumerate(matching):
        x1, y1, x2, y2 = scope["box"]
        half_width = max(1.0, (x2 - x1) / 2)
        half_height = max(1.0, (y2 - y1) / 2)
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        distance = ((xs - center_x) / half_width) ** 2 + ((ys - center_y) / half_height) ** 2
        update = scope["inside"] & (distance < best_distance)
        assignments[update] = scope_index
        best_distance[update] = distance[update]

    partitions = []
    for scope_index, scope in enumerate(matching):
        selected = assignments == scope_index
        if int(selected.sum()) < minimum_pixels:
            continue
        scoped = np.zeros_like(component, dtype=bool)
        scoped[ys[selected], xs[selected]] = True
        partitions.append((scoped, scope["id"], scope["box"]))
    return partitions or [(component, None, None)]


def _encode_webp(
    image: Image.Image,
    max_bytes: int = 500 * 1024,
    max_edge: int = MAX_CROP_EDGE,
) -> str:
    """Encode every crop within the callback and downstream Lens limits."""
    working = image.convert("RGB")
    working.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    quality = 88
    while True:
        output = io.BytesIO()
        working.save(output, format="WEBP", quality=quality, method=6)
        if output.tell() <= max_bytes:
            return base64.b64encode(output.getvalue()).decode("ascii")
        if quality > 48:
            quality -= 10
            continue

        next_size = (
            max(1, round(working.width * 0.82)),
            max(1, round(working.height * 0.82)),
        )
        if next_size == working.size:
            raise ValueError("Candidate crop cannot be encoded below 500 KB")
        working = working.resize(next_size, Image.Resampling.LANCZOS)
        quality = 78


def _normalized_box(box: list[int], width: int, height: int) -> dict[str, float]:
    return {
        "l": round(box[0] / width, 6),
        "t": round(box[1] / height, 6),
        "w": round((box[2] - box[0]) / width, 6),
        "h": round((box[3] - box[1]) / height, 6),
    }


def _median_component_lab(
    source: np.ndarray,
    component: np.ndarray,
) -> tuple[float, float, float]:
    """Return a robust perceptual color summary for one FASHN component."""
    median_rgb = np.median(source[component], axis=0).astype(np.float64) / 255.0
    linear_rgb = np.where(
        median_rgb <= 0.04045,
        median_rgb / 12.92,
        ((median_rgb + 0.055) / 1.055) ** 2.4,
    )
    x, y, z = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]) @ linear_rgb
    normalized = np.array([x / 0.95047, y, z / 1.08883])
    delta = 6 / 29
    transformed = np.where(
        normalized > delta ** 3,
        np.cbrt(normalized),
        normalized / (3 * delta ** 2) + 4 / 29,
    )
    return (
        float(116 * transformed[1] - 16),
        float(500 * (transformed[0] - transformed[1])),
        float(200 * (transformed[1] - transformed[2])),
    )


def _lab_distance(first: tuple[float, ...], second: tuple[float, ...]) -> float:
    return float(np.linalg.norm(np.asarray(first) - np.asarray(second)))


def _vertical_overlap_over_smaller(first: list[int], second: list[int]) -> float:
    overlap = max(0, min(first[3], second[3]) - max(first[1], second[1]))
    smaller_height = min(first[3] - first[1], second[3] - second[1])
    return overlap / max(1, smaller_height)


def _horizontal_gap(first: list[int], second: list[int]) -> int:
    return max(0, first[0] - second[2], second[0] - first[2])


def _is_lateral_fragment(anchor_box: list[int], fragment_box: list[int]) -> bool:
    """Keep this fallback sleeve-shaped instead of merging central layers."""
    anchor_width = max(1, anchor_box[2] - anchor_box[0])
    fragment_center = (fragment_box[0] + fragment_box[2]) / 2
    return (
        fragment_center <= anchor_box[0] + anchor_width * 0.25
        or fragment_center >= anchor_box[2] - anchor_width * 0.25
    )


def _candidate_for_component(
    category: str,
    component: np.ndarray,
    detections: list[dict[str, Any]],
    source_array: np.ndarray,
    width: int,
    height: int,
    scope_id: str | None = None,
    scope_box: list[int] | None = None,
) -> dict[str, Any]:
    component_mask = component.astype(np.uint8) * 255
    component_box = _bbox_from_mask(component_mask)
    assert component_box is not None
    component_pixels = int(component.sum())
    component_area = _box_area(component_box)
    best = None
    best_score = -1.0

    for detection in detections:
        detection_box = detection["box"]
        if scope_box is not None:
            detection_box = _intersection_box(detection_box, scope_box)
            if detection_box is None:
                continue
        x1, y1, x2, y2 = detection_box
        overlap = int(component[y1:y2, x1:x2].sum())
        if overlap == 0:
            continue
        detector_area = _box_area(detection_box)
        area_ratio = detector_area / component_area
        if area_ratio > 4.0:
            continue
        coverage = overlap / component_pixels
        precision = overlap / detector_area
        score = coverage + precision + float(detection["score"]) * 0.5
        if score > best_score:
            best_score = score
            best = {
                "detection": {**detection, "box": detection_box},
                "overlapPixels": overlap,
                "maskCoverage": coverage,
                "boxPrecision": precision,
                "areaRatioToFashnBox": area_ratio,
            }

    if best:
        unpadded = _union_boxes(component_box, best["detection"]["box"])
        box_source = "fashn_union_dino"
        label = best["detection"]["label"]
        confidence = min(1.0, float(best["detection"]["score"]) * 0.65 + min(1.0, best_score / 2) * 0.35)
        metrics = {key: round(value, 5) if isinstance(value, float) else value for key, value in best.items() if key != "detection"}
    else:
        unpadded = component_box
        box_source = "fashn_only"
        label = category
        confidence = min(0.82, 0.5 + component_pixels / (width * height) * 3)
        metrics = {"componentPixels": component_pixels}

    if scope_id is not None:
        metrics["personScoped"] = True

    return {
        "category": category,
        "label": label,
        "confidence": round(confidence, 4),
        "box": _pad_box(unpadded, width, height),
        "boxSource": box_source,
        "metrics": metrics,
        "_scopeId": scope_id,
        "_scopeBox": scope_box,
        "_componentBox": component_box,
        "_componentPixels": component_pixels,
        "_componentLab": _median_component_lab(source_array, component),
        "_rawBox": unpadded,
    }


def _is_same_person_fashn_fragment(
    anchor: dict[str, Any],
    fragment: dict[str, Any],
    image_width: int,
    max_component_pixel_ratio: float,
    max_horizontal_gap_ratio: float,
    min_vertical_overlap: float,
    max_color_distance: float,
) -> tuple[bool, float]:
    if (
        anchor["category"] != "top"
        or fragment["category"] != anchor["category"]
        or anchor.get("boxSource") != "fashn_only"
        or fragment.get("boxSource") != "fashn_only"
        or anchor.get("_scopeId") is None
        or fragment.get("_scopeId") != anchor.get("_scopeId")
    ):
        return False, float("inf")

    anchor_pixels = max(1, int(anchor.get("_componentPixels", 0)))
    fragment_pixels = int(fragment.get("_componentPixels", 0))
    if not fragment_pixels or fragment_pixels / anchor_pixels > max_component_pixel_ratio:
        return False, float("inf")

    anchor_box = anchor.get("_componentBox")
    fragment_box = fragment.get("_componentBox")
    anchor_lab = anchor.get("_componentLab")
    fragment_lab = fragment.get("_componentLab")
    if not anchor_box or not fragment_box or anchor_lab is None or fragment_lab is None:
        return False, float("inf")

    scope_box = anchor.get("_scopeBox")
    person_width = (scope_box[2] - scope_box[0]) if scope_box else image_width
    maximum_gap = max(4, round(person_width * max_horizontal_gap_ratio))
    color_distance = _lab_distance(anchor_lab, fragment_lab)
    matches = (
        _horizontal_gap(anchor_box, fragment_box) <= maximum_gap
        and _vertical_overlap_over_smaller(anchor_box, fragment_box) >= min_vertical_overlap
        and _is_lateral_fragment(anchor_box, fragment_box)
        and color_distance <= max_color_distance
    )
    return matches, color_distance


def _group_same_person_fashn_fragments(
    candidates: list[dict[str, Any]],
    width: int,
    height: int,
    max_component_pixel_ratio: float = 0.6,
    max_horizontal_gap_ratio: float = 0.08,
    min_vertical_overlap: float = 0.35,
    max_color_distance: float = 18.0,
) -> list[dict[str, Any]]:
    """Reconnect FASHN top regions split by arms, hands, hair, or accessories.

    GroundingDINO remains the preferred garment-instance signal. This fallback
    only groups lateral, similarly colored FASHN-only regions on the same
    detected person. Geometry is measured on raw component boxes and padding is
    applied once after the union.
    """
    grouped: list[dict[str, Any]] = []
    ordered = sorted(
        candidates,
        key=lambda item: int(item.get("_componentPixels", 0)),
        reverse=True,
    )
    for candidate in ordered:
        match = None
        match_color_distance = float("inf")
        for index, existing in enumerate(grouped):
            matches, color_distance = _is_same_person_fashn_fragment(
                existing,
                candidate,
                width,
                max_component_pixel_ratio,
                max_horizontal_gap_ratio,
                min_vertical_overlap,
                max_color_distance,
            )
            if matches and color_distance < match_color_distance:
                match = index
                match_color_distance = color_distance

        if match is None:
            grouped.append(dict(candidate))
            continue

        existing = grouped[match]
        existing_pixels = int(existing["_componentPixels"])
        fragment_pixels = int(candidate["_componentPixels"])
        total_pixels = existing_pixels + fragment_pixels
        combined_lab = tuple(
            (
                existing["_componentLab"][channel] * existing_pixels
                + candidate["_componentLab"][channel] * fragment_pixels
            ) / total_pixels
            for channel in range(3)
        )
        raw_box = _union_boxes(existing["_rawBox"], candidate["_rawBox"])
        merged_metrics = dict(existing.get("metrics", {}))
        merged_metrics.update({
            "componentPixels": total_pixels,
            "mergedFragmentCount": int(merged_metrics.get("mergedFragmentCount", 0)) + 1,
            "fragmentGrouping": "same_person_geometry_color",
            "maxMergedColorDistance": round(max(
                float(merged_metrics.get("maxMergedColorDistance", 0)),
                match_color_distance,
            ), 3),
        })
        grouped[match] = {
            **existing,
            "confidence": max(existing["confidence"], candidate["confidence"]),
            "box": _pad_box(raw_box, width, height),
            "metrics": merged_metrics,
            "_componentPixels": total_pixels,
            "_componentLab": combined_lab,
            "_rawBox": raw_box,
        }
    return grouped


def _same_scope(first: dict[str, Any], second: dict[str, Any]) -> bool:
    first_scope = first.get("_scopeId")
    second_scope = second.get("_scopeId")
    return first_scope is None or second_scope is None or first_scope == second_scope


def _evaluated_by_fashn_fragment_grouping(candidate: dict[str, Any]) -> bool:
    return candidate.get("boxSource") == "fashn_only" and "_componentBox" in candidate


def _deduplicate(
    candidates: list[dict[str, Any]],
    iou_threshold: float = 0.65,
    fragment_overlap_threshold: float = 0.55,
    max_fragment_area_ratio: float = 0.5,
) -> list[dict[str, Any]]:
    """Suppress duplicate boxes without collapsing separate garments.

    A smaller FASHN component may be separated from the main garment by an arm
    while its padded box still overlaps the main box. Merge that fragment into
    the dominant proposal so the resulting crop contains the complete garment.
    IoU then handles similarly sized duplicate proposals.
    """
    dominant: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: _box_area(item["box"]), reverse=True):
        candidate_area = _box_area(candidate["box"])
        merge_index = next((
            index
            for index, existing in enumerate(dominant)
            if existing["category"] == candidate["category"]
            and _same_scope(existing, candidate)
            # The pre-padding grouping stage already made the higher-quality
            # geometry/color decision for raw FASHN-only components. Do not
            # override a deliberate rejection with this legacy padded-box rule.
            and not (
                _evaluated_by_fashn_fragment_grouping(existing)
                and _evaluated_by_fashn_fragment_grouping(candidate)
            )
            and candidate_area / _box_area(existing["box"]) <= max_fragment_area_ratio
            and _intersection_over_smaller(candidate["box"], existing["box"])
            >= fragment_overlap_threshold
        ), None)
        if merge_index is None:
            dominant.append(candidate)
            continue

        existing = dominant[merge_index]
        merged_metrics = dict(existing.get("metrics", {}))
        merged_metrics["mergedFragmentCount"] = int(
            merged_metrics.get("mergedFragmentCount", 0)
        ) + 1
        dominant[merge_index] = {
            **existing,
            "confidence": max(existing["confidence"], candidate["confidence"]),
            "box": _union_boxes(existing["box"], candidate["box"]),
            "metrics": merged_metrics,
        }

    kept = []
    for candidate in sorted(dominant, key=lambda item: item["confidence"], reverse=True):
        if any(
            existing["category"] == candidate["category"]
            and _same_scope(existing, candidate)
            and _iou(existing["box"], candidate["box"]) >= iou_threshold
            for existing in kept
        ):
            continue
        kept.append(candidate)
    return kept


def run_inspiration_candidate_detection(image_path: str, max_candidates: int = 12) -> dict[str, Any]:
    started = time.perf_counter()
    # Phone cameras commonly store landscape pixels plus an EXIF orientation
    # instruction. Normalize that instruction into the pixels before either
    # model sees the image so detection geometry matches what users see.
    with Image.open(image_path) as opened_source:
        source = ImageOps.exif_transpose(opened_source).convert("RGB")
    source_array = np.asarray(source)
    height, width = source_array.shape[:2]

    fashn_started = time.perf_counter()
    seg_map = np.asarray(_get_fashn_parser().predict(source_array))
    if seg_map.shape != (height, width):
        seg_map = np.asarray(
            Image.fromarray(seg_map.astype(np.uint8), mode="L").resize(
                (width, height), Image.Resampling.NEAREST
            )
        )
    fashn_ms = round((time.perf_counter() - fashn_started) * 1000)
    foreground_mask = seg_map != 0
    minimum_pixels = max(256, int(width * height * 0.0005))

    dino_started = time.perf_counter()
    all_queries = list(dict.fromkeys(
        CATEGORY_QUERIES["top"] + CATEGORY_QUERIES["bottom"] + [PERSON_QUERY]
    ))
    raw_detections = _run_grounding_dino(source, all_queries)
    scopes = _person_scopes(raw_detections, width, height)
    detections = []
    for detection in raw_detections:
        category = _category_for_label(detection["label"])
        if category:
            detections.append({**detection, "category": category})
    dino_ms = round((time.perf_counter() - dino_started) * 1000)

    candidates = []
    for category, class_ids in CATEGORY_CLASSES.items():
        category_mask = np.isin(seg_map, class_ids)
        components = _component_masks(category_mask, minimum_pixels)
        category_detections = [item for item in detections if item["category"] == category]
        for component in components:
            for scoped_component, scope_id, scope_box in _partition_component_by_scopes(
                component, scopes, minimum_pixels
            ):
                candidates.append(_candidate_for_component(
                    category,
                    scoped_component,
                    category_detections,
                    source_array,
                    width,
                    height,
                    scope_id,
                    scope_box,
                ))

        # DINO-only proposals are a fallback only when FASHN found no usable
        # component in this category. This avoids duplicating contextual boxes.
        if not components:
            for detection in category_detections:
                clipped = _clip_box(detection["box"], width, height)
                if clipped:
                    candidates.append({
                        "category": category,
                        "label": detection["label"],
                        "confidence": round(float(detection["score"]), 4),
                        "box": _pad_box(clipped, width, height),
                        "boxSource": "dino_only",
                        "metrics": {"detectorConfidence": detection["score"]},
                    })

    candidates = _group_same_person_fashn_fragments(candidates, width, height)
    candidates = _deduplicate(candidates)[:max_candidates]
    foreground_composite = np.full_like(source_array, 255)
    foreground_composite[foreground_mask] = source_array[foreground_mask]
    retrieval_source = Image.fromarray(foreground_composite, mode="RGB")

    response_candidates = []
    for candidate in candidates:
        box = candidate["box"]
        public_candidate = {
            key: value
            for key, value in candidate.items()
            if key != "box" and not key.startswith("_")
        }
        retrieval = _square_crop(retrieval_source, box, fill=(255, 255, 255))
        response_candidates.append({
            **public_candidate,
            "bbox": _normalized_box(box, width, height),
            "retrievalCropBase64": _encode_webp(retrieval),
        })

    return {
        "candidates": response_candidates,
        "imageSize": {"width": width, "height": height},
        "timingsMs": {
            "fashn": fashn_ms,
            "groundingDino": dino_ms,
            "total": round((time.perf_counter() - started) * 1000),
        },
        "constraints": {
            "usesSam2": False,
            "generatesEmbeddings": False,
            "removesSkin": False,
            "personScopes": len(scopes),
        },
    }
