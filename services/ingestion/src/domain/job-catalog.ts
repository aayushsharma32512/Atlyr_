import { z } from 'zod';
import { buildDedupeKey, uuid } from './ids';
import { persistStatePatch, readState } from './state-store';
import { config } from '../config/index';
import { supabaseAdmin } from '../db/supabase';
import type { PipelineState } from './state';

const TRACKING_PARAM_PREFIXES = ['utm_', 'ic_', 'mc_', 'spm', 'ga_'];
const TRACKING_PARAM_KEYS = new Set([
  'ref',
  'refid',
  'referrer',
  'gclid',
  'fbclid',
  'yclid',
  'msclkid',
  'campaign',
  'campaignid',
  'adgroup',
  'adgroupid',
  'adid',
  'source',
  'medium',
  'cid',
  'cm_mmc',
  'mc_eid'
]);

export type CanonicalUrlParts = {
  originalUrl: string;
  canonicalUrl: string;
  domain: string;
  path: string;
};

export function canonicalizeProductUrl(rawUrl: string): CanonicalUrlParts {
  const trimmed = rawUrl.trim();
  const parsed = new URL(trimmed);

  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();

  const params = new URLSearchParams(parsed.search);
  for (const key of Array.from(params.keys())) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAM_KEYS.has(lower)) {
      params.delete(key);
      continue;
    }
    if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      params.delete(key);
    }
  }
  params.sort();
  parsed.search = params.toString() ? `?${params.toString()}` : '';

  let normalisedPath = parsed.pathname || '/';
  normalisedPath = normalisedPath.replace(/\/{2,}/g, '/');
  if (normalisedPath.length > 1 && normalisedPath.endsWith('/')) {
    normalisedPath = normalisedPath.slice(0, -1);
  }
  parsed.pathname = normalisedPath;

  const canonical = parsed.toString();
  return {
    originalUrl: trimmed,
    canonicalUrl: canonical,
    domain: parsed.hostname,
    path: normalisedPath
  };
}

const JobRowSchema = z.object({
  job_id: z.string().uuid(),
  dedupe_key: z.string().min(1)
});

export type IngestionJobRow = z.infer<typeof JobRowSchema> & {
  status: string;
  canonical_url: string;
  original_url: string;
  batch_id: string | null;
  created_at: string;
  updated_at: string;
  last_step: string | null;
  phase_flags: Record<string, unknown> | null;
  error_count: number;
  last_error: string | null;
  pause_reason: string | null;
};

export async function findJobByDedupeKey(dedupeKey: string): Promise<IngestionJobRow | null> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_jobs')
    .select('*')
    .eq('dedupe_key', dedupeKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data as IngestionJobRow | null;
}

export type StaleQueuedJob = {
  job_id: string;
  dedupe_key: string;
  created_at: string;
  status: string;
  started_at: string | null;
};

export async function findStaleQueuedJobs(cutoffIso: string): Promise<StaleQueuedJob[]> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_jobs')
    .select('job_id,dedupe_key,created_at,status,started_at')
    .eq('status', 'queued')
    .is('started_at', null)
    .lt('created_at', cutoffIso)
    .limit(200);

  if (error) {
    throw error;
  }
  return (data as StaleQueuedJob[] | null) ?? [];
}

export type CreateJobOptions = {
  batchId?: string;
  batchLabel?: string;
  createdBy?: string;
};

export type CreateJobResult = {
  jobId: string;
  dedupeKey: string;
  canonical: CanonicalUrlParts;
};

