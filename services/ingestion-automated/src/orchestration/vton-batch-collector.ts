/**
 * Collector — ships a tray of parked jobs to AI Studio batch.
 *
 * Ordering is the crash-safety core, and it is deliberately "wasteful" in the safe direction:
 *
 *   1. open a `gemini_batches` row in 'submitting'
 *   2. atomically claim jobs into it
 *   3. build the requests
 *   4. submit, then record the provider batch name
 *
 * Any crash before step 4 leaves a 'submitting' row with no provider name, which the poller's
 * janitor recognises and releases — the jobs go back in the pool, nothing was billed. Doing it
 * the other way round (build, submit, then stamp) makes a crash after submission indistinguishable
 * from never having submitted, and the retry bills the whole tray twice.
 */
import type { BossHandle } from '../queue/boss';
import type { InlinedRequest } from '@google/genai';
import { config } from '../config/index';
import {
  bumpFallbackCount,
  claimJobsForBatch,
  unclaimedParkedStats,
  demoteToInstantLane,
  discardBatch,
  markBatchSubmitted,
  openBatch,
  releaseClaims,
  updateBatchStatus,
} from '../domain/gemini-batches';
import { getLatestArtifact } from '../domain/artifacts';
import { BatchSpendCapError, createInlineBatch, uploadFile, type UploadedFile } from '../adapters/gemini-batch';
import { CORRELATION_KEY, errorMessageOf, shouldFlushTray } from '../adapters/gemini-batch.protocol';
import {
  avatarKeyFor,
  buildVtonRequest,
  fetchImageAsBase64,
  loadAvatarBytes,
  sniffMimeType,
  vtonGenerationConfig,
  type AvatarKey,
} from '../adapters/vton/vton-request';
import { sendPipelineStep } from '../queue/send-step';
import { createLogger } from '../utils/logger';
import type { IngestionPipelineJob } from '../domain/types';

const logger = createLogger({ stage: 'vton-batch-collector' });

// ─── Avatar cache ────────────────────────────────────────────────────────────

// Files API objects live 48 hours. Re-upload well before that: a tray built with a URI that
// expires mid-flight would fail every one of its requests, and re-uploading a 2 MB asset is far
// cheaper than losing a tray. Inlining instead is not an option — the male avatar alone is ~16 MB
// as base64 against a 20 MB ceiling.
const AVATAR_REFRESH_MARGIN_MS = 6 * 60 * 60 * 1000;

const avatarCache = new Map<AvatarKey, UploadedFile>();

function isFresh(file: UploadedFile, now: number): boolean {
  if (!file.expiresAt) return false;
  const expiry = Date.parse(file.expiresAt);
  if (Number.isNaN(expiry)) return false;
  return expiry - now > AVATAR_REFRESH_MARGIN_MS;
}

async function avatarFileFor(gender: string): Promise<UploadedFile> {
  const key = avatarKeyFor(gender);
  const cached = avatarCache.get(key);
  if (cached && isFresh(cached, Date.now())) return cached;

  const bytes = loadAvatarBytes(key);
  const uploaded = await uploadFile({
    bytes,
    mimeType: sniffMimeType(bytes),
    displayName: `vton-avatar-${key}`,
  });
  avatarCache.set(key, uploaded);
  return uploaded;
}

/** Exposed for tests and for the kill switch, which should not leave a stale URI behind. */
export function clearAvatarCache(): void {
  avatarCache.clear();
}

// ─── Tray building ───────────────────────────────────────────────────────────

async function buildRequestForJob(job: IngestionPipelineJob, model: string): Promise<InlinedRequest> {
  if (!job.v_ton_preferred_image) throw new Error('v_ton_preferred_image is not set');

  const summaryArtifact = await getLatestArtifact(job.job_id, 'garment_summary');
  if (!summaryArtifact) throw new Error('garment_summary artifact missing');
  const summary = (summaryArtifact.data ?? {}) as Record<string, unknown>;

  const spec = buildVtonRequest({
    imageUrl: job.v_ton_preferred_image,
    gender: job.product_gender_type,
    productType: job.product_type,
    productSubType: job.product_sub_type,
    techPack: (summary.tech_pack as string) ?? '',
    garmentPhysics: (summary.garment_physics as string) ?? '',
    itemName: (summary.item_name as string) ?? '',
    colorAndFabric: (summary.color_and_fabric as string) ?? '',
  });

  const [avatar, garment] = await Promise.all([
    avatarFileFor(job.product_gender_type),
    fetchImageAsBase64(job.v_ton_preferred_image),
  ]);

  return {
    model,
    contents: [
      {
        role: 'user',
        parts: [
          // Avatar by reference, garment inline. This is what keeps a 30-job tray at ~2 MB
          // instead of ~89 MB, i.e. inline-able at all.
          { fileData: { fileUri: avatar.uri, mimeType: avatar.mimeType } },
          { inlineData: { mimeType: garment.mimeType, data: garment.b64 } },
          { text: spec.prompt },
        ],
      },
    ],
    // Correlation rides here and nowhere else. Verified to echo back on InlinedResponse.metadata
    // by the Phase 0 spike; never match results by position.
    metadata: { [CORRELATION_KEY]: job.job_id },
    config: {
      ...vtonGenerationConfig(),
      systemInstruction: spec.system,
    },
  };
}

