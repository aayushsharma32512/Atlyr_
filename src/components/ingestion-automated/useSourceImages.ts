import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'
import { storageUrl } from './imageUrl'

// All raw scraped images, unfiltered — the full set SigLIP classified from. Separate
// from useImageClassification.ts, which only surfaces the 4 named winners; this is the
// "everything we actually scraped" audit view (also catches Side / Macro Detail shots
// that don't map to any of the 4 named slots).
export function useSourceImages(jobs: PipelineJob[]): Record<string, string[]> {
  const [map, setMap] = useState<Record<string, string[]>>({})

  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')

  useEffect(() => {
    const ids = jobs.map(j => j.job_id)
    if (ids.length === 0) { setMap({}); return }
    let cancelled = false

    ;(async () => {
      // pipeline_step_artifacts is not in generated types — cast to any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('pipeline_step_artifacts')
        .select('job_id, storage_path, data')
        .in('job_id', ids)
        .eq('artifact_type', 'raw_image')
        .order('created_at', { ascending: true })
      if (cancelled || error || !data) return

      const next: Record<string, string[]> = {}
      for (const row of data as { job_id: string; storage_path: string | null; data: Record<string, unknown> | null }[]) {
        const url = (row.data?.public_url as string | undefined) ?? storageUrl(row.storage_path)
        if (!url) continue
        ;(next[row.job_id] ??= []).push(url)
      }
      setMap(next)
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return map
}
