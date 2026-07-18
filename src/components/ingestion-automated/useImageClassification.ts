import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'

export type View = 'Front' | 'Back' | 'Side'
export type PhotoType = 'Model' | 'Flat' | 'Detail'

// One row per raw image, using its *effective* verdict — a human override
// (image_classification.data.user_override, written by POST .../photos/retag) if one
// exists, otherwise SigLIP's own winner. view/type are null when the image doesn't map
// to any of the 4 named slots (Side profile, or a Macro Detail crop) and hasn't been
// manually assigned one either.
export type ImageTag = {
  url: string
  view: View | null
  type: PhotoType | null
  uncertain: boolean
  manual: boolean
}

// Slot resolution (including override precedence) now happens server-side — see
// useVtonSelection.ts for the authoritative Front·Mod/Front·Flt/Back·Mod/Back·Flt picks.
// This hook is just the raw per-image list, used for the retag panel's "current tag" caption.
//
// Explicit refetch() (rather than relying only on job.updated_at) because a retag on an
// image that isn't the currently-preferred one doesn't necessarily touch the job row.
export function useImageClassification(jobs: PipelineJob[]): { tags: Record<string, ImageTag[]>; refetch: () => void } {
  const [map, setMap] = useState<Record<string, ImageTag[]>>({})
  const [nonce, setNonce] = useState(0)
  const ids = jobs.map(j => j.job_id)
  const key = ids.join(',')

  const load = useCallback(async () => {
    if (ids.length === 0) { setMap({}); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('pipeline_step_artifacts')
      .select('job_id, data')
      .in('job_id', ids)
      .eq('artifact_type', 'image_classification')
      .order('created_at', { ascending: true })
    if (error || !data) return

    const next: Record<string, ImageTag[]> = {}
    for (const row of data as { job_id: string; data: Record<string, unknown> | null }[]) {
      const d = row.data
      if (!d) continue
      const url = d.public_url as string | undefined
      if (!url) continue

      // Use `override ? ... : ...`, not `override?.x ?? d.x` — a Detail override's
      // stage2_verdict is legitimately null, and ?? would wrongly fall through to the
      // original SigLIP value for a nullish (but present) override field.
      const override = d.user_override as { stage1_verdict: string; stage2_verdict: string | null } | undefined
      const s1 = override ? override.stage1_verdict : (d.stage1_winner as string | undefined)
      const s2 = override ? override.stage2_verdict : (d.stage2_winner as string | undefined)

      const type: PhotoType | null = s1 === 'Live Model' ? 'Model' : s1 === 'Flat Lay' ? 'Flat' : s1 === 'Macro Detail' ? 'Detail' : null
      const view: View | null = s2 === 'Front' ? 'Front' : s2 === 'Back' ? 'Back' : s2 === 'Side' ? 'Side' : null

      ;(next[row.job_id] ??= []).push({
        url, view, type,
        uncertain: override ? false : !!(d.stage1_uncertain || d.stage2_uncertain),
        manual: !!override,
      })
    }
    setMap(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { load() }, [load, nonce])

  return { tags: map, refetch: () => setNonce(n => n + 1) }
}
