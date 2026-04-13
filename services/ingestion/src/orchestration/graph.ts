import { Annotation, StateGraph, START, END, typedNode, Command, isGraphInterrupt } from '@langchain/langgraph';
import type { PipelineState } from '../domain/state';
import { mergePipelineState } from '../domain/merge-pipeline-state';
import {
  submitNode,
  crawlNode,
  extractNode,
  downloadNode,
  garmentSummaryNode,
  enrichNode,
  ghostNode,
  hitlPhase1PauseNode,
  hitlPhase1InterruptNode,
  hitlPhase2PauseNode,
  hitlPhase2InterruptNode,
  stageNode,
  promoteNode
} from './nodes';
import { recordNodeError } from './error-routing';

const GraphAnnotation = Annotation.Root({
  state: Annotation<PipelineState>({
    reducer: (prev, update) => mergePipelineState(prev, update)
  })
});

type GraphInput = typeof GraphAnnotation.State;

function unwrapPipelineState(input: GraphInput | PipelineState | undefined): PipelineState | undefined {
  if (!input) return undefined;
  if (typeof input === 'object' && 'state' in input) {
    const candidate = input as { state?: PipelineState };
    return candidate.state ?? undefined;
  }
  return input as PipelineState;
}

function wrapStateUpdate(current: PipelineState | undefined, patch: Partial<PipelineState>) {
  return { state: mergePipelineState(current, patch) } satisfies typeof GraphAnnotation.Update;
}

async function withNodeErrors<T>(
  pipeline: PipelineState | undefined,
  step: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isGraphInterrupt(error)) {
      await recordNodeError(pipeline, step, error);
    }
    throw error;
  }
}

const hitlPhase1PauseWriter = typedNode(GraphAnnotation)(async (graphState) => {
  const pipeline = unwrapPipelineState(graphState);
  if (!pipeline) return {} as typeof GraphAnnotation.Update;

  const patch = await withNodeErrors(pipeline, 'hitl_phase1_pause', () => hitlPhase1PauseNode(pipeline));
  if (!patch || Object.keys(patch).length === 0) {
    return {} as typeof GraphAnnotation.Update;
  }
  return wrapStateUpdate(pipeline, patch);
});

export const graph = new StateGraph(GraphAnnotation)
  .addNode('submit', async (state, config) => {
    const pipeline = unwrapPipelineState(state);
    const patch = await withNodeErrors(pipeline, 'submit', () => submitNode(pipeline, config));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  })
  .addNode('crawl', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'crawl', () => crawlNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  }, { retryPolicy: { maxAttempts: 3, initialInterval: 1 } })
  .addNode('extract', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'extract', () => extractNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  }, { retryPolicy: { maxAttempts: 2, initialInterval: 1 } })
  .addNode('download', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'download', () => downloadNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  }, { retryPolicy: { maxAttempts: 3, initialInterval: 1 } })
  .addNode('hitl_phase1_pause', hitlPhase1PauseWriter)
  .addNode('hitl_phase1_interrupt', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'hitl_phase1_interrupt', () => hitlPhase1InterruptNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  })
  .addNode('garment_summary', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'garment_summary', () => garmentSummaryNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  }, { retryPolicy: { maxAttempts: 3, initialInterval: 1 } })
  .addNode('enrich', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'enrich', () => enrichNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  }, { retryPolicy: { maxAttempts: 3, initialInterval: 1 } })
  .addNode('ghost', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'ghost', () => ghostNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  }, { retryPolicy: { maxAttempts: 3, initialInterval: 1 } })
  //   .addNode('normalize_images', async (state: GraphState) => state)
  .addNode('hitl_phase2_pause', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'hitl_phase2_pause', () => hitlPhase2PauseNode(pipeline));
    if (patch instanceof Command) {
      return patch;
    }
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  })
  .addNode('hitl_phase2_interrupt', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'hitl_phase2_interrupt', () => hitlPhase2InterruptNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  })
  .addNode('stage', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'stage', () => stageNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  })
  .addNode('promote', async (state) => {
    const pipeline = unwrapPipelineState(state);
    if (!pipeline) return {};
    const patch = await withNodeErrors(pipeline, 'promote', () => promoteNode(pipeline));
    if (!patch || Object.keys(patch).length === 0) {
      return {};
    }
    return wrapStateUpdate(pipeline, patch);
  })
  .addEdge(START, 'submit')
  .addEdge('submit', 'crawl')
  .addEdge('crawl', 'extract')
  .addEdge('extract', 'download')
  .addEdge('download', 'hitl_phase1_pause')
  .addEdge('hitl_phase1_pause', 'hitl_phase1_interrupt')
  .addEdge('hitl_phase1_interrupt', 'garment_summary')
  .addEdge('hitl_phase1_interrupt', 'enrich')
  .addEdge('garment_summary', 'ghost')
  .addEdge('ghost', 'hitl_phase2_pause')
  .addEdge('enrich', 'hitl_phase2_pause')
  .addEdge('hitl_phase2_pause', 'hitl_phase2_interrupt')
  .addEdge('hitl_phase2_interrupt', 'stage')
  .addEdge('stage', 'promote')
  .addEdge('promote', END);
