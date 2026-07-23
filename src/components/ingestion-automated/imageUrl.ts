import { supabase } from '@/integrations/supabase/client'
import { V2_STORAGE_BUCKET, type PipelineJob } from '@/utils/ingestionV2Api'

export function storageUrl(path: string | null): string | null {
  if (!path) return null
  const { data } = supabase.storage.from(V2_STORAGE_BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

// List payloads carry no step artifacts (fetching them per row would be N+1), so the
// row thumbnail can only use image URLs stored directly on the job itself.
export function jobThumbnail(job: PipelineJob): string | null {
  return job.vton_image_url ?? job.v_ton_preferred_image ?? job.segmented_image_url ?? null
}
