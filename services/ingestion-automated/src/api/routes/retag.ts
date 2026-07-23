import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getJob, updateJob } from '../../domain/job-catalog';
import { getArtifacts, getArtifactByPublicUrl, getLatestArtifact, updateArtifactData, saveArtifact } from '../../domain/artifacts';
import {
  buildSlots, pickPreferredSlot, winningScore, SLOT_LABEL, SLOT_KEYS,
  type ClassificationInput, type SlotMapResult,
} from '../../adapters/siglip';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:retag' });

const RetagBody = z.object({
  image_url: z.string().url(),
  // view doesn't apply to 'Detail' — a macro/texture crop has no front/back of its own.
  view: z.enum(['Front', 'Back', 'Side']).optional(),
  type: z.enum(['Model', 'Flat', 'Detail']),
}).refine((b) => b.type === 'Detail' || !!b.view, {
  message: "view is required unless type is 'Detail'",
  path: ['view'],
});

// view/type (the UI's vocabulary) <-> stage1/stage2 winners (SigLIP's vocabulary).
// 'Detail' and 'Side' never land in any of the 4 VTON slots (see slotKeyFor in
// siglip.ts) — tagging either only corrects how the image is identified.
function toVerdict(view: 'Front' | 'Back' | 'Side' | undefined, type: 'Model' | 'Flat' | 'Detail') {
  if (type === 'Detail') return { stage1_verdict: 'Macro Detail', stage2_verdict: null };
  return { stage1_verdict: type === 'Model' ? 'Live Model' : 'Flat Lay', stage2_verdict: view! };
}

function slotsEqual(a: SlotMapResult, b: SlotMapResult | undefined): boolean {
  if (!b) return false;
  return SLOT_KEYS.every((k) => (a[k]?.publicUrl ?? null) === (b[k]?.publicUrl ?? null));
}

export async function registerRetagRoute(app: FastifyInstance): Promise<void> {
  app.post('/jobs/:jobId/photos/retag', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = RetagBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { image_url, view, type } = parsed.data;

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    // The image must have gone through identification — that's what we're correcting.
    const target = await getArtifactByPublicUrl(jobId, 'image_classification', image_url);
    if (!target) {
      return reply.status(400).send({
        error: 'image_url has no image_classification artifact for this job — run identification first',
      });
    }

    // Always record the correction at its source, regardless of whether it ends up
    // changing any of the 4 VTON slots (e.g. a Detail/Side tag never does).
    const { stage1_verdict, stage2_verdict } = toVerdict(view, type);
    const overriddenAt = new Date().toISOString();
    await updateArtifactData(target.id, {
      ...(target.data ?? {}),
      user_override: { stage1_verdict, stage2_verdict, overridden_at: overriddenAt },
    });

    // Recompute all 4 slots from every image's *effective* verdict (override if present,
    // else SigLIP's own winner, ranked by score) — a correction on a non-primary image
    // can still flip which image wins its slot, even if that slot isn't the preferred one.
    const allClassifications = await getArtifacts(jobId, 'image_classification');
    const items: ClassificationInput[] = allClassifications.map((a) => {
      const d = (a.data ?? {}) as Record<string, unknown>;
      const override = d.user_override as { stage1_verdict: string; stage2_verdict: string | null; overridden_at: string } | undefined;
      // Use `override ? ... : ...`, not `override?.x ?? d.x` — a Detail/Side override's
      // stage2_verdict is legitimately null, and ?? would wrongly fall through to the
      // original SigLIP value for a nullish (but present) override field.
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
    const finalUrl = preferred?.publicUrl ?? job.v_ton_preferred_image ?? null;
    if (!finalUrl) {
      return reply.status(500).send({ error: 'Could not resolve a preferred image after retag' });
    }

    // Only touch vton_image_selection when one of the 4 slots actually changed — a
    // Detail/Side tag, or re-tagging an image that was already a slot's winner with the
    // same verdict, changes nothing about the VTON pick and shouldn't write a new row.
    const existingSelection = await getLatestArtifact(jobId, 'vton_image_selection');
    const existingSlots = (existingSelection?.data as Record<string, unknown> | undefined)?.slots as SlotMapResult | undefined;
    const changed = !slotsEqual(slots, existingSlots);

    if (changed) {
      const payload = {
        // Kept at top level for backward-compat with existing readers (ImagePreviewStrip.tsx).
        public_url: finalUrl,
        category:   preferredKey ? SLOT_LABEL[preferredKey] : null,
        stage1_uncertain: preferred?.uncertain ?? false,
        stage2_uncertain: false,
        source: 'manual',
        slots,
        preferred_slot: preferredKey,
        preference_type: job.v_ton_image_preference?.type ?? null,
        retagged_image: image_url,
        retagged_view: view ?? null,
        retagged_type: type,
      };
      // Single canonical row per job — update it in place rather than appending a new
      // one every retag (this table is insert-only everywhere else, but a selection is a
      // derived "current state," not an event log — see updateArtifactData in artifacts.ts).
      if (existingSelection) {
        await updateArtifactData(existingSelection.id, payload);
      } else {
        await saveArtifact({ jobId, stepName: 'identifying', artifactType: 'vton_image_selection', data: payload });
      }

      if (finalUrl !== job.v_ton_preferred_image) {
        await updateJob(jobId, { v_ton_preferred_image: finalUrl });
      }
    }

    logger.info({ jobId, image_url, view, type, preferredKey, changed }, 'photo retagged');
    return reply.send({ job_id: jobId, slots, preferred_slot: preferredKey, public_url: finalUrl, changed });
  });
}
