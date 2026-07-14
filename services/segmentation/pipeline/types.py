from dataclasses import dataclass, field
from typing import Optional, Any

@dataclass
class SegmentationStepInput:
    seg_job_id: str
    pipeline_job_id: str
    image_path: str           # Local absolute path to the input image
    step_config: dict = field(default_factory=dict)
    prior_results: dict = field(default_factory=dict)  # step_name -> dict representation of SegmentationStepOutput
    output_dir: str = ""       # Folder path where intermediate files are saved
    category: str = "top"      # top, dress, skirt, pants, footwear

@dataclass
class SegmentationStepOutput:
    step_name: str
    output_path: str
    mask_path: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "step_name": self.step_name,
            "output_path": self.output_path,
            "mask_path": self.mask_path,
            "metadata": self.metadata
        }

@dataclass
class StepResult:
    step_name: str
    step_order: int
    parallel_group: Optional[int]
    status: str  # pending, in_progress, completed, failed, skipped
    output: Optional[dict] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "step_name": self.step_name,
            "step_order": self.step_order,
            "parallel_group": self.parallel_group,
            "status": self.status,
            "output": self.output,
            "error": self.error,
            "started_at": self.started_at,
            "completed_at": self.completed_at
        }
