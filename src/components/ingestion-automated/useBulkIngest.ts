import { useCallback, useRef, useState } from 'react'
import { v2Api, DuplicateJobError, type PipelineJob } from '@/utils/ingestionV2Api'
import { BULK_COMPLEXITY, BULK_VTON_MODEL, type BulkRow } from './bulkIngest'

// Ported from the standalone ingest-runner (ingest.mjs): submit a small batch, wait for it to
// settle, then move on — so the models never see more than BATCH_SIZE jobs at once — and retry
// failures a bounded number of times from the step they died at.
const BATCH_SIZE = 3
const MAX_ATTEMPTS = 3          // restarts per job before we give up
const POLL_MS = 6000
const RETRY_BACKOFF_MS = 60_000 // let transient upstream errors (503 / rate limit) clear

// A job is "settled" once it reaches a terminal state or parks at a review gate.
const SETTLED = new Set([
  'completed', 'failed', 'discarded', 'cancelled',
  'awaiting_hitl_identification', 'awaiting_hitl_segmentation',
])

export type BulkPhase = 'idle' | 'submitting' | 'waiting' | 'retrying' | 'done' | 'stopped'

export type BulkState = {
  phase: BulkPhase
  submitted: number
  duplicates: number
  failedToSubmit: number
  total: number
  message: string
}

const INITIAL: BulkState = { phase: 'idle', submitted: 0, duplicates: 0, failedToSubmit: 0, total: 0, message: '' }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function useBulkIngest() {
  const [state, setState] = useState<BulkState>(INITIAL)
  // Ref (not state) so the running loop sees a stop request immediately.
  const stopRef = useRef(false)

  const stop = useCallback(() => { stopRef.current = true }, [])
  const reset = useCallback(() => { stopRef.current = false; setState(INITIAL) }, [])

  const run = useCallback(async (rows: BulkRow[], batchId: string, onTick?: () => void) => {
    stopRef.current = false
    setState({ ...INITIAL, phase: 'submitting', total: rows.length })

    const jobIds: string[] = []
    let submitted = 0, duplicates = 0, failedToSubmit = 0

    const fetchJobs = async (): Promise<Map<string, PipelineJob>> => {
      const { jobs } = await v2Api.listJobs()
      return new Map(jobs.map(j => [j.job_id, j]))
    }

    // Wait until every id in the batch settles (or the user stops).
    const waitForBatch = async (ids: string[]) => {
      while (!stopRef.current && ids.length) {
        await sleep(POLL_MS)
        onTick?.()
        let byId: Map<string, PipelineJob>
        try { byId = await fetchJobs() } catch { continue }   // transient fetch error → keep waiting
        const pending = ids.filter(id => {
          const st = byId.get(id)?.current_state
          return !st || !SETTLED.has(st)
        })
        if (!pending.length) return
        setState(s => ({ ...s, phase: 'waiting', message: `waiting on ${pending.length} of ${ids.length} in this batch…` }))
      }
    }

    // ---- 1. submit in batches of BATCH_SIZE, settling each before the next ----
    for (let i = 0; i < rows.length && !stopRef.current; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE)
      setState(s => ({ ...s, phase: 'submitting', message: `submitting ${i + 1}-${Math.min(i + BATCH_SIZE, rows.length)} of ${rows.length}…` }))

      const ids: string[] = []
      for (const row of slice) {
        if (stopRef.current) break
        try {
          const res = await v2Api.submit({
            product_url: row.product_url,
            product_gender_type: row.product_gender_type,
            product_type: row.product_type,
            product_sub_type: row.product_sub_type,
            product_complexity: BULK_COMPLEXITY,
            v_ton_model: BULK_VTON_MODEL,
            hitl_post_identification: false,
            // Park before placement so a human reviews the garment; go-live stays manual.
            hitl_post_segmentation: true,
            created_by: batchId,
          })
          ids.push(res.job_id); jobIds.push(res.job_id); submitted++
        } catch (e) {
          if (e instanceof DuplicateJobError) {
            duplicates++
            if (e.existingJobId) jobIds.push(e.existingJobId)
          } else {
            failedToSubmit++
          }
        }
        setState(s => ({ ...s, submitted, duplicates, failedToSubmit }))
      }
      onTick?.()
      await waitForBatch(ids)
    }

    // ---- 2. retry failures, restarting from the step each job died at ----
    const attempts = new Map<string, number>()
    while (!stopRef.current) {
      let byId: Map<string, PipelineJob>
      try { byId = await fetchJobs() } catch { await sleep(RETRY_BACKOFF_MS); continue }

      const failed = jobIds
        .map(id => byId.get(id))
        .filter((j): j is PipelineJob => !!j && j.current_state === 'failed')
        .filter(j => (attempts.get(j.job_id) ?? 0) < MAX_ATTEMPTS)

      if (!failed.length) break

      const slice = failed.slice(0, BATCH_SIZE)
      setState(s => ({ ...s, phase: 'retrying', message: `retrying ${slice.length} failed (${failed.length} left)…` }))

      for (const j of slice) {
        if (stopRef.current) break
        attempts.set(j.job_id, (attempts.get(j.job_id) ?? 0) + 1)
        // Restart from where it failed — falling back to the start if the step is unknown.
        const from = j.last_error_step || 'scraping'
        try { await v2Api.restart(j.job_id, from) } catch { /* keep going; next sweep re-checks */ }
      }
      onTick?.()
      await waitForBatch(slice.map(j => j.job_id))
      await sleep(RETRY_BACKOFF_MS)
    }

    setState(s => ({
      ...s,
      phase: stopRef.current ? 'stopped' : 'done',
      message: stopRef.current ? 'stopped — already-submitted items keep running in the pipeline' : 'batch finished',
    }))
    onTick?.()
  }, [])

  return { state, run, stop, reset, isRunning: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'stopped' }
}
