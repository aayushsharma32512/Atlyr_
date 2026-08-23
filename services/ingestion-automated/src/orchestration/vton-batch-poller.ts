/**
 * Poller — brings batch results home, then lets each job continue alone.
 *
 * Two invariants dominate the design:
 *
 * **Apply results BEFORE marking the tray terminal.** The scan set is 'pending'/'running'; the
 * moment a row is written 'succeeded' it leaves that set forever. Persisting the status first
 * means a crash mid-application permanently strands results that have already been paid for. So:
 * fetch state → apply every item → sweep → and only then write the terminal status. A crash
 * anywhere in that window leaves the row 'running' and the next tick redoes it — harmlessly,
 * because every per-item write is guarded.
 *
 * **Every terminal outcome sweeps its members** — succeeded, failed and expired alike. A tray
 * Google reports as failed at hour 2 must demote its parked members in that same tick. Otherwise
 * they sit parked forever, invisible to the reaper, which excludes the parked state outright.
 */
import type { BossHandle } from '../queue/boss';
import { config } from '../config/index';
import {
  bumpFallbackCount,
  demoteToInstantLane,
  advanceParkedJob,
  listOpenBatches,
  listParkedMembers,
  listStaleSubmittingBatches,
  releaseClaims,
  updateBatchStatus,
  type GeminiBatchRow,
} from '../domain/gemini-batches';
import { getLatestArtifact } from '../domain/artifacts';
import { downloadFileText, getBatch, type BatchHandle } from '../adapters/gemini-batch';
import {
  errorMessageOf,
  isPastDeadline,
  isTerminalStatus,
  parseJsonlResults,
  readBatchItem,
  type BatchStatus,
  type RawBatchItem,
} from '../adapters/gemini-batch.protocol';
import { persistVtonResult } from '../steps/persist-vton-result';
import { nextState } from './state-machine';
import { sendPipelineStep } from '../queue/send-step';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'vton-batch-poller' });

const BATCH_ROUTE = 'batch:ai_studio';

/**
 * Where a resumed job goes next. Derived from the state machine rather than hardcoded to
 * 'segmenting', so the batch lane cannot drift out of step with the instant one if the edge
 * after generating_vton ever changes.
 */
function stateAfterVton(): string {
  return nextState({ current_state: 'generating_vton' } as never);
}

export interface PollResult {
  batchesChecked: number;
  applied: number;
  demoted: number;
  released: number;
}

// ─── Result application ──────────────────────────────────────────────────────

async function fetchItems(handle: BatchHandle): Promise<RawBatchItem[]> {
  if (handle.items) return handle.items;
  if (handle.outputFileName) return parseJsonlResults(await downloadFileText(handle.outputFileName));
  return [];
}

/**
 * Apply one result. Returns what happened so the tick can count it.
 *
 * The order — artifact, then the guarded state advance — is Rule 4 and is not negotiable: a crash
 * between them leaves a parked job that already owns its image, which the next tick completes.
 * The reverse would leave an advanced job with no image and nothing to recover it.
 */
async function applyItem(
  boss: BossHandle,
  batch: GeminiBatchRow,
  raw: RawBatchItem,
): Promise<'applied' | 'demoted' | 'skipped'> {
  const result = readBatchItem(raw);

  if (result.outcome === 'uncorrelated') {
    logger.warn({ batchId: batch.batch_id, error: result.error }, 'batch result carried no job id, discarding');
    return 'skipped';
  }

  const { jobId } = result;

  if (result.outcome === 'error') {
    logger.warn(
      { batchId: batch.batch_id, jobId, refusal: result.refusal, error: result.error },
      result.refusal ? 'batch item refused, falling back to instant lane' : 'batch item failed, falling back to instant lane',
    );
    if (!(await demoteToInstantLane(jobId, batch.batch_id))) return 'skipped';
    await sendPipelineStep(boss, jobId, 'generating_vton');
    return 'demoted';
  }

  // Writing the artifact twice would be wasteful rather than wrong (the newest wins), but a
  // repeated tick after a crash is exactly the case this lane is built for — so skip the upload
  // when the image is already stored and go straight to completing the advance.
  const existing = await getLatestArtifact(jobId, 'vton_image');
  const alreadyStored = typeof existing?.data?.public_url === 'string' && existing.data.public_url;

  if (!alreadyStored) {
    await persistVtonResult({
      jobId,
      bytes: Buffer.from(result.b64, 'base64'),
      mimeType: result.mimeType,
      modelUsed: batch.model,
      routeUsed: BATCH_ROUTE,
      // Wall-clock from submission to collection, not model time — batch does not report the latter.
      inferenceMs: batch.submitted_at ? Date.now() - Date.parse(batch.submitted_at) : 0,
      usage: result.usage,
    });
  }

  const target = stateAfterVton();
  if (!(await advanceParkedJob(jobId, batch.batch_id, target))) {
    // Restarted into the instant lane while the tray was out, deleted, or already advanced by an
    // earlier tick. The image is stored either way; nothing here may drive the job.
    logger.info({ batchId: batch.batch_id, jobId }, 'batch result no longer owns its job, discarding');
    return 'skipped';
  }

  // targetState matters: without it a 90-minute Modal segmentation would be sent with the fast
  // queue's 30-minute expiry and a retry would run concurrently with the original.
  await sendPipelineStep(boss, jobId, target);
  logger.info({ batchId: batch.batch_id, jobId, nextState: target }, 'batch result applied');
  return 'applied';
}

