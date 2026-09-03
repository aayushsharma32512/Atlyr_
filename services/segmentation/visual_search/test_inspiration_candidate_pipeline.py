import base64
import io
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from visual_search.inspiration_candidate_pipeline import (
    MAX_CROP_EDGE,
    _deduplicate,
    _encode_webp,
    _group_same_person_fashn_fragments,
    _partition_component_by_scopes,
    run_inspiration_candidate_detection,
)


class ExifOrientationTest(unittest.TestCase):
    def test_normalizes_exif_orientation_before_running_models(self):
        class Parser:
            received_shape: tuple[int, ...] | None = None

            def predict(self, source: np.ndarray) -> np.ndarray:
                self.received_shape = source.shape
                return np.zeros(source.shape[:2], dtype=np.uint8)

        parser = Parser()
        dino_sizes: list[tuple[int, int]] = []

        def run_dino(source: Image.Image, _queries: list[str]) -> list[dict]:
            dino_sizes.append(source.size)
            return []

        # EXIF orientation 6 means the stored 4x2 pixels should display after a
        # 90-degree clockwise rotation, producing an upright 2x4 image.
        source = Image.new("RGB", (4, 2), (120, 80, 40))
        exif = Image.Exif()
        exif[274] = 6

        with tempfile.NamedTemporaryFile(suffix=".jpg") as image_file:
            source.save(image_file.name, exif=exif)
            with (
                patch(
                    "visual_search.inspiration_candidate_pipeline._get_fashn_parser",
                    return_value=parser,
                ),
                patch(
                    "visual_search.inspiration_candidate_pipeline._run_grounding_dino",
                    side_effect=run_dino,
                ),
            ):
                result = run_inspiration_candidate_detection(image_file.name)

        self.assertEqual(parser.received_shape, (4, 2, 3))
        self.assertEqual(dino_sizes, [(2, 4)])
        self.assertEqual(result["imageSize"], {"width": 2, "height": 4})


class EncodeWebpTest(unittest.TestCase):
    def decode(self, encoded: str) -> tuple[bytes, Image.Image]:
        payload = base64.b64decode(encoded)
        return payload, Image.open(io.BytesIO(payload))

    def test_encodes_crop_smaller_than_previous_minimum(self):
        image = Image.new("RGB", (192, 192), (120, 80, 40))

        payload, decoded = self.decode(_encode_webp(image))

        self.assertLessEqual(len(payload), 500 * 1024)
        self.assertEqual(decoded.size, image.size)

    def test_bounds_large_noisy_crop_for_callback(self):
        random_pixels = np.random.default_rng(7).integers(
            0,
            256,
            size=(1600, 1600, 3),
            dtype=np.uint8,
        )
        image = Image.fromarray(random_pixels, mode="RGB")

        payload, decoded = self.decode(_encode_webp(image))

        self.assertLessEqual(len(payload), 500 * 1024)
        self.assertLessEqual(max(decoded.size), MAX_CROP_EDGE)


class DeduplicateCandidatesTest(unittest.TestCase):
    @staticmethod
    def candidate(
        category: str,
        confidence: float,
        box: list[int],
        scope_id: str | None = None,
    ) -> dict:
        return {
            "category": category,
            "confidence": confidence,
            "box": box,
            "_scopeId": scope_id,
        }

    def test_suppresses_nested_fragment_even_when_fragment_scores_higher(self):
        complete_top = self.candidate("top", 0.56, [100, 100, 220, 260])
        fragment = self.candidate("top", 0.62, [115, 115, 155, 175])

        result = _deduplicate([fragment, complete_top])

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["box"], complete_top["box"])
        self.assertEqual(result[0]["confidence"], fragment["confidence"])
        self.assertEqual(result[0]["metrics"]["mergedFragmentCount"], 1)

    def test_merges_partially_overlapping_occluded_fragment(self):
        # Mirrors the two fresh production candidates that exposed the issue:
        # the upper fragment is not contained, but 62% of it overlaps the main
        # garment box and it is less than one third of the main box's area.
        complete_top = self.candidate("top", 0.56, [155, 264, 450, 514])
        upper_fragment = self.candidate("top", 0.52, [163, 200, 292, 366])

        result = _deduplicate([complete_top, upper_fragment])

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["box"], [155, 200, 450, 514])
        self.assertEqual(result[0]["metrics"]["mergedFragmentCount"], 1)

    def test_keeps_separate_garments_of_the_same_category(self):
        first_top = self.candidate("top", 0.71, [20, 30, 100, 160])
        second_top = self.candidate("top", 0.68, [180, 25, 270, 165])

        result = _deduplicate([first_top, second_top])

        self.assertEqual(result, [first_top, second_top])

    def test_keeps_nested_boxes_from_different_categories(self):
        top = self.candidate("top", 0.70, [90, 60, 210, 250])
        bottom = self.candidate("bottom", 0.65, [110, 150, 190, 230])

        result = _deduplicate([top, bottom])

        self.assertEqual(result, [top, bottom])

    def test_iou_suppression_still_prefers_confidence_for_similar_boxes(self):
        stronger = self.candidate("top", 0.78, [100, 100, 200, 240])
        weaker = self.candidate("top", 0.66, [105, 105, 205, 245])

        result = _deduplicate([weaker, stronger])

        self.assertEqual(result, [stronger])

    def test_keeps_overlapping_candidates_for_different_people(self):
        first_top = self.candidate("top", 0.78, [100, 100, 210, 250], "person:0")
        second_top = self.candidate("top", 0.72, [105, 105, 215, 255], "person:1")

        result = _deduplicate([first_top, second_top])

        self.assertEqual(result, [first_top, second_top])


