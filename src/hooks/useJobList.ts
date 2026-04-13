import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { getOperatorToken, getIngestionApiBaseUrl } from '@/utils/ingestionApi'

export type IngestionJobSummary = {
  job_id: string
  original_url: string
  canonical_url: string
  domain: string
  path: string
  dedupe_key: string
  batch_id: string | null
  batch_label?: string | null
  created_at: string
  status: string
  last_step: string | null
  phase_flags: Record<string, unknown> | null
  queued_at: string | null
  started_at: string | null
  completed_at: string | null
  error_count: number
  last_error: string | null
  pause_reason: string | null
}

type JobListResponse = {
  items: IngestionJobSummary[]
  nextCursor: string | null
}

export type JobListStatus = 'idle' | 'loading' | 'error'

type UseJobListOptions = {
  limit?: number
  status?: string
  search?: string
  autoRefresh?: boolean
  intervalMs?: number
}

type UseJobListReturn = {
  jobs: IngestionJobSummary[]
  status: JobListStatus
  error?: string | null
  hasMore: boolean
  fetchNext: () => Promise<void>
  refresh: () => Promise<void>
  setFilters: (filters: { status?: string; search?: string }) => void
  filters: { status?: string; search?: string }
}

export function useJobList(options: UseJobListOptions = {}): UseJobListReturn {
  const { limit = 25, autoRefresh = true, intervalMs = 15000 } = options
  const [jobs, setJobs] = useState<IngestionJobSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(options.status)
  const [searchFilter, setSearchFilter] = useState<string | undefined>(options.search)
  const [status, setStatus] = useState<JobListStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const pollingRef = useRef<number | null>(null)
  const { toast } = useToast()

  const token = useMemo(() => getOperatorToken(), [])

  const buildPath = useCallback(
    (cursorParam?: string | null) => {
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      if (statusFilter) params.set('status', statusFilter)
      if (searchFilter) params.set('search', searchFilter)
      if (cursorParam) params.set('cursor', cursorParam)
      return `/jobs?${params.toString()}`
    },
    [limit, statusFilter, searchFilter]
  )

  const fetchPage = useCallback(
    async (cursorParam?: string | null, replace = false) => {
      try {
        setStatus('loading')
        setError(null)
        const response = await fetch(`${getIngestionApiBaseUrl()}${buildPath(cursorParam)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          const text = await response.text()
          throw new Error(text || `Failed with status ${response.status}`)
        }
        const data = (await response.json()) as JobListResponse
        setJobs((prev) => (replace ? data.items : [...prev, ...data.items]))
        setHasMore(Boolean(data.nextCursor))
        setCursor(data.nextCursor)
        setStatus('idle')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load jobs'
        setError(message)
        setStatus('error')
        toast({ title: 'Unable to load jobs', description: message, variant: 'destructive' })
      }
    },
    [buildPath, toast, token]
  )

  const refresh = useCallback(async () => {
    setCursor(null)
    await fetchPage(null, true)
  }, [fetchPage])

  const fetchNext = useCallback(async () => {
    if (!hasMore || status === 'loading') return
    await fetchPage(cursor, false)
  }, [cursor, fetchPage, hasMore, status])

  const setFilters = useCallback((filters: { status?: string; search?: string }) => {
    setStatusFilter(filters.status)
    setSearchFilter(filters.search)
  }, [])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchFilter, limit])

  useEffect(() => {
    if (!autoRefresh) return
    if (pollingRef.current) window.clearInterval(pollingRef.current)
    pollingRef.current = window.setInterval(() => {
      refresh()
    }, intervalMs)
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [autoRefresh, intervalMs, refresh])

  return {
    jobs,
    status,
    error,
    hasMore,
    fetchNext,
    refresh,
    setFilters,
    filters: { status: statusFilter, search: searchFilter },
  }
}
