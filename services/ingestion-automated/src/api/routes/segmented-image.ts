import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getJob, updateJob } from '../../domain/job-catalog';
import { supabaseAdmin } from '../../db/supabase';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:segmented-image' });

// The editor sends the edited PNG as a base64 data URL. Overwriting the object requires the
// service-role key — the browser anon key is blocked by storage RLS — so it's done here.
const Body = z.object({ image_base64: z.string().min(1) });

/** Extract { bucket, path } from a Supabase public storage URL (…/object/public/<bucket>/<path>). */
function parsePublicUrl(url: string): { bucket: string; path: string } | null {
  const marker = '/storage/v1/object/public/';
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const rest = url.slice(i + marker.length).split('?')[0];
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) };
}

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

    logger.info({ jobId, path: loc.path }, 'segmented image overwritten');
    return reply.send({ job_id: jobId, segmented_image_url: fresh });
  });
}
