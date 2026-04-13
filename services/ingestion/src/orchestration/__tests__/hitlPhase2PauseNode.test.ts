import { hitlPhase2PauseNode } from '../nodes';
import type { PipelineState } from '../../domain/state';

const baseState = (): PipelineState => ({
  jobId: 'job-1',
  originalUrl: 'https://example.com/product',
  domain: 'example.com',
  dedupeKey: 'example.com/product',
  flags: {
    enrichReady: false,
    ghostReady: true
  }
});

describe('hitlPhase2PauseNode gating', () => {
  it('returns empty patch when automation outputs are not ready', async () => {
    const state = baseState();
    const patch = await hitlPhase2PauseNode(state);
    expect(patch).toEqual({});
  });
});
