import { mergePipelineState } from '../merge-pipeline-state';
import type { PipelineState } from '../state';

const baseState = (): PipelineState => ({
  jobId: 'job-1',
  originalUrl: 'https://example.com/product',
  domain: 'example.com',
  dedupeKey: 'example.com/product'
});

describe('mergePipelineState artifacts arrays', () => {
  it('merges rawImages by originalUrl without dropping existing entries', () => {
    const prev = {
      ...baseState(),
      artifacts: {
        rawImages: [
          { originalUrl: 'https://cdn/a.png', sizeBytes: 1 },
          { originalUrl: 'https://cdn/b.png', sizeBytes: 2 }
        ]
      }
    };

    const patch = {
      artifacts: {
        rawImages: [
          { originalUrl: 'https://cdn/a.png', sizeBytes: 3 }
        ]
      }
    };

    const next = mergePipelineState(prev, patch);
    const rawImages = next.artifacts?.rawImages ?? [];
    expect(rawImages).toHaveLength(2);
    expect(rawImages.find((img) => (img as { originalUrl?: string }).originalUrl === 'https://cdn/a.png')?.sizeBytes).toBe(3);
    expect(rawImages.find((img) => (img as { originalUrl?: string }).originalUrl === 'https://cdn/b.png')).toBeDefined();
  });

  it('unions imageUrls instead of replacing', () => {
    const prev = {
      ...baseState(),
      artifacts: {
        imageUrls: ['a', 'b']
      }
    };
    const patch = {
      artifacts: {
        imageUrls: ['b', 'c']
      }
    };

    const next = mergePipelineState(prev, patch);
    expect(next.artifacts?.imageUrls).toEqual(['a', 'b', 'c']);
  });

  it('merges ghostImages by view', () => {
    const prev = {
      ...baseState(),
      artifacts: {
        ghostImages: [
          { view: 'front', storagePath: 'old-front' },
          { view: 'back', storagePath: 'old-back' }
        ]
      }
    };
    const patch = {
      artifacts: {
        ghostImages: [
          { view: 'front', storagePath: 'new-front' }
        ]
      }
    };

    const next = mergePipelineState(prev, patch);
    const ghostImages = next.artifacts?.ghostImages ?? [];
    expect(ghostImages).toHaveLength(2);
    expect(ghostImages.find((img) => (img as { view?: string }).view === 'front')?.storagePath).toBe('new-front');
    expect(ghostImages.find((img) => (img as { view?: string }).view === 'back')).toBeDefined();
  });
});
