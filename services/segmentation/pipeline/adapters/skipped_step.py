from ..types import SegmentationStepInput, SegmentationStepOutput
from ..registry import register_adapter

class BaseSkippedAdapter:
    name = "skipped"
    
    def validate(self, step_input: SegmentationStepInput) -> None:
        pass
        
    def run(self, step_input: SegmentationStepInput) -> SegmentationStepOutput:
        """Passes through the output of the last active step (fashn_seg_refine or sam_v2)."""
        refine_output = step_input.prior_results.get("fashn_seg_refine") or step_input.prior_results.get("sam_v2")
        output_path = refine_output.get("output_path") if refine_output else step_input.image_path
        mask_path = refine_output.get("mask_path") if refine_output else None
        metadata = refine_output.get("metadata") if refine_output else {}
        
        return SegmentationStepOutput(
            step_name=self.name,
            output_path=output_path,
            mask_path=mask_path,
            metadata={**metadata, "status": "skipped"}
        )

class VitmatteAdapter(BaseSkippedAdapter):
    name = "vitmatte"

class BirefnetAdapter(BaseSkippedAdapter):
    name = "birefnet"

class CombineAdapter(BaseSkippedAdapter):
    name = "combine"

# Auto-register the skipped adapters
register_adapter("vitmatte", VitmatteAdapter)
register_adapter("birefnet", BirefnetAdapter)
register_adapter("combine", CombineAdapter)
