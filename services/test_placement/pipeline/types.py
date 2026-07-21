from dataclasses import dataclass
from typing import Optional, Tuple, Dict, Any
import numpy as np

@dataclass
class PlacementResult:
    """End-to-end placement pipeline result."""
    status: str
    pipeline_job_id: str
    selected_mannequin: str
    final_image_url: Optional[str] = None
    scale: float = 1.0
    rotation_deg: float = 0.0
    translation: Tuple[float, float] = (0.0, 0.0)
    inliers: int = 0
    inlier_ratio: float = 0.0
    reproj_error: float = float('inf')
    scores: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
