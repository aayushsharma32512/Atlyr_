import os
import time
import concurrent.futures
from datetime import datetime
from typing import Optional, List, Dict, Any
from .registry import get_adapter
from .types import SegmentationStepInput, SegmentationStepOutput, StepResult
from .state_machine import STEP_ORDER, next_state
from . import result_store
from . import db_store
from . import supabase_client

def run_step(step_name: str, step_order: int, parallel_group: Optional[int], step_input: SegmentationStepInput) -> StepResult:
    """Executes a single step using its resolved adapter, updating the result store."""
    started_at = datetime.utcnow().isoformat() + "Z"
    try:
        adapter = get_adapter(step_name)
        
        # Mark step as in-progress
        in_progress_res = StepResult(
            step_name=step_name,
            step_order=step_order,
            parallel_group=parallel_group,
            status="in_progress",
            started_at=started_at
        )
        result_store.save_step_result(step_input.output_dir, in_progress_res)
        
        # Run execution
        adapter.validate(step_input)
        output = adapter.run(step_input)
        
        completed_at = datetime.utcnow().isoformat() + "Z"
        res = StepResult(
            step_name=step_name,
            step_order=step_order,
            parallel_group=parallel_group,
            status="completed",
            output=output.to_dict(),
            started_at=started_at,
            completed_at=completed_at
        )
        result_store.save_step_result(step_input.output_dir, res)
        return res
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        completed_at = datetime.utcnow().isoformat() + "Z"
        
        res = StepResult(
            step_name=step_name,
            step_order=step_order,
            parallel_group=parallel_group,
            status="failed",
            error=error_msg,
            started_at=started_at,
            completed_at=completed_at
        )
        result_store.save_step_result(step_input.output_dir, res)
        return res

