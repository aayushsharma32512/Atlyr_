import type PgBoss from 'pg-boss';
import { readState } from '../domain/state-store';
import { persistStatePatchAndSync } from './state-sync';
import type { PauseResumeSignal, PipelineState } from '../domain/state';
import { TOPICS } from '../queue/topics';

async function enqueueOrchestrator(boss: PgBoss, jobId: string) {
  await boss.send(TOPICS.ORCHESTRATOR, { jobId }, { retryLimit: 0 });
}

export class ResumeError extends Error {}

export async function resumeConversation(
  boss: PgBoss,
  jobId: string,
  signal: PauseResumeSignal
): Promise<PipelineState> {
  const state = await readState(jobId);
  if (!state) {
    throw new ResumeError('job-not-found');
  }
  if (!state.pause || state.pause.reason !== 'hitl_phase1') {
    throw new ResumeError('job-not-awaiting-phase1');
  }

  await persistStatePatchAndSync(jobId, {
    jobId,
    pause: {
      ...state.pause,
      resumeSignal: signal
    }
  }, 'hitl_phase1_pause');

  await enqueueOrchestrator(boss, jobId);
  const updated = await readState(jobId);
  if (!updated) throw new ResumeError('job-state-missing-after-resume');
  return updated;
}

export async function rerunNode(
  boss: PgBoss,
  jobId: string,
  node: 'ghost' | 'garment_summary' | 'enrich',
  data?: Record<string, unknown>
): Promise<PipelineState> {
  const state = await readState(jobId);
  if (!state) throw new ResumeError('job-not-found');
  if (!state.pause || state.pause.reason !== 'hitl_phase2') {
    throw new ResumeError('job-not-awaiting-phase2');
  }

  const signal: PauseResumeSignal = { action: 'rerun', node, data };
  await persistStatePatchAndSync(jobId, {
    jobId,
    pause: {
      ...state.pause,
      resumeSignal: signal
    }
  }, 'hitl_phase2_pause');

  await enqueueOrchestrator(boss, jobId);
  const updated = await readState(jobId);
  if (!updated) throw new ResumeError('job-state-missing-after-resume');
  return updated;
}

export async function approvePhaseTwo(boss: PgBoss, jobId: string, data?: Record<string, unknown>) {
  const state = await readState(jobId);
  if (!state) throw new ResumeError('job-not-found');
  if (!state.pause || state.pause.reason !== 'hitl_phase2') {
    throw new ResumeError('job-not-awaiting-phase2');
  }

  const signal: PauseResumeSignal = { action: 'resume', actor: 'phase2', data };
  await persistStatePatchAndSync(jobId, {
    jobId,
    pause: {
      ...state.pause,
      resumeSignal: signal
    }
  }, 'hitl_phase2_pause');

  await enqueueOrchestrator(boss, jobId);
  const updated = await readState(jobId);
  if (!updated) throw new ResumeError('job-state-missing-after-resume');
  return updated;
}
