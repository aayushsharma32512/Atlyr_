import os
import json
import threading
import urllib.request
from typing import Dict, Optional
from .types import StepResult
from . import db_store
from . import supabase_client

STATUS_FILENAME = "segmentation_job_status.json"
_file_lock = threading.Lock()

# Mapping to store DB configuration: output_dir -> {"seg_job_id": str, "pipeline_config_id": str}
_db_job_configs = {}

def init_db_mode(output_dir: str, seg_job_id: str, pipeline_config_id: str):
    """Initializes database mode for the given output directory."""
    _db_job_configs[output_dir] = {
        "seg_job_id": seg_job_id,
        "pipeline_config_id": pipeline_config_id
    }

def get_db_config(output_dir: str) -> Optional[dict]:
    return _db_job_configs.get(output_dir)

def get_db_mode(output_dir: str) -> bool:
    """Returns True if database mode has been initialized for the given output directory."""
    return output_dir in _db_job_configs

def ensure_local_file(path_or_url: str, output_dir: str) -> str:
    """Helper to download file locally if it is a remote URL with SSRF protection."""
    if not path_or_url:
        return path_or_url
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        # Prevent SSRF: block loopback, link-local, and private IP subnets
        from urllib.parse import urlparse
        import socket
        parsed_url = urlparse(path_or_url)
        hostname = parsed_url.hostname
        if hostname:
            try:
                ip = socket.gethostbyname(hostname)
                if (ip.startswith("127.") or 
                    ip.startswith("10.") or 
                    ip.startswith("192.168.") or 
                    ip.startswith("169.254.") or
                    any(ip.startswith(f"172.{sub}.") for sub in range(16, 32))):
                    raise ValueError(f"SSRF Prevention: Blocked connection to private IP address {ip}")
            except Exception as e:
                if "SSRF Prevention" in str(e):
                    raise e
                # Allow standard DNS resolution failure to propagate to urlretrieve

        filename = path_or_url.split("/")[-1]
        local_path = os.path.join(output_dir, filename)
        if not os.path.exists(local_path):
            os.makedirs(output_dir, exist_ok=True)
            print(f"[result_store] Downloading {path_or_url} to {local_path}...")
            urllib.request.urlretrieve(path_or_url, local_path)
        return local_path
    return path_or_url

def translate_paths_to_local(output_dict: dict, output_dir: str) -> dict:
    """Recursively downloads and resolves paths in output data."""
    if not output_dict:
        return output_dict
    res = output_dict.copy()
    if "output_path" in res:
        res["output_path"] = ensure_local_file(res["output_path"], output_dir)
    if "mask_path" in res:
        res["mask_path"] = ensure_local_file(res["mask_path"], output_dir)
    if "metadata" in res and res["metadata"]:
        meta = res["metadata"].copy()
        for k, v in meta.items():
            if k.endswith("_path") and isinstance(v, str):
                meta[k] = ensure_local_file(v, output_dir)
        res["metadata"] = meta
    return res

def upload_step_files(seg_job_id: str, result: StepResult) -> dict:
    """Uploads local outputs from a step to storage, returning public URLs."""
    if not result.output:
        return {}
        
    translated = result.output.copy()
    step = result.step_name
    
    if result.output.get("output_path"):
        local = result.output["output_path"]
        if os.path.exists(local):
            ext = local.split(".")[-1]
            path = f"segmentation/{seg_job_id}/steps/{step}.{ext}"
            translated["output_path"] = supabase_client.upload_file_to_storage(local, path, f"image/{ext}")
        
    if result.output.get("mask_path"):
        local = result.output["mask_path"]
        if os.path.exists(local):
            ext = local.split(".")[-1]
            path = f"segmentation/{seg_job_id}/steps/{step}_mask.{ext}"
            translated["mask_path"] = supabase_client.upload_file_to_storage(local, path, f"image/{ext}")
        
    if result.output.get("metadata"):
        meta = result.output["metadata"].copy()
        for k, v in meta.items():
            if k.endswith("_path") and isinstance(v, str) and os.path.exists(v):
                ext = v.split(".")[-1]
                path = f"segmentation/{seg_job_id}/steps/{step}_{k}.{ext}"
                ct = "application/octet-stream" if ext == "npy" else f"image/{ext}"
                meta[k] = supabase_client.upload_file_to_storage(v, path, ct)
        translated["metadata"] = meta
        
    return translated

def _get_status_path(output_dir: str) -> str:
    return os.path.join(output_dir, STATUS_FILENAME)

def _load_status(output_dir: str) -> dict:
    path = _get_status_path(output_dir)
    if not os.path.exists(path):
        return {"current_state": "pending", "steps": {}}
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return {"current_state": "pending", "steps": {}}

