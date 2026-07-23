// Maps the real ingestion-automated pipeline state machine (a single linear chain:
// pending → scraping → ... → segmented → placement → completed, with awaiting_hitl_*
// gates) onto the design handoff's S1 "scrape & tag" / S2 "generation" queue split and
// its 4-state row model (ready / processing / attention / error).
//
// See @/components/ingestion-v2/constants for the source-of-truth state sets — reused
// here rather than redefined.
import type { PipelineJob } from '@/utils/ingestionV2Api'
import { AWAITING_STATES, ACTIVE_STATES } from '@/components/ingestion-v2/constants'

export type Stage = 1 | 2
export type RowState = 'ready' | 'processing' | 'attention' | 'error'

// Stage 1 = scrape, identify, summarize. Stage 2 = VTon, segmentation, placement.
const STAGE_1_STATES = new Set([
  'pending', 'scraping', 'scraped', 'identifying', 'identified',
  'awaiting_hitl_identification',
  'generating_garment_summary', 'garment_summary_generated',
])

// States where the /proceed endpoint actually accepts a push (see
// services/ingestion-automated/src/api/routes/proceed.ts PROCEED_ALLOWED_STATES).
// 'placement' reaches this state too but has no live route yet — treat as stub.
export const PROCEED_ALLOWED_STATES = new Set(['awaiting_hitl_identification', 'awaiting_hitl_segmentation'])

export function stageOf(job: PipelineJob): Stage {
  if (STAGE_1_STATES.has(job.current_state)) return 1
  if (job.current_state === 'failed' || job.current_state === 'discarded' || job.current_state === 'cancelled') {
    // Terminal states carry no stage of their own — fall back to where the failure happened.
    const step = job.last_error_step
    if (step && STAGE_1_STATES.has(step)) return 1
    if (step) return 2
    return 1
  }
  return 2
}

export function rowStateOf(job: PipelineJob): RowState {
  if (job.current_state === 'failed') return 'error'
  if (job.current_state === 'discarded' || job.current_state === 'cancelled') return 'error'
  if (AWAITING_STATES.has(job.current_state)) return 'attention'
  if (job.current_state === 'completed') return 'ready'
  if (ACTIVE_STATES.has(job.current_state)) return 'processing'
  return 'processing'
}

export function isPushed(job: PipelineJob): boolean {
  return job.current_state === 'completed'
    || job.current_state === 'discarded'
    || job.current_state === 'cancelled'
}

export function canProceed(job: PipelineJob): boolean {
  return PROCEED_ALLOWED_STATES.has(job.current_state)
}

// attnNote-equivalent: short human line for why a row is flagged 'attention'.
export function attentionNote(job: PipelineJob): string | null {
  switch (job.current_state) {
    case 'awaiting_hitl_identification':
      return 'Needs review — confirm SigLIP identification before generation'
    case 'awaiting_hitl_segmentation':
      return 'Needs review — confirm segmented image before placement'
    case 'placement':
      return 'Awaiting placement — no live endpoint yet, use the placement editor preview'
    default:
      return null
  }
}
