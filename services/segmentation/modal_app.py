import os
import sys
import modal

# 1. Define the Modal App
app = modal.App("atlyr-segmentation")

local_dir = os.path.dirname(os.path.abspath(__file__))

# Read ignore patterns from .modalignore to prevent uploading garbage folders/files
def get_ignore_list():
    ignore_path = os.path.join(local_dir, ".modalignore")
    if not os.path.exists(ignore_path):
        return []
    with open(ignore_path, "r") as f:
        return [
            line.strip()
            for line in f
            if line.strip() and not line.strip().startswith("#")
        ]

# 2. Define the container image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1-mesa-glx", "libglib2.0-0")  # Required for OpenCV/Qt inside Debian
    .pip_install(
        "fashn-human-parser",
        "torch",
        "torchvision",
        "opencv-python-headless",
        "numpy",
        "Pillow",
        "scipy",
        "transformers",
        "requests",
        "python-dotenv",
        "fastapi[standard]",
        "hydra-core",
    )
    .pip_install("SAM-2 @ git+https://github.com/facebookresearch/sam2.git")
    .run_commands(
        "python -c 'import urllib.request, os; os.makedirs(\"/root/.cache/sam\", exist_ok=True); urllib.request.urlretrieve(\"https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt\", \"/root/.cache/sam/sam2.1_hiera_large.pt\"); urllib.request.urlretrieve(\"https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt\", \"/root/.cache/sam/sam2.1_hiera_base_plus.pt\")'",
        "python -c 'from fashn_human_parser import FashnHumanParser; FashnHumanParser(device=\"cpu\")'",
    )
    .add_local_dir(local_dir, remote_path="/root", ignore=get_ignore_list())
)

# 3. Define the GPU-backed Web Endpoint
@app.function(
    gpu="L4",                                             # L4 is 27% cheaper and newer than A10G
    cpu=4.0,                                              # 4 CPU cores for fast parallel OpenCV inpainting
    image=image,
    secrets=[modal.Secret.from_name("supabase-secret")],  # Mounts the Supabase credentials securely
    timeout=600,                                          # 10 minutes timeout limit
    scaledown_window=10,                                  # Spin down container after 10s idle (saves 50s of idle billing!)
)
@modal.fastapi_endpoint(method="POST")
def segment(seg_job_id: str, pipeline_job_id: str, category: str = "top"):
    """
    HTTP POST Web Endpoint.
    To trigger:
    POST https://<your-modal-username>--atlyr-segmentation-segment.modal.run/?seg_job_id=xxx&pipeline_job_id=yyy&category=top
    """
    print(f"--- Launching segmentation pipeline for seg_job_id={seg_job_id} ---")
    
    # Configure the paths inside the container
    os.environ["SCHP_ROOT"] = "/root/Utils/Self-Correction-Human-Parsing"
    
    # Insert working directory to Python path
    sys.path.insert(0, "/root")
    
    from pipeline import db_store
    from pipeline.green_screen_pipeline import run_green_screen_pipeline_e2e
    
    # Fetch job from Supabase DB to get input vton_image_url
    print(f"[Modal] Fetching job details for seg_job_id={seg_job_id}...")
    job = db_store.fetch_job(seg_job_id)
    vton_image_url = job.get("vton_image_url")
    
    result = run_green_screen_pipeline_e2e(
        seg_job_id=seg_job_id,
        pipeline_job_id=pipeline_job_id,
        vton_image_url=vton_image_url,
        category=category,
        output_dir="/tmp/output_segmentation_pipeline",
        skip_intermediate_uploads=False
    )
    
    print("--- Pipeline execution completed inside Modal container ---")
    return result
