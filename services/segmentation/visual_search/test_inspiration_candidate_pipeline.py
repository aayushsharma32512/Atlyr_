import base64
import io
import unittest

import numpy as np
from PIL import Image

from visual_search.inspiration_candidate_pipeline import (
    MAX_CROP_EDGE,
    _deduplicate,
    _encode_webp,
    _partition_component_by_scopes,
)


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
