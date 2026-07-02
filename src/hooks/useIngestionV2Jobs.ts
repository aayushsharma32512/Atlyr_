import { useEffect, useRef, useState } from 'react'
import { v2Api, type PipelineJob } from '@/utils/ingestionV2Api'

const ACTIVE_STATES = new Set([
  'pending', 'scraping', 'scraped', 'identifying', 'identified',
  'generating_garment_summary', 'garment_summary_generated',
  'generating_vton', 'vton_generated', 'segmenting', 'segmented',
])

export function useIngestionV2Jobs(stateFilter?: string) {
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await v2Api.listJobs(stateFilter)
        if (!cancelled) {
          setJobs(data.jobs)
          setError(null)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load jobs')
          setLoading(false)
        }
      }
    }

    load()

    // Poll faster when viewing active states, slower otherwise
    const hasActiveJobs = () => jobs.some(j => ACTIVE_STATES.has(j.current_state))
    intervalRef.current = setInterval(load, hasActiveJobs() ? 4000 : 8000)

    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateFilter])

  const refetch = () => {
    setLoading(true)
    v2Api.listJobs(stateFilter)
      .then(data => { setJobs(data.jobs); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load jobs'))
      .finally(() => setLoading(false))
  }

  return { jobs, loading, error, refetch }
}
