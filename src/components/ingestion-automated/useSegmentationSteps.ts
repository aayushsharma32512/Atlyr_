import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'

export type SegStep = {
  step_name: string
  output_image_url: string | null
  mask_url: string | null
}

type State = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Per-step artifacts of the segmentation pipeline for one ingestion job.
 *
 * segmentation_jobs.pipeline_job_id is UNIQUE (1:1 with the ingestion job), so one embedded select
 * spans the link and returns every step in a single round trip. Neither table has RLS, so the anon
 * client reads them directly — same shape as usePlacementImage / useIngestionV2Job.
 */
export function useSegmentationSteps(jobId: string | null) {
  const [steps, setSteps] = useState<Record<string, SegStep>>({})
  const [state, setState] = useState<State>('idle')

  useEffect(() => {
    if (!jobId) { setSteps({}); setState('idle'); return }
    let cancelled = false
    setState('loading')

    void (async () => {
      // segmentation_* are not in generated types — cast to any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('segmentation_jobs')
        .select('seg_job_id, segmentation_step_results(step_name, output_image_url, mask_url)')
        .eq('pipeline_job_id', jobId)
        .maybeSingle()
      if (cancelled) return
      if (error || !data) { setSteps({}); setState('error'); return }

      const next: Record<string, SegStep> = {}
      for (const r of (data.segmentation_step_results ?? []) as SegStep[]) next[r.step_name] = r
      setSteps(next)
      setState('ready')
    })()

    return () => { cancelled = true }
  }, [jobId])

  // FASHN's coarse garment mask (02_fashn_garment.png). Its classes are a single argmax map whose
  // garment ids are disjoint from background/face/hair/arms/hands/legs/torso, so it excludes skin
  // and backdrop by construction — which is what makes a cloth-only restore brush possible.
  // When skip_intermediate_uploads was set the column holds a LOCAL container path
  // (green_screen_pipeline.py:58-68), so only an http URL is fetchable from the browser.
  const fashn = steps.fashn_parse?.output_image_url ?? null

  return {
    steps,
    state,
    fashnGarmentUrl: fashn?.startsWith('http') ? fashn : null,
  }
}
