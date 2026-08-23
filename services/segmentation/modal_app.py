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
    # How long a finished container waits for more work before dying. NOT a request timeout — it
    # never delays a response; it only decides whether the NEXT job re-pays a cold start.
    #
    # 10s was too short: measured 94.9s cold vs 54.0s warm, and a 40s gap between jobs was enough
    # to lose the container. But the window is billed as idle GPU, so overshooting costs real
    # money at the tail of every sheet (one idle window per container, ~$0.011/container at 60s).
    # 60s covers the observed inter-arrival gaps with margin while keeping that tail small, and
    # matches the value already chosen for eraser/modal_app_eraser.py.
    scaledown_window=60,
    # A spend ceiling, not a throttle. Previously absent entirely: nothing anywhere capped
    # concurrent GPU containers, so a bug or a very large sheet could fan out without limit.
    # Matched to the caller's own ceiling (pg-boss BOSS_TEAM_SIZE=12) on purpose — setting it
    # LOWER just serialises work into extra waves (measured: 8 containers cost ~54s more
    # wall-clock per 21-job sheet to save ~3 cents). Guardrail, not a tuning knob.
    #
    # NOTE: deliberately NOT adding @modal.concurrent(max_inputs=N) here. The pipeline caches a
    # SAM2 predictor in a module global and calls set_image() per request, so two inputs sharing
    # one container would race on that state. Needs per-input model handles first.
    max_containers=12,
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
    
    # Per-job scratch dir. Containers are reused across invocations, so a shared
    # dir makes job N re-use job N-1's cached files (every VTON image is named
    # front.jpg) and segment the wrong garment.
    output_dir = f"/tmp/output_segmentation_pipeline/{seg_job_id}"

    try:
        result = run_green_screen_pipeline_e2e(
            seg_job_id=seg_job_id,
            pipeline_job_id=pipeline_job_id,
            vton_image_url=vton_image_url,
            category=category,
            output_dir=output_dir,
            skip_intermediate_uploads=False
        )
    finally:
        # Everything worth keeping is already in Supabase Storage; drop the
        # scratch files so a warm container doesn't fill its disk.
        import shutil
        shutil.rmtree(output_dir, ignore_errors=True)

    print("--- Pipeline execution completed inside Modal container ---")
    return result
