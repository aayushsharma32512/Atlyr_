import type { PipelineState } from '../domain/state';
import { persistStatePatch, readState } from '../domain/state-store';

const TRANSIENT_ERROR_PATTERN =
  /timeout|timed out|econnreset|econnrefused|enotfound|eai_again|rate limit|429|socket hang up|gateway|service unavailable/i;

type PipelineErrorEntry = NonNullable<PipelineState['errors']>[number];
export type PipelineErrorKind = PipelineErrorEntry['kind'];

export function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function classifyErrorKind(message: string): PipelineErrorKind {
  return TRANSIENT_ERROR_PATTERN.test(message) ? 'transient' : 'fatal';
}

function dedupeErrors(existing: PipelineErrorEntry[], additions: PipelineErrorEntry[]): PipelineErrorEntry[] {
  const map = new Map<string, PipelineErrorEntry>();
  for (const entry of existing) {
    map.set(`${entry.step}:${entry.message}:${entry.kind ?? 'unknown'}`, entry);
  }
  for (const entry of additions) {
    map.set(`${entry.step}:${entry.message}:${entry.kind ?? 'unknown'}`, entry);
  }
  return Array.from(map.values());
}

export async function recordNodeError(
  state: PipelineState | undefined,
  step: string,
  err: unknown
): Promise<{ message: string; kind: PipelineErrorKind } | undefined> {
  const jobId = state?.jobId;
  if (!jobId) return undefined;
  const message = normalizeErrorMessage(err);
  const kind = classifyErrorKind(message);
  const current = await readState(jobId);
  const nextErrors = dedupeErrors(current?.errors ?? [], [{ step, message, kind }]);
  await persistStatePatch(jobId, { jobId, errors: nextErrors, step });
  return { message, kind };
}
