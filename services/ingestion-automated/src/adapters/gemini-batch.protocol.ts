/**
 * Wire-protocol helpers for the AI Studio (Gemini API) batch lane.
 *
 * Everything here is a pure function over values the batch API hands back — no config, no SDK,
 * no network — so the correlation and idempotency rules the economy lane rests on can be tested
 * without env or a live batch. See docs/economy-lane-batch-vton.md.
 */
import { readUsage, type TokenUsage } from './gemini-usage';

// ─── Correlation ─────────────────────────────────────────────────────────────

/**
 * The one field that carries job_id through a batch. Inlined trays put it in
 * `metadata[CORRELATION_KEY]`; file (JSONL) trays put the bare job_id in the line's `key`.
 * Never match results by array index or line order — lines can be missing or carry per-item
 * errors, and matching by position is how the enrichment edge function crossed its wires.
 */
export const CORRELATION_KEY = 'job_id';

// ─── Batch status ────────────────────────────────────────────────────────────

/** `gemini_batches.status`, matching the CHECK constraint on that column. */
export type BatchStatus = 'submitting' | 'pending' | 'running' | 'succeeded' | 'failed' | 'expired';

/**
 * JobState → our status. Two mappings deserve a note:
 *
 * - `JOB_STATE_CANCELLED` is 'failed', not its own status: to the pipeline a cancelled tray is
 *   just a tray that will never deliver, and its members must fall back to the instant lane
 *   exactly as a failed one's do.
 * - `JOB_STATE_PARTIALLY_SUCCEEDED` is 'succeeded'. The items that did land are applied per the
 *   ownership guard, and the reconciliation sweep demotes whatever stayed parked — which is the
 *   same handling a fully successful tray with missing items gets.
 */
const STATE_TO_STATUS: Readonly<Record<string, BatchStatus>> = {
  JOB_STATE_UNSPECIFIED: 'pending',
  JOB_STATE_QUEUED: 'pending',
  JOB_STATE_PENDING: 'pending',
  JOB_STATE_RUNNING: 'running',
  JOB_STATE_UPDATING: 'running',
  JOB_STATE_PAUSED: 'running',
  JOB_STATE_CANCELLING: 'running',
  JOB_STATE_SUCCEEDED: 'succeeded',
  JOB_STATE_PARTIALLY_SUCCEEDED: 'succeeded',
  JOB_STATE_FAILED: 'failed',
  JOB_STATE_CANCELLED: 'failed',
  JOB_STATE_EXPIRED: 'expired',
};

/**
 * An unknown or absent state reads as 'running', never as terminal. A terminal misread is the
 * expensive direction: it sweeps members that are still live back to the instant lane and pays
 * for the same image twice. Reading a finished tray as running only costs one more poll tick.
 */
export function toBatchStatus(state: string | null | undefined): BatchStatus {
  if (!state) return 'running';
  return STATE_TO_STATUS[state] ?? 'running';
}

const TERMINAL: ReadonlySet<BatchStatus> = new Set<BatchStatus>(['succeeded', 'failed', 'expired']);

/** Terminal in the sense that matters: no further results will arrive, so sweep the members. */
export function isTerminalStatus(status: BatchStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * Google expires a batch left "running or pending for more than 48 hours". We self-expire on the
 * same deadline rather than trusting that we can always read the provider state — an unreachable
 * batch would otherwise hold its members parked forever, invisible to the reaper, which excludes
 * the parked state unconditionally.
 */
export const BATCH_DEADLINE_MS = 48 * 60 * 60 * 1000;

export function isPastDeadline(submittedAt: string | Date, now: number): boolean {
  const t = submittedAt instanceof Date ? submittedAt.getTime() : Date.parse(submittedAt);
  if (Number.isNaN(t)) return false;
  return now - t >= BATCH_DEADLINE_MS;
}

// ─── Result items ────────────────────────────────────────────────────────────

/**
 * One result as it arrives, from either transport. The inlined path supplies `metadata`; the
 * JSONL path supplies `key`. Structural on purpose — the poller must be able to hand this raw
 * JSON straight from a downloaded file, not only SDK objects.
 */
export interface RawBatchItem {
  key?: string | null;
  metadata?: Record<string, string> | null;
  response?: RawGenerateContentResponse | null;
  error?: { code?: number; message?: string; status?: string } | null;
}

export interface RawGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } | null }> | null } | null;
    finishReason?: string | null;
  }> | null;
  promptFeedback?: { blockReason?: string | null } | null;
  usageMetadata?: unknown;
}

export type BatchItemResult =
  | { outcome: 'image'; jobId: string; b64: string; mimeType: string; usage: TokenUsage | null }
  | { outcome: 'error'; jobId: string; error: string; refusal: boolean }
  /** No usable correlation value — there is no job to route this to, so it can only be logged. */
  | { outcome: 'uncorrelated'; error: string };

/**
 * finishReason / blockReason values that mean the model declined rather than broke. They are the
 * refusal tax the economy lane's savings are quoted net of, so they are counted separately from
 * genuine failures — a rising refusal rate is the signal to abandon the lane, per the spike's
 * abort criterion.
 */
const REFUSAL_REASONS: ReadonlySet<string> = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'RECITATION',
  'SPII',
]);

export function isRefusalReason(reason: string | null | undefined): boolean {
  return !!reason && REFUSAL_REASONS.has(reason);
}

/** Correlation value for an item, or null when it carries none. */
export function resolveJobId(item: RawBatchItem): string | null {
  const fromMetadata = item.metadata?.[CORRELATION_KEY];
  if (typeof fromMetadata === 'string' && fromMetadata.trim()) return fromMetadata.trim();
  if (typeof item.key === 'string' && item.key.trim()) return item.key.trim();
  return null;
}

