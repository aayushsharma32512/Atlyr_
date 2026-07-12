import os
import sys
import cv2
import numpy as np
from PIL import Image

# Ensure the root services/segmentation is in path
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from fashn_human_parser import FashnHumanParser
from ..types import SegmentationStepInput, SegmentationStepOutput
from ..registry import register_adapter
from experiment_segmentation import colorize_segmentation, extract_class_mask

# Local definitions for category resolution matching production improved pipeline
GARMENT_CLASSES_LOCAL = {
    "top": [3],
    "dress": [4],
    "skirt": [5],
    "pants": [6],
    "footwear": [8, 9, 15],
}

FASHN_GARMENT_CLASSES = {
    "top": [3, 7, 10, 11],
    "dress": [4, 7, 10, 11],
    "pants": [6, 7],
    "skirt": [5, 7],
    "footwear": [8, 9, 15],
}

FASHN_EXCLUSION_CLASSES = {
    "top": [1, 2, 12, 13, 14, 16],
    "dress": [1, 2, 12, 13, 14, 16],
    "pants": [1, 2, 12, 13, 14, 16],
    "skirt": [1, 2, 12, 13, 14, 16],
    "footwear": [1, 2, 12, 13, 16],
}

_PARSER_CACHE = None

def get_parser():
    global _PARSER_CACHE
    if _PARSER_CACHE is None:
        print("[FASHN] Loading FASHN SegFormer-B4 parser model weights...")
        _PARSER_CACHE = FashnHumanParser()
    return _PARSER_CACHE

class FashnSegAdapter:
    name = "fashn_seg"

    def validate(self, step_input: SegmentationStepInput) -> None:
        if not os.path.exists(step_input.image_path):
            raise FileNotFoundError(f"Input image not found: {step_input.image_path}")

    def run(self, step_input: SegmentationStepInput) -> SegmentationStepOutput:
        img_bgr = cv2.imread(step_input.image_path)
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        
        parser = get_parser()
        seg_map = parser.predict(img_rgb)
        
        # Dynamically resolve garment category
        category = "top"
        best_area = 0
        for cat, class_ids in GARMENT_CLASSES_LOCAL.items():
            mask = extract_class_mask(seg_map, class_ids)
            area = mask.sum() // 255
            if area > best_area:
                best_area = area
                category = cat
                
        print(f"  [Fashn] Resolved category: {category}")
        
        # Build garment coarse prior mask
        fashn_g_ids = FASHN_GARMENT_CLASSES.get(category, [3])
        coarse_garment_mask = extract_class_mask(seg_map, fashn_g_ids)
        
        # Build exclusion mask
        fashn_s_ids = FASHN_EXCLUSION_CLASSES.get(category, [1, 2, 12, 13, 14, 16])
        exclusion_mask = extract_class_mask(seg_map, fashn_s_ids)
        
        # Save step results
        seg_map_path = os.path.join(step_input.output_dir, "02_fashn_seg_map.png")
        garment_mask_path = os.path.join(step_input.output_dir, "02_fashn_garment.png")
        exclusion_mask_path = os.path.join(step_input.output_dir, "02_fashn_exclusion.png")
        colored_seg_path = os.path.join(step_input.output_dir, "02_fashn_seg_colored.png")
        
        cv2.imwrite(seg_map_path, seg_map.astype(np.uint8))
        cv2.imwrite(garment_mask_path, coarse_garment_mask)
        cv2.imwrite(exclusion_mask_path, exclusion_mask)
        
        colored_seg = colorize_segmentation(seg_map)
        cv2.imwrite(colored_seg_path, colored_seg)
        
        return SegmentationStepOutput(
            step_name=self.name,
            output_path=garment_mask_path,
            mask_path=exclusion_mask_path,
            metadata={
                "category": category,
                "seg_map_path": seg_map_path,
                "colored_seg_path": colored_seg_path
            }
        )

# Register adapter
register_adapter("fashn_seg", FashnSegAdapter)
