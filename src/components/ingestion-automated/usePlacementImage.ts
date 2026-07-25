import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'

export type PlacementTransform = { scale: number; rotationDeg: number; tx: number; ty: number }

export type PlacementInfo = {
  url: string
  /** 'Male' | 'Female' as chosen by LoFTR registration in the placement pipeline. */
  mannequin: string | null
  /** Affine fit from camera_registration.py. Absent on jobs placed before it was persisted. */
  transform: PlacementTransform | null
}

// Final placement, written by the placement step (services/ingestion-automated/src/steps/
// placement.handler.ts) as a `placement` artifact. Keyed on job_id:updated_at so the tile fills
// in when the job advances to completed — same pattern as useSourceImages / useProductMeta.
export function usePlacementImage(jobs: PipelineJob[]): { placements: Record<string, PlacementInfo>; refetch: () => void } {
  const [map, setMap] = useState<Record<string, PlacementInfo>>({})
  const [nonce, setNonce] = useState(0)
  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')

  const load = useCallback(async () => {
    const ids = key ? key.split(',').map(s => s.split(':')[0]) : []
    if (ids.length === 0) { setMap({}); return }

    // pipeline_step_artifacts is not in generated types — cast to any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('pipeline_step_artifacts')
      .select('job_id, data')
      .in('job_id', ids)
      .eq('artifact_type', 'placement')
      .order('created_at', { ascending: true })
    if (error || !data) return

    const next: Record<string, PlacementInfo> = {}
    for (const row of data as { job_id: string; data: Record<string, unknown> | null }[]) {
      const url = row.data?.placedImageUrl as string | undefined
      if (!url) continue
      const t = row.data?.transform as Partial<PlacementTransform> | undefined
      // later row wins — latest placement
      next[row.job_id] = {
        url,
        mannequin: (row.data?.selectedMannequin as string | undefined) ?? null,
        transform: t && typeof t.scale === 'number'
          ? { scale: t.scale, rotationDeg: t.rotationDeg ?? 0, tx: t.tx ?? 0, ty: t.ty ?? 0 }
          : null,
      }
    }
    setMap(next)
  }, [key])

  useEffect(() => { load() }, [load, nonce])

  return { placements: map, refetch: () => setNonce(n => n + 1) }
}
