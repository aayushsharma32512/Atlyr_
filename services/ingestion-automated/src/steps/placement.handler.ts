import type { StepHandler, IngestionPipelineJob } from '../domain/types';
import { saveArtifact } from '../domain/artifacts';
import { config } from '../config/index';
import { callModal } from '../adapters/modal';
import { updateState } from '../domain/job-catalog';
import { upsertIngestedProduct } from '../domain/catalog';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'placement' });

export class PlacementHandler implements StepHandler {
  async validate(job: IngestionPipelineJob): Promise<void> {
    if (!job.segmented_image_url) {
      throw new Error('segmented_image_url is not set — segmenting step must run first');
    }
    if (!job.vton_image_url) {
      throw new Error('vton_image_url is not set — tryon step must run first');
    }
  }

  async execute(job: IngestionPipelineJob): Promise<void> {
    const { job_id, segmented_image_url, vton_image_url } = job;
    logger.info({ jobId: job_id }, 'starting automated garment placement');

    const modalUrl = config.MODAL_PLACEMENT_URL;
    if (!modalUrl) {
      throw new Error('MODAL_PLACEMENT_URL is not set in environment variables');
    }

    // Guarded by callModal — see adapters/modal.ts for the timeout and retry rationale.
    const { result: modalResult, durationMs } = await callModal<{
      status: string;
      final_image_url: string;
      selected_mannequin?: string;
      // Affine the pipeline used, in the mesh editor's 1800x3072 space — lets the editor
      // reconstruct this auto-placement instead of defaulting the garment to canvas-centre.
      transform?: { scale: number; rotationDeg: number; tx: number; ty: number };
      // One transform per mannequin the garment registered against acceptably, keyed
      // "Female"/"Male". Superset of `transform`. Storing every one is what lets the studio put a
      // garment on the viewer's own body rather than whichever mannequin scored best.
      transforms?: Record<string, { scale: number; rotationDeg: number; tx: number; ty: number }>;
    }>(modalUrl, {
      label: 'placement',
      params: {
        pipeline_job_id: job_id,
        segmented_image_url: segmented_image_url!,
        vton_image_url: vton_image_url!,
      },
    });
    if (modalResult.status !== 'success' && modalResult.status !== 'completed' || !modalResult.final_image_url) {
      throw new Error(`Modal placement pipeline failed: ${JSON.stringify(modalResult)}`);
    }

    logger.info(
      { jobId: job_id, mannequin: modalResult.selected_mannequin, finalUrl: modalResult.final_image_url },
      'Modal placement completed successfully'
    );

    // Save placement artifact
    await saveArtifact({
      jobId: job_id,
      stepName: 'placement',
      artifactType: 'placement',
      data: {
        placedImageUrl: modalResult.final_image_url,
        selectedMannequin: modalResult.selected_mannequin,
        createdAt: new Date().toISOString(),
        duration_ms: durationMs,
        // Present once the Modal pipeline is redeployed with the transform export; the mesh
        // editor reads this (usePlacementImage.ts) to reopen on the already-placed cloth.
        ...(modalResult.transform ? { transform: modalResult.transform } : {}),
        // Every mannequin this garment placed acceptably on. upsertIngestedProduct writes one
        // `placement` entry per key, so a unisex garment ends up renderable on either body.
        ...(modalResult.transforms && Object.keys(modalResult.transforms).length
          ? { transforms: modalResult.transforms }
          : {}),
      },
    });

    await updateState(job_id, 'completed');

    // Stage the finished item into the catalog (ingested_products). Best-effort: placement itself
    // has already succeeded, and the Go-Live button re-stages via its own upsert if this fails.
    try {
      await upsertIngestedProduct({ ...job, current_state: 'completed', ingested_product_id: job.ingested_product_id ?? null });
      logger.info({ jobId: job_id }, 'staged into ingested_products');
    } catch (err) {
      logger.error({ jobId: job_id, err: err instanceof Error ? err.message : String(err) }, 'catalog staging failed (non-fatal)');
    }
  }
}
