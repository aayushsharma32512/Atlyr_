import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { getLatestArtifact } from '../domain/artifacts';
import { updateJob } from '../domain/job-catalog';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { resolveVtonModel } from '../adapters/vton/index';
import { persistVtonResult } from './persist-vton-result';
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

    // This step is the expensive one — a 2K Gemini image, 40-160s and billed per generation. Two
    // separate paths can leave a finished image sitting here before the state has advanced:
    //
    //  · the instant path saves the artifact several awaits BEFORE advanceAndTrigger moves the
    //    state, so a process killed in that window leaves an already-paid-for image with
    //    current_state still 'generating_vton'. Boot recovery re-dispatches this step, and
    //    without this guard we would buy the same image twice.
    //  · the economy lane writes the artifact from the batch poller, out of band and hours later,
    //    then resumes the job through this same edge.
    //
    // Either way the image is already ours. Reuse it and carry the job forward.
    //
    // Safe against a deliberate re-run: "Restart from generating_vton" calls
    // deleteArtifactsForSteps first, so the artifact is gone and generation proceeds normally.
    const existing = await getLatestArtifact(job_id, 'vton_image');
    const existingData = existing?.data as { public_url?: string; route_used?: string } | undefined;
    const existingUrl = existingData?.public_url;
    if (existingUrl) {
      logger.info(
        { jobId: job_id, publicUrl: existingUrl, route: existingData?.route_used ?? 'unknown' },
        'vton image already exists, reusing instead of regenerating',
      );
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

    const { publicUrl } = await persistVtonResult({
      jobId: job_id,
      bytes: result.bytes,
      mimeType: result.mimeType,
      modelUsed: result.modelUsed,
      // The router reports which pool actually served the call. Providers that do not route
      // (FASHN, seedream) report nothing, and 'instant' is the honest label for those.
      routeUsed: result.routeUsed ?? 'instant',
      attempted: result.attempted,
      inferenceMs: result.inferenceMs,
      usage: result.usage,
    });

    logger.info(
      { jobId: job_id, model: result.modelUsed, route: result.routeUsed, inferenceMs: result.inferenceMs },
      'vton image saved',
    );

    const updatedJob = { ...job, vton_image_url: publicUrl };
    await advanceAndTrigger(updatedJob);
  }
}
