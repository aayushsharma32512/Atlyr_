import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { updateJob } from '../domain/job-catalog';
import { saveArtifact } from '../domain/artifacts';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'generating_vton' });

export class VtonHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.v_ton_preferred_image) {
      throw new Error('v_ton_preferred_image is not set — identifying step must run first');
    }
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id, v_ton_preferred_image } = job;
    logger.info({ jobId: job_id }, 'mocking vton tryon generation (pass-through)');

    // Save mock tryon image artifact
    await saveArtifact({
      jobId:        job_id,
      stepName:     'generating_vton',
      artifactType: 'tryon_image',
      data: {
        imageUrl: v_ton_preferred_image,
        storagePath: null,
        modelUsed: 'mock-pass-through',
        inferenceMs: 0,
        createdAt: new Date().toISOString(),
      },
    });

    // Update parent job vton_image_url
    await updateJob(job_id, { vton_image_url: v_ton_preferred_image });
    logger.info({ jobId: job_id }, 'vton image url updated');

    const updatedJob = { ...job, vton_image_url: v_ton_preferred_image };
    await advanceAndTrigger(updatedJob);
  }
}
