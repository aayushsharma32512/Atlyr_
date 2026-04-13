import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { fetchJob, fetchJobStatus, PipelineState } from '@/utils/ingestionApi'
import { useToast } from '@/hooks/use-toast'

export type HitlPhase = 'phase1' | 'phase2'

export type HitlJobStatus = 'unknown' | 'awaiting_phase1' | 'running' | 'awaiting_phase2' | 'completed' | 'cancelled' | 'errored'

type PauseState = Record<string, unknown> | null

type HitlFlags = Record<string, unknown> & {
  hitlPhase1Completed?: boolean
  hitlPhase2Completed?: boolean
}

type FlagState = HitlFlags | undefined

type State = {
  job?: PipelineState
  loading: boolean
  status: HitlJobStatus
  step?: string | null
  pause?: PauseState
  flags?: FlagState
  error?: string | null
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; payload: { job: PipelineState } }
  | { type: 'STATUS_SUCCESS'; payload: { status: HitlJobStatus; step?: string | null; pause?: PauseState; flags?: FlagState } }
  | { type: 'ERROR'; payload: { error: string } }

const initialState: State = {
  job: undefined,
  loading: true,
  status: 'unknown',
  step: undefined,
  pause: null,
  flags: undefined,
  error: undefined,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: undefined }
    case 'LOAD_SUCCESS':
      return { ...state, loading: false, job: action.payload.job, error: undefined }
    case 'STATUS_SUCCESS':
      return {
        ...state,
        status: action.payload.status,
        step: action.payload.step,
        pause: action.payload.pause ?? null,
        flags: action.payload.flags,
        error: undefined,
      }
    case 'ERROR':
      return { ...state, loading: false, error: action.payload.error }
    default:
      return state
  }
}

function derivePhase(job?: PipelineState, status?: HitlJobStatus): HitlPhase {
  if (!job) return 'phase1'
  const flags = job.flags as HitlFlags | undefined
  if (status === 'awaiting_phase2' || flags?.hitlPhase1Completed) {
    return 'phase2'
  }
  return 'phase1'
}

function mapStatus(rawStatus?: string): HitlJobStatus {
  switch (rawStatus) {
    case 'awaiting_phase1':
      return 'awaiting_phase1'
    case 'awaiting_phase2':
      return 'awaiting_phase2'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'errored':
      return 'errored'
    default:
      return 'unknown'
  }
}

type PollingConfig = {
  intervalMs?: number
  autoStart?: boolean
}

type UseHitlJobOptions = PollingConfig & {
  token?: string
  skip?: boolean
}

type UseHitlJobReturn = {
  job?: PipelineState
  loading: boolean
  error?: string | null
  status: HitlJobStatus
  step?: string | null
  phase: HitlPhase
  pause?: PauseState
  flags?: FlagState
  refetch: () => void
  startPolling: () => void
  stopPolling: () => void
}

export function useHitlJob(jobId: string | null | undefined, options: UseHitlJobOptions = {}): UseHitlJobReturn {
  const { intervalMs = 15000, autoStart = true, skip = false, token } = options
  const [state, dispatch] = useReducer(reducer, initialState)
  const { toast } = useToast()
  const pollingRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [pollingEnabled, setPollingEnabled] = useState(autoStart)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  const handleError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      dispatch({ type: 'ERROR', payload: { error: message } })
      toast({
        title: 'Unable to load job',
        description: message,
        variant: 'destructive',
      })
    },
    [toast]
  )

  const fetchState = useCallback(async () => {
    if (!jobId) return
    dispatch({ type: 'LOAD_START' })
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const job = await fetchJob(jobId, { token, signal: controller.signal })
      dispatch({ type: 'LOAD_SUCCESS', payload: { job } })
    } catch (error) {
      if (controller.signal.aborted) return
      handleError(error)
    }
  }, [jobId, token, handleError])

  const fetchStatus = useCallback(async () => {
    if (!jobId) return
    const controller = new AbortController()
    try {
      const statusResp = await fetchJobStatus(jobId, { token, signal: controller.signal })
      dispatch({
        type: 'STATUS_SUCCESS',
        payload: {
          status: mapStatus(statusResp.status),
          step: statusResp.step,
          pause: statusResp.pause ?? null,
          flags: (statusResp.flags ?? undefined) as FlagState,
        },
      })
    } catch (error) {
      if (controller.signal.aborted) return
      handleError(error)
    }
  }, [jobId, token, handleError])

  const startPolling = useCallback(() => {
    if (pollingRef.current || !pollingEnabled) return
    pollingRef.current = window.setInterval(() => {
      fetchStatus()
    }, intervalMs)
  }, [fetchStatus, intervalMs, pollingEnabled])

  const refetch = useCallback(() => {
    fetchState()
    fetchStatus()
  }, [fetchState, fetchStatus])

  useEffect(() => {
    if (!jobId || skip) return
    fetchState()
    fetchStatus()
  }, [fetchState, fetchStatus, jobId, skip])

  useEffect(() => {
    if (!jobId || skip) return
    if (!pollingEnabled) {
      stopPolling()
      return
    }
    startPolling()
    return () => {
      stopPolling()
    }
  }, [jobId, skip, pollingEnabled, startPolling, stopPolling])

  useEffect(() => {
    if (!autoStart && pollingEnabled) {
      setPollingEnabled(false)
      stopPolling()
    }
  }, [autoStart, pollingEnabled, stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  const phase = useMemo(() => derivePhase(state.job, state.status), [state.job, state.status])

  return {
    job: state.job,
    loading: state.loading,
    error: state.error,
    status: state.status,
    step: state.step,
    phase,
    pause: state.pause ?? null,
    flags: state.flags,
    refetch,
    startPolling: () => {
      setPollingEnabled(true)
      startPolling()
    },
    stopPolling: () => {
      setPollingEnabled(false)
      stopPolling()
    },
  }
}
