import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { getLatestArtifact, saveArtifact } from '../domain/artifacts';
import { advanceAndTrigger } from '../orchestration/advance-and-trigger';
import { generateGarmentSummary, generateEnrichment, GHOST_PROMPT_VERSION } from '../adapters/gemini';
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
        model:            summary.model_used,
        prompt_version:   GHOST_PROMPT_VERSION,
        usage:            summary.usage,
      },
    });

    logger.info({ jobId: job_id, complexity: summary.complexity_level, category }, 'garment summary saved');

    // Merchandising enrichment (fit/feel/vibes/description_text/color_group/…) — best-effort so an
    // enrichment failure never blocks the pipeline. Mirrors the old HITL `enrichNode` output.
    try {
      const crawl = (crawlMeta?.data ?? {}) as Record<string, unknown>;
      const enrichment = await generateEnrichment(v_ton_preferred_image!, {
        brand:       crawl.brand as string | undefined,
        productName: (crawl.product_name as string | undefined) ?? summary.item_name ?? undefined,
        color:       crawl.color as string | undefined,
        care:        crawl.care as string | undefined,
        description: crawl.description as string | undefined,
      });

      await saveArtifact({
        jobId:        job_id,
        stepName:     'generating_garment_summary',
        artifactType: 'enrichment',
        data: {
          type_category:           enrichment.type_category,
          color_group:             enrichment.color_group,
          fit:                     enrichment.fit,
          feel:                    enrichment.feel,
          vibes:                   enrichment.vibes,
          occasion:                enrichment.occasion,
          care:                    enrichment.care,
          material_type:           enrichment.material_type,
          description_text:        enrichment.description_text,
          product_specifications:  enrichment.product_specifications,
          product_name_suggestion: enrichment.product_name_suggestion,
          model:                   enrichment.model_used,
          prompt_version:          enrichment.prompt_version,
          usage:                   enrichment.usage,
        },
      });
      logger.info({ jobId: job_id, model: enrichment.model_used }, 'enrichment saved');
    } catch (err) {
      logger.warn({ jobId: job_id, error: (err as Error).message }, 'enrichment failed (continuing)');
    }

    await advanceAndTrigger(job);
  }
}
