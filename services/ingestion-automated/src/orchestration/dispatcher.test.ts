import { describe, expect, test, mock, beforeEach } from 'bun:test';

// config/index.ts validates env at import time and process.exit(1)s when it is absent, so the
// environment must exist before the dispatcher (and the step handlers it pulls in) are evaluated.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';
process.env.DATABASE_URL_DIRECT ??= 'postgres://localhost:5432/test';
process.env.API_TOKEN ??= 'test-token';

let job: { job_id: string; current_state: string };
const failed: Array<{ jobId: string; message: string }> = [];

mock.module('../domain/job-catalog', () => ({
  getJob: async () => job,
  markJobFailed: async (jobId: string, message: string) => { failed.push({ jobId, message }); },
  updateState: async () => {},
  updateJob: async () => {},
  listJobs: async () => [],
  insertJob: async () => job,
  findActiveJobByDedupeKey: async () => null,
  findLatestJobByDedupeKey: async () => null,
}));

const { dispatch } = await import('./dispatcher');
const { HITL_STATES, TERMINAL_STATES } = await import('./state-machine');

beforeEach(() => { failed.length = 0; });

describe('dispatch', () => {
  // The bug this guards: HITL states deliberately have no handler, and without an explicit guard
  // they fell through to "No handler registered for state: …" and were marked FAILED. A duplicate
  // queue row or a pg-boss retry then destroyed jobs that had already completed VTON and
  // segmentation and were sitting in the review queue — seven of them in one batch.
  for (const state of ['awaiting_hitl_identification', 'awaiting_hitl_segmentation']) {
    test(`a stray dispatch on '${state}' does not fail the job`, async () => {
      job = { job_id: 'job-1', current_state: state };
      await dispatch('job-1');
      expect(failed).toEqual([]);
    });
  }

  test('every HITL state is covered by the guard, not by a handler', async () => {
    for (const state of HITL_STATES) {
      job = { job_id: 'job-x', current_state: state };
      await dispatch('job-x');
    }
    expect(failed).toEqual([]);
  });

  test('terminal states are still skipped silently', async () => {
    for (const state of TERMINAL_STATES) {
      job = { job_id: 'job-t', current_state: state };
      await dispatch('job-t');
    }
    expect(failed).toEqual([]);
  });

  test('a genuinely unknown state IS still failed', async () => {
    job = { job_id: 'job-2', current_state: 'not_a_real_state' };
    await dispatch('job-2');
    expect(failed).toHaveLength(1);
    expect(failed[0].message).toContain('No handler registered');
  });
});
