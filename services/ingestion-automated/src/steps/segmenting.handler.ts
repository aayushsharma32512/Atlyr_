import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { supabaseAdmin } from '../db/supabase';
import { saveArtifact } from '../domain/artifacts';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'segmenting' });

export class SegmentingHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.vton_image_url) {
      throw new Error('vton_image_url is not set — tryon step must run first');
    }
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id, vton_image_url } = job;
    logger.info({ jobId: job_id }, 'starting automated segmentation');

    // 1. Fetch the active config ID
    const { data: configs, error: configErr } = await supabaseAdmin
      .from('segmentation_pipeline_config')
      .select('id')
      .eq('is_active', true)
      .limit(1);

    if (configErr) {
      throw new Error(`Failed to fetch active config: ${configErr.message}`);
    }
    if (!configs || configs.length === 0) {
      throw new Error('No active segmentation pipeline configuration found');
    }
    const configId = configs[0].id;

    // 2. Clean up any existing job record for this pipeline job to prevent unique constraint error
    await supabaseAdmin
      .from('segmentation_jobs')
      .delete()
      .eq('pipeline_job_id', job_id);

    // 3. Create the segmentation job in pending state
    const { data: segJob, error: segErr } = await supabaseAdmin
      .from('segmentation_jobs')
      .insert({
        pipeline_job_id: job_id,
        pipeline_config_id: configId,
        vton_image_url: vton_image_url,
        current_state: 'pending',
      })
      .select()
      .single();

    if (segErr || !segJob) {
      throw new Error(`Failed to create segmentation job: ${segErr?.message ?? 'Unknown error'}`);
    }

    // Resolve category
    let category = 'top';
    const prodType = (job.product_type ?? '').toLowerCase();
    if (prodType.includes('bottom')) category = 'bottom';
    else if (prodType.includes('dress')) category = 'dress';

    logger.info({ jobId: job_id, segJobId: segJob.seg_job_id, category }, 'triggering Modal segmentation endpoint');

    // 4. Trigger Modal cloud GPU endpoint synchronously
    const modalUrl = process.env.MODAL_SEGMENTATION_URL || 'https://nahmahn--atlyr-segmentation-segment.modal.run';
    const triggerUrl = `${modalUrl}/?seg_job_id=${segJob.seg_job_id}&pipeline_job_id=${job_id}&category=${category}`;

    const res = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Modal segmentation request failed (${res.status}): ${errText}`);
    }

    const modalResult = (await res.json()) as { status: string; final_image_url: string };
    if (modalResult.status !== 'success' && modalResult.status !== 'completed' || !modalResult.final_image_url) {
      throw new Error(`Modal segmentation pipeline failed: ${JSON.stringify(modalResult)}`);
    }

    logger.info({ jobId: job_id, finalUrl: modalResult.final_image_url }, 'Modal segmentation completed successfully');

    // 5. Save the final segmentation artifact
    await saveArtifact({
      jobId:        job_id,
      stepName:     'segmenting',
      artifactType: 'segmentation',
      data: {
        segmentedImageUrl: modalResult.final_image_url,
        configName: 'v1',
        createdAt: new Date().toISOString(),
      },
    });

    // We mutate the job parameter directly to pass the updated state to advanceAndTrigger
    const updatedJob = { ...job, segmented_image_url: modalResult.final_image_url };
    await advanceAndTrigger(updatedJob);
  }
}
