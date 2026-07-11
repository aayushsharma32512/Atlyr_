import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { getLatestArtifact, saveArtifact } from '../domain/artifacts';
import { updateJob } from '../domain/job-catalog';
import { uploadToSupabase } from '../utils/storage';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { resolveVtonModel } from '../adapters/vton/index';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'vton-generation' });

export class VtonGenerationHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.v_ton_preferred_image) {
      throw new Error('v_ton_preferred_image is not set — identifying step must run first');
    }
    const summary = await getLatestArtifact(job.job_id, 'garment_summary');
    if (!summary) throw new Error('garment_summary artifact missing — garment-summary step must run first');
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id } = job;
    logger.info({ jobId: job_id }, 'generating vton image');

    const summaryArtifact = await getLatestArtifact(job_id, 'garment_summary');
    const summary = summaryArtifact!.data as Record<string, unknown>;

    const provider = resolveVtonModel(job);

    const result = await provider.run({
      imageUrl: job.v_ton_preferred_image!,
      gender: job.product_gender_type,
      productType: job.product_type,
      productSubType: job.product_sub_type,
      techPack: (summary.tech_pack as string) ?? '',
      garmentPhysics: (summary.garment_physics as string) ?? '',
      itemName: (summary.item_name as string) ?? '',
      colorAndFabric: (summary.color_and_fabric as string) ?? '',
    });

    const storagePath = `${job_id}/tryon/front.jpg`;
    const publicUrl = await uploadToSupabase(storagePath, result.bytes, result.mimeType);

    await saveArtifact({
      jobId: job_id,
      stepName: 'generating_vton',
      artifactType: 'vton_image',
      storagePath,
      data: {
        public_url: publicUrl,
        model_used: result.modelUsed,
        inference_ms: result.inferenceMs,
      },
    });

    await updateJob(job_id, { vton_image_url: publicUrl });

    logger.info({ jobId: job_id, model: result.modelUsed, inferenceMs: result.inferenceMs }, 'vton image saved');

    const updatedJob = { ...job, vton_image_url: publicUrl };
    await advanceAndTrigger(updatedJob);
  }
}
