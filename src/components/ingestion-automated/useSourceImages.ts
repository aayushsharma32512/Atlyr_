import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { fetchArtifacts, type ArtifactClient, type ArtifactRow } from './fetchArtifacts'
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
      const client = supabase as unknown as ArtifactClient
      let rawRows: ArtifactRow[]
      let clsRows: ArtifactRow[]
      try {
        ;[rawRows, clsRows] = await Promise.all([
          fetchArtifacts(client, {
            jobIds: ids,
            artifactTypes: 'raw_image',
            columns: 'job_id, storage_path, data',
          }),
          // Excluded photos (soft-deleted via POST .../photos/delete) — hide them from the
          // scraped list too, keyed by job + public_url.
          fetchArtifacts(client, { jobIds: ids, artifactTypes: 'image_classification' }),
        ])
      } catch (err) {
        console.error('useSourceImages: artifact fetch failed', err)
        return
      }
      if (cancelled) return

      const excluded = new Set<string>()
      for (const row of clsRows as { job_id: string; data: Record<string, unknown> | null }[]) {
        const url = row.data?.public_url as string | undefined
        if (row.data?.excluded && url) excluded.add(`${row.job_id}::${url}`)
      }

      const next: Record<string, string[]> = {}
      for (const row of rawRows as { job_id: string; storage_path: string | null; data: Record<string, unknown> | null }[]) {
        const url = (row.data?.public_url as string | undefined) ?? storageUrl(row.storage_path)
        if (!url) continue
        if (excluded.has(`${row.job_id}::${url}`)) continue
        ;(next[row.job_id] ??= []).push(url)
      }
      setMap(next)
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return map
}
