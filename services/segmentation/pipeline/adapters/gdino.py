import os
import sys
import json
from PIL import Image

# Ensure root services/segmentation is in path
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from experiment_segmentation import _run_grounding_dino_detect, BASE_GDINO_TOKENS
from ..types import SegmentationStepInput, SegmentationStepOutput
from ..registry import register_adapter

class GdinoAdapter:
    name = "gdino"

    def validate(self, step_input: SegmentationStepInput) -> None:
        if not os.path.exists(step_input.image_path):
            raise FileNotFoundError(f"Input image not found: {step_input.image_path}")

    def run(self, step_input: SegmentationStepInput) -> SegmentationStepOutput:
        # Determine category from fashn_seg outputs if available
        fashn_out = step_input.prior_results.get("fashn_seg")
        category = step_input.category
        if fashn_out and "category" in fashn_out.get("metadata", {}):
            category = fashn_out["metadata"]["category"]
            
        pil_img = Image.open(step_input.image_path).convert("RGB")
        
        positive_queries = BASE_GDINO_TOKENS.get(category, {}).get("primary", ["clothing"])
        negative_queries = ["neck", "chest skin", "face", "arms", "legs", "hands", "feet"]
        
        pos_boxes = []
        neg_boxes = []
        
        # Run detection using experiment_segmentation helper
        # Note: By default, this will bypass and return empty lists if SKIP_DINO is set to "1" in the environment
        try:
            pos_boxes, neg_boxes = _run_grounding_dino_detect(
                image_pil=pil_img,
                positive_queries=positive_queries,
                negative_queries=negative_queries
            )
        except Exception as e:
            print(f"  [DINO] [Warning] Failed to run GroundingDINO: {e}. Bypassing.")
            
        # Serialize box outputs
        pos_list = [box.tolist() for box in pos_boxes] if pos_boxes else []
        neg_list = [box.tolist() for box in neg_boxes] if neg_boxes else []
        
        boxes_path = os.path.join(step_input.output_dir, "02_gdino_boxes.json")
        with open(boxes_path, "w") as f:
            json.dump({"positive": pos_list, "negative": neg_list}, f, indent=2)
            
        return SegmentationStepOutput(
            step_name=self.name,
            output_path=boxes_path,
            metadata={
                "positive_boxes": pos_list,
                "negative_boxes": neg_list
            }
        )

# Register adapter
register_adapter("gdino", GdinoAdapter)
