import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { getArtifacts, saveArtifact } from '../domain/artifacts';
import { updateJob } from '../domain/job-catalog';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { classifyImage, selectVtonImage } from '../adapters/siglip';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'identifying' });

export class IdentificationHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    const rawImages = await getArtifacts(job.job_id, 'raw_image');
    if (rawImages.length === 0) throw new Error('No raw_image artifacts found');
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id } = job;
    logger.info({ jobId: job_id }, 'classifying images');

    const rawImages = await getArtifacts(job_id, 'raw_image');

    // Classify each image individually (Modal endpoint takes one image at a time)
    const classifications = await Promise.all(
      rawImages.map(async (artifact) => {
        const publicUrl = (artifact.data as Record<string, unknown>)['public_url'] as string;
        const result = await classifyImage(publicUrl, job.product_type, job.product_gender_type);
        return { artifact, result };
      }),
    );

    // Save one artifact per image
    for (const { artifact, result } of classifications) {
      await saveArtifact({
        jobId:        job_id,
        stepName:     'identifying',
        artifactType: 'image_classification',
        storagePath:  artifact.storage_path ?? undefined,
        data: {
          public_url:    result.imageUrl,
          storage_path:  artifact.storage_path ?? null,
          category:      result.category,
          stage1_winner: result.stage1Winner,
          stage1_labels: result.stage1Labels,
          stage1_probs:  result.stage1Probs,
          stage2_winner: result.stage2Winner,
          stage2_labels: result.stage2Labels,
          stage2_probs:  result.stage2Probs,
          stage1_uncertain: result.stage1Uncertain,
          stage2_uncertain: result.stage2Uncertain,
        },
      });
    }

    logger.info({ jobId: job_id, count: classifications.length }, 'classifications saved');

    // Pick best VTON image
    const selected = selectVtonImage(
      classifications.map((c) => c.result),
      job.v_ton_image_preference,
    );

    if (!selected) throw new Error('Could not select a VTON image from classifications');

    await saveArtifact({
      jobId:        job_id,
      stepName:     'identifying',
      artifactType: 'vton_image_selection',
      data: {
        public_url: selected.imageUrl,
        category:   selected.category,
        stage1_uncertain: selected.stage1Uncertain,
        stage2_uncertain: selected.stage2Uncertain,
        source:     'auto',
      },
    });

    await updateJob(job_id, { v_ton_preferred_image: selected.imageUrl });
    logger.info({ jobId: job_id, category: selected.category }, 'vton image selected');

    const updatedJob = { ...job, v_ton_preferred_image: selected.imageUrl };
    await advanceAndTrigger(updatedJob);
  }
}
