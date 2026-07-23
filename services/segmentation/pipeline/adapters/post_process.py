import os
import sys
import cv2
import numpy as np

# Ensure root services/segmentation is in path
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from ..types import SegmentationStepInput, SegmentationStepOutput
from ..registry import register_adapter
from experiment_segmentation import extract_class_mask

class FashnSegRefineAdapter:
    name = "fashn_seg_refine"

    def validate(self, step_input: SegmentationStepInput) -> None:
        if not os.path.exists(step_input.image_path):
            raise FileNotFoundError(f"Input image not found: {step_input.image_path}")
        if "sam_v2" not in step_input.prior_results:
            raise ValueError("sam_v2 results are required for fashn_seg_refine")

    def run(self, step_input: SegmentationStepInput) -> SegmentationStepOutput:
        # Load raw SAM mask path from prior results
        sam_v2_out = step_input.prior_results["sam_v2"]
        category = sam_v2_out["metadata"]["category"]
        
        # Load files
        img_bgr = cv2.imread(step_input.image_path)
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        h, w = img_rgb.shape[:2]
        
        sam_mask = cv2.imread(sam_v2_out["output_path"], cv2.IMREAD_GRAYSCALE)
        
        # Read green screen and color skin masks saved by sam_v2
        foreground_mask = cv2.imread(sam_v2_out["metadata"]["foreground_mask_path"], cv2.IMREAD_GRAYSCALE)
        color_skin_mask = cv2.imread(sam_v2_out["metadata"]["color_skin_mask_path"], cv2.IMREAD_GRAYSCALE)
        parser_skin_mask = cv2.imread(sam_v2_out["metadata"]["parser_skin_mask_path"], cv2.IMREAD_GRAYSCALE)
        
        # 1. Gate SAM2 result with chroma key foreground mask ONLY if green screen input
        is_green_screen = sam_v2_out["metadata"].get("is_green_screen", False)
        if is_green_screen:
            sam2_only_alpha = cv2.bitwise_and(sam_mask, foreground_mask)
        else:
            sam2_only_alpha = sam_mask.copy()

        # 2. Head/neck guided skin subtraction (neck collar punch)
        fashn_out = step_input.prior_results["fashn_seg"]
        seg_map = cv2.imread(fashn_out["metadata"]["seg_map_path"], cv2.IMREAD_GRAYSCALE)
        
        fashn_hn = extract_class_mask(seg_map, [1, 2, 16])
        schp_hn = np.zeros_like(fashn_hn)
        
        schp_out = step_input.prior_results.get("schp_seg")
        if schp_out:
            schp_map = cv2.imread(schp_out["metadata"]["schp_map_path"], cv2.IMREAD_GRAYSCALE)
            for cid in [2, 13]:
                schp_hn[schp_map == cid] = 255
                
        head_neck_mask = np.maximum(fashn_hn, schp_hn)
        kernel_hn = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
        dilated_hn = cv2.dilate(head_neck_mask, kernel_hn)
        color_skin_guided = cv2.bitwise_and(color_skin_mask, dilated_hn)
        combined_exclusion = cv2.bitwise_or(parser_skin_mask, color_skin_guided)
        sam2_only_alpha[combined_exclusion > 127] = 0
        
        # 3. Multi-component cleanup (> 1000px)
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            (sam2_only_alpha > 127).astype(np.uint8),
            connectivity=8
        )
        if num_labels > 1:
            cleaned = np.zeros_like(sam2_only_alpha)
            for i in range(1, num_labels):
                if stats[i, cv2.CC_STAT_AREA] > 1000:
                    cleaned[labels == i] = 255
            sam2_only_alpha = cleaned
            
        # Convert to strict binary mask
        sam2_only_alpha_binary = np.zeros_like(sam2_only_alpha)
        sam2_only_alpha_binary[sam2_only_alpha >= 128] = 255
        
        # Calculate mean saturation to identify non-gray garments (for dynamic despill)
        garment_pixels = img_bgr[sam2_only_alpha_binary > 127]
        if len(garment_pixels) > 0:
            b_garment = garment_pixels[:, 0].astype(np.int32)
            g_garment = garment_pixels[:, 1].astype(np.int32)
            r_garment = garment_pixels[:, 2].astype(np.int32)
            sat_garment = np.maximum(np.maximum(r_garment, g_garment), b_garment) - np.minimum(np.minimum(r_garment, g_garment), b_garment)
            mean_sat = sat_garment.mean()
        else:
            mean_sat = 0.0
            
        # 4. Adaptive color extension (inpainting)
        orig_pixel_count = np.sum(sam2_only_alpha_binary > 0)
        clean_core = None
        for erode_sz in [9, 7, 5, 3]:
            kernel_core = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_sz, erode_sz))
            candidate_core = cv2.erode(sam2_only_alpha_binary, kernel_core, iterations=1)
            if np.sum(candidate_core > 0) > max(100, 0.1 * orig_pixel_count):
                clean_core = candidate_core
                break
                
        if clean_core is not None:
            inpaint_mask = (clean_core == 0).astype(np.uint8)
            img_bgr_inpainted = cv2.inpaint(img_bgr, inpaint_mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
            img_rgb_inpainted = cv2.cvtColor(img_bgr_inpainted, cv2.COLOR_BGR2RGB)
        else:
            img_rgb_inpainted = img_rgb.copy()
            
        # 5. Distance transform soft feathering (3 pixels width)
        dist = cv2.distanceTransform(sam2_only_alpha_binary, cv2.DIST_L2, 5)
        feather_width = 3.0
        alpha = np.clip((dist / feather_width) * 255.0, 0, 255).astype(np.uint8)
        
        # 6. Boundary-only targeted cleanup & despill
        boundary_mask = (dist > 0) & (dist <= 5)
        
        b = img_bgr[:, :, 0].astype(np.int32)
        g = img_bgr[:, :, 1].astype(np.int32)
        r = img_bgr[:, :, 2].astype(np.int32)
        cmax = np.maximum(np.maximum(r, g), b)
        cmin = np.minimum(np.minimum(r, g), b)
        sat = cmax - cmin
        
        bg_color = img_bgr[0, 0].astype(np.float32)
        bg_sat = np.max(bg_color) - np.min(bg_color)
        diff = img_bgr.astype(np.float32) - bg_color
        dist_bg = np.sqrt(np.sum(diff**2, axis=-1))
        
        # Dynamic Background-Aware Despill
        if bg_sat > 30:
            spill_mask = boundary_mask & (dist_bg < 120)
            print("  [Refine] Background detected as saturated. Applying chroma despill.")
        else:
            spill_mask = boundary_mask & (sat < 15) & (dist_bg < 120)
            print("  [Refine] Background detected as neutral. Applying gray despill.")
            
        # Softly suppress alpha for spill pixels
        alpha[spill_mask] = (alpha[spill_mask] * 0.3).astype(np.uint8)
        
        # Blending original image and color-extended image
        weight = np.clip(dist / feather_width, 0.0, 1.0)
        weight[spill_mask] = 0.0
        weight_3d = np.expand_dims(weight, axis=-1)
        blended_rgb = (weight_3d * img_rgb + (1.0 - weight_3d) * img_rgb_inpainted).astype(np.uint8)
        
        # Explicit Green color despill on the blended image
        blended_r = blended_rgb[:, :, 0].astype(np.float32)
        blended_g = blended_rgb[:, :, 1].astype(np.float32)
        blended_b = blended_rgb[:, :, 2].astype(np.float32)
        
        green_spill_pixels = boundary_mask & (blended_g > blended_r) & (blended_g > blended_b)
        blended_g[green_spill_pixels] = np.maximum(blended_r[green_spill_pixels], blended_b[green_spill_pixels])
        blended_rgb = np.dstack([blended_r, blended_g, blended_b]).astype(np.uint8)
        
        # Assemble RGBA
        rgba = np.dstack([blended_rgb, alpha])
        
        # Save output files
        final_garment_path = os.path.join(step_input.output_dir, "09_final_garment.png")
        final_alpha_path = os.path.join(step_input.output_dir, "07b_sam2_alpha.png")
        final_checker_path = os.path.join(step_input.output_dir, "09_final_garment_checker.png")
        
        cv2.imwrite(final_garment_path, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
        cv2.imwrite(final_alpha_path, alpha)
        
        # Build checkerboard visualization
        checker = np.zeros((h, w, 3), dtype=np.uint8)
        grid_sz = 16
        for r_idx in range(0, h, grid_sz):
            for c_idx in range(0, w, grid_sz):
                if ((r_idx // grid_sz) + (c_idx // grid_sz)) % 2 == 0:
                    checker[r_idx:r_idx+grid_sz, c_idx:c_idx+grid_sz] = 200
                else:
                    checker[r_idx:r_idx+grid_sz, c_idx:c_idx+grid_sz] = 255
                    
        alpha_f = rgba[:, :, 3:4] / 255.0
        vis_bgr = (rgba[:, :, :3] * alpha_f + checker * (1 - alpha_f)).astype(np.uint8)
        cv2.imwrite(final_checker_path, cv2.cvtColor(vis_bgr, cv2.COLOR_RGB2BGR))
        
        return SegmentationStepOutput(
            step_name=self.name,
            output_path=final_garment_path,
            mask_path=final_alpha_path,
            metadata={
                "mean_sat": float(mean_sat),
                "checkerboard_path": final_checker_path
            }
        )

# Register adapter
register_adapter("fashn_seg_refine", FashnSegRefineAdapter)
