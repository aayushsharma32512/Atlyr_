import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'

// 'live'   = promoted into the live products table (ingested_products.verdict = 'approved')
// 'staged' = auto-written into ingested_products on completion, not yet published
// undefined = nothing in the catalog for this job yet
export type CatalogStatus = 'live' | 'staged' | undefined

// Reads ingested_products keyed by pipeline_job_id. Keyed on job_id:updated_at so it refreshes
// when a job advances (e.g. completion auto-stages it) — same pattern as usePlacementImage.
export function useCatalogStatus(jobs: PipelineJob[]): { statuses: Record<string, CatalogStatus>; refetch: () => void } {
  const [map, setMap] = useState<Record<string, CatalogStatus>>({})
  const [nonce, setNonce] = useState(0)
  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')

  const load = useCallback(async () => {
    const ids = key ? key.split(',').map(s => s.split(':')[0]) : []
    if (ids.length === 0) { setMap({}); return }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ingested_products')
      .select('pipeline_job_id, verdict')
      .in('pipeline_job_id', ids)
    if (error || !data) return

    const next: Record<string, CatalogStatus> = {}
    for (const row of data as { pipeline_job_id: string; verdict: string | null }[]) {
      if (!row.pipeline_job_id) continue
      next[row.pipeline_job_id] = row.verdict === 'approved' ? 'live' : 'staged'
    }
    setMap(next)
  }, [key])

  useEffect(() => { load() }, [load, nonce])

  return { statuses: map, refetch: () => setNonce(n => n + 1) }
}
