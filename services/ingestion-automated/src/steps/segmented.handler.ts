import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'segmented' });

export class SegmentedHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.segmented_image_url) {
      throw new Error('segmented_image_url is not set — segmenting step must run first');
    }
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id } = job;
    logger.info({ jobId: job_id }, 'segmentation verified, advancing to placement');
    await advanceAndTrigger(job);
  }
}
