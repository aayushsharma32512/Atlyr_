import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { saveArtifact } from '../domain/artifacts';
import { updateState } from '../domain/job-catalog';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'placement' });

export class PlacementHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.segmented_image_url) {
      throw new Error('segmented_image_url is not set — segmenting step must run first');
    }
    if (!job.vton_image_url) {
      throw new Error('vton_image_url is not set — tryon step must run first');
    }
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id, segmented_image_url, vton_image_url } = job;
    logger.info({ jobId: job_id }, 'starting automated garment placement');

    const modalUrl = process.env.MODAL_PLACEMENT_URL;
    if (!modalUrl) {
      throw new Error('MODAL_PLACEMENT_URL is not set in environment variables');
    }

    const triggerUrl = `${modalUrl}/?pipeline_job_id=${job_id}&segmented_image_url=${encodeURIComponent(segmented_image_url!)}&vton_image_url=${encodeURIComponent(vton_image_url!)}`;

    const res = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Modal placement request failed (${res.status}): ${errText}`);
    }

    const modalResult = (await res.json()) as { status: string; final_image_url: string; selected_mannequin?: string };
    if (modalResult.status !== 'success' && modalResult.status !== 'completed' || !modalResult.final_image_url) {
      throw new Error(`Modal placement pipeline failed: ${JSON.stringify(modalResult)}`);
    }

    logger.info(
      { jobId: job_id, mannequin: modalResult.selected_mannequin, finalUrl: modalResult.final_image_url },
      'Modal placement completed successfully'
    );

    // Save placement artifact
    await saveArtifact({
      jobId: job_id,
      stepName: 'placement',
      artifactType: 'placement',
      data: {
        placedImageUrl: modalResult.final_image_url,
        selectedMannequin: modalResult.selected_mannequin,
        createdAt: new Date().toISOString(),
      },
    });

    await updateState(job_id, 'completed');
  }
}
