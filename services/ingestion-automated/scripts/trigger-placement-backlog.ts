/**
 * Triggers the placement step for every job whose segmentation is done but which never
 * reached placement — i.e. the `awaiting_hitl_segmentation` backlog.
 *
 * Goes through POST /jobs/:id/proceed rather than writing state directly, so the job advances
 * through the state machine and gets enqueued on the Modal queue exactly like a human clicking
 * Proceed in the dashboard. pg-boss paces the actual GPU work, so enqueuing the whole backlog
 * at once is safe.
 *
 * Usage (from services/ingestion-automated):
 *   bun scripts/trigger-placement-backlog.ts --dry
 *   bun scripts/trigger-placement-backlog.ts --limit 10
 *   bun scripts/trigger-placement-backlog.ts
 */
import { Pool } from 'pg';

const args = process.argv.slice(2);
const dry = args.includes('--dry') || args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : null;

const API = `http://localhost:${process.env.PORT ?? 3001}`;
const TOKEN = process.env.API_TOKEN;
if (!TOKEN) throw new Error('API_TOKEN is not set — run this from services/ingestion-automated');

const pool = new Pool({ connectionString: process.env.DATABASE_URL_DIRECT, max: 4 });

// Both URLs are what PlacementHandler.validate() requires; the artifact check keeps a job that
// already has a placement (manual or automated) out of the batch.
const { rows: jobs } = await pool.query<{ job_id: string; product_gender_type: string | null }>(`
  select j.job_id, j.product_gender_type
  from ingestion_pipeline_jobs j
  where j.current_state = 'awaiting_hitl_segmentation'
    and j.segmented_image_url is not null
    and j.vton_image_url is not null
    and not exists (
      select 1 from pipeline_step_artifacts a
      where a.job_id = j.job_id and a.artifact_type = 'placement'
    )
  order by j.updated_at asc
  ${limit ? `limit ${Number(limit)}` : ''}
`);

console.log(`${jobs.length} job(s) ready for placement${dry ? ' (dry run — nothing sent)' : ''}`);
if (dry || jobs.length === 0) {
  for (const j of jobs) console.log(`  ${j.job_id}  ${j.product_gender_type ?? '?'}`);
  await pool.end();
  process.exit(0);
}

let ok = 0;
const failures: Array<{ jobId: string; reason: string }> = [];

for (const [i, job] of jobs.entries()) {
  const label = `[${i + 1}/${jobs.length}] ${job.job_id}`;
  try {
    const res = await fetch(`${API}/jobs/${job.job_id}/proceed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: '{}',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      failures.push({ jobId: job.job_id, reason: `${res.status} ${JSON.stringify(body)}` });
      console.log(`${label}  FAILED  ${res.status}`);
    } else {
      ok++;
      console.log(`${label}  -> ${(body as { current_state?: string }).current_state}`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    failures.push({ jobId: job.job_id, reason });
    console.log(`${label}  ERROR  ${reason}`);
  }
  // Small gap so 61 rapid state writes don't contend with the workers already draining the queue.
  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\nenqueued ${ok}/${jobs.length}`);
if (failures.length) {
  console.log('failures:');
  for (const f of failures) console.log(`  ${f.jobId}  ${f.reason}`);
}

await pool.end();
