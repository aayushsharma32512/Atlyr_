import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getJob } from '../../domain/job-catalog';
import { getLatestArtifact, saveArtifact } from '../../domain/artifacts';
import { uploadToSupabase } from '../../utils/storage';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:placement' });

const PlacementBody = z.object({
  // Flattened composite rendered by the browser mesh editor, at the pipeline's 1800x3072 canvas.
  image_base64: z.string().min(1),
  // Editor-space transform: scale/rotation relative to the fit-centred garment, translation
  // as an offset from the canvas centre. See PlacementMeshEditor.tsx.
  transform: z.object({
    scale:       z.number(),
    rotationDeg: z.number(),
    tx:          z.number(),
    ty:          z.number(),
  }),
  // Warp lattice offsets in garment geometry space — kept so re-opening can restore the
  // editable state rather than starting over from the flattened PNG.
  warp: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
});

export async function registerPlacementRoute(app: FastifyInstance): Promise<void> {
  app.post('/jobs/:jobId/placement', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = PlacementBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { image_base64, transform, warp } = parsed.data;

    const job = await getJob(jobId).catch(() => null);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    let bytes: Buffer;
    try {
      bytes = Buffer.from(image_base64, 'base64');
    } catch {
      return reply.status(400).send({ error: 'image_base64 is not valid base64' });
    }
    if (bytes.length === 0) {
      return reply.status(400).send({ error: 'Decoded image is empty' });
    }

    // Versioned filename: the automated pipeline owns placement/{jobId}/final.png, and Supabase
    // public URLs are CDN-cached — overwriting a fixed path would keep serving the stale image.
    const storagePath = `${jobId}/placement/manual-${Date.now()}.png`;
    const placedImageUrl = await uploadToSupabase(storagePath, bytes, 'image/png');

    // Carry the mannequin choice forward from whatever the automated run picked.
    const previous = await getLatestArtifact(jobId, 'placement');
    const selectedMannequin = (previous?.data as Record<string, unknown> | undefined)?.selectedMannequin ?? null;

    // stepName 'placement' so a restart-from-placement cleans this up via deleteArtifactsForSteps.
    await saveArtifact({
      jobId,
      stepName: 'placement',
      artifactType: 'placement',
      storagePath,
      data: {
        placedImageUrl,
        selectedMannequin,
        transform,
        warp,
        source: 'manual',
        createdAt: new Date().toISOString(),
      },
    });

    // Deliberately no updateState here: editing a placement never advances or resets the job,
    // so an already-pushed row stays pushed.
    logger.info({ jobId, storagePath, bytes: bytes.length }, 'manual placement saved');
    return reply.send({ job_id: jobId, placed_image_url: placedImageUrl });
  });
}
