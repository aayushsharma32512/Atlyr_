import os
import sys
import modal

# 1. Define Modal App
app = modal.App("atlyr-placement")

local_dir = os.path.dirname(os.path.abspath(__file__))

# 2. Container image definition with PyTorch, CUDA, Kornia, OpenCV, Pillow, Requests
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "torch",
        "torchvision",
        "kornia",
        "opencv-python-headless",
        "numpy",
        "Pillow",
        "requests",
        "python-dotenv",
        "fastapi[standard]",
    )
    .add_local_dir(local_dir, remote_path="/root")
)

# 3. GPU-backed Web Endpoint
@app.function(
    gpu="L4",
    cpu=4.0,
    image=image,
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=600,
    scaledown_window=10,
)
@modal.fastapi_endpoint(method="POST")
def place(pipeline_job_id: str, segmented_image_url: str = None, vton_image_url: str = None):
    """
    HTTP POST Web Endpoint for Garment Placement.
    Triggers dual-mannequin LoFTR registration & compositing on cloud GPU.
    """
    print(f"--- Launching placement pipeline for pipeline_job_id={pipeline_job_id} ---")
    sys.path.insert(0, "/root")

    from pipeline.placement_pipeline import run_placement_pipeline_e2e

    result = run_placement_pipeline_e2e(
        pipeline_job_id=pipeline_job_id,
        segmented_image_url=segmented_image_url,
        vton_image_url=vton_image_url,
        output_dir="/tmp/output_placement_pipeline"
    )

    print("--- Placement execution completed inside Modal container ---")
    return result
