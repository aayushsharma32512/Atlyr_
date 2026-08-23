/**
 * The one place a finished VTON image becomes a stored artifact.
 *
 * Both lanes land here — the instant handler with a provider response it just awaited, and the
 * batch poller with a result that arrived hours later in a different process. Keeping it shared
 * is what makes a batch-produced job indistinguishable downstream: same storage path, same
 * artifact shape, same `vton_image_url`.
 */
import { saveArtifact } from '../domain/artifacts';
import { updateJob } from '../domain/job-catalog';
import { uploadToSupabase } from '../utils/storage';
import type { TokenUsage } from '../adapters/gemini-usage';

export interface VtonResultInput {
  jobId: string;
  bytes: Buffer;
  mimeType: string;
  /** The model that produced the image. */
  modelUsed: string;
  /**
   * How the image was produced. 'instant' for a per-job call; 'batch:ai_studio' for the economy
   * lane. The dashboard prices and labels a route by this prefix, so it must not be invented at
   * call sites.
   */
  routeUsed: string;
  inferenceMs: number;
  usage?: TokenUsage | null;
  /**
   * Routes already tried and rejected, for the dashboard's failover line. A batch attempt that
   * refused and fell back to instant is recorded here so the demotion is visible rather than
   * looking like the job simply went the instant way.
   */
  attempted?: Array<{ route: string; model: string; errorKind: string; ms: number; message: string }>;
}

export interface PersistedVton {
  storagePath: string;
  publicUrl: string;
}

/**
 * Upload, write the artifact, then point the job row at it.
 *
 * Order matters and is the reverse of what feels natural: **artifact first, job state second**.
 * A crash between the two leaves a parked job that already has its image — the poller's next tick
 * sees it still parked and completes the advance idempotently. The other order would leave an
 * advanced job with no image, which nothing recovers.
 */
export async function persistVtonResult(input: VtonResultInput): Promise<PersistedVton> {
  const storagePath = `${input.jobId}/tryon/front.jpg`;
  const publicUrl = await uploadToSupabase(storagePath, input.bytes, input.mimeType);

  await saveArtifact({
    jobId: input.jobId,
    stepName: 'generating_vton',
    artifactType: 'vton_image',
    storagePath,
    data: {
      public_url: publicUrl,
      model_used: input.modelUsed,
      route_used: input.routeUsed,
      inference_ms: input.inferenceMs,
      usage: input.usage ?? null,
      ...(input.attempted?.length ? { attempted: input.attempted } : {}),
    },
  });

  await updateJob(input.jobId, { vton_image_url: publicUrl });

  return { storagePath, publicUrl };
}
