import type { IngestionPipelineJob, PipelineState } from '../domain/types';

export const HITL_STATES: PipelineState[] = [
  'awaiting_hitl_identification',
  'awaiting_hitl_segmentation',
  // The manual asset lane's four gates. HITL, not PARKED: a parked state deliberately has no
  // TRANSITIONS entry and is resumed by replaying its predecessor's edge (see the poller), while
  // these are resumed by POST /proceed calling nextState() — the HITL shape. Membership here is
  // load-bearing well beyond the enqueue guard: it is also what keeps the dispatcher, the reaper,
  // boot recovery and restart.ts's isActive check off a job that is simply waiting on a person.
  'awaiting_manual_identification',
  'awaiting_manual_vton',
  'awaiting_manual_segmentation',
  'awaiting_manual_placement',
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
  // The manual-lane fork. It sits here rather than inside the scraping handler so the state
  // machine keeps describing the whole pipeline; a fork hidden in a handler is invisible to
  // nextState() and to every test that reasons about reachability.
  scraping:                     (j) => j.asset_lane === 'manual'
                                         ? 'awaiting_manual_identification'
                                         : 'identifying',
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

  // The manual lane. Every edge is an operator clicking Proceed. Nothing is enqueued on entry to
  // any of them — all four are in HITL_STATES, so advanceAndTrigger returns before sendPipelineStep
  // — and the lane never reaches identifying, generating_garment_summary, generating_vton or
  // segmenting, which is why no handler needs to know the lane exists.
  awaiting_manual_identification: () => 'awaiting_manual_vton',
  awaiting_manual_vton:           () => 'awaiting_manual_segmentation',
  awaiting_manual_segmentation:   () => 'awaiting_manual_placement',
  awaiting_manual_placement:      () => 'completed',
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
