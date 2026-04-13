import type { PipelineState } from './state';
import { supabaseAdmin } from '../db/supabase';
import { mergePipelineState } from './merge-pipeline-state';

const TABLE = 'ingestion_job_state';

/**
 * LangGraph checkpoints map 1:1 with our PipelineState rows.
 * The orchestrator will call loadCheckpoint/saveCheckpoint via these helpers.
 */
export async function loadCheckpoint(jobId: string): Promise<PipelineState | undefined> {
  return fetchState(jobId);
}

export async function saveCheckpoint(jobId: string, patch: Partial<PipelineState>): Promise<PipelineState> {
  return persistStatePatch(jobId, patch);
}

async function fetchState(jobId: string): Promise<PipelineState | undefined> {
  const row = await fetchStateRow(jobId);
  return row?.currentstate ?? undefined;
}

type StateRow = {
  currentstate: PipelineState;
  updated_at: string;
};

async function fetchStateRow(jobId: string): Promise<StateRow | undefined> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('currentstate, updated_at')
    .eq('job_id', jobId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return undefined;
  return {
    currentstate: data.currentstate as PipelineState,
    updated_at: data.updated_at as string
  };
}

export async function readState(jobId: string): Promise<PipelineState | undefined> {
  return fetchState(jobId);
}

export type StateWithCheckpoint = {
  state?: PipelineState;
  checkpoint?: unknown;
};

export async function readStateWithCheckpoint(jobId: string): Promise<StateWithCheckpoint | undefined> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('currentstate, checkpoint')
    .eq('job_id', jobId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return undefined;

  return {
    state: data.currentstate as PipelineState | undefined,
    checkpoint: data.checkpoint as unknown
  };
}

export async function persistStatePatch(jobId: string, patch: Partial<PipelineState>): Promise<PipelineState> {
  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const row = await fetchStateRow(jobId);
    const prev = row?.currentstate;
    const next = mergePipelineState(prev, { ...patch, jobId });
    const now = new Date().toISOString();

    if (row) {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .update({ currentstate: next, updated_at: now })
        .eq('job_id', jobId)
        .eq('updated_at', row.updated_at)
        .select('job_id');

      if (error) throw error;
      if (data && data.length > 0) {
        return next;
      }
      continue;
    }

    const { error } = await supabaseAdmin
      .from(TABLE)
      .insert({ job_id: jobId, currentstate: next, updated_at: now });

    if (!error) return next;
    if ((error as { code?: string }).code === '23505') {
      continue;
    }
    throw error;
  }

  throw new Error(`state-update-conflict:${jobId}`);
}

export async function resetState(jobId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq('job_id', jobId);

  if (error) throw error;
}
