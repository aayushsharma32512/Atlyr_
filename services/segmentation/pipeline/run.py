import argparse
import sys
import os
import uuid
from datetime import datetime

# Ensure root services/segmentation is in path
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from pipeline import (
    run_segmentation_pipeline,
    get_job_state,
    get_completed_steps,
    get_failed_step,
    clear_from_step
)

def print_status(output_dir: str):
    """Utility to print step results cleanly in the terminal."""
    if not os.path.exists(output_dir):
        print(f"Output directory does not exist: {output_dir}")
        return
        
    state = get_job_state(output_dir)
    print(f"\n==========================================")
    print(f"Segmentation Job Status")
    print(f"==========================================")
    print(f"Overarching State: {state}")
    
    completed = get_completed_steps(output_dir)
    failed = get_failed_step(output_dir)
    
    # List in order of STEP_ORDER
    from pipeline.state_machine import STEP_ORDER
    print("\nSteps Detail:")
    idx = 1
    for stage in STEP_ORDER:
        for step in stage['steps']:
            status_str = "pending"
            duration_str = ""
            if step in completed:
                status_str = "[OK] completed"
                res = completed[step]
                if res.started_at and res.completed_at:
                    try:
                        # parse datetime strings: '2026-07-03T12:00:00.123456Z'
                        fmt = "%Y-%m-%dT%H:%M:%S.%fZ"
                        s_str = res.started_at.split('+')[0]
                        e_str = res.completed_at.split('+')[0]
                        
                        s_time = datetime.strptime(s_str, fmt)
                        e_time = datetime.strptime(e_str, fmt)
                        duration_str = f"({(e_time - s_time).total_seconds():.1f}s)"
                    except Exception as err:
                        # Fallback parsing format if microsecond parsing failed
                        try:
                            fmt_fallback = "%Y-%m-%dT%H:%M:%SZ"
                            s_time = datetime.strptime(s_str, fmt_fallback)
                            e_time = datetime.strptime(e_str, fmt_fallback)
                            duration_str = f"({(e_time - s_time).total_seconds():.1f}s)"
                        except Exception:
                            pass
            elif failed and failed.step_name == step:
                status_str = "[FAIL] FAILED"
                
            print(f"[{idx}/8] {step:<20} ... {status_str} {duration_str}")
            idx += 1
            
    if failed:
        print(f"\nError in step '{failed.step_name}':")
        print(f"------------------------------------------")
        print(failed.error)
        print(f"------------------------------------------")
    print(f"==========================================\n")

def main():
    parser = argparse.ArgumentParser(description="Standalone Segmentation Pipeline CLI")
    parser.add_argument("--image", type=str, help="Path to input image")
    parser.add_argument("--output-dir", type=str, help="Target folder for output results")
    parser.add_argument("--category", type=str, default="top", choices=["top", "dress", "skirt", "pants", "footwear"], help="Garment type")
    parser.add_argument("--status", action="store_true", help="Print the current step status of the output directory")
    parser.add_argument("--restart-from", type=str, help="Clear results starting from this step and re-run")
    args = parser.parse_args()

    # Determine output_dir
    output_dir = args.output_dir
    if not output_dir and args.image:
        output_dir = os.path.join(os.path.dirname(os.path.abspath(args.image)), "output_segmentation_pipeline")
        
    if not output_dir:
        print("Error: --output-dir is required if --image is not provided.")
        sys.exit(1)

    output_dir = os.path.abspath(output_dir)

    # 1. Print Status Only
    if args.status:
        print_status(output_dir)
        sys.exit(0)

    # 2. Restart from Step
    if args.restart_from:
        print(f"[Pipeline] Clearing steps starting from: '{args.restart_from}'...")
        clear_from_step(output_dir, args.restart_from)
        print_status(output_dir)

    # 3. Execution
    if not args.image:
        print("Error: --image is required to run the pipeline.")
        sys.exit(1)

    image_path = os.path.abspath(args.image)
    print(f"\n[Pipeline] Starting segmentation for image: {image_path}")
    print(f"[Pipeline] Output directory: {output_dir}")
    print(f"[Pipeline] Resolved initial category: {args.category}")
    
    seg_job_id = str(uuid.uuid4())
    pipeline_job_id = str(uuid.uuid4())
    
    result = run_segmentation_pipeline(
        seg_job_id=seg_job_id,
        pipeline_job_id=pipeline_job_id,
        image_path=image_path,
        category=args.category,
        output_dir=output_dir
    )
    
    if result["status"] == "completed":
        print(f"\n[OK] Pipeline completed successfully!")
        print(f"Final output RGBA path: {result['final_image_path']}")
        print_status(output_dir)
    else:
        print(f"\n[FAIL] Pipeline failed at step '{result['error_step']}':")
        print(result["error"])
        sys.exit(1)

if __name__ == "__main__":
    main()
