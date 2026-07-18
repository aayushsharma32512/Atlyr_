import { supabaseAdmin } from '../db/supabase';
import type { PipelineStepArtifact } from './types';

export async function saveArtifact(input: {
  jobId: string;
  stepName: string;
  artifactType: string;
  data?: Record<string, unknown>;
  storagePath?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pipeline_step_artifacts')
    .insert({
      job_id: input.jobId,
      step_name: input.stepName,
      artifact_type: input.artifactType,
      data: input.data ?? null,
      storage_path: input.storagePath ?? null,
    });

  if (error) throw new Error(`saveArtifact failed: ${error.message}`);
}

export async function getArtifacts(
  jobId: string,
  artifactType: string
): Promise<PipelineStepArtifact[]> {
  const { data, error } = await supabaseAdmin
    .from('pipeline_step_artifacts')
    .select('*')
    .eq('job_id', jobId)
    .eq('artifact_type', artifactType)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`getArtifacts failed: ${error.message}`);
  return (data ?? []) as PipelineStepArtifact[];
}

export async function getLatestArtifact(
  jobId: string,
  artifactType: string
): Promise<PipelineStepArtifact | null> {
  const { data, error } = await supabaseAdmin
    .from('pipeline_step_artifacts')
    .select('*')
    .eq('job_id', jobId)
    .eq('artifact_type', artifactType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getLatestArtifact failed: ${error.message}`);
  return data as PipelineStepArtifact | null;
}

export async function deleteArtifactsForSteps(
  jobId: string,
  stepNames: string[]
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pipeline_step_artifacts')
    .delete()
    .eq('job_id', jobId)
    .in('step_name', stepNames);

  if (error) throw new Error(`deleteArtifactsForSteps failed: ${error.message}`);
}

// Everything above this line is insert-only (event-sourced) — this is the one exception,
// used to layer a human retag verdict onto an existing image_classification row without
// losing the original SigLIP verdict it sits next to. A `restart` from 'identifying' still
// deletes the whole row via deleteArtifactsForSteps above, so overrides never survive a
// full re-classification.
export async function getArtifactByPublicUrl(
  jobId: string,
  artifactType: string,
  publicUrl: string
): Promise<PipelineStepArtifact | null> {
  const { data, error } = await supabaseAdmin
    .from('pipeline_step_artifacts')
    .select('*')
    .eq('job_id', jobId)
    .eq('artifact_type', artifactType)
    .eq('data->>public_url', publicUrl)
    .maybeSingle();

  if (error) throw new Error(`getArtifactByPublicUrl failed: ${error.message}`);
  return data as PipelineStepArtifact | null;
}

export async function updateArtifactData(
  artifactId: string,
  data: Record<string, unknown>
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pipeline_step_artifacts')
    .update({ data })
    .eq('id', artifactId);

  if (error) throw new Error(`updateArtifactData failed: ${error.message}`);
}
