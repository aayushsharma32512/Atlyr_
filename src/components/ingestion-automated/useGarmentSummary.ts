import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'

export type TechPackEntry = { key: string; label: string; value: string }

export type GarmentSummaryData = {
  techPack: TechPackEntry[]  // parsed from the raw tech_pack blob — Fit/Colour/Material live here
  physics: string | null     // closest real analog to "Feel" — a drape/texture paragraph
  colorAndFabric: string | null
  itemName: string | null
  complexity: string | null
  raw: Record<string, unknown> // the full artifact data, for the Pack JSON viewer
}

// The Gemini prompt (services/ingestion-automated/src/adapters/gemini.ts) returns tech_pack
// as one string like "[TECH_PACK]\nMaterial_Physics: ...\nFit_Silhouette: ...\nColor: ...".
// parseStage1 already strips it down to "[TECH_PACK]\n<lines>" — drop that header line, then
// split each remaining line on its first ':'.
function parseTechPack(techPack: string | null | undefined): TechPackEntry[] {
  if (!techPack) return []
  return techPack
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l !== '[TECH_PACK]')
    .map((line): TechPackEntry | null => {
      const idx = line.indexOf(':')
      if (idx === -1) return null
      const key = line.slice(0, idx).trim()
      return { key, label: key.replace(/_/g, ' '), value: line.slice(idx + 1).trim() }
    })
    .filter((e): e is TechPackEntry => e !== null)
}

// garment_summary is written once by the generating_garment_summary step
// (services/ingestion-automated/src/steps/garment-summary.handler.ts) — doesn't exist yet
// for jobs still earlier than that in Stage 1.
export function useGarmentSummary(jobs: PipelineJob[]): Record<string, GarmentSummaryData> {
  const [map, setMap] = useState<Record<string, GarmentSummaryData>>({})

  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')

  useEffect(() => {
    const ids = jobs.map(j => j.job_id)
    if (ids.length === 0) { setMap({}); return }
    let cancelled = false

    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('pipeline_step_artifacts')
        .select('job_id, data')
        .in('job_id', ids)
        .eq('artifact_type', 'garment_summary')
        .order('created_at', { ascending: true })
      if (cancelled || error || !data) return

      const next: Record<string, GarmentSummaryData> = {}
      for (const row of data as { job_id: string; data: Record<string, unknown> | null }[]) {
        const d = row.data
        if (!d) continue
        next[row.job_id] = {
          techPack: parseTechPack(d.tech_pack as string | undefined),
          physics: (d.garment_physics as string | undefined) ?? null,
          colorAndFabric: (d.color_and_fabric as string | undefined) ?? null,
          itemName: (d.item_name as string | undefined) ?? null,
          complexity: (d.complexity_level as string | undefined) ?? null,
          raw: d,
        }
      }
      setMap(next)
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return map
}
