/**
 * Which states the two rescue passes are allowed to touch.
 *
 * The reaper and boot recovery ask different questions, but they must agree on one thing: which
 * states are driven by something *other* than this worker's step handlers. A row in one of those
 * states legitimately has no pg-boss job behind it, for as long as the external thing takes — so
 * "nothing is backing this row" is not evidence that it is dead.
 *
 * This list lived twice, once in each file, and drifted: the reaper included the parked states,
 * boot recovery did not. A parked job NEVER has a queue row (that is the whole point of
 * NO_ENQUEUE_STATES), so boot recovery matched every parked job as an orphan and re-dispatched it.
 * Only the PARKED_STATES guard inside dispatch() stopped that from destroying trays that had
 * already been paid for — correctness resting on a guard in an unrelated file.
 *
 * Kept free of `../config` on purpose, in the same spirit as the protocol modules: the audit drill
 * has to be able to import it without the env-validating config killing the test process.
 */
import { HITL_STATES, PARKED_STATES, TERMINAL_STATES } from './state-machine';

/**
 * Handed off to a Modal GPU app, which patches `current_state` directly, out of band:
 *   - segmenting: pipeline/db_store.py update_parent_job_url() writes current_state='segmented'
 *   - placement:  the Modal placement pipeline patches current_state as a side effect
 *
 * Re-dispatching one of these races the run that is still going, and SegmentingHandler deletes the
 * existing segmentation_jobs row before inserting — so a racing retry wipes the record of the run
 * still in progress.
 */
export const MODAL_DRIVEN_STATES: readonly string[] = ['segmenting', 'placement'];

/**
 * Driven by something outside this worker's step handlers. Neither rescue pass may treat an absent
 * queue row here as proof of death.
 *
 * PARKED_STATES belongs here for exactly the Modal reason: a job sitting in a batch tray at Google
 * has no queue row and will not move for minutes-to-hours (24h SLA). What bounds it instead is the
 * poller's 48h deadline, which self-expires a tray even when the provider is unreachable.
 */
export const EXTERNALLY_DRIVEN_STATES: readonly string[] = [
  ...MODAL_DRIVEN_STATES,
  ...PARKED_STATES,
];

/** Rows neither pass should ever consider: finished, waiting on a human, or externally driven. */
export const RESCUE_EXCLUDED_STATES: readonly string[] = [
  ...TERMINAL_STATES,
  ...HITL_STATES,
  ...EXTERNALLY_DRIVEN_STATES,
];
