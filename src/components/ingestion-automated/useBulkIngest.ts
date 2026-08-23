import { useCallback, useRef, useState } from 'react'
import { v2Api, type BatchJobSummary } from '@/utils/ingestionV2Api'
import { BULK_COMPLEXITY, BULK_VTON_MODEL, batchLabel, type BulkRow } from './bulkIngest'

// One POST creates and enqueues the whole sheet server-side (POST /batches); the hook then only
// polls rollup progress and sweeps failures. Closing the tab stops the polling and the retry
// sweep — never the batch: every job already lives in the server queue.
const MAX_ATTEMPTS = 3          // client-driven restarts per job before we give up
const POLL_MS = 6000
const RETRY_SWEEP_MS = 60_000   // gap between restart sweeps, letting transient upstream errors clear

// A job is "settled" once it reaches a terminal state or parks waiting on something this runner
// cannot influence. 'failed' is settled but restartable — the sweep below may put it back in
// flight. 'vton_batch_queued' belongs here for the same reason the HITL gates do: the job is
// sitting in a batch tray at Google and will not move for minutes-to-hours, and only the poller
// can change that.
const SETTLED = new Set([
  'completed', 'failed', 'discarded', 'cancelled',
  'awaiting_hitl_identification', 'awaiting_hitl_segmentation',
  'vton_batch_queued',
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

  const run = useCallback(async (
    rows: BulkRow[],
    batchId: string,
    onTick?: () => void,
    options: { vtonLane?: 'instant' | 'batch' } = {},
  ) => {
    const economy = options.vtonLane === 'batch'
    stopRef.current = false
    setState({ ...INITIAL, phase: 'submitting', total: rows.length, message: `submitting ${rows.length} rows as one batch…` })

    // ---- 1. one request; the server creates + enqueues every job ----
    let serverBatchId: string
    try {
      const res = await v2Api.submitBatch({
        label: batchLabel(batchId),
        created_by: batchId,
        rows: rows.map(r => ({
          product_url: r.product_url,
          product_gender_type: r.product_gender_type,
          product_type: r.product_type,
          product_sub_type: r.product_sub_type,
        })),
        options: {
          product_complexity: BULK_COMPLEXITY,
          v_ton_model: BULK_VTON_MODEL,
          hitl_post_identification: false,
          // Park before placement so a human reviews the garment; go-live stays manual.
          hitl_post_segmentation: true,
          // Economy mode routes every row's VTON step through the AI Studio batch lane. Sent
          // per batch rather than per row: the toggle is a property of the sheet.
          vton_lane: options.vtonLane ?? 'instant',
        },
      })
      serverBatchId = res.batch_id
      setState(s => ({
        ...s,
        submitted: res.submitted,
        duplicates: res.duplicates,
        failedToSubmit: res.rejected,
        message: `${res.submitted} queued server-side` +
          (res.duplicates ? ` · ${res.duplicates} already ingested/queued` : '') +
          (res.rejected ? ` · ${res.rejected} rejected` : ''),
      }))
      onTick?.()
      if (res.submitted === 0) {
        setState(s => ({ ...s, phase: 'done', message: s.message + ' — nothing new to run' }))
        return
      }
    } catch (e) {
      setState(s => ({
        ...s,
        phase: 'done',
        failedToSubmit: rows.length,
        message: `batch submit failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      }))
      return
    }

    // ---- 2. poll rollup progress; sweep failures back in, bounded per job ----
    const attempts = new Map<string, number>()
    let lastSweep = 0

    while (!stopRef.current) {
      await sleep(POLL_MS)
      if (stopRef.current) break

      let jobs: BatchJobSummary[]
      try { jobs = (await v2Api.getBatch(serverBatchId)).jobs } catch { continue }  // transient fetch error → keep polling
      onTick?.()

      const unsettled = jobs.filter(j => !SETTLED.has(j.current_state))
      const restartable = jobs.filter(j =>
        j.current_state === 'failed' && (attempts.get(j.job_id) ?? 0) < MAX_ATTEMPTS)

      if (!unsettled.length && !restartable.length) break

      if (restartable.length && Date.now() - lastSweep >= RETRY_SWEEP_MS) {
        lastSweep = Date.now()
        setState(s => ({ ...s, phase: 'retrying', message: `retrying ${restartable.length} failed…` }))
        for (const j of restartable) {
          if (stopRef.current) break
          attempts.set(j.job_id, (attempts.get(j.job_id) ?? 0) + 1)
          // Restart from where it failed — falling back to the start if the step is unknown.
          try { await v2Api.restart(j.job_id, j.last_error_step || 'scraping') } catch { /* next sweep re-checks */ }
        }
        onTick?.()
        continue
      }

      setState(s => ({
        ...s,
        phase: 'waiting',
        message: `${unsettled.length} of ${jobs.length} still running…` +
          (restartable.length ? ` (${restartable.length} awaiting retry)` : ''),
      }))
    }

    setState(s => ({
      ...s,
      phase: stopRef.current ? 'stopped' : 'done',
      message: stopRef.current
        ? 'stopped watching — the batch keeps running server-side'
        : economy
          // "done" here means every row settled, not that every image exists: economy rows settle
          // by PARKING at Google and finish out of band. Saying "batch finished" would read as
          // "your sheet is ready" when nothing has been generated yet.
          ? 'batch submitted — economy items are queued at Google and will finish on their own'
          : 'batch finished',
    }))
    onTick?.()
  }, [])

  return { state, run, stop, reset, isRunning: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'stopped' }
}
