import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getJob, updateJob } from '../../domain/job-catalog';
import { getLatestArtifact, updateArtifactData } from '../../domain/artifacts';
import { pickPreferredSlot, SLOT_LABEL, type SlotMapResult } from '../../adapters/siglip';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:details' });

const DetailsBody = z.object({
  // crawl_meta fields (scraped, not job columns) — patched onto the latest crawl_meta artifact.
  product_name: z.string().optional(),
  brand:        z.string().optional(),
  price:        z.number().optional(),
  currency:     z.string().optional(),
  // real job columns
  product_gender_type: z.enum(['male', 'female', 'unisex']).optional(),
  product_type:        z.enum(['topwear', 'bottomwear', 'dress']).optional(),
  product_sub_type:    z.string().optional(),
  product_complexity:  z.string().optional(),
  // also a job column, but re-picks the preferred VTON slot when it changes (see below)
  v_ton_image_preference: z.object({ type: z.enum(['model', 'flat_lay']) }).nullable().optional(),
});

export async function registerDetailsRoute(app: FastifyInstance): Promise<void> {
  app.patch('/jobs/:jobId/details', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = DetailsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { product_name, brand, price, currency, v_ton_image_preference, ...jobFields } = parsed.data;
    // JSON has no `undefined`, so this reliably means "the client included this key."
    const preferenceProvided = v_ton_image_preference !== undefined;

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const jobPatch = {
      ...jobFields,
      ...(preferenceProvided && { v_ton_image_preference: v_ton_image_preference ?? null }),
    };
    if (Object.keys(jobPatch).length > 0) {
      await updateJob(jobId, jobPatch);
    }

    const crawlPatch = { product_name, brand, price, currency };
    const hasCrawlPatch = Object.values(crawlPatch).some((v) => v !== undefined);
    if (hasCrawlPatch) {
      const crawlMeta = await getLatestArtifact(jobId, 'crawl_meta');
      if (!crawlMeta) {
        return reply.status(409).send({ error: 'No crawl_meta artifact yet — scraping has not run for this job' });
      }
      await updateArtifactData(crawlMeta.id, {
        ...(crawlMeta.data ?? {}),
        ...Object.fromEntries(Object.entries(crawlPatch).filter(([, v]) => v !== undefined)),
      });
    }

    // Changing the preference doesn't change which images are candidates for each slot
    // (that's SigLIP's job, or a manual retag) — it only changes which already-resolved
    // slot wins. Re-pick from the existing snapshot rather than re-deriving from every
    // image_classification row.
    if (preferenceProvided) {
      const selection = await getLatestArtifact(jobId, 'vton_image_selection');
      const slots = (selection?.data as Record<string, unknown> | undefined)?.slots as SlotMapResult | undefined;
      if (selection && slots) {
        const prevPreferredKey = (selection.data as Record<string, unknown>)?.preferred_slot ?? null;
        const preferredKey = pickPreferredSlot(slots, v_ton_image_preference?.type);
        const preferred = preferredKey ? slots[preferredKey] : null;
        const finalUrl = preferred?.publicUrl ?? job.v_ton_preferred_image ?? null;

        if (preferredKey !== prevPreferredKey && finalUrl) {
          await updateArtifactData(selection.id, {
            ...(selection.data ?? {}),
            public_url: finalUrl,
            category: preferredKey ? SLOT_LABEL[preferredKey] : null,
            preferred_slot: preferredKey,
            preference_type: v_ton_image_preference?.type ?? null,
          });
          if (finalUrl !== job.v_ton_preferred_image) {
            await updateJob(jobId, { v_ton_preferred_image: finalUrl });
          }
        } else {
          // Winning slot didn't change — still record the new preference for audit.
          await updateArtifactData(selection.id, { ...(selection.data ?? {}), preference_type: v_ton_image_preference?.type ?? null });
        }
      }
    }

    logger.info({ jobId, jobFields, preference: preferenceProvided ? v_ton_image_preference : undefined, crawlPatch: hasCrawlPatch ? crawlPatch : undefined }, 'job details updated');
    return reply.send({ job_id: jobId, updated: true });
  });
}
