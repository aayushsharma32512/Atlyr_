/**
 * AI Studio (Gemini API) Batch client — the transport the economy VTON lane runs on.
 *
 * Batch trades latency for ~50% of the interactive price: submissions come back minutes-to-hours
 * later (24h SLA, 48h hard expiry) against a tray of requests. This module owns only the
 * transport — creating trays, reading their state, uploading and fetching files. It knows nothing
 * about pipeline jobs; correlation and idempotency live in the collector/poller on top of
 * ./gemini-batch.protocol. See docs/economy-lane-batch-vton.md.
 */
import { GoogleGenAI, type BatchJob, type File as GenAIFile, type InlinedRequest } from '@google/genai';
import { config } from '../config/index';
import { createLogger } from '../utils/logger';
import { withRetry, isTransientUpstreamError } from '../utils/retry';
import {
  errorMessageOf,
  isSpendCapError,
  toBatchStatus,
  type BatchStatus,
  type RawBatchItem,
} from './gemini-batch.protocol';

const logger = createLogger({ stage: 'adapter:gemini-batch' });

const API_BASE = 'https://generativelanguage.googleapis.com';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Raised instead of a bare 429 when the monthly spend cap is what refused us. The collector must
 * treat this as "stop submitting and surface loudly", never as a retryable rate limit — retrying
 * into a spend cap is how a lane goes quiet for a day without anyone noticing.
 */
export class BatchSpendCapError extends Error {
  readonly kind = 'spend_cap';
  constructor(message: string) {
    super(message);
    this.name = 'BatchSpendCapError';
  }
}

/**
 * Fail fast on a spend cap, retry ordinary transient upstream trouble. Ordering matters: a spend
 * cap arrives as 429, which `isTransientUpstreamError` would happily retry forever.
 */
function shouldRetryBatchCall(err: unknown): boolean {
  if (err instanceof BatchSpendCapError) return false;
  return isTransientUpstreamError(err);
}

function rethrowSpendCap(err: unknown): never {
  if (isSpendCapError(err)) {
    const msg = errorMessageOf(err);
    logger.error({ error: msg }, 'AI Studio spend cap reached — batch submission must stop');
    throw new BatchSpendCapError(msg);
  }
  throw err;
}

// ─── Client ──────────────────────────────────────────────────────────────────

let _client: GoogleGenAI | undefined;

