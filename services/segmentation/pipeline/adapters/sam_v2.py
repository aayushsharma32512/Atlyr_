import os
import sys
import cv2
import numpy as np
from PIL import Image

# Ensure root services/segmentation is in path
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

import torch
from experiment_segmentation import (
    _load_sam2_predictor,
    _select_best_mask_by_iou,
    _build_prompt_points,
    punch_vneck_skin_final,
    HEAD_NECK_CLASSES,
    extract_class_mask
)
from ..types import SegmentationStepInput, SegmentationStepOutput
from ..registry import register_adapter

class SamV2Adapter:
    name = "sam_v2"

    def validate(self, step_input: SegmentationStepInput) -> None:
        if not os.path.exists(step_input.image_path):
            raise FileNotFoundError(f"Input image not found: {step_input.image_path}")
        if "fashn_seg" not in step_input.prior_results:
            raise ValueError("fashn_seg results are required for sam_v2")

    def run(self, step_input: SegmentationStepInput) -> SegmentationStepOutput:
        # Load inputs from prior results
        fashn_out = step_input.prior_results["fashn_seg"]
        category = fashn_out["metadata"]["category"]
        
        # Read masks and arrays
        coarse_garment_mask = cv2.imread(fashn_out["output_path"], cv2.IMREAD_GRAYSCALE)
        exclusion_mask = cv2.imread(fashn_out["mask_path"], cv2.IMREAD_GRAYSCALE)
        seg_map = cv2.imread(fashn_out["metadata"]["seg_map_path"], cv2.IMREAD_GRAYSCALE)
        
        # Integrate SCHP fine exclusions if present
        schp_map = None
        schp_out = step_input.prior_results.get("schp_seg")
        if schp_out:
            schp_exclusion = cv2.imread(schp_out["mask_path"], cv2.IMREAD_GRAYSCALE)
            schp_map = cv2.imread(schp_out["metadata"]["schp_map_path"], cv2.IMREAD_GRAYSCALE)
            exclusion_mask = np.maximum(exclusion_mask, schp_exclusion)
            
        # Integrate DINO negative box coordinates if present
        dino_out = step_input.prior_results.get("gdino")
        neg_boxes = []
        if dino_out:
            neg_boxes = dino_out["metadata"].get("negative_boxes", [])
            
        # Load image into numpy array
        pil_img = Image.open(step_input.image_path).convert("RGB")
        img_arr = np.array(pil_img)
        img_h, img_w = img_arr.shape[:2]
        img_bgr = cv2.cvtColor(img_arr, cv2.COLOR_RGB2BGR)

        # 1. Chroma Keying (Green Screen Mask)
        print("  [SAM2] Performing chroma keying...")
        hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
        lower_green = np.array([35, 40, 30])
        upper_green = np.array([90, 255, 255])
        green_mask = cv2.inRange(hsv, lower_green, upper_green)

        kernel_morph = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        green_mask_clean = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, kernel_morph)
        green_mask_clean = cv2.morphologyEx(green_mask_clean, cv2.MORPH_OPEN, kernel_morph)
        foreground_mask = cv2.bitwise_not(green_mask_clean)

        green_coverage = np.sum(green_mask_clean > 0) / (img_h * img_w)
        # Check green coverage at the border area of the image (outer 5% border) to distinguish 
        # a green garment in the center from an actual green screen background.
        border_mask = np.ones((img_h, img_w), dtype=np.uint8) * 255
        border_mask[int(img_h*0.05):int(img_h*0.95), int(img_w*0.05):int(img_w*0.95)] = 0
        green_border_pixels = cv2.bitwise_and(green_mask_clean, border_mask)
        green_border_coverage = np.sum(green_border_pixels > 0) / np.sum(border_mask > 0)
        is_green_screen = (green_coverage > 0.05) and (green_border_coverage > 0.15)

        if is_green_screen:
            print(f"  [SAM2] Green screen detected ({green_coverage:.1%}). Keeping full exclusion mask.")
        else:
            exclusion_mask = cv2.bitwise_and(exclusion_mask, cv2.bitwise_not(coarse_garment_mask))
            print(f"  [SAM2] Non-green-screen ({green_coverage:.1%}). Protecting garment from exclusion.")

        parser_skin_mask = exclusion_mask.copy()

        # 2. Dynamic skin color detection
        if np.sum(coarse_garment_mask > 127) > 0:
            b_mean = np.mean(img_bgr[:, :, 0][coarse_garment_mask > 127])
            g_mean = np.mean(img_bgr[:, :, 1][coarse_garment_mask > 127])
            r_mean = np.mean(img_bgr[:, :, 2][coarse_garment_mask > 127])
            is_garment_skin_colored = (r_mean > 95) and (g_mean > 40) and (b_mean > 20) and (r_mean > g_mean) and (r_mean > b_mean) and (r_mean - g_mean > 10) and (r_mean - b_mean > 10)
        else:
            is_garment_skin_colored = False

        if not is_garment_skin_colored:
            b_ch = img_bgr[:, :, 0].astype(np.float32)
            g_ch = img_bgr[:, :, 1].astype(np.float32)
            r_ch = img_bgr[:, :, 2].astype(np.float32)
            color_skin = (r_ch > 95) & (g_ch > 40) & (b_ch > 20) & (r_ch - g_ch > 15) & (r_ch - b_ch > 15) & (r_ch > g_ch) & (r_ch > b_ch)
            if is_green_screen:
                exclusion_mask = np.maximum(exclusion_mask, color_skin.astype(np.uint8) * 255)
                color_skin_mask = color_skin.astype(np.uint8) * 255
            else:
                color_skin_clean = cv2.bitwise_and(color_skin.astype(np.uint8) * 255, cv2.bitwise_not(coarse_garment_mask))
                exclusion_mask = np.maximum(exclusion_mask, color_skin_clean)
                color_skin_mask = color_skin_clean
        else:
            color_skin_mask = np.zeros_like(parser_skin_mask)

        # Save masks for post_process step
        foreground_mask_path = os.path.join(step_input.output_dir, "03_foreground_mask.png")
        color_skin_mask_path = os.path.join(step_input.output_dir, "03_color_skin_mask.png")
        parser_skin_mask_path = os.path.join(step_input.output_dir, "03_parser_skin_mask.png")

        cv2.imwrite(foreground_mask_path, foreground_mask)
        cv2.imwrite(color_skin_mask_path, color_skin_mask)
        cv2.imwrite(parser_skin_mask_path, parser_skin_mask)
        
        # Build prompt coordinates and labels
        point_coords_list = []
        point_labels_list = []
        
        # Fashn baseline points
        fashn_coords, fashn_labels = _build_prompt_points(coarse_garment_mask, exclusion_mask, img_h, img_w)
        if fashn_coords is not None:
            point_coords_list.append(fashn_coords)
            point_labels_list.append(fashn_labels)
            
        # Dino negative points
        if len(neg_boxes) > 0:
            dino_neg_pts = []
            for box in neg_boxes:
                x1, y1, x2, y2 = box
                x1_c = max(0, min(img_w - 1, int(x1)))
                y1_c = max(0, min(img_h - 1, int(y1)))
                x2_c = max(0, min(img_w - 1, int(x2)))
                y2_c = max(0, min(img_h - 1, int(y2)))
                
                cx, cy = (x1_c + x2_c) // 2, (y1_c + y2_c) // 2
                
                # Exclude if falls on garment
                if coarse_garment_mask[cy, cx] == 0:
                    dino_neg_pts.append([cx, cy])
                    
                w = x2_c - x1_c
                h = y2_c - y1_c
                if w > 10 and h > 10:
                    offsets = [
                        (cx - int(w*0.2), cy),
                        (cx + int(w*0.2), cy),
                        (cx, cy - int(h*0.2)),
                        (cx, cy + int(h*0.2))
                    ]
                    for ox, oy in offsets:
                        ox_c = max(0, min(img_w - 1, ox))
                        oy_c = max(0, min(img_h - 1, oy))
                        if coarse_garment_mask[oy_c, ox_c] == 0:
                            dino_neg_pts.append([ox_c, oy_c])
                            
            if len(dino_neg_pts) > 0:
                dino_neg_coords = np.array(dino_neg_pts, dtype=np.float32)
                dino_neg_labels = np.zeros(len(dino_neg_pts), dtype=np.int32)
                point_coords_list.append(dino_neg_coords)
                point_labels_list.append(dino_neg_labels)
                
        if len(point_coords_list) > 0:
            point_coords = np.concatenate(point_coords_list, axis=0)
            point_labels = np.concatenate(point_labels_list, axis=0)
        else:
            point_coords, point_labels = None, None
            
        # Padded Fashn garment bounding box
        best_pos_box = None
        ys, xs = np.where(coarse_garment_mask > 127)
        if len(ys) > 0:
            ymin, ymax = int(ys.min()), int(ys.max())
            xmin, xmax = int(xs.min()), int(xs.max())
            pad_y = int((ymax - ymin) * 0.15)
            pad_x = int((xmax - xmin) * 0.15)
            x1 = max(0, xmin - pad_x)
            y1 = max(0, ymin - pad_y)
            x2 = min(img_w - 1, xmax + pad_x)
            y2 = min(img_h - 1, ymax + pad_y)
            best_pos_box = np.array([x1, y1, x2, y2], dtype=np.float32)
            
        # Predict using SAM2 Image Predictor
        sam_variant = step_input.step_config.get("sam2_variant", "sam2_large")
        print(f"  [SAM2] Loading/Retrieving SAM2 Predictor ({sam_variant})...")
        predictor = _load_sam2_predictor(sam_variant, img_arr)
        
        with torch.inference_mode():
            masks, scores, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=best_pos_box,
                multimask_output=True,
            )
        sam_mask = _select_best_mask_by_iou(masks, coarse_garment_mask)
        
        # Hard body exclusion constraint
        sam_mask[exclusion_mask > 127] = 0
        
        # Fill in internal tears/holes
        coarse_clean = (coarse_garment_mask > 127) & (exclusion_mask <= 127)
        sam_mask = np.where(coarse_clean, 255, sam_mask)
        
        # Layered V-neck skin punch
        head_neck_mask = extract_class_mask(seg_map, HEAD_NECK_CLASSES)
        sam_mask = punch_vneck_skin_final(
            mask=sam_mask,
            image_bgr=img_arr[:, :, ::-1].copy(),  # convert RGB to BGR for cv2
            seg_map=seg_map,
            category=category,
            garment_mask=coarse_garment_mask,
            head_neck_mask=head_neck_mask,
            schp_map=schp_map
        )
        
        # Save output path
        sam_output_path = os.path.join(step_input.output_dir, "03_sam_and_fashn.png")
        cv2.imwrite(sam_output_path, sam_mask)
        
        return SegmentationStepOutput(
            step_name=self.name,
            output_path=sam_output_path,
            metadata={
                "category": category,
                "is_green_screen": bool(is_green_screen),
                "exclusion_mask_path": fashn_out["mask_path"],
                "foreground_mask_path": foreground_mask_path,
                "color_skin_mask_path": color_skin_mask_path,
                "parser_skin_mask_path": parser_skin_mask_path,
            }
        )

# Register adapter
register_adapter("sam_v2", SamV2Adapter)
