import type { IngestionPipelineJob, PipelineState } from '../domain/types';

export const HITL_STATES: PipelineState[] = [
  'awaiting_hitl_identification',
  'awaiting_hitl_segmentation',
  'placement',
];

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
  generating_garment_summary:   () => 'generating_vton',
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

export function hasTransition(state: string): boolean {
  return state in TRANSITIONS;
}