export async function createJobRecord(originalUrl: string, options: CreateJobOptions = {}): Promise<CreateJobResult> {
  const canonical = canonicalizeProductUrl(originalUrl);
  const { domain, path, canonicalUrl } = canonical;
  const dedupeKey = buildDedupeKey(domain, path);
  const jobId = uuid();

  await persistStatePatch(jobId, {
    jobId,
    originalUrl: canonicalUrl,
    domain,
    dedupeKey,
    artifacts: {
      capabilities: {
        ghostBackEnabled: config.ENABLE_GHOST_BACK_VIEW
      }
    },
    flags: {
      submitReceived: true
    }
  });

  const { error } = await supabaseAdmin
    .from('ingestion_jobs')
    .upsert(
      {
        job_id: jobId,
        original_url: canonical.originalUrl,
        canonical_url: canonicalUrl,
        domain,
        path,
        dedupe_key: dedupeKey,
        batch_id: options.batchId ?? null,
        batch_label: options.batchLabel ?? null,
        created_by: options.createdBy ?? null,
        status: 'queued',
        phase_flags: {},
        queued_at: new Date().toISOString()
      },
      { onConflict: 'job_id' }
    );

  if (error) {
    throw error;
  }

  return { jobId, dedupeKey, canonical };
}

export async function getJobWithState(jobId: string) {
  const [{ data, error }, state] = await Promise.all([
    supabaseAdmin.from('ingestion_jobs').select('*').eq('job_id', jobId).maybeSingle(),
    readState(jobId)
  ]);

  if (error) throw error;
  return { catalog: data as IngestionJobRow | null, state };
}

type IngestionJobStatus =
  | 'queued'
  | 'ingesting'
  | 'awaiting_phase1'
  | 'phase1_complete'
  | 'awaiting_phase2'
  | 'promoting'
  | 'completed'
  | 'cancelled'
  | 'errored';

function resolveStatus(state: PipelineState): IngestionJobStatus {
  if (state.flags?.cancelled) return 'cancelled';
  if (state.flags?.promoteCompleted) return 'completed';
  const hasNonTransientErrors = (state.errors ?? []).some((entry) => entry.kind !== 'transient');
  if (hasNonTransientErrors) return 'errored';
  if (state.pause?.reason === 'hitl_phase2') return 'awaiting_phase2';
  if (state.pause?.reason === 'hitl_phase1') return 'awaiting_phase1';
  if (state.flags?.stageCompleted) return 'promoting';
  if (state.flags?.hitlPhase1Completed) return 'phase1_complete';
  return 'ingesting';
}

function pickPhaseFlags(state: PipelineState): Record<string, boolean> {
  const flags = state.flags ?? {};
  return {
    hitlPhase1Completed: Boolean(flags.hitlPhase1Completed),
    hitlPhase2Completed: Boolean(flags.hitlPhase2Completed),
    stageCompleted: Boolean(flags.stageCompleted),
    promoteCompleted: Boolean(flags.promoteCompleted)
  };
}

function deriveTimestamps(state: PipelineState) {
  const timestamps = state.timestamps ?? {};
  return {
    phase1_completed_at: timestamps.hitl_phase1_resumed ?? timestamps.hitl_phase1_rerun ?? null,
    phase2_completed_at: timestamps.hitl_phase2_resumed ?? timestamps.hitl_phase2_rerun ?? null,
    stage_at: timestamps.stage_completed ?? null,
    promote_at: timestamps.promote_completed ?? null,
    completed_at: timestamps.promote_completed ?? null
  };
}

export async function markJobStarted(jobId: string) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('ingestion_jobs')
    .update({ status: 'ingesting', started_at: now, updated_at: now })
    .eq('job_id', jobId)
    .in('status', ['queued', 'ingesting']);

  if (error) throw error;
}

export async function updateJobCatalogFromState(jobId: string, state: PipelineState) {
  const now = new Date().toISOString();
  const status = resolveStatus(state);
  const phaseFlags = pickPhaseFlags(state);
  const timestamps = deriveTimestamps(state);
  const errorCount = state.errors?.length ?? 0;
  const lastError = errorCount > 0 ? state.errors?.[state.errors.length - 1]?.message ?? null : null;
  const lastStep = state.step ?? state.pause?.atNode ?? null;

  const { error } = await supabaseAdmin
    .from('ingestion_jobs')
    .update({
      status,
      last_step: lastStep,
      phase_flags: phaseFlags,
      pause_reason: state.pause?.reason ?? null,
      error_count: errorCount,
      last_error: lastError,
      updated_at: now,
      ...timestamps
    })
    .eq('job_id', jobId);

  if (error) throw error;
}
