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

    // This step is the expensive one — a 2K Gemini image, 40-160s and billed per generation. The
    // image is saved (artifact + vton_image_url) several awaits BEFORE advanceAndTrigger moves the
    // state, so a process killed in that window leaves a finished, already-paid-for image behind
    // with current_state still 'generating_vton'. Boot recovery then re-dispatches this step, and
    // without this guard we would buy the same image twice.
    //
    // Safe against a deliberate re-run: "Restart from generating_vton" calls
    // deleteArtifactsForSteps first, so the artifact is gone and generation proceeds normally.
    const existing = await getLatestArtifact(job_id, 'vton_image');
    const existingUrl = (existing?.data as { public_url?: string } | undefined)?.public_url;
    if (existingUrl) {
      logger.info({ jobId: job_id, publicUrl: existingUrl }, 'vton image already generated, reusing instead of regenerating');
      if (!job.vton_image_url) await updateJob(job_id, { vton_image_url: existingUrl });
      await advanceAndTrigger({ ...job, vton_image_url: existingUrl });
      return;
    }

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
        route_used: result.routeUsed ?? null,
        attempted: result.attempted?.length ? result.attempted : null,
        inference_ms: result.inferenceMs,
        usage: result.usage ?? null,
      },
    });

    await updateJob(job_id, { vton_image_url: publicUrl });

    logger.info({ jobId: job_id, model: result.modelUsed, route: result.routeUsed, inferenceMs: result.inferenceMs }, 'vton image saved');

    const updatedJob = { ...job, vton_image_url: publicUrl };
    await advanceAndTrigger(updatedJob);
  }
}
