import { supabaseAdmin } from '../db/supabase';
import type { IngestionPipelineJob, PipelineState } from './types';

export async function getJob(jobId: string): Promise<IngestionPipelineJob> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (error) throw new Error(`getJob failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data as IngestionPipelineJob;
}

export async function insertJob(
  input: Omit<IngestionPipelineJob, 'job_id' | 'error_count' | 'last_error' | 'last_error_step' | 'created_at' | 'updated_at' | 'current_state' | 'v_ton_preferred_image' | 'vton_image_url' | 'segmented_image_url' | 'ingested_product_id'>
): Promise<IngestionPipelineJob> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .insert({ ...input, current_state: 'pending' })
    .select()
    .single();

  if (error) throw new Error(`insertJob failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data as IngestionPipelineJob;
}

export async function updateJob(
  jobId: string,
  updates: Partial<Omit<IngestionPipelineJob, 'job_id' | 'created_at'>>
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('job_id', jobId);

  if (error) throw new Error(`updateJob failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
}

export async function updateState(jobId: string, state: PipelineState): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .update({ current_state: state, updated_at: new Date().toISOString() })
    .eq('job_id', jobId);

  if (error) throw new Error(`updateState failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
}

export async function findJobByDedupeKey(
  key: string
): Promise<IngestionPipelineJob | null> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .select('*')
    .eq('dedupe_key', key)
    .not('current_state', 'in', '("completed","failed","discarded","cancelled")')
    .maybeSingle();

  if (error) throw new Error(`findJobByDedupeKey failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data as IngestionPipelineJob | null;
}

export async function markJobFailed(
  jobId: string,
  errorMsg: string,
  step: string
): Promise<void> {
  const job = await getJob(jobId);

  const { error } = await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .update({
      current_state: 'failed',
      last_error: errorMsg,
      last_error_step: step,
      error_count: job.error_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('job_id', jobId);

  if (error) throw new Error(`markJobFailed failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
}

export async function listJobs(filters: {
  state?: string;
  created_by?: string;
  limit?: number;
  offset?: number;
}): Promise<IngestionPipelineJob[]> {
  let query = supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 50);

  if (filters.state) query = query.eq('current_state', filters.state);
  if (filters.created_by) query = query.eq('created_by', filters.created_by);
  if (filters.offset) query = query.range(filters.offset, (filters.offset ?? 0) + (filters.limit ?? 50) - 1);

  const { data, error } = await query;
  if (error) throw new Error(`listJobs failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return (data ?? []) as IngestionPipelineJob[];
}