def run_segmentation_pipeline(
    seg_job_id: str,
    pipeline_job_id: str,
    image_path: str,
    category: str = 'top',
    output_dir: str = None,
    config: dict = None
) -> dict:
    """
    Main orchestration entrypoint for running the segmentation steps sequentially & in parallel
    with crash recovery.
    """
    if not output_dir:
        if image_path:
            output_dir = os.path.dirname(image_path)
        else:
            output_dir = os.path.join(os.getcwd(), "output_segmentation_pipeline")
        
    os.makedirs(output_dir, exist_ok=True)
    
    use_db = bool(seg_job_id) or result_store.get_db_mode(output_dir)
    
    if use_db:
        print(f"[Pipeline] Database mode active for seg_job_id: {seg_job_id}")
        try:
            job = db_store.fetch_job(seg_job_id)
            pipeline_config_id = job.get("pipeline_config_id")
            pipeline_job_id = job.get("pipeline_job_id")
            vton_image_url = job.get("vton_image_url")
            
            # Initialize db mode in result store
            result_store.init_db_mode(output_dir, seg_job_id, pipeline_config_id)
            
            # Resolve remote VTON image locally
            print(f"[Pipeline] Resolving VTON image path: {vton_image_url}")
            image_path = result_store.ensure_local_file(vton_image_url, output_dir)
        except Exception as e:
            import traceback
            err_msg = f"Failed to initialize database mode: {str(e)}\n{traceback.format_exc()}"
            print(f"[Pipeline] Error during DB initialization: {err_msg}")
            return {
                "status": "failed",
                "error_step": "initialize",
                "error": err_msg
            }
            
    # Initialize overall job state in result_store if not set
    current_state = result_store.get_job_state(output_dir)
    if current_state == "pending" or current_state == "":
        result_store.update_job_state(output_dir, "pending")
        
    # Get all completed steps to populate prior_results (supports crash recovery)
    completed_steps = result_store.get_completed_steps(output_dir)
    prior_results = {name: res.output for name, res in completed_steps.items()}
    
    step_order_idx = 1
    
    for stage in STEP_ORDER:
        state_name = stage['state']
        steps = stage['steps']
        is_parallel = stage['parallel']
        parallel_group = 1 if is_parallel else None
        
        # Check if stage is already fully completed
        stage_completed = all(step in completed_steps for step in steps)
        
        if stage_completed:
            result_store.update_job_state(output_dir, state_name)
            step_order_idx += len(steps)
            continue
            
        # Check if job is currently failed (must be manually restarted/cleared)
        failed_step = result_store.get_failed_step(output_dir)
        if failed_step:
            res_fail = {
                "status": "failed",
                "error_step": failed_step.step_name,
                "error": failed_step.error
            }
            if use_db:
                db_store.update_job_db_state(seg_job_id, "failed", error=failed_step.error, error_step=failed_step.step_name)
            return res_fail
            
        # Transition overarching state
        result_store.update_job_state(output_dir, state_name)
        
        # Prepare inputs for this stage's steps
        step_inputs = []
        for i, step_name in enumerate(steps):
            order = step_order_idx + i
            step_input = SegmentationStepInput(
                seg_job_id=seg_job_id,
                pipeline_job_id=pipeline_job_id,
                image_path=image_path,
                step_config=config.get(step_name, {}) if config else {},
                prior_results=prior_results,
                output_dir=output_dir,
                category=category
            )
            step_inputs.append((step_name, order, parallel_group, step_input))
            
        stage_results = []
        if is_parallel and len(steps) > 1:
            # Parallel execution round
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(steps)) as executor:
                futures = {
                    executor.submit(run_step, name, order, p_grp, inp): name 
                    for name, order, p_grp, inp in step_inputs
                }
                for future in concurrent.futures.as_completed(futures):
                    stage_results.append(future.result())
        else:
            # Sequential execution round
            for name, order, p_grp, inp in step_inputs:
                res = run_step(name, order, p_grp, inp)
                stage_results.append(res)
                if res.status == "failed":
                    break
                    
        # Check if any step failed in this stage
        failed = [res for res in stage_results if res.status == "failed"]
        if failed:
            result_store.update_job_state(output_dir, "failed")
            res_fail = {
                "status": "failed",
                "error_step": failed[0].step_name,
                "error": failed[0].error
            }
            if use_db:
                db_store.update_job_db_state(seg_job_id, "failed", error=failed[0].error, error_step=failed[0].step_name)
            return res_fail
            
        # Cache outputs of completed steps
        for res in stage_results:
            prior_results[res.step_name] = res.output
            completed_steps[res.step_name] = res
            
        step_order_idx += len(steps)
        
    # All stages completed successfully
    result_store.update_job_state(output_dir, "completed")
    
    # Resolves final image path (fallback from combine -> fashn_seg_refine -> sam_v2)
    final_output = prior_results.get("combine") or prior_results.get("fashn_seg_refine") or prior_results.get("sam_v2")
    final_path = final_output.get("output_path") if final_output else None
    
    # If in DB mode: upload final combined image to storage and update DB tables
    if use_db and final_path:
        try:
            print(f"[Pipeline] Uploading final segmentation image to storage: {final_path}")
            final_url = supabase_client.upload_file_to_storage(final_path, f"{pipeline_job_id}/segmentation/final.png", "image/png")
            print(f"[Pipeline] Final image uploaded successfully: {final_url}")
            
            # Update database states
            db_store.update_job_db_state(seg_job_id, "completed", final_image_url=final_url)
            db_store.update_parent_job_url(pipeline_job_id, final_url)
            print("[Pipeline] DB tables updated successfully!")
        except Exception as e:
            import traceback
            err_msg = f"Failed to complete DB upload: {str(e)}\n{traceback.format_exc()}"
            print(f"[Pipeline] DB upload error: {err_msg}")
            # Mark job as failed in DB since it failed to update
            db_store.update_job_db_state(seg_job_id, "failed", error=err_msg, error_step="finalization")
            return {
                "status": "failed",
                "error_step": "finalization",
                "error": err_msg
            }
            
    return {
        "status": "completed",
        "final_image_path": final_path,
        "results": prior_results
    }