/**
 * Nothing may stay parked behind a terminal tray. Runs for success (missing items), failure and
 * expiry alike, and — per the ordering invariant — before the terminal status is persisted.
 */
async function sweepMembers(boss: BossHandle, batch: GeminiBatchRow, why: string): Promise<number> {
  const stragglers = await listParkedMembers(batch.batch_id);
  let demoted = 0;
  for (const { job_id } of stragglers) {
    if (!(await demoteToInstantLane(job_id, batch.batch_id))) continue;
    await sendPipelineStep(boss, job_id, 'generating_vton');
    demoted++;
  }
  if (demoted > 0) {
    logger.warn({ batchId: batch.batch_id, demoted, why }, 'swept parked members back to the instant lane');
  }
  return demoted;
}

// ─── Tick ────────────────────────────────────────────────────────────────────

export async function pollVtonBatches(boss: BossHandle): Promise<PollResult> {
  const result: PollResult = { batchesChecked: 0, applied: 0, demoted: 0, released: 0 };

  // Janitor first: trays that were opened but never reached the provider still hold claims.
  for (const stale of await listStaleSubmittingBatches(config.VTON_BATCH_SUBMIT_GRACE_SECONDS)) {
    const released = await releaseClaims(stale.batch_id);
    await updateBatchStatus(stale.batch_id, 'failed', {
      error: 'never submitted — collector crashed between claiming and submitting',
      completed: true,
    });
    result.released += released;
    logger.warn({ batchId: stale.batch_id, released }, 'released claims from a tray that was never submitted');
  }

  const open = (await listOpenBatches()).filter((b) => b.provider_batch_name);

  for (const batch of open) {
    result.batchesChecked++;
    const now = Date.now();

    let handle: BatchHandle | null = null;
    try {
      handle = await getBatch(batch.provider_batch_name!);
    } catch (err) {
      logger.warn({ batchId: batch.batch_id, error: errorMessageOf(err) }, 'batch state unreachable');
    }

    // Google expires a tray left running or pending past 48h. Self-expire on the same deadline
    // even when the provider is unreachable, or an unreadable tray holds its members forever.
    const submittedAt = batch.submitted_at ?? batch.created_at;
    const overdue = isPastDeadline(submittedAt, now);
    const status: BatchStatus = handle ? handle.status : overdue ? 'expired' : batch.status;

    if (!isTerminalStatus(status)) {
      if (!overdue) {
        if (status !== batch.status) {
          await updateBatchStatus(batch.batch_id, status);
          // The only sign of life while a tray renders — without it the logs are silent for the
          // whole wait and "everything is at Google" is indistinguishable from "nothing running".
          logger.info(
            { batchId: batch.batch_id, providerBatch: batch.provider_batch_name, from: batch.status, to: status },
            'batch tray state changed at Google',
          );
        }
        const ageSeconds = Math.round((now - Date.parse(submittedAt)) / 1000);
        if (ageSeconds > config.VTON_BATCH_STALE_WARN_SECONDS) {
          logger.warn(
            { batchId: batch.batch_id, providerBatch: batch.provider_batch_name, ageSeconds, state: handle?.state },
            'batch tray still pending well past the expected turnaround',
          );
        }
        continue;
      }
      logger.warn({ batchId: batch.batch_id, state: handle?.state }, 'batch past the 48h deadline, treating as expired');
    }

    const terminal: BatchStatus = isTerminalStatus(status) ? status : 'expired';

    // ── apply, then sweep, then persist. Never the other way round. ──
    if (terminal === 'succeeded' && handle) {
      let items: RawBatchItem[] = [];
      try {
        items = await fetchItems(handle);
      } catch (err) {
        // Cannot read results this tick. Leave the row non-terminal so the next tick retries;
        // marking it succeeded here would strand every result in it.
        logger.error({ batchId: batch.batch_id, error: errorMessageOf(err) }, 'could not read batch results, retrying next tick');
        continue;
      }

      for (const raw of items) {
        try {
          const outcome = await applyItem(boss, batch, raw);
          if (outcome === 'applied') result.applied++;
          if (outcome === 'demoted') result.demoted++;
        } catch (err) {
          // One unwritable result must not strand the rest. The row stays parked, so the sweep
          // below (or the next tick) still resolves it.
          logger.error({ batchId: batch.batch_id, error: errorMessageOf(err) }, 'failed to apply a batch result');
        }
      }
    }

    const swept = await sweepMembers(boss, batch, terminal);
    result.demoted += swept;
    await bumpFallbackCount(batch.batch_id, swept);

    await updateBatchStatus(batch.batch_id, terminal, {
      error: handle?.error ?? (terminal === 'expired' ? 'batch expired' : null),
      outputFile: handle?.outputFileName ?? null,
      completed: true,
    });

    logger.info(
      { batchId: batch.batch_id, status: terminal, applied: result.applied, demoted: result.demoted },
      'batch tray closed',
    );
  }

  return result;
}