/** Run `tasks` with at most `limit` in flight, preserving input order in the results. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Tick ────────────────────────────────────────────────────────────────────

export interface CollectResult {
  batchId: string | null;
  submitted: number;
  demoted: number;
  reason?: string;
}

export async function collectVtonBatch(boss: BossHandle): Promise<CollectResult> {
  // The kill switch stops the COLLECTOR only. The poller and janitor keep running so trays
  // already at Google still drain — switching the lane off must never strand parked work.
  if (!config.VTON_BATCH_ENABLED) return { batchId: null, submitted: 0, demoted: 0, reason: 'disabled' };

  const { count: waiting, oldestAgeSeconds } = await unclaimedParkedStats();
  if (waiting === 0) return { batchId: null, submitted: 0, demoted: 0, reason: 'no parked jobs' };

  // Fill-or-age. A cron tick is permission to CONSIDER a tray, not an instruction to ship one:
  // shipping whatever is parked every tick turns a slow arrival rate into a stream of one- and
  // two-item batches, which costs the same per image but multiplies trays, polling and pressure
  // on the 100-concurrent-batch ceiling — and defeats the point of batching at all.
  const decision = shouldFlushTray({
    waiting,
    oldestAgeSeconds,
    minFill: config.VTON_BATCH_MIN_FILL,
    maxWaitSeconds: config.VTON_BATCH_MAX_WAIT_SECONDS,
  });
  if (!decision.flush) {
    logger.info(
      { waiting, minFill: config.VTON_BATCH_MIN_FILL, oldestAgeSeconds, maxWait: config.VTON_BATCH_MAX_WAIT_SECONDS },
      'holding — tray not full and nothing has waited long enough yet',
    );
    return { batchId: null, submitted: 0, demoted: 0, reason: `holding (${waiting}/${config.VTON_BATCH_MIN_FILL})` };
  }
  logger.info({ waiting, oldestAgeSeconds, trigger: decision.trigger }, 'flushing a batch tray');

  const batch = await openBatch(config.VTON_BATCH_MODEL);
  const claimed = await claimJobsForBatch(batch.batch_id, config.VTON_BATCH_FLUSH_SIZE);

  if (claimed.length === 0) {
    // Another tick took them between the count and the claim. Nothing was billed.
    await discardBatch(batch.batch_id);
    return { batchId: null, submitted: 0, demoted: 0, reason: 'lost the claim race' };
  }

  logger.info({ batchId: batch.batch_id, claimed: claimed.length, waiting }, 'claimed jobs for batch tray');

  // Build every request, tolerating per-job failures. A garment 404 or a timeout demotes that one
  // job to the instant lane and drops it from the tray — aborting the tick would punish the other
  // 29 for one bad URL.
  const built = await mapWithConcurrency(
    claimed,
    config.VTON_BATCH_FETCH_CONCURRENCY,
    async (job) => {
      try {
        return { job, request: await buildRequestForJob(job, config.VTON_BATCH_MODEL), error: null };
      } catch (err) {
        return { job, request: null, error: errorMessageOf(err) };
      }
    },
  );

  const usable = built.filter((b): b is { job: IngestionPipelineJob; request: InlinedRequest; error: null } => b.request !== null);
  const failed = built.filter((b) => b.request === null);

  let demoted = 0;
  for (const { job, error } of failed) {
    logger.warn({ batchId: batch.batch_id, jobId: job.job_id, error }, 'batch request build failed, demoting to instant lane');
    if (await demoteToInstantLane(job.job_id, batch.batch_id)) {
      demoted++;
      await sendPipelineStep(boss, job.job_id, 'generating_vton');
    }
  }
  await bumpFallbackCount(batch.batch_id, demoted);

  if (usable.length === 0) {
    await releaseClaims(batch.batch_id);
    await discardBatch(batch.batch_id);
    return { batchId: null, submitted: 0, demoted, reason: 'every request failed to build' };
  }

  try {
    const handle = await createInlineBatch({
      model: config.VTON_BATCH_MODEL,
      displayName: `vton-${batch.batch_id}`,
      requests: usable.map((u) => u.request),
    });
    await markBatchSubmitted(batch.batch_id, handle.name, usable.length);
    logger.info(
      { batchId: batch.batch_id, providerBatch: handle.name, requests: usable.length, demoted },
      'batch tray submitted',
    );
    return { batchId: batch.batch_id, submitted: usable.length, demoted };
  } catch (err) {
    // A spend cap is not a rate limit: retrying into it burns nothing but time and keeps the lane
    // silently broken. Release the claims so the jobs stay collectable once the cap resets, and
    // shout — this failure mode already cost a full day once.
    const spendCap = err instanceof BatchSpendCapError;
    const message = errorMessageOf(err);
    await releaseClaims(batch.batch_id);
    await updateBatchStatus(batch.batch_id, 'failed', { error: message, completed: true });

    if (spendCap) {
      logger.error(
        { batchId: batch.batch_id, released: usable.length, error: message },
        'AI STUDIO SPEND CAP — batch submission halted; set VTON_BATCH_ENABLED=false or raise the cap',
      );
    } else {
      logger.error({ batchId: batch.batch_id, error: message }, 'batch submission failed, claims released');
    }
    return { batchId: null, submitted: 0, demoted, reason: spendCap ? 'spend cap' : 'submit failed' };
  }
}
