import type { PipelineState } from '../domain/state';
import { persistStatePatch } from '../domain/state-store';
import { orchestratorRunnable } from './engine';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'graph-sync' });

function resolveSyncNode(state: PipelineState, fallback: string): string {
  const pauseNode = state.pause?.atNode;
  if (typeof pauseNode === 'string' && pauseNode.trim()) return pauseNode;
  if (typeof state.step === 'string' && state.step.trim()) return state.step;
  return fallback;
}

export async function syncGraphState(jobId: string, state: PipelineState, asNode?: string) {
  const node = asNode ?? resolveSyncNode(state, 'submit');
  try {
    await orchestratorRunnable.updateState(
      { configurable: { thread_id: jobId } },
      { state },
      node
    );
  } catch (error) {
    logger.warn({ jobId, node, error: error instanceof Error ? error.message : String(error) }, 'Unable to sync LangGraph state');
  }
}

export async function persistStatePatchAndSync(jobId: string, patch: Partial<PipelineState>, asNode?: string) {
  const nextState = await persistStatePatch(jobId, patch);
  await syncGraphState(jobId, nextState, asNode);
  return nextState;
}
