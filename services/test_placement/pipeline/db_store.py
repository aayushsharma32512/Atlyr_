import requests
from datetime import datetime
from .supabase_client import SUPABASE_URL, get_headers

def fetch_job(pipeline_job_id: str) -> dict:
    """Gets job info from public.ingestion_pipeline_jobs."""
    url = f"{SUPABASE_URL}/rest/v1/ingestion_pipeline_jobs?job_id=eq.{pipeline_job_id}&select=*"
    response = requests.get(url, headers=get_headers())
    if response.status_code == 200 and len(response.json()) > 0:
        return response.json()[0]
    raise ValueError(f"Job not found for pipeline_job_id: {pipeline_job_id}")

def update_job_placement_result(pipeline_job_id: str, state: str = "completed", placement_url: str = None, error: str = None):
    """Updates status, errors, and placement output URL in public.ingestion_pipeline_jobs."""
    url = f"{SUPABASE_URL}/rest/v1/ingestion_pipeline_jobs?job_id=eq.{pipeline_job_id}"
    payload = {
        "current_state": state,
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    if error:
        payload["last_error"] = error
        payload["last_error_step"] = "placement"
        
    requests.patch(url, headers=get_headers(), json=payload)
