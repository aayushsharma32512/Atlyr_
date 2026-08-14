import { describe, expect, test, mock, beforeEach } from 'bun:test';

// config validates env at import time and process.exit(1)s without it.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';
process.env.DATABASE_URL_DIRECT ??= 'postgres://localhost:5432/test';
process.env.API_TOKEN ??= 'test-token';

// Only the modules the reuse path actually touches are mocked. mock.module patches the registry
// process-wide and bun's mock.restore() does not undo it, so faking ../adapters/vton/index here
// would leak into the real resolveVtonModel tests and fail them. It isn't needed: the guard under
// test returns before the provider or storage is ever reached, which is precisely the point — if
// this test ever started needing a vton mock, the guard would be broken.
type Artifact = { data: Record<string, unknown> } | null;

let vtonArtifact: Artifact = null;
let advancedWith: string | undefined;
let updatedUrl: string | undefined;

mock.module('../domain/artifacts', () => ({
  getLatestArtifact: async (_jobId: string, type: string): Promise<Artifact> =>
    type === 'vton_image' ? vtonArtifact : { data: { tech_pack: 'tp' } },
  saveArtifact: async () => {},
}));

mock.module('../domain/job-catalog', () => ({
  updateJob: async (_jobId: string, patch: { vton_image_url?: string }) => { updatedUrl = patch.vton_image_url; },
}));

mock.module('../orchestration/advance-and-trigger', () => ({
  advanceAndTrigger: async (job: { vton_image_url?: string }) => { advancedWith = job.vton_image_url; },
}));

const { VtonGenerationHandler } = await import('./vton-generation.handler');

const baseJob = {
  job_id: 'job-1',
  v_ton_preferred_image: 'https://example.com/model.jpg',
  product_gender_type: 'female',
  product_type: 'topwear',
  product_sub_type: 'top',
  vton_image_url: null,
} as never;

beforeEach(() => {
  vtonArtifact = null;
  advancedWith = undefined;
  updatedUrl = undefined;
});

describe('VtonGenerationHandler', () => {
  // A 2K Gemini generation is billed per call and takes 40-160s. The image is written several
  // awaits before the state advances, so a process killed in that window leaves a finished,
  // already-paid-for image with the job still sitting on this step. Boot recovery re-dispatches
  // it — and without this guard we would buy the same image a second time.
  test('reuses an already-generated image instead of paying for it again', async () => {
    vtonArtifact = { data: { public_url: 'https://storage/already-there.jpg' } };

    // Reaching the provider would throw here (no network, no mock), so completing at all proves
    // the guard short-circuited before any billable call.
    await new VtonGenerationHandler().execute(baseJob);

    expect(advancedWith).toBe('https://storage/already-there.jpg');
    expect(updatedUrl).toBe('https://storage/already-there.jpg');
  });

  test('does not re-record the url when the job already carries it', async () => {
    vtonArtifact = { data: { public_url: 'https://storage/already-there.jpg' } };
    const job = { ...(baseJob as object), vton_image_url: 'https://storage/already-there.jpg' } as never;

    await new VtonGenerationHandler().execute(job);

    expect(updatedUrl).toBeUndefined();
    expect(advancedWith).toBe('https://storage/already-there.jpg');
  });
});