class GroupSamePersonFashnFragmentsTest(unittest.TestCase):
    @staticmethod
    def candidate(
        box: list[int],
        component_box: list[int],
        pixels: int,
        lab: tuple[float, float, float],
        scope_id: str = "person:0",
    ) -> dict:
        return {
            "category": "top",
            "label": "top",
            "confidence": 0.55,
            "box": box,
            "boxSource": "fashn_only",
            "metrics": {"componentPixels": pixels, "personScoped": True},
            "_scopeId": scope_id,
            "_scopeBox": [100, 150, 370, 600],
            "_componentBox": component_box,
            "_componentPixels": pixels,
            "_componentLab": lab,
            "_rawBox": component_box,
        }

    def test_groups_same_person_sleeves_before_padding(self):
        torso = self.candidate(
            [164, 239, 312, 446],
            [181, 263, 295, 422],
            13_369,
            (48.0, 62.0, 39.0),
        )
        right_sleeve = self.candidate(
            [267, 229, 346, 513],
            [276, 262, 337, 480],
            5_233,
            (49.0, 61.0, 40.0),
        )
        left_cuff = self.candidate(
            [136, 307, 173, 392],
            [140, 311, 169, 388],
            1_265,
            (47.0, 63.0, 38.0),
        )

        result = _group_same_person_fashn_fragments(
            [right_sleeve, left_cuff, torso],
            width=474,
            height=843,
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["_rawBox"], [140, 262, 337, 480])
        self.assertEqual(result[0]["box"], [110, 229, 367, 513])
        self.assertEqual(result[0]["metrics"]["componentPixels"], 19_867)
        self.assertEqual(result[0]["metrics"]["mergedFragmentCount"], 2)
        self.assertEqual(
            result[0]["metrics"]["fragmentGrouping"],
            "same_person_geometry_color",
        )

    def test_keeps_central_layer_separate(self):
        torso = self.candidate(
            [85, 80, 215, 270],
            [100, 100, 200, 250],
            10_000,
            (50.0, 20.0, 10.0),
        )
        central_layer = self.candidate(
            [115, 115, 185, 235],
            [130, 130, 170, 220],
            3_000,
            (51.0, 20.0, 10.0),
        )

        grouped = _group_same_person_fashn_fragments(
            [torso, central_layer],
            width=400,
            height=600,
        )
        result = _deduplicate(grouped)

        self.assertEqual(len(result), 2)

    def test_keeps_different_colored_lateral_garment_separate(self):
        torso = self.candidate(
            [85, 80, 215, 270],
            [100, 100, 200, 250],
            10_000,
            (50.0, 65.0, 40.0),
        )
        lateral_layer = self.candidate(
            [185, 90, 260, 275],
            [195, 110, 245, 255],
            4_000,
            (35.0, -5.0, -35.0),
        )

        grouped = _group_same_person_fashn_fragments(
            [torso, lateral_layer],
            width=400,
            height=600,
        )
        result = _deduplicate(grouped)

        self.assertEqual(len(result), 2)


class ComponentPartitionTest(unittest.TestCase):
    def test_splits_one_connected_fashn_region_across_people(self):
        component = np.zeros((180, 300), dtype=bool)
        component[40:140, 10:290] = True
        scopes = [
            {"id": "person:0", "box": [0, 0, 100, 180]},
            {"id": "person:1", "box": [100, 0, 200, 180]},
            {"id": "person:2", "box": [200, 0, 300, 180]},
        ]

        parts = _partition_component_by_scopes(component, scopes, minimum_pixels=100)

        self.assertEqual([scope_id for _, scope_id, _ in parts], [
            "person:0",
            "person:1",
            "person:2",
        ])
        self.assertEqual(sum(int(mask.sum()) for mask, _, _ in parts), int(component.sum()))
        for mask, _, scope_box in parts:
            ys, xs = np.where(mask)
            self.assertGreater(len(xs), 0)
            self.assertGreaterEqual(int(xs.min()), scope_box[0])
            self.assertLess(int(xs.max()), scope_box[2])

    def test_leaves_component_unscoped_when_person_overlap_is_weak(self):
        component = np.zeros((200, 300), dtype=bool)
        component[20:180, 20:280] = True
        scopes = [{"id": "person:0", "box": [0, 0, 80, 200]}]

        parts = _partition_component_by_scopes(component, scopes, minimum_pixels=100)

        self.assertEqual(len(parts), 1)
        self.assertIsNone(parts[0][1])
        np.testing.assert_array_equal(parts[0][0], component)


if __name__ == "__main__":
    unittest.main()
