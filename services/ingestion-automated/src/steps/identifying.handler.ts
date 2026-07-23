import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { getArtifacts, saveArtifact } from '../domain/artifacts';
import { updateJob } from '../domain/job-catalog';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import {
  classifyImage, selectVtonImage, buildSlots, pickPreferredSlot, winningScore, SLOT_LABEL,
  type ClassificationInput,
} from '../adapters/siglip';
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

    // Resolve the 4 named slots (Front·Model, Front·Flat, Back·Model, Back·Flat) and pick
    // the preferred one per job.v_ton_image_preference (defaults to 'model' if unset).
    const items: ClassificationInput[] = classifications.map(({ result }) => ({
      imageUrl:  result.imageUrl,
      stage1:    result.stage1Winner,
      stage2:    result.stage2Winner,
      score:     winningScore(result.stage2Labels, result.stage2Probs, result.stage2Winner),
      uncertain: result.stage1Uncertain || result.stage2Uncertain,
      manual:    false,
      overriddenAt: null,
    }));
    const slots = buildSlots(items);
    const preferredKey = pickPreferredSlot(slots, job.v_ton_image_preference?.type);
    const preferred = preferredKey ? slots[preferredKey] : null;

    // Fallback for jobs where nothing landed in any of the 4 named slots (e.g. only
    // Side / Macro Detail shots were scraped) — never leave a job without a pick.
    const fallback = preferred ? null : selectVtonImage(classifications.map((c) => c.result), job.v_ton_image_preference);
    const finalUrl = preferred?.publicUrl ?? fallback?.imageUrl ?? null;
    if (!finalUrl) throw new Error('Could not select a VTON image from classifications');

    await saveArtifact({
      jobId:        job_id,
      stepName:     'identifying',
      artifactType: 'vton_image_selection',
      data: {
        // Kept at top level for backward-compat with existing readers (ImagePreviewStrip.tsx).
        public_url: finalUrl,
        category:   preferredKey ? SLOT_LABEL[preferredKey] : fallback?.category ?? null,
        stage1_uncertain: preferred?.uncertain ?? fallback?.stage1Uncertain ?? false,
        stage2_uncertain: false,
        source:     'auto',
        // Full slot breakdown, so the dashboard can render/retag all 4 rather than just the winner.
        slots,
        preferred_slot: preferredKey,
        preference_type: job.v_ton_image_preference?.type ?? null,
      },
    });

    await updateJob(job_id, { v_ton_preferred_image: finalUrl });
    logger.info({ jobId: job_id, preferredKey }, 'vton image selected');

    const updatedJob = { ...job, v_ton_preferred_image: finalUrl };
    await advanceAndTrigger(updatedJob);
  }
}
