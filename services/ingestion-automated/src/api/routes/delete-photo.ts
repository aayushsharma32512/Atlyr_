import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getJob, updateJob } from '../../domain/job-catalog';
import { getArtifacts, getArtifactByPublicUrl, getLatestArtifact, updateArtifactData, saveArtifact } from '../../domain/artifacts';
import {
  buildSlots, pickPreferredSlot, winningScore, SLOT_LABEL,
  type ClassificationInput,
} from '../../adapters/siglip';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:delete-photo' });

const DeleteBody = z.object({ image_url: z.string().url() });

// Soft-delete a single scraped photo: mark its image_classification artifact excluded, then
// recompute the 4 VTON slots + preferred image from the remaining (non-excluded) photos. Unlike
// retag, deleting the last usable image must NOT hard-fail — it just leaves the item with no
// preferred image (needs a re-scrape), signalled via `warning: 'no_usable_image'`.
export async function registerDeletePhotoRoute(app: FastifyInstance): Promise<void> {
  app.post('/jobs/:jobId/photos/delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = DeleteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { image_url } = parsed.data;

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const target = await getArtifactByPublicUrl(jobId, 'image_classification', image_url);
    if (!target) {
      return reply.status(400).send({ error: 'image_url has no image_classification artifact for this job' });
    }

    // Soft-exclude in place (the row is kept so a future re-classification/restart can reset it).
    await updateArtifactData(target.id, { ...(target.data ?? {}), excluded: true });

    // Recompute all 4 slots from every *non-excluded* image's effective verdict — same mapping
    // as retag.ts, minus the ones now excluded.
    const allClassifications = await getArtifacts(jobId, 'image_classification');
    const items: ClassificationInput[] = allClassifications
      .filter((a) => !((a.data ?? {}) as Record<string, unknown>).excluded)
      .map((a) => {
        const d = (a.data ?? {}) as Record<string, unknown>;
        const override = d.user_override as { stage1_verdict: string; stage2_verdict: string | null; overridden_at: string } | undefined;
        return {
          imageUrl:  d.public_url as string,
          stage1:    override ? override.stage1_verdict : (d.stage1_winner as string | null),
          stage2:    override ? override.stage2_verdict : (d.stage2_winner as string | null),
          score:     override ? 0 : winningScore(d.stage2_labels as string[] | undefined, d.stage2_probs as number[] | undefined, d.stage2_winner as string | undefined),
          uncertain: override ? false : !!(d.stage1_uncertain || d.stage2_uncertain),
          manual:    !!override,
          overriddenAt: override?.overridden_at ?? null,
        };
      });

    const slots = buildSlots(items);
    const preferredKey = pickPreferredSlot(slots, job.v_ton_image_preference?.type);
    const preferred = preferredKey ? slots[preferredKey] : null;
    const finalUrl = preferred?.publicUrl ?? null;
    const warning = finalUrl ? undefined : 'no_usable_image';

    // Rewrite the single canonical vton_image_selection row with the recomputed slots.
    const payload = {
      public_url: finalUrl,
      category:   preferredKey ? SLOT_LABEL[preferredKey] : null,
      stage1_uncertain: preferred?.uncertain ?? false,
      stage2_uncertain: false,
      source: 'manual',
      slots,
      preferred_slot: preferredKey,
      preference_type: job.v_ton_image_preference?.type ?? null,
      deleted_image: image_url,
    };
    const existingSelection = await getLatestArtifact(jobId, 'vton_image_selection');
    if (existingSelection) {
      await updateArtifactData(existingSelection.id, payload);
    } else {
      await saveArtifact({ jobId, stepName: 'identifying', artifactType: 'vton_image_selection', data: payload });
    }

    // Always touch the job row so every job.updated_at-keyed frontend hook refreshes — even when
    // the deleted photo wasn't the preferred one (finalUrl unchanged).
    await updateJob(jobId, { v_ton_preferred_image: finalUrl });

    logger.info({ jobId, image_url, preferredKey, warning }, 'photo deleted (soft-excluded)');
    return reply.send({ job_id: jobId, slots, preferred_slot: preferredKey, warning });
  });
}
