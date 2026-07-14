#!/usr/bin/env python3
"""
Test script for the deployed Modal Web Endpoint.

This script:
1. Uploads a local test image to Supabase Storage to get a public URL.
2. Creates a parent job and a segmentation job in the Supabase DB.
3. Hits the deployed Modal endpoint:
   https://nahmahn--atlyr-segmentation-segment.modal.run
4. Waits for the cloud GPU to process the image and checks the output.

Usage:
    cd services/segmentation
    python pipeline/test_modal_deploy.py
"""
import os
import sys
import uuid
import requests
from datetime import datetime

# Path setup
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from pipeline import supabase_client
from pipeline import db_store

TEST_IMAGE = os.path.join(
    base_dir, "final_sam2_only_green_screen", "green_screen_test", "green_test_image2.png"
)
MODAL_ENDPOINT = "https://nahmahn--atlyr-segmentation-segment.modal.run"


def main():
    print("=" * 60)
    print("  TESTING DEPLOYED MODAL ENDPOINT")
    print("=" * 60)

    if not os.path.exists(TEST_IMAGE):
        print(f"[FATAL] Test image not found: {TEST_IMAGE}")
        return

    # 1. Upload the local test image to Supabase Storage to get a public URL for Modal
    print("\n[1/4] Uploading test image to Supabase Storage...")
    input_storage_path = f"segmentation/test_runs/{uuid.uuid4()}/input.png"
    vton_image_url = supabase_client.upload_file_to_storage(
        TEST_IMAGE, input_storage_path, "image/png"
    )
    print(f"  Public input URL: {vton_image_url}")

    # 2. Setup database records
    print("\n[2/4] Setting up DB config and job rows...")
    # Resolve config ID
    url = f"{supabase_client.SUPABASE_URL}/rest/v1/segmentation_pipeline_config?select=id,name&is_active=eq.true"
    resp = requests.get(url, headers=supabase_client.get_headers())
    config_id = resp.json()[0]["id"]

    # Use existing parent job or create one with correct fields
    jobs_url = f"{supabase_client.SUPABASE_URL}/rest/v1/ingestion_pipeline_jobs?select=job_id&limit=1"
    jobs_resp = requests.get(jobs_url, headers=supabase_client.get_headers())
    if jobs_resp.status_code == 200 and jobs_resp.json():
        pipeline_job_id = jobs_resp.json()[0]["job_id"]
        print(f"  Reusing parent job: {pipeline_job_id}")
    else:
        pipeline_job_id = str(uuid.uuid4())
        p_res = requests.post(
            f"{supabase_client.SUPABASE_URL}/rest/v1/ingestion_pipeline_jobs",
            headers=supabase_client.get_headers(),
            json={
                "job_id": pipeline_job_id,
                "product_url": "https://example.com/modal-test",
                "current_state": "segmenting",
            },
        )
        print(f"  Created parent job: {pipeline_job_id} (Status: {p_res.status_code})")

    # Clean up old seg job for this pipeline_job_id (unique constraint)
    chk = requests.get(
        f"{supabase_client.SUPABASE_URL}/rest/v1/segmentation_jobs?pipeline_job_id=eq.{pipeline_job_id}",
        headers=supabase_client.get_headers(),
    )
    if chk.status_code == 200 and chk.json():
        old_id = chk.json()[0]["seg_job_id"]
        requests.delete(f"{supabase_client.SUPABASE_URL}/rest/v1/segmentation_step_results?seg_job_id=eq.{old_id}", headers=supabase_client.get_headers())
        requests.delete(f"{supabase_client.SUPABASE_URL}/rest/v1/segmentation_jobs?seg_job_id=eq.{old_id}", headers=supabase_client.get_headers())

    # Create segmentation job
    seg_job_id = str(uuid.uuid4())
    s_res = requests.post(
        f"{supabase_client.SUPABASE_URL}/rest/v1/segmentation_jobs",
        headers=supabase_client.get_headers(),
        json={
            "seg_job_id": seg_job_id,
            "pipeline_job_id": pipeline_job_id,
            "pipeline_config_id": config_id,
            "vton_image_url": vton_image_url,
            "current_state": "pending",
        },
    )
    print(f"  Created segmentation job: {seg_job_id} (Status: {s_res.status_code})")

    # 3. Hit the Modal endpoint
    print(f"\n[3/4] Sending POST request to Modal cloud GPU...")
    print(f"  Endpoint: {MODAL_ENDPOINT}")
    
    params = {
        "seg_job_id": seg_job_id,
        "pipeline_job_id": pipeline_job_id,
        "category": "top",
    }
    
    start_time = datetime.utcnow()
    # Modal cold-starts can take ~20-30 seconds to spin up the GPU container on the first request
    r = requests.post(MODAL_ENDPOINT, params=params, timeout=300)
    duration = (datetime.utcnow() - start_time).total_seconds()
    
    print(f"  Request finished in {duration:.2f} seconds")
    print(f"  Status code: {r.status_code}")
    print(f"  Response   : {r.text[:500]}")

    # 4. Verify DB updates
    if r.status_code == 200:
        print("\n[4/4] Verifying database updates...")
        job_after = db_store.fetch_job(seg_job_id)
        parent_resp = requests.get(
            f"{supabase_client.SUPABASE_URL}/rest/v1/ingestion_pipeline_jobs?job_id=eq.{pipeline_job_id}",
            headers=supabase_client.get_headers(),
        ).json()[0]
        
        print(f"  segmentation_job.current_state  : {job_after.get('current_state')}")
        print(f"  segmentation_job.final_image_url: {job_after.get('final_image_url')}")
        print(f"  parent_job.current_state        : {parent_resp.get('current_state')}")
        print(f"  parent_job.segmented_image_url  : {parent_resp.get('segmented_image_url')}")
    else:
        print("\n[FAIL] Modal endpoint returned error response.")
    print("=" * 60)


if __name__ == "__main__":
    main()
