import { supabaseAdmin } from '../db/supabase';
import type { IngestionBatch, IngestionPipelineJob } from './types';

export async function insertBatch(input: {
  label: string;
  created_by: string | null;
  total: number;
}): Promise<IngestionBatch> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_batches')
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(`insertBatch failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data as IngestionBatch;
}

// total is only known after the per-row dedupe pass, so the row is created first (jobs need the
// FK) and the accepted count written back once submission finishes.
export async function updateBatchTotal(batchId: string, total: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ingestion_batches')
    .update({ total })
    .eq('batch_id', batchId);

  if (error) throw new Error(`updateBatchTotal failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
}

export async function getBatch(batchId: string): Promise<IngestionBatch | null> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_batches')
    .select('*')
    .eq('batch_id', batchId)
    .maybeSingle();

  if (error) throw new Error(`getBatch failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return data as IngestionBatch | null;
}

export async function listBatches(limit = 20): Promise<IngestionBatch[]> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listBatches failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return (data ?? []) as IngestionBatch[];
}

export async function listJobsByBatch(batchId: string): Promise<IngestionPipelineJob[]> {
  const { data, error } = await supabaseAdmin
    .from('ingestion_pipeline_jobs')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`listJobsByBatch failed: ${error.message ?? error.code ?? JSON.stringify(error)}`);
  return (data ?? []) as IngestionPipelineJob[];
}
