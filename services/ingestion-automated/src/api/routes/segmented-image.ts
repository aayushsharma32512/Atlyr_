import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getJob, updateJob } from '../../domain/job-catalog';
import { upsertIngestedProduct } from '../../domain/catalog';
import { supabaseAdmin } from '../../db/supabase';
import { parsePublicUrl } from '../../utils/storage';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:segmented-image' });

// The editor sends the edited PNG as a base64 data URL. Overwriting the object requires the
// service-role key — the browser anon key is blocked by storage RLS — so it's done here.
const Body = z.object({ image_base64: z.string().min(1) });

export async function registerSegmentedImageRoute(app: FastifyInstance): Promise<void> {
  app.post('/jobs/:jobId/segmented-image', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (!job.segmented_image_url) {
      return reply.status(409).send({ error: 'Job has no segmented image to overwrite' });
    }

    const loc = parsePublicUrl(job.segmented_image_url);
    if (!loc) {
      return reply.status(422).send({ error: 'segmented_image_url is not a Supabase storage URL' });
    }

    const b64 = parsed.data.image_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(b64, 'base64');

    // Overwrite the same object path in place (upsert), preserving the existing URL.
    const { error } = await supabaseAdmin.storage.from(loc.bucket).upload(loc.path, buffer, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) {
      logger.error({ jobId, err: error.message }, 'segmented image overwrite failed');
      return reply.status(500).send({ error: `Storage upload failed: ${error.message}` });
    }

    // Cache-bust the stored URL so the new pixels show everywhere it's used (UI + placement).
    const base = job.segmented_image_url.split('?')[0];
    const fresh = `${base}?v=${Date.now()}`;
    await updateJob(jobId, { segmented_image_url: fresh });

    // The catalog wears a `.fullres.webp` re-encode of this image, and it is a SEPARATE object —
    // overwriting the PNG does not touch it, so an already-staged product would keep serving the
    // pre-edit pixels until something re-staged it. Re-stage now to regenerate the WebP and repoint
    // image_url. Only for jobs already in the catalog: staging one that has never been staged would
    // create a catalog row mid-pipeline. Best-effort — an edit must not fail on a staging hiccup.
    if (job.ingested_product_id) {
      try {
        await upsertIngestedProduct({ ...job, segmented_image_url: fresh });
      } catch (err) {
        logger.error(
          { jobId, err: err instanceof Error ? err.message : String(err) },
          're-stage after segmented image edit failed (non-fatal) — image_url still points at the pre-edit WebP'
        );
      }
    }

    logger.info({ jobId, path: loc.path }, 'segmented image overwritten');
    return reply.send({ job_id: jobId, segmented_image_url: fresh });
  });
}