/** The first inline image part in a response, if the model returned one. */
export function extractImage(
  response: RawGenerateContentResponse | null | undefined,
): { b64: string; mimeType: string } | null {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part?.inlineData;
    if (inline?.data) return { b64: inline.data, mimeType: inline.mimeType || 'image/png' };
  }
  return null;
}

/**
 * Classify one result. Every non-image outcome carries the job_id so the poller can demote that
 * single job to the instant lane rather than failing the tray — the whole point of per-item
 * handling is that one refusal does not cost the other 29 their batch price.
 */
export function readBatchItem(item: RawBatchItem): BatchItemResult {
  const jobId = resolveJobId(item);
  if (!jobId) {
    return {
      outcome: 'uncorrelated',
      error: `batch item carries no ${CORRELATION_KEY} (metadata or key)`,
    };
  }

  if (item.error) {
    const { code, status, message } = item.error;
    const detail = [status, code != null ? `code ${code}` : null, message].filter(Boolean).join(' ');
    return { outcome: 'error', jobId, error: detail || 'unspecified batch item error', refusal: false };
  }

  const image = extractImage(item.response);
  if (image) {
    return {
      outcome: 'image',
      jobId,
      b64: image.b64,
      mimeType: image.mimeType,
      usage: readUsage(item.response?.usageMetadata),
    };
  }

  const finishReason = item.response?.candidates?.[0]?.finishReason ?? null;
  const blockReason = item.response?.promptFeedback?.blockReason ?? null;
  const reason = blockReason ?? finishReason;
  return {
    outcome: 'error',
    jobId,
    error: `no image in response (finishReason=${finishReason ?? 'unknown'}${blockReason ? `, blockReason=${blockReason}` : ''})`,
    refusal: isRefusalReason(reason),
  };
}

// ─── JSONL transport (the file path, used when a tray outgrows the 20 MB inline ceiling) ────

/** One input line: a user-defined key plus the request it correlates. */
export function toJsonlLine(key: string, request: unknown): string {
  return JSON.stringify({ key, request });
}

/**
 * Parse a downloaded output file. Malformed lines are surfaced as uncorrelated errors rather
 * than thrown: one unparseable line must not cost the rest of the tray its results.
 */
export function parseJsonlResults(text: string): RawBatchItem[] {
  const items: RawBatchItem[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed) as RawBatchItem);
    } catch {
      items.push({ error: { message: `unparseable output line: ${trimmed.slice(0, 200)}` } });
    }
  }
  return items;
}

// ─── Flush decision ──────────────────────────────────────────────────────────

/**
 * Whether a collector tick should actually ship a tray.
 *
 * A cron tick is permission to CONSIDER a tray, not an instruction to send one. Sending whatever
 * happens to be parked on every tick turns a slow arrival rate into a stream of one- and two-item
 * batches: the same price per image, but many times the trays, polling and pressure on the
 * 100-concurrent-batch ceiling — and none of the behaviour anyone means by "batching".
 *
 * So: ship when the tray is full, or when the most patient job has waited long enough that
 * holding out for a fuller tray is no longer worth the delay. Never on a bare tick.
 */
export function shouldFlushTray(input: {
  waiting: number;
  oldestAgeSeconds: number;
  minFill: number;
  maxWaitSeconds: number;
  /**
   * True when nothing upstream can still park — no job anywhere is in a pre-park state on this
   * lane. `minFill` is only ever a GUESS at that question, and for any sheet smaller than it the
   * guess is always wrong: a complete 15-row tray under minFill=20 sat for ~11 minutes waiting out
   * maxWait, on work that was ready at two. When the real answer is available, use it.
   */
  noMoreArrivals?: boolean;
}): { flush: boolean; trigger: 'complete' | 'full' | 'max-wait' | 'none' } {
  if (input.waiting <= 0) return { flush: false, trigger: 'none' };
  // Checked first: a complete tray should never be held back by a fill line it can never reach.
  if (input.noMoreArrivals) return { flush: true, trigger: 'complete' };
  if (input.waiting >= input.minFill) return { flush: true, trigger: 'full' };
  if (input.oldestAgeSeconds >= input.maxWaitSeconds) return { flush: true, trigger: 'max-wait' };
  return { flush: false, trigger: 'none' };
}

// ─── Spend cap ───────────────────────────────────────────────────────────────

/**
 * This lane spends real money against a monthly cap, and hitting that cap returns 429 — the same
 * status as an ordinary rate limit, which wants the opposite reaction (back off and retry, vs.
 * stop submitting entirely and shout). Only the message separates them. This exact ambiguity
 * silently disabled the interactive AI Studio route for a full day.
 *
 * Google publishes no exact wording, so the markers are deliberately loose and callers must log
 * the raw message — that is how this list gets tightened from real output rather than guesses.
 */
const SPEND_CAP_MARKERS: readonly RegExp[] = [
  /spend(ing)?[\s_-]*(limit|cap)/i,
  /monthly[\s_-]*(budget|limit|cap|spend)/i,
  /billing[\s_-]*(budget|limit|cap)/i,
  /budget[\s_-]*(exceeded|limit|cap)/i,
  /exceeded[^.]*\bbudget\b/i,
];

export function errorMessageOf(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  const e = err as { message?: unknown; error?: { message?: unknown } };
  if (typeof e.message === 'string') return e.message;
  if (typeof e.error?.message === 'string') return e.error.message;
  return String(err);
}

export function isSpendCapError(err: unknown): boolean {
  const msg = errorMessageOf(err);
  return SPEND_CAP_MARKERS.some((re) => re.test(msg));
}
