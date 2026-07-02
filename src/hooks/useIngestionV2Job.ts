import { useCallback, useEffect, useRef, useState } from 'react'
import { v2Api, type PipelineJob, type StepArtifact } from '@/utils/ingestionV2Api'
import { supabase } from '@/integrations/supabase/client'

const TERMINAL_STATES = new Set(['completed', 'failed', 'discarded', 'cancelled'])

async function fetchArtifacts(jobId: string): Promise<StepArtifact[]> {
  // pipeline_step_artifacts is not in generated types — cast to any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('pipeline_step_artifacts')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as StepArtifact[]
}

export function useIngestionV2Job(jobId: string | null) {
  const [job, setJob] = useState<PipelineJob | null>(null)
  const [artifacts, setArtifacts] = useState<StepArtifact[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (id: string) => {
    try {
      const [jobData, artifactData] = await Promise.all([
        v2Api.getJob(id),
        fetchArtifacts(id),
      ])
      setJob(jobData)
      setArtifacts(artifactData)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load job')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!jobId) {
      setJob(null)
      setArtifacts([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    load(jobId)

    intervalRef.current = setInterval(() => {
      // Stop polling once terminal
      if (job && TERMINAL_STATES.has(job.current_state)) return
      load(jobId)
    }, 3000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  const refetch = useCallback(() => {
    if (jobId) load(jobId)
  }, [jobId, load])

  return { job, artifacts, loading, error, refetch }
}
