import type { IngestionPipelineJob, PipelineState } from '../domain/types';

export const HITL_STATES: PipelineState[] = [
  'awaiting_hitl_identification',
  'awaiting_hitl_segmentation',
];

// States where a job waits on something this service does not drive. Nothing enqueues a message
// on entry, the reaper must not call them stranded, and the dispatcher must not run a handler for
// one — a stale retry landing on a parked job would otherwise fail work that is perfectly healthy.
// HITL waits for a human; a parked VTON job waits for a batch tray at Google.
export const PARKED_STATES: PipelineState[] = [
  'vton_batch_queued',
];

// Everything that must NOT be enqueued when a job advances into it.
export const NO_ENQUEUE_STATES: PipelineState[] = [...HITL_STATES, ...PARKED_STATES];

export const TERMINAL_STATES: PipelineState[] = [
  'completed',
  'failed',
  'discarded',
  'cancelled',
];

// Maps current_state → next state. Only states that have an automatic transition are listed.
const TRANSITIONS: Record<string, (job: IngestionPipelineJob) => PipelineState> = {
  pending:                      () => 'scraping',
  scraping:                     () => 'identifying',
  identifying:                  (j) => j.hitl_post_identification
                                         ? 'awaiting_hitl_identification'
                                         : 'generating_garment_summary',
  awaiting_hitl_identification: () => 'generating_garment_summary',
  // The lane fork. Gating on the provider as well as the lane is not belt-and-braces: a
  // FASHN-pinned job parked in a Gemini tray would never be collected, because the collector
  // only ever builds Gemini requests.
  generating_garment_summary:   (j) => j.vton_lane === 'batch'
                                       && (j.v_ton_model ?? 'gemini_nano_banana') === 'gemini_nano_banana'
                                         ? 'vton_batch_queued'
                                         : 'generating_vton',
  generating_vton:              () => 'segmenting',
  segmenting:                   () => 'segmented',
  segmented:                    (j) => j.hitl_post_segmentation
                                         ? 'awaiting_hitl_segmentation'
                                         : 'placement',
  awaiting_hitl_segmentation:   () => 'placement',
  placement:                    () => 'completed',
};

export function nextState(job: IngestionPipelineJob): PipelineState {
  const fn = TRANSITIONS[job.current_state];
  if (!fn) throw new Error(`No transition defined for state: ${job.current_state}`);
  return fn(job);
}

// 'vton_batch_queued' has no entry in TRANSITIONS on purpose. The poller resumes a parked job by
// replaying the generating_vton edge (advanceAndTrigger on a synthetic 'generating_vton' job), so
// there is no second path into 'segmenting' to keep in sync.
export function hasTransition(state: string): boolean {
  return state in TRANSITIONS;
}
