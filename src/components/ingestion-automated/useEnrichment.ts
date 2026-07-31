import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'
import { parseTechPack } from './useGarmentSummary'

// The Gemini view of a job. Everything here comes from the two artifacts the
// generating_garment_summary step writes (services/ingestion-automated/src/steps/
// garment-summary.handler.ts) — read-only in the UI, since no route writes them back.
export type EnrichmentData = {
  occasion: string | null
  colorGroup: string | null
  fit: string | null          // already comma-joined server-side (gemini.ts mapEnrichment)
  feel: string | null
  vibes: string | null        // string[] in the artifact — joined here for display
  materialType: string | null
  summary: string | null      // description_text line 1
  styling: string | null      // description_text line 4 — the styling/pairing tip
  other: string | null        // tech pack Peculiar_Notes, from the garment_summary artifact
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// description_text is four \n-separated sentences by prompt convention (gemini.ts): mood hook,
// fit & silhouette, seasonality + occasion, styling tip. Short responses just yield fewer lines.
function splitDescription(v: unknown): { summary: string | null; styling: string | null } {
  const lines = typeof v === 'string' ? v.split('\n').map(l => l.trim()).filter(Boolean) : []
  return { summary: lines[0] ?? null, styling: lines[3] ?? null }
}

function emptyData(): EnrichmentData {
  return {
    occasion: null, colorGroup: null, fit: null, feel: null, vibes: null,
    materialType: null, summary: null, styling: null, other: null,
  }
}

// Batched like useProductMeta / useGarmentSummary — one query for the whole page of jobs. Both
// artifact types are pulled together because `other` lives in garment_summary and the rest in
// enrichment; splitting them would cost a second round trip per poll.
export function useEnrichment(jobs: PipelineJob[]): Record<string, EnrichmentData> {
  const [map, setMap] = useState<Record<string, EnrichmentData>>({})

  // updated_at in the key so rows refresh when a job advances — the artifacts land partway
  // through Stage 1, after the row has already rendered.
  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')

  useEffect(() => {
    const ids = jobs.map(j => j.job_id)
    if (ids.length === 0) { setMap({}); return }
    let cancelled = false

    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('pipeline_step_artifacts')
        .select('job_id, artifact_type, data')
        .in('job_id', ids)
        .in('artifact_type', ['enrichment', 'garment_summary'])
        .order('created_at', { ascending: true })
      if (cancelled || error || !data) return

      // Ascending order + last-write-wins so a re-run (↻ Summary appends a fresh artifact) wins.
      const next: Record<string, EnrichmentData> = {}
      for (const row of data as { job_id: string; artifact_type: string; data: Record<string, unknown> | null }[]) {
        const d = row.data
        if (!d) continue
        const cur = next[row.job_id] ?? emptyData()

        if (row.artifact_type === 'enrichment') {
          const { summary, styling } = splitDescription(d.description_text)
          next[row.job_id] = {
            ...cur,
            occasion: str(d.occasion),
            colorGroup: str(d.color_group),
            fit: str(d.fit),
            feel: str(d.feel),
            vibes: Array.isArray(d.vibes) ? (d.vibes.filter(v => typeof v === 'string') as string[]).join(', ') || null : null,
            materialType: str(d.material_type),
            summary,
            styling,
          }
        } else {
          const peculiar = parseTechPack(d.tech_pack as string | undefined)
            .find(e => e.key.toLowerCase() === 'peculiar_notes')
          next[row.job_id] = { ...cur, other: str(peculiar?.value) }
        }
      }
      setMap(next)
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return map
}