function client(): GoogleGenAI {
  if (!config.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');
  if (!_client) _client = new GoogleGenAI({ apiKey: config.GOOGLE_API_KEY });
  return _client;
}

// ─── Batch jobs ──────────────────────────────────────────────────────────────

/** A tray as this service cares about it: provider name, our status, and whatever came back. */
export interface BatchHandle {
  /** Provider resource name, "batches/…". The only handle `getBatch`/`cancelBatch` accept. */
  name: string;
  status: BatchStatus;
  /** Raw JobState, kept for logs — our status collapses several of them. */
  state: string | null;
  error: string | null;
  /** Present on a succeeded inlined tray. */
  items: RawBatchItem[] | null;
  /** Present on a succeeded file tray; fetch with `downloadFileText`. */
  outputFileName: string | null;
}

function toHandle(job: BatchJob): BatchHandle {
  if (!job.name) throw new Error('batch job returned without a resource name');
  const dest = job.dest;
  return {
    name: job.name,
    status: toBatchStatus(job.state),
    state: job.state ?? null,
    error: job.error ? errorMessageOf(job.error) : null,
    items: (dest?.inlinedResponses as RawBatchItem[] | undefined) ?? null,
    outputFileName: dest?.fileName ?? null,
  };
}

/**
 * Submit an inlined tray. Suitable while the whole payload stays under the 20 MB ceiling —
 * which it does once avatars are referenced by `fileUri` instead of inlined per request.
 *
 * Not idempotent: the API mints a new batch on every call, so a retry after an ambiguous failure
 * bills twice. The collector guards this by claiming jobs before submitting, never after.
 */
export async function createInlineBatch(params: {
  model: string;
  displayName: string;
  requests: InlinedRequest[];
}): Promise<BatchHandle> {
  if (params.requests.length === 0) throw new Error('createInlineBatch: empty tray');
  const job = await withRetry(
    () =>
      client()
        .batches.create({
          model: params.model,
          src: params.requests,
          config: { displayName: params.displayName },
        })
        .catch(rethrowSpendCap),
    {
      retries: 3,
      backoffMs: 2000,
      maxBackoffMs: 30_000,
      shouldRetry: shouldRetryBatchCall,
      onRetry: (err, attempt, delayMs) =>
        logger.warn(
          { attempt, delayMs, error: errorMessageOf(err) },
          'batch create failed, retrying',
        ),
    },
  );
  const handle = toHandle(job);
  logger.info(
    { batch: handle.name, state: handle.state, requests: params.requests.length },
    'batch submitted (inline)',
  );
  return handle;
}

/**
 * Submit a tray from a JSONL file already uploaded to the Files API. The escape hatch for when a
 * tray outgrows 20 MB inline; correlation moves from `metadata` to each line's `key`.
 */
export async function createFileBatch(params: {
  model: string;
  displayName: string;
  /** Files API resource name, "files/…". */
  fileName: string;
}): Promise<BatchHandle> {
  const job = await withRetry(
    () =>
      client()
        .batches.create({
          model: params.model,
          src: { fileName: params.fileName },
          config: { displayName: params.displayName },
        })
        .catch(rethrowSpendCap),
    {
      retries: 3,
      backoffMs: 2000,
      maxBackoffMs: 30_000,
      shouldRetry: shouldRetryBatchCall,
      onRetry: (err, attempt, delayMs) =>
        logger.warn({ attempt, delayMs, error: errorMessageOf(err) }, 'batch create failed, retrying'),
    },
  );
  const handle = toHandle(job);
  logger.info({ batch: handle.name, state: handle.state, file: params.fileName }, 'batch submitted (file)');
  return handle;
}

export async function getBatch(name: string): Promise<BatchHandle> {
  const job = await withRetry(() => client().batches.get({ name }), {
    retries: 3,
    backoffMs: 1000,
    maxBackoffMs: 15_000,
    shouldRetry: isTransientUpstreamError,
  });
  return toHandle(job);
}

/** Stop a mistakenly-submitted tray so it stops billing. Best-effort: a tray that already finished cannot be cancelled. */
export async function cancelBatch(name: string): Promise<void> {
  await client().batches.cancel({ name });
  logger.warn({ batch: name }, 'batch cancelled');
}

// ─── Files API ───────────────────────────────────────────────────────────────

export interface UploadedFile {
  /** Resource name, "files/…". */
  name: string;
  /** The URI a request references as `fileData.fileUri`. */
  uri: string;
  mimeType: string;
  /** Google stores uploads for 48 hours; past this the URI 404s and must be re-uploaded. */
  expiresAt: string | null;
}

function toUploadedFile(file: GenAIFile, fallbackMime: string): UploadedFile {
  if (!file.name || !file.uri) throw new Error('Files API upload returned without a name/uri');
  return {
    name: file.name,
    uri: file.uri,
    mimeType: file.mimeType ?? fallbackMime,
    expiresAt: file.expirationTime ?? null,
  };
}

/**
 * Upload bytes and return a reusable `fileUri`. This is what keeps a tray inline-able: the male
 * avatar alone is ~16 MB as base64, so inlining it per request blows the 20 MB ceiling on the
 * first job. Referenced instead, a 30-job tray is ~6 MB.
 *
 * The 48-hour retention is the same window after which a batch expires, so a cached URI is only
 * ever as stale as a tray is allowed to be — but callers must still handle a miss by re-uploading.
 */
export async function uploadFile(params: {
  bytes: Buffer | Uint8Array;
  mimeType: string;
  displayName?: string;
}): Promise<UploadedFile> {
  const blob = new Blob([new Uint8Array(params.bytes)], { type: params.mimeType });
  const file = await withRetry(
    () =>
      client().files.upload({
        file: blob,
        config: { mimeType: params.mimeType, displayName: params.displayName },
      }),
    {
      retries: 3,
      backoffMs: 1000,
      maxBackoffMs: 15_000,
      shouldRetry: isTransientUpstreamError,
      onRetry: (err, attempt, delayMs) =>
        logger.warn(
          { attempt, delayMs, displayName: params.displayName, error: errorMessageOf(err) },
          'file upload failed, retrying',
        ),
    },
  );
  const uploaded = toUploadedFile(await waitForFileActive(file), params.mimeType);
  logger.info(
    { file: uploaded.name, uri: uploaded.uri, expiresAt: uploaded.expiresAt, bytes: params.bytes.length },
    'uploaded file to Files API',
  );
  return uploaded;
}

/**
 * An upload lands in PROCESSING and a request that references it before it is ACTIVE fails. For
 * images the transition is near-immediate, so this almost never sleeps — but "almost never" is
 * not "never", and the failure it prevents would look like a bad `fileUri`.
 */
async function waitForFileActive(file: GenAIFile, timeoutMs = 60_000): Promise<GenAIFile> {
  if (!file.name) throw new Error('Files API upload returned without a name');
  const deadline = Date.now() + timeoutMs;
  let current = file;
  while (current.state === 'PROCESSING' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    current = await client().files.get({ name: current.name! });
  }
  if (current.state === 'FAILED') {
    throw new Error(`Files API upload failed: ${errorMessageOf(current.error) || 'unknown error'}`);
  }
  if (current.state === 'PROCESSING') {
    throw new Error(`Files API upload still PROCESSING after ${timeoutMs}ms: ${current.name}`);
  }
  return current;
}

export async function deleteFile(name: string): Promise<void> {
  await client().files.delete({ name });
}

/**
 * Fetch a Files API object as text. Used for batch output JSONL.
 *
 * Goes straight at the media endpoint rather than the SDK's `files.download`, which only writes
 * to a path on disk — the poller wants the bytes in memory, not a temp file to clean up.
 */
export async function downloadFileText(name: string): Promise<string> {
  if (!config.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');
  const url = `${API_BASE}/download/v1beta/${name}:download?alt=media`;
  const resp = await withRetry(
    async () => {
      const r = await fetch(url, {
        headers: { 'x-goog-api-key': config.GOOGLE_API_KEY! },
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) throw new Error(`Files API download ${r.status}: ${await r.text()}`);
      return r;
    },
    { retries: 3, backoffMs: 1000, maxBackoffMs: 15_000, shouldRetry: isTransientUpstreamError },
  );
  return resp.text();
}
