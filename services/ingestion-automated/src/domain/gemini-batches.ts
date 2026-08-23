/**
 * Data access for the economy VTON lane's batch trays.
 *
 * Every mutation here that decides a job's fate is a single conditional UPDATE, never a
 * read-then-write. That is the whole safety story of the lane: results arrive hours later in a
 * different process, so the only defensible question to ask is "is this row *still* parked and
 * *still* owned by this tray?" — and the only way to ask it without a race is to make the answer
 * and the write the same statement. Zero rows affected means the world moved on: discard.
 *
 * See docs/economy-lane-batch-vton.md.
 */
import { pgPool } from '../db/pg';
import type { BatchStatus } from '../adapters/gemini-batch.protocol';
import type { IngestionPipelineJob } from './types';

export const PARKED_STATE = 'vton_batch_queued';

export interface GeminiBatchRow {
  batch_id: string;
  provider_batch_name: string | null;
  status: BatchStatus;
  model: string;
  request_count: number;
  input_file: string | null;
  output_file: string | null;
  error: string | null;
  fallback_count: number;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Tray lifecycle ──────────────────────────────────────────────────────────

/**
 * Open a tray in 'submitting' BEFORE claiming anything and before calling the provider.
 *
 * Batch creation is not idempotent, so the dangerous crash window is between "jobs are claimed"
 * and "we know the provider batch name". Recording our intent first turns that window into a
 * recognisable state — a 'submitting' row with no `provider_batch_name` — which the janitor
 * cleans up by releasing the claims. Zero spend, and a double submit is impossible.
 */
export async function openBatch(model: string): Promise<GeminiBatchRow> {
  const { rows } = await pgPool().query<GeminiBatchRow>(
    `INSERT INTO gemini_batches (model, status) VALUES ($1, 'submitting') RETURNING *`,
    [model],
  );
  return rows[0];
}

/**
 * Atomically take up to `limit` parked, unclaimed jobs for this tray.
 *
 * The claim — not the cron cadence — is the concurrency guard: two collector ticks that overlap
 * cannot take the same job, because `gemini_batch_id IS NULL` stops being true the moment the
 * first one commits. `FOR UPDATE SKIP LOCKED` means the second tick moves on to other rows
 * instead of blocking behind the first.
 */
export async function claimJobsForBatch(batchId: string, limit: number): Promise<IngestionPipelineJob[]> {
  const { rows } = await pgPool().query<IngestionPipelineJob>(
    `UPDATE ingestion_pipeline_jobs
        SET gemini_batch_id = $1, updated_at = now()
      WHERE job_id IN (
        SELECT job_id
          FROM ingestion_pipeline_jobs
         WHERE current_state = '${PARKED_STATE}'
           AND gemini_batch_id IS NULL
         ORDER BY updated_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [batchId, limit],
  );
  return rows;
}

export async function markBatchSubmitted(
  batchId: string,
  providerBatchName: string,
  requestCount: number,
  inputFile: string | null = null,
): Promise<void> {
  await pgPool().query(
    `UPDATE gemini_batches
        SET provider_batch_name = $2, request_count = $3, input_file = $4,
            status = 'pending', submitted_at = now(), updated_at = now()
      WHERE batch_id = $1`,
    [batchId, providerBatchName, requestCount, inputFile],
  );
}

export async function updateBatchStatus(
  batchId: string,
  status: BatchStatus,
  fields: { error?: string | null; outputFile?: string | null; completed?: boolean } = {},
): Promise<void> {
  await pgPool().query(
    `UPDATE gemini_batches
        SET status = $2,
            error = COALESCE($3, error),
            output_file = COALESCE($4, output_file),
            completed_at = CASE WHEN $5 THEN now() ELSE completed_at END,
            updated_at = now()
      WHERE batch_id = $1`,
    [batchId, status, fields.error ?? null, fields.outputFile ?? null, fields.completed ?? false],
  );
}

/** Abandon a tray that never reached the provider. Safe to call before or after claiming. */
export async function discardBatch(batchId: string): Promise<void> {
  await pgPool().query(`DELETE FROM gemini_batches WHERE batch_id = $1`, [batchId]);
}

export async function bumpFallbackCount(batchId: string, by: number): Promise<void> {
  if (by <= 0) return;
  await pgPool().query(
    `UPDATE gemini_batches SET fallback_count = fallback_count + $2, updated_at = now() WHERE batch_id = $1`,
    [batchId, by],
  );
}

/** Trays the poller still has to chase. */
export async function listOpenBatches(): Promise<GeminiBatchRow[]> {
  const { rows } = await pgPool().query<GeminiBatchRow>(
    `SELECT * FROM gemini_batches
      WHERE status IN ('submitting', 'pending', 'running')
      ORDER BY created_at ASC`,
  );
  return rows;
}

/**
 * Trays that were opened but never reached the provider — a crash between claiming and
 * submitting. Their members are still claimed and would otherwise sit parked forever behind a
 * tray that does not exist at Google.
 */
export async function listStaleSubmittingBatches(graceSeconds: number): Promise<GeminiBatchRow[]> {
  const { rows } = await pgPool().query<GeminiBatchRow>(
    `SELECT * FROM gemini_batches
      WHERE status = 'submitting'
        AND provider_batch_name IS NULL
        AND now() - created_at > make_interval(secs => $1::int)`,
    [graceSeconds],
  );
  return rows;
}

// ─── Per-job outcomes ────────────────────────────────────────────────────────

/**
 * Hand a job back to the pool of unclaimed parked work. Used when a tray dies before it was ever
 * submitted — the jobs are still perfectly good batch candidates, so they stay in the batch lane
 * rather than being demoted.
 */
export async function releaseClaims(batchId: string): Promise<number> {
  const { rowCount } = await pgPool().query(
    `UPDATE ingestion_pipeline_jobs
        SET gemini_batch_id = NULL, updated_at = now()
      WHERE gemini_batch_id = $1 AND current_state = '${PARKED_STATE}'`,
    [batchId],
  );
  return rowCount ?? 0;
}

/**
 * Advance a job whose batch image has landed. **Call only after the artifact is written** — a
 * crash between the two must leave a parked job that already has its image (recoverable on the
 * next tick), never an advanced job with none.
 *
 * Returns false when the row is no longer parked or no longer owned by this tray: an operator
 * restarted it into the instant lane, it was deleted, or a previous tick already advanced it.
 * A stale result can therefore never double-drive a job into segmenting, which would trip the
 * documented segmentation_jobs clobber hazard.
 */
export async function advanceParkedJob(
  jobId: string,
  batchId: string,
  nextState: string,
): Promise<boolean> {
  const { rowCount } = await pgPool().query(
    `UPDATE ingestion_pipeline_jobs
        SET current_state = $3, gemini_batch_id = NULL, updated_at = now()
      WHERE job_id = $1
        AND current_state = '${PARKED_STATE}'
        AND gemini_batch_id = $2`,
    [jobId, batchId, nextState],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Demote a parked job to the instant lane: a per-item refusal or error, or a member swept up
 * after its tray reached a terminal state. The instant router's model/route failover walk takes
 * over from here.
 *
 * Same ownership guard as `advanceParkedJob`, and for the same reason.
 */
export async function demoteToInstantLane(jobId: string, batchId: string): Promise<boolean> {
  const { rowCount } = await pgPool().query(
    `UPDATE ingestion_pipeline_jobs
        SET current_state = 'generating_vton', vton_lane = 'instant',
            gemini_batch_id = NULL, updated_at = now()
      WHERE job_id = $1
        AND current_state = '${PARKED_STATE}'
        AND gemini_batch_id = $2`,
    [jobId, batchId],
  );
  return (rowCount ?? 0) > 0;
}

/** Members of a tray still sitting parked — what the reconciliation sweep has to deal with. */
export async function listParkedMembers(batchId: string): Promise<{ job_id: string }[]> {
  const { rows } = await pgPool().query<{ job_id: string }>(
    `SELECT job_id::text AS job_id
       FROM ingestion_pipeline_jobs
      WHERE gemini_batch_id = $1 AND current_state = '${PARKED_STATE}'`,
    [batchId],
  );
  return rows;
}

/**
 * Move every unclaimed parked job back to the instant lane. The kill switch's companion: turning
 * the collector off would otherwise strand whatever is already parked, and clicking restart
 * per job does not scale to a 500-row sheet.
 */
export async function unparkAllUnclaimed(): Promise<string[]> {
  const { rows } = await pgPool().query<{ job_id: string }>(
    `UPDATE ingestion_pipeline_jobs
        SET current_state = 'generating_vton', vton_lane = 'instant', updated_at = now()
      WHERE current_state = '${PARKED_STATE}' AND gemini_batch_id IS NULL
      RETURNING job_id::text AS job_id`,
  );
  return rows.map((r) => r.job_id);
}

/** Count of parked jobs waiting for a tray — the collector's "is there work" check. */
export async function countUnclaimedParked(): Promise<number> {
  return (await unclaimedParkedStats()).count;
}

/**
 * How much work is waiting, and how long the most patient job has been waiting for it.
 *
 * Both numbers are needed because the flush decision is fill-OR-age: submit a full tray
 * immediately, but never let a slow trickle sit parked indefinitely just because it never
 * reaches the fill line.
 */
export async function unclaimedParkedStats(): Promise<{ count: number; oldestAgeSeconds: number }> {
  const { rows } = await pgPool().query<{ n: string; oldest: string | null }>(
    `SELECT count(*)::text AS n,
            coalesce(max(extract(epoch from now() - updated_at)), 0)::text AS oldest
       FROM ingestion_pipeline_jobs
      WHERE current_state = '${PARKED_STATE}' AND gemini_batch_id IS NULL`,
  );
  return { count: Number(rows[0]?.n ?? 0), oldestAgeSeconds: Math.floor(Number(rows[0]?.oldest ?? 0)) };
}
