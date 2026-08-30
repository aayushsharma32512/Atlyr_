import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'

// 'live'   = promoted into the live products table (ingested_products.verdict = 'approved')
// 'staged' = auto-written into ingested_products on completion, not yet published
// undefined = nothing in the catalog for this job yet
export type CatalogStatus = 'live' | 'staged' | undefined

// Reads ingested_products keyed by pipeline_job_id. Keyed on job_id:updated_at so it refreshes
// when a job advances (e.g. completion auto-stages it) — same pattern as usePlacementImage.
//
// `stale` marks live items with edits newer than their last publish, so an Update button can
// disable itself once everything has been pushed. Publish stamps verdict_at; an edit after that
// leaves a newer timestamp in one of two places:
//   - the job row (segmentation overwrites go through updateJob, which bumps updated_at), or
//   - a placement artifact (a manual placement save writes one without touching the job row).
// stale is only ever computed for live rows; failure direction is deliberate — when in doubt
// (missing verdict_at, artifact query error) the item counts as stale, because a needlessly
// enabled Update button is harmless and a wrongly disabled one strands the operator.
export function useCatalogStatus(jobs: PipelineJob[]): {
  statuses: Record<string, CatalogStatus>
  stale: Record<string, boolean>
  refetch: () => void
} {
  const [map, setMap] = useState<Record<string, CatalogStatus>>({})
  const [staleMap, setStaleMap] = useState<Record<string, boolean>>({})
  const [nonce, setNonce] = useState(0)
  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')
  const updatedAtByJob = Object.fromEntries(jobs.map(j => [j.job_id, j.updated_at]))
  const updatedKey = JSON.stringify(updatedAtByJob)

  const load = useCallback(async () => {
    const ids = key ? key.split(',').map(s => s.split(':')[0]) : []
    if (ids.length === 0) { setMap({}); setStaleMap({}); return }
    const jobUpdatedAt = JSON.parse(updatedKey) as Record<string, string>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ingested_products')
      .select('pipeline_job_id, verdict, verdict_at')
      .in('pipeline_job_id', ids)
    if (error || !data) return

    // Latest placement artifact per job — pipeline_step_artifacts is not in generated types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: artifacts } = await (supabase as any)
      .from('pipeline_step_artifacts')
      .select('job_id, created_at')
      .in('job_id', ids)
      .eq('artifact_type', 'placement')
    const latestArtifactAt: Record<string, number> = {}
    for (const row of (artifacts ?? []) as { job_id: string; created_at: string }[]) {
      const t = new Date(row.created_at).getTime()
      if (!latestArtifactAt[row.job_id] || t > latestArtifactAt[row.job_id]) latestArtifactAt[row.job_id] = t
    }

    const next: Record<string, CatalogStatus> = {}
    const nextStale: Record<string, boolean> = {}
    for (const row of data as { pipeline_job_id: string; verdict: string | null; verdict_at: string | null }[]) {
      if (!row.pipeline_job_id) continue
      const live = row.verdict === 'approved'
      next[row.pipeline_job_id] = live ? 'live' : 'staged'
      if (live) {
        const publishedAt = row.verdict_at ? new Date(row.verdict_at).getTime() : 0
        const jobAt = jobUpdatedAt[row.pipeline_job_id] ? new Date(jobUpdatedAt[row.pipeline_job_id]).getTime() : 0
        const artifactAt = latestArtifactAt[row.pipeline_job_id] ?? 0
        nextStale[row.pipeline_job_id] = publishedAt === 0 || jobAt > publishedAt || artifactAt > publishedAt
      }
    }
    setMap(next)
    setStaleMap(nextStale)
  }, [key, updatedKey])

  useEffect(() => { load() }, [load, nonce])

  return { statuses: map, stale: staleMap, refetch: () => setNonce(n => n + 1) }
}
