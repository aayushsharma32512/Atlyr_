import type PgBoss from 'pg-boss';
import { Command, INTERRUPT } from '@langchain/langgraph';
import { createLogger } from '../utils/logger';
import { orchestratorRunnable } from './engine';
import { TOPICS } from '../queue/topics';
import type { PipelineState, PauseResumeSignal } from '../domain/state';
import { persistStatePatch, readState, readStateWithCheckpoint } from '../domain/state-store';
import { mergePipelineState } from '../domain/merge-pipeline-state';
import { markJobStarted, updateJobCatalogFromState } from '../domain/job-catalog';
import { classifyErrorKind, normalizeErrorMessage } from './error-routing';

type OrchestratorJobPayload = {
  jobId: string;
};

const hasInterrupt = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && INTERRUPT in value;

const UPDATE_NODES = new Set([
  'submit',
  'crawl',
  'extract',
  'download',
  'hitl_phase1_pause',
  'hitl_phase1_interrupt',
  'garment_summary',
  'enrich',
  'ghost',
  'hitl_phase2_pause',
  'hitl_phase2_interrupt',
  'stage',
  'promote'
]);

function resolveUpdateNode(state: PipelineState | undefined): string {
  const pauseNode = state?.pause?.atNode;
  if (typeof pauseNode === 'string' && UPDATE_NODES.has(pauseNode)) {
    return pauseNode;
  }

  const step = typeof state?.step === 'string' ? state.step : '';
  if (step && UPDATE_NODES.has(step)) {
    return step;
  }
  if (step.startsWith('hitl_phase1')) {
    return 'hitl_phase1_interrupt';
  }
  if (step.startsWith('hitl_phase2')) {
    return 'hitl_phase2_interrupt';
  }

  return 'submit';
}

function hasCheckpointEnvelope(checkpoint: unknown): boolean {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return false;
  const namespaces = (checkpoint as { namespaces?: Record<string, unknown> }).namespaces;
  if (!namespaces || typeof namespaces !== 'object') return false;

  return Object.values(namespaces).some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const namespace = entry as { latest?: string; checkpoints?: Record<string, unknown> };
    if (typeof namespace.latest === 'string' && namespace.latest.trim()) return true;
    if (namespace.checkpoints && typeof namespace.checkpoints === 'object') {
      return Object.keys(namespace.checkpoints).length > 0;
    }
    return false;
  });
}

let lastRegisteredGeneration = -1;