def _save_status(output_dir: str, status_data: dict):
    os.makedirs(output_dir, exist_ok=True)
    path = _get_status_path(output_dir)
    with open(path, "w") as f:
        json.dump(status_data, f, indent=2)

def save_step_result(output_dir: str, result: StepResult):
    """Saves the result of a single step to local JSON and DB (if active)."""
    db_cfg = get_db_config(output_dir)
    if db_cfg:
        seg_job_id = db_cfg["seg_job_id"]
        pipeline_config_id = db_cfg["pipeline_config_id"]
        
        db_result = StepResult(
            step_name=result.step_name,
            step_order=result.step_order,
            parallel_group=result.parallel_group,
            status=result.status,
            output=result.output,
            error=result.error,
            started_at=result.started_at,
            completed_at=result.completed_at
        )
        
        if result.status == "completed" and result.output:
            try:
                db_result.output = upload_step_files(seg_job_id, result)
            except Exception as e:
                db_result.status = "failed"
                db_result.error = f"Storage Upload Failed: {str(e)}"
                result.status = "failed"
                result.error = db_result.error
                
        db_store.save_step_result_db(seg_job_id, pipeline_config_id, db_result)
        
    with _file_lock:
        status = _load_status(output_dir)
        status["steps"][result.step_name] = result.to_dict()
        _save_status(output_dir, status)

def get_completed_steps(output_dir: str) -> dict:
    """Returns a dict of all completed StepResult objects by step_name."""
    db_cfg = get_db_config(output_dir)
    if db_cfg:
        seg_job_id = db_cfg["seg_job_id"]
        completed = db_store.get_completed_steps_db(seg_job_id)
        for name, res in completed.items():
            res.output = translate_paths_to_local(res.output, output_dir)
        return completed
        
    with _file_lock:
        status = _load_status(output_dir)
        
    completed = {}
    for name, data in status.get("steps", {}).items():
        if data.get("status") == "completed":
            completed[name] = StepResult(
                step_name=data["step_name"],
                step_order=data["step_order"],
                parallel_group=data["parallel_group"],
                status=data["status"],
                output=data.get("output"),
                error=data.get("error"),
                started_at=data.get("started_at"),
                completed_at=data.get("completed_at")
            )
    return completed

def get_failed_step(output_dir: str) -> Optional[StepResult]:
    """Returns the first failed step if any exists."""
    db_cfg = get_db_config(output_dir)
    if db_cfg:
        seg_job_id = db_cfg["seg_job_id"]
        return db_store.get_failed_step_db(seg_job_id)
        
    with _file_lock:
        status = _load_status(output_dir)
        
    for name, data in status.get("steps", {}).items():
        if data.get("status") == "failed":
            return StepResult(
                step_name=data["step_name"],
                step_order=data["step_order"],
                parallel_group=data["parallel_group"],
                status=data["status"],
                output=data.get("output"),
                error=data.get("error"),
                started_at=data.get("started_at"),
                completed_at=data.get("completed_at")
            )
    return None

def update_job_state(output_dir: str, state: str):
    """Updates the overarching current state of the job."""
    db_cfg = get_db_config(output_dir)
    if db_cfg:
        seg_job_id = db_cfg["seg_job_id"]
        db_store.update_job_db_state(seg_job_id, state)
        
    with _file_lock:
        status = _load_status(output_dir)
        status["current_state"] = state
        _save_status(output_dir, status)

def get_job_state(output_dir: str) -> str:
    """Gets the current overarching state of the job."""
    db_cfg = get_db_config(output_dir)
    if db_cfg:
        seg_job_id = db_cfg["seg_job_id"]
        try:
            return db_store.fetch_job(seg_job_id).get("current_state", "pending")
        except Exception:
            pass
            
    with _file_lock:
        return _load_status(output_dir).get("current_state", "pending")

def clear_from_step(output_dir: str, step_name: str):
    """Clears status records for target step and all subsequent steps."""
    db_cfg = get_db_config(output_dir)
    if db_cfg:
        seg_job_id = db_cfg["seg_job_id"]
        db_store.clear_from_step_db(seg_job_id, step_name)
        
    from .state_machine import STEP_ORDER
    ordered_steps = []
    for s in STEP_ORDER:
        ordered_steps.extend(s["steps"])
    
    if step_name not in ordered_steps:
        return
        
    start_idx = ordered_steps.index(step_name)
    steps_to_clear = ordered_steps[start_idx:]
    
    with _file_lock:
        status = _load_status(output_dir)
        for name in list(status.get("steps", {}).keys()):
            if name in steps_to_clear:
                del status["steps"][name]
                
        for s in STEP_ORDER:
            if step_name in s["steps"]:
                status["current_state"] = s["state"]
                break
                
        _save_status(output_dir, status)
