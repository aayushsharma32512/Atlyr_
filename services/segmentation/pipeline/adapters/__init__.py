from .fashn_seg import FashnSegAdapter
from .schp_seg import SchpSegAdapter
from .gdino import GdinoAdapter
from .sam_v2 import SamV2Adapter
from .post_process import FashnSegRefineAdapter
from .skipped_step import VitmatteAdapter, BirefnetAdapter, CombineAdapter

# Re-exports all step adapters so they register themselves in STEP_REGISTRY upon package import
__all__ = [
    "FashnSegAdapter",
    "SchpSegAdapter",
    "GdinoAdapter",
    "SamV2Adapter",
    "FashnSegRefineAdapter",
    "VitmatteAdapter",
    "BirefnetAdapter",
    "CombineAdapter",
]