export async function registerOrchestratorWorker(boss: PgBoss, generation = 0) {
  const logger = createLogger({ stage: 'orchestrator' });
  if (generation === lastRegisteredGeneration) {
    logger.info({ generation }, 'Orchestrator worker already registered for generation');
    return;
  }
  lastRegisteredGeneration = generation;

  await boss.work<OrchestratorJobPayload, void>(TOPICS.ORCHESTRATOR, async (job) => {
    const jobId = job?.data?.jobId;
    if (!jobId) {
      logger.warn({ bossJobId: job?.id }, 'Orchestrator received job without jobId');
      return;
    }

    try {
      const config: { configurable: { thread_id: string } } = { configurable: { thread_id: jobId } };

      const stateRecord = await readStateWithCheckpoint(jobId);
      const currentState = stateRecord?.state;
      const checkpointEnvelope = stateRecord?.checkpoint;
      logger.info({ jobId, currentState, pause: currentState?.pause }, 'Loaded current state');
      if (!currentState) {
        logger.error({ jobId }, 'No persisted state found for job; skipping iteration');
        return;
      }

      if (currentState.flags?.cancelled) {
        logger.info({ jobId }, 'Job cancelled; skipping orchestration');
        await updateJobCatalogFromState(jobId, currentState);
        return;
      }

      logger.info({ jobId }, 'Orchestrator executing next node');
      await markJobStarted(jobId);
      const snapshotBefore = await orchestratorRunnable.getState(config);
      const snapshotHasState = Boolean((snapshotBefore?.values as { state?: PipelineState } | undefined)?.state);
      const checkpointPresent = hasCheckpointEnvelope(checkpointEnvelope);
      const hasCheckpoint = checkpointPresent || snapshotHasState;
      logger.info({ jobId, checkpointPresent, snapshotHasState, hasCheckpoint }, 'Checkpoint status');
      if (checkpointPresent && !snapshotHasState) {
        logger.warn({ jobId }, 'Checkpoint present but graph snapshot missing state');
      }
      if (!checkpointPresent && snapshotHasState) {
        logger.warn({ jobId }, 'Graph snapshot has state but checkpoint envelope missing');
      }
      if (hasCheckpoint) {
        const updateNode = resolveUpdateNode(currentState);
        await orchestratorRunnable.updateState(config, { state: currentState }, updateNode);
      }

      let resumeSignal = currentState.pause?.resumeSignal ?? undefined;
      if (resumeSignal && !hasCheckpoint) {
        logger.error({ jobId }, 'Resume requested but no checkpoint found; keeping job paused');
        await updateJobCatalogFromState(jobId, currentState);
        return;
      }

      const asRerunSignal = (signal: PauseResumeSignal | undefined): signal is PauseResumeSignal & { action: 'rerun'; node?: string } =>
        Boolean(signal && signal.action === 'rerun');

      let invokeInput: Command | null | undefined;

      if (hasCheckpoint && asRerunSignal(resumeSignal)) {
        const target = typeof resumeSignal.node === 'string' ? resumeSignal.node : undefined;
        if (target && ['garment_summary', 'enrich', 'ghost'].includes(target)) {
          const resumedAt = new Date().toISOString();
          const flagsBase = currentState.flags ?? {};
          const timestampsBase = currentState.timestamps ?? {};

          const rerunPatch: Partial<PipelineState> = {
            pause: null,
            step: 'hitl_phase2_rerun',
            flags: {
              ...flagsBase,
              hitlPhase2Completed: false
            },
            timestamps: {
              ...timestampsBase,
              hitl_phase2_resumed: resumedAt
            }
          };

          const mergedForRerun = mergePipelineState(currentState, { jobId, ...rerunPatch });
          await persistStatePatch(jobId, { jobId, ...rerunPatch });
          await orchestratorRunnable.updateState(config, { state: mergedForRerun }, resolveUpdateNode(mergedForRerun));

          invokeInput = new Command({ goto: target as 'garment_summary' | 'enrich' | 'ghost' });
          resumeSignal = undefined;
        } else {
          logger.warn({ jobId, resumeSignal }, 'Orchestrator received rerun signal without valid target; falling back to regular resume');
        }
      }

      if (!invokeInput && hasCheckpoint) {
        invokeInput = resumeSignal ? new Command({ resume: resumeSignal }) : null;
      }

      const result = hasCheckpoint
        ? await orchestratorRunnable.invoke(invokeInput ?? null, config)
        : await orchestratorRunnable.invoke({ state: currentState }, config);

      const refreshedState = await readState(jobId);
      const catalogState = refreshedState ?? currentState;
      if (catalogState) {
        await updateJobCatalogFromState(jobId, catalogState);
      }
      if (refreshedState) {
        await orchestratorRunnable.updateState(config, { state: refreshedState }, resolveUpdateNode(refreshedState));
      }

      const snapshotAfter = await orchestratorRunnable.getState(config);
      const statePatch = snapshotAfter?.values?.state as Partial<PipelineState> | undefined;
      logger.info({ jobId, result, snapshot: snapshotAfter?.values }, 'Orchestrator iteration complete');

      if (statePatch && Object.keys(statePatch).length > 0) {
        const baseState = refreshedState ?? currentState;
        const mergedState = mergePipelineState(baseState, statePatch);
        await persistStatePatch(jobId, mergedState);
        await orchestratorRunnable.updateState(config, { state: mergedState }, resolveUpdateNode(mergedState));
      }

      if (hasInterrupt(result)) {
        logger.info({ jobId }, 'Workflow paused awaiting human input');
        return;
      }

      if (!snapshotAfter) {
        logger.error({ jobId }, 'Unable to read graph state after iteration');
        return;
      }

      if (snapshotAfter.next.length === 0) {
        const completedAt = new Date().toISOString();
        const completionPatch: Partial<PipelineState> = {
          timestamps: {
            ...(catalogState.timestamps ?? {}),
            workflow_completed: completedAt
          }
        };
        const completedState = await persistStatePatch(jobId, { jobId, ...completionPatch });
        await updateJobCatalogFromState(jobId, completedState);
        logger.info({ jobId }, 'Workflow completed');
        return;
      }

      await boss.send(TOPICS.ORCHESTRATOR, { jobId }, { retryLimit: 0 });
    } catch (err) {
      const message = normalizeErrorMessage(err);
      const kind = classifyErrorKind(message);
      logger.error({ jobId, error: message }, 'Orchestrator failed');
      if (jobId) {
        try {
          const current = await readState(jobId);
          const nextErrors = [
            ...(current?.errors ?? []),
            { step: 'orchestrator', message, kind }
          ];
          const nextState = await persistStatePatch(jobId, { jobId, errors: nextErrors });
          await updateJobCatalogFromState(jobId, nextState);
          if (kind === 'transient' && nextErrors.length <= 3) {
            await boss.send(TOPICS.ORCHESTRATOR, { jobId }, { retryLimit: 3, retryBackoff: true });
            return;
          }
        } catch (persistError) {
          logger.warn({ jobId, error: String((persistError as Error)?.message ?? persistError) }, 'Orchestrator error persistence failed');
        }
      }
      throw err;
    }
  });
}
