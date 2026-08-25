import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IngestionPipelineJob, PipelineState } from '../../domain/types';
import { getJob, updateJob } from '../../domain/job-catalog';
import { saveArtifact } from '../../domain/artifacts';
import { uploadToSupabase } from '../../utils/storage';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:manual-assets' });

/**
 * The two operator uploads of the manual asset lane: a try-on image, and a hand-cut transparent
 * PNG made in Photoshop. They replace generating_vton and segmenting for jobs whose asset_lane is
 * 'manual' — footwear, today, which has no automated path at either step.
 *
 * Shaped after api/routes/segmented-image.ts, with one deliberate difference: that route
 * OVERWRITES an object the pipeline already produced (and 409s when there is none), whereas these
 * CREATE the first copy. Hence an explicit storage path here rather than parsing one out of an
 * existing URL.
 *
 * Uploading does NOT advance the job. The operator advances separately via POST /jobs/:id/proceed,
 * which keeps "the file exists" and "the human is happy with it" as two different facts — a
 * re-upload while still parked at the gate is then just an upsert, not a state repair.
 */

const Body = z.object({ image_base64: z.string().min(1) });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** PNG colour types that carry an alpha channel: 4 = grey+alpha, 6 = RGBA. */
const PNG_ALPHA_COLOUR_TYPES = new Set([4, 6]);

function decodeBase64Image(raw: string): Buffer {
  return Buffer.from(raw.replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * Whether a PNG actually carries transparency, read from the IHDR colour-type byte at offset 25.
 *
 * This is the guard that matters for the cut-out. A Photoshop export flattened to RGB is a
 * perfectly valid PNG that looks right in Finder and in the operator's own preview, and it fails
 * only much later — the placement editor drapes it on the mannequin as an opaque rectangle with
 * the background baked in. Catching it at upload costs one byte read.
 */
function pngHasAlphaChannel(buf: Buffer): boolean {
  if (buf.length < 26 || buf.subarray(12, 16).toString('ascii') !== 'IHDR') return false;
  return PNG_ALPHA_COLOUR_TYPES.has(buf[25]);
}

type GateSpec = {
  /** The state the job must be parked in for this upload to be meaningful. */
  state: PipelineState;
  /** Storage path under the job's prefix, so removeStoragePrefix still cleans it on delete. */
  path: (jobId: string, ext: string) => string;
  /** Job column the resulting public URL is written to. */
  column: 'vton_image_url' | 'segmented_image_url';
  artifactType: string;
  /** Whether the upload must be a PNG carrying real transparency. */
  requireAlpha: boolean;
};

function guardJob(job: IngestionPipelineJob | null, gate: GateSpec, reply: FastifyReply): boolean {
  if (!job) {
    reply.status(404).send({ error: 'Job not found' });
    return false;
  }
  if (job.asset_lane !== 'manual') {
    reply.status(409).send({
      error: 'Job is not on the manual asset lane',
      asset_lane: job.asset_lane,
    });
    return false;
  }
  if (job.current_state !== gate.state) {
    reply.status(409).send({
      error: `Job is not awaiting this upload`,
      current_state: job.current_state,
      expected_state: gate.state,
    });
    return false;
  }
  return true;
}

function registerUpload(app: FastifyInstance, route: string, gate: GateSpec): void {
  app.post(route, async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const job = await getJob(jobId).catch(() => null);
    if (!guardJob(job, gate, reply)) return reply;

    const buffer = decodeBase64Image(parsed.data.image_base64);
    if (buffer.length === 0) {
      return reply.status(400).send({ error: 'image_base64 decoded to zero bytes' });
    }

    const png = isPng(buffer);
    if (gate.requireAlpha) {
      if (!png) {
        return reply.status(422).send({
          error: 'The cut-out must be a PNG — it needs an alpha channel to composite on the mannequin',
        });
      }
      if (!pngHasAlphaChannel(buffer)) {
        return reply.status(422).send({
          error:
            'This PNG has no alpha channel, so it would place as an opaque rectangle. Re-export from Photoshop with transparency (do not flatten).',
        });
      }
    } else if (!png && !buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
      return reply.status(422).send({ error: 'Expected a PNG or JPEG image' });
    }

    const contentType = png ? 'image/png' : 'image/jpeg';
    const path = gate.path(jobId, png ? 'png' : 'jpg');
    let publicUrl: string;
    try {
      publicUrl = await uploadToSupabase(path, buffer, contentType);
    } catch (err) {
      logger.error({ jobId, path, err: (err as Error).message }, 'manual asset upload failed');
      return reply.status(500).send({ error: (err as Error).message });
    }

    // Cache-bust: the path is stable across re-uploads (upsert), so without this a corrected file
    // keeps rendering as the old pixels everywhere the previous URL is already cached.
    const fresh = `${publicUrl.split('?')[0]}?v=${Date.now()}`;
    await updateJob(jobId, { [gate.column]: fresh });

    await saveArtifact({
      jobId,
      stepName: gate.state,
      artifactType: gate.artifactType,
      data: { public_url: fresh, bytes: buffer.length, content_type: contentType },
      storagePath: path,
    });

    logger.info({ jobId, path, bytes: buffer.length }, 'manual asset uploaded');
    return reply.send({ job_id: jobId, [gate.column]: fresh });
  });
}

export async function registerManualAssetRoutes(app: FastifyInstance): Promise<void> {
  registerUpload(app, '/jobs/:jobId/manual/vton', {
    state: 'awaiting_manual_vton',
    path: (jobId, ext) => `${jobId}/manual/vton.${ext}`,
    column: 'vton_image_url',
    artifactType: 'manual_vton',
    // A try-on reference is only ever looked at, never composited, so it does not need alpha.
    requireAlpha: false,
  });

  registerUpload(app, '/jobs/:jobId/manual/segmented', {
    state: 'awaiting_manual_segmentation',
    path: (jobId) => `${jobId}/manual/segmented.png`,  // always PNG — requireAlpha enforces it
    column: 'segmented_image_url',
    artifactType: 'manual_segmented',
    requireAlpha: true,
  });
}
