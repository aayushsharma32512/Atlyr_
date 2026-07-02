import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { getLatestArtifact, saveArtifact } from '../domain/artifacts';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { generateGarmentSummary, GHOST_PROMPT_VERSION } from '../adapters/gemini';
import { config } from '../config/index';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'garment-summary' });

function resolveCategory(
  job: IngestionPipelineJob,
): 'topwear' | 'bottomwear' | 'dress' {
  const raw = (job.product_type ?? '').toLowerCase();
  if (raw === 'bottomwear') return 'bottomwear';
  if (raw === 'dress' || raw === 'dresses') return 'dress';
  return 'topwear';
}

export class GarmentSummaryHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.v_ton_preferred_image) {
      throw new Error('v_ton_preferred_image is not set — identifying step must run first');
    }
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id, v_ton_preferred_image, product_url } = job;
    logger.info({ jobId: job_id }, 'generating garment summary');

    const category = resolveCategory(job);
    const crawlMeta = await getLatestArtifact(job_id, 'crawl_meta');
    const finalUrl = (crawlMeta?.data as Record<string, unknown>)?.['final_url'] as string | undefined;
    const productLink = finalUrl ?? product_url;

    const summary = await generateGarmentSummary(
      v_ton_preferred_image!,
      category,
      productLink,
    );

    await saveArtifact({
      jobId:        job_id,
      stepName:     'generating_garment_summary',
      artifactType: 'garment_summary',
      data: {
        view:             'front',
        tech_pack:        summary.tech_pack,
        garment_physics:  summary.garment_physics,
        item_name:        summary.item_name,
        color_and_fabric: summary.color_and_fabric,
        complexity_level: summary.complexity_level,
        raw:              summary.raw,
        model:            config.GEMINI_TEXT_MODEL,
        prompt_version:   GHOST_PROMPT_VERSION,
      },
    });

    logger.info({ jobId: job_id, complexity: summary.complexity_level, category }, 'garment summary saved');
    await advanceAndTrigger(job);
  }
}
