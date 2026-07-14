import os
import sys
import cv2
import numpy as np

# Ensure root services/segmentation is in path
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

# Set SCHP_ROOT environment variable before imports
os.environ["SCHP_ROOT"] = os.path.join(base_dir, "Utils", "Self-Correction-Human-Parsing")

from experiment_segmentation import (
    run_schp_parsing,
    SCHP_EXCLUSION_CLASSES,
    SCHP_GARMENT_CLASSES
)
from ..types import SegmentationStepInput, SegmentationStepOutput
from ..registry import register_adapter

class SchpSegAdapter:
    name = "schp_seg"

    def validate(self, step_input: SegmentationStepInput) -> None:
        if not os.path.exists(step_input.image_path):
            raise FileNotFoundError(f"Input image not found: {step_input.image_path}")

    def run(self, step_input: SegmentationStepInput) -> SegmentationStepOutput:
        # Check resolved category from fashn_seg if it ran, or use the default from input
        fashn_out = step_input.prior_results.get("fashn_seg")
        category = step_input.category
        if fashn_out and "category" in fashn_out.get("metadata", {}):
            category = fashn_out["metadata"]["category"]
            
        print(f"  [SCHP] Running parser for category: {category}")
        schp_map = run_schp_parsing(step_input.image_path)
        
        # Build fine-grained skin and arm exclusion mask
        schp_s_ids = SCHP_EXCLUSION_CLASSES.get(category, [2, 13, 14, 15, 16, 17, 18, 19])
        schp_exclusion = np.zeros_like(schp_map, dtype=np.uint8)
        for cid in schp_s_ids:
            schp_exclusion[schp_map == cid] = 255
            
        # Build prior garment mask
        schp_g_ids = SCHP_GARMENT_CLASSES.get(category, [5])
        if category == "footwear":
            # For footwear, treat legs in SCHP as prior to prevent boot cutouts
            schp_g_ids = list(set(schp_g_ids + [16, 17]))
            
        schp_prior = np.zeros_like(schp_map, dtype=np.uint8)
        for cid in schp_g_ids:
            schp_prior[schp_map == cid] = 255
            
        # Save output paths
        schp_map_path = os.path.join(step_input.output_dir, "02_schp_seg_map.png")
        exclusion_mask_path = os.path.join(step_input.output_dir, "02_schp_exclusion.png")
        prior_mask_path = os.path.join(step_input.output_dir, "02_schp_prior.png")
        
        cv2.imwrite(schp_map_path, schp_map.astype(np.uint8))
        cv2.imwrite(exclusion_mask_path, schp_exclusion)
        cv2.imwrite(prior_mask_path, schp_prior)
        
        return SegmentationStepOutput(
            step_name=self.name,
            output_path=prior_mask_path,
            mask_path=exclusion_mask_path,
            metadata={
                "schp_map_path": schp_map_path
            }
        )

# Register adapter
register_adapter("schp_seg", SchpSegAdapter)
