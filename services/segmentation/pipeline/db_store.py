import requests
from datetime import datetime
from .supabase_client import SUPABASE_URL, get_headers

def fetch_job(seg_job_id: str) -> dict:
    """Gets job info from the DB."""
    url = f"{SUPABASE_URL}/rest/v1/segmentation_jobs?seg_job_id=eq.{seg_job_id}&select=*"
    response = requests.get(url, headers=get_headers())
    if response.status_code == 200 and len(response.json()) > 0:
        return response.json()[0]
    raise ValueError(f"Job not found for ID: {seg_job_id}")

def update_job_db_state(seg_job_id: str, state: str, final_image_url: str = None, error: str = None, error_step: str = None):
    """Updates status and errors in the DB."""
    url = f"{SUPABASE_URL}/rest/v1/segmentation_jobs?seg_job_id=eq.{seg_job_id}"
    payload = {
        "current_state": state,
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    if final_image_url:
        payload["final_image_url"] = final_image_url
    if error:
        payload["last_error"] = error
        payload["error_count"] = 1
    if error_step:
        payload["last_error_step"] = error_step
        
    requests.patch(url, headers=get_headers(), json=payload)

def update_parent_job_url(pipeline_job_id: str, segmented_image_url: str):
    """Updates the parent ingestion job with the final segmented image URL and advances state to 'segmented'."""
    url = f"{SUPABASE_URL}/rest/v1/ingestion_pipeline_jobs?job_id=eq.{pipeline_job_id}"
    payload = {
        "segmented_image_url": segmented_image_url,
        "current_state": "segmented",
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    requests.patch(url, headers=get_headers(), json=payload)

def save_step_result_db(seg_job_id: str, pipeline_config_id: str, result):
    """Upserts step results into public.segmentation_step_results table."""
    check_url = f"{SUPABASE_URL}/rest/v1/segmentation_step_results?seg_job_id=eq.{seg_job_id}&step_name=eq.{result.step_name}"
    check_response = requests.get(check_url, headers=get_headers())
    
    payload = {
        "seg_job_id": seg_job_id,
        "pipeline_config_id": pipeline_config_id,
        "step_name": result.step_name,
        "step_order": result.step_order,
        "status": result.status,
        "input_image_url": result.output.get("output_path") if result.output else None,
        "output_image_url": result.output.get("output_path") if result.output else None,
        "mask_url": result.output.get("mask_path") if result.output else None,
        "metadata": result.output.get("metadata") if result.output else None,
        "error": result.error,
        "started_at": result.started_at,
        "completed_at": result.completed_at
    }
    
    if check_response.status_code == 200 and len(check_response.json()) > 0:
        requests.patch(check_url, headers=get_headers(), json=payload)
    else:
        requests.post(f"{SUPABASE_URL}/rest/v1/segmentation_step_results", headers=get_headers(), json=payload)

def get_completed_steps_db(seg_job_id: str) -> dict:
    """Retrieves all completed steps for a job from the DB."""
    url = f"{SUPABASE_URL}/rest/v1/segmentation_step_results?seg_job_id=eq.{seg_job_id}&status=eq.completed"
    response = requests.get(url, headers=get_headers())
    completed = {}
    if response.status_code == 200:
        for row in response.json():
            from .types import StepResult
            completed[row["step_name"]] = StepResult(
                step_name=row["step_name"],
                step_order=row["step_order"],
                parallel_group=None,
                status=row["status"],
                output={
                    "step_name": row["step_name"],
                    "output_path": row["output_image_url"],
                    "mask_path": row["mask_url"],
                    "metadata": row["metadata"] or {}
                },
                error=row.get("error"),
                started_at=row.get("started_at"),
                completed_at=row.get("completed_at")
            )
    return completed

def get_failed_step_db(seg_job_id: str):
    """Retrieves first failed step for a job from the DB."""
    url = f"{SUPABASE_URL}/rest/v1/segmentation_step_results?seg_job_id=eq.{seg_job_id}&status=eq.failed"
    response = requests.get(url, headers=get_headers())
    if response.status_code == 200 and len(response.json()) > 0:
        row = response.json()[0]
        from .types import StepResult
        return StepResult(
            step_name=row["step_name"],
            step_order=row["step_order"],
            parallel_group=None,
            status=row["status"],
            output=None,
            error=row.get("error"),
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at")
        )
    return None

def clear_from_step_db(seg_job_id: str, step_name: str):
    """Deletes results for step and all subsequent steps from DB."""
    from .state_machine import STEP_ORDER
    ordered_steps = []
    for s in STEP_ORDER:
        ordered_steps.extend(s["steps"])
    
    if step_name not in ordered_steps:
        return
        
    start_idx = ordered_steps.index(step_name)
    steps_to_clear = ordered_steps[start_idx:]
    
    steps_str = ",".join(f'"{s}"' for s in steps_to_clear)
    url = f"{SUPABASE_URL}/rest/v1/segmentation_step_results?seg_job_id=eq.{seg_job_id}&step_name=in.({steps_str})"
    requests.delete(url, headers=get_headers())
