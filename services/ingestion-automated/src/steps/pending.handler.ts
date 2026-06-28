import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';

export class PendingHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.product_url) throw new Error('Missing product_url');
    if (!job.product_gender_type) throw new Error('Missing product_gender_type');
    if (!job.product_type) throw new Error('Missing product_type');
    if (!job.product_sub_type) throw new Error('Missing product_sub_type');
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    await advanceAndTrigger(job);
  }
}
