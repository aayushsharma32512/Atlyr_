import { randomUUID } from 'node:crypto';
import { crawlNode, extractNode, downloadNode } from '../orchestration/nodes';
import { persistStatePatch, readState, resetState } from '../domain/state-store';
import type { PipelineState } from '../domain/state';

console.log('[bootstrap] Script started');

async function main() {
  console.log('[bootstrap] main invoked');
  const jobId = randomUUID();
  const originalUrl = process.env.TEST_PRODUCT_URL;

  if (!originalUrl) {
    throw new Error('Set TEST_PRODUCT_URL in your environment to run this script');
  }

  const url = new URL(originalUrl);
  const domain = url.hostname;
  const dedupeKey = `${domain}|${url.pathname}`;

  console.log('Testing crawl/extract nodes with LangGraph state', { jobId, originalUrl, domain, dedupeKey });

  await resetState(jobId);

  await persistStatePatch(jobId, { jobId, originalUrl, domain, dedupeKey });

  await runNode('crawl', crawlNode, jobId);
  await runNode('extract', extractNode, jobId);
  await runNode('download', downloadNode, jobId);

  const finalState = await readState(jobId);
  console.log('Final state snapshot:', JSON.stringify(finalState, null, 2));

  console.log('\nNext steps:');
  console.log('  1. Check Supabase storage for artifacts under artifacts/pages/' + jobId);
  console.log('  2. Inspect ingestion_job_state row for this jobId');
}

async function runNode(name: string, node: (state: PipelineState) => Promise<Partial<PipelineState>>, jobId: string) {
  const before = await readState(jobId);
  if (!before) throw new Error(`State missing before ${name}`);
  console.log(`\nRunning ${name} node...`);
  const patch = await node(before);
  if (Object.keys(patch || {}).length) {
    await persistStatePatch(jobId, patch);
  }
  const after = await readState(jobId);
  console.log(`${name} node complete. Current state excerpt:`, JSON.stringify(after, null, 2));
}

main().then(() => {
  console.log('[bootstrap] script completed');
}).catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});

