import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { getArtifacts, saveArtifact } from '../domain/artifacts';
import { updateJob } from '../domain/job-catalog';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { classifyImages, selectVtonImage } from '../adapters/siglip';
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

    // Collect public URLs for bulk SigLIP call
    const publicUrls = rawImages.map((a) => (a.data as Record<string, unknown>)['public_url'] as string);

    const classifications = await classifyImages(publicUrls);
    logger.info({ jobId: job_id, count: classifications.length }, 'siglip classifications received');

    // Save one artifact per image
    for (const cls of classifications) {
      const rawImage = rawImages.find(
        (a) => (a.data as Record<string, unknown>)['public_url'] === cls.imageUrl
      );
      await saveArtifact({
        jobId:        job_id,
        stepName:     'identifying',
        artifactType: 'image_classification',
        storagePath:  rawImage?.storage_path ?? null,
        data: {
          public_url:   cls.imageUrl,
          storage_path: rawImage?.storage_path ?? null,
          label:        cls.label,
          confidence:   cls.confidence,
        },
      });
    }

    // Select the best image for VTON
    const selected = selectVtonImage(classifications, job.v_ton_image_preference);
    if (!selected) throw new Error('Could not select a VTON image from classifications');

    const selectionReason = job.v_ton_image_preference
      ? `preference:${job.v_ton_image_preference.type}`
      : `priority:${selected.label}`;

    await saveArtifact({
      jobId:        job_id,
      stepName:     'identifying',
      artifactType: 'vton_image_selection',
      data: {
        public_url:       selected.imageUrl,
        label:            selected.label,
        confidence:       selected.confidence,
        selection_reason: selectionReason,
        source:           'auto',
      },
    });

    await updateJob(job_id, { v_ton_preferred_image: selected.imageUrl });
    logger.info({ jobId: job_id, label: selected.label, reason: selectionReason }, 'vton image selected');

    // Reload job so advance-and-trigger sees updated hitl flag
    const updatedJob = { ...job, v_ton_preferred_image: selected.imageUrl };
    await advanceAndTrigger(updatedJob);
  }
}
