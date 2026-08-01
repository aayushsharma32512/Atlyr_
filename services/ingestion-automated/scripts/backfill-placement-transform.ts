#!/usr/bin/env bun
/**
 * Backfill placement transforms onto artifacts that are missing the per-mannequin set.
 *
 * Why: the mesh editor reconstructs a placement from {transform, warp} (see PlacementMeshEditor.tsx
 * and usePlacementImage.ts). Automated placements written before the Modal pipeline exported a
 * transform carry only {placedImageUrl, selectedMannequin}, so opening the editor on those rows
 * shows the garment at the canvas default instead of where it was actually placed.
 *
 * Also backfills `transforms` — one entry per mannequin the garment registers against. The pipeline
 * always registered against both and used to discard the loser, so older artifacts hold only the
 * winner. Without the second entry the studio cannot put the garment on the viewer's own body, which
 * is why a unisex top currently shows the wrong mannequin to half the users.
 *
 * What it does, per job whose LATEST placement artifact lacks `transforms`:
 *   1. Re-runs the Modal placement endpoint with the job's existing segmented + vton images.
 *      The pipeline is deterministic, so the composite it re-uploads to placement/{jobId}/final.png
 *      is the same image that is already there — only the returned transform is new information.
 *   2. Patches `transform` into the EXISTING artifact row (no new artifact, no history churn).
 *   3. Merges the matching entry into the product's `placement` JSONB map so the studio agrees.
 *
 * Only jobs already in `completed` are touched: the Modal pipeline patches current_state to
 * 'completed' as a side effect, which would wrongly advance a job sitting in an earlier state.
 *
 * Usage (from services/ingestion-automated):
 *   bun run scripts/backfill-placement-transform.ts              # dry run — lists what it would do
 *   bun run scripts/backfill-placement-transform.ts --apply
 *   bun run scripts/backfill-placement-transform.ts --apply --job <job_id>
 *   bun run scripts/backfill-placement-transform.ts --apply --limit 3 --concurrency 2
 *   bun run scripts/backfill-placement-transform.ts --gender unisex   # the ones that matter most
 */
import { pgPool } from '../src/db/pg';
import { catalogId, placementEntriesFrom, writePlacementEntry } from '../src/domain/catalog';

type Row = {
  id: string;
  job_id: string;
  data: Record<string, unknown> | null;
  current_state: string;
  product_gender_type: string | null;
  segmented_image_url: string | null;
  vton_image_url: string | null;
};

type Transform = { scale: number; rotationDeg: number; tx: number; ty: number };

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = argv.includes('--apply');
const ONLY_JOB = flag('job');
const LIMIT = Number(flag('limit') ?? 0) || 0;
const CONCURRENCY = Number(flag('concurrency') ?? 2) || 2;
// Narrow to one product_gender_type. Unisex first is the cheapest, highest-value slice: those are
// the products actually showing the wrong body today.
const ONLY_GENDER = flag('gender');
// A cold L4 container plus registration runs well over a minute; don't cut it off early.
const MODAL_TIMEOUT_MS = 10 * 60 * 1000;

const MODAL_URL = process.env.MODAL_PLACEMENT_URL;
if (!MODAL_URL) throw new Error('MODAL_PLACEMENT_URL is not set (expected in services/ingestion-automated/.env)');

async function findCandidates(): Promise<Row[]> {
  const { rows } = await pgPool().query<Row>(
    `with latest as (
       select distinct on (a.job_id) a.id, a.job_id, a.data, a.created_at
         from public.pipeline_step_artifacts a
        where a.artifact_type = 'placement'
        order by a.job_id, a.created_at desc
     )
     select l.id, l.job_id, l.data, j.current_state, j.product_gender_type,
            j.segmented_image_url, j.vton_image_url
       from latest l
       join public.ingestion_pipeline_jobs j using (job_id)
      where not (l.data ? 'transforms')
        and ($1::uuid is null or l.job_id = $1::uuid)
        and ($2::text is null or j.product_gender_type = $2::text)
      order by l.created_at desc`,
    [ONLY_JOB ?? null, ONLY_GENDER ?? null],
  );
  return rows;
}

async function runModal(
  row: Row,
): Promise<{ transform: Transform; transforms: Record<string, Transform>; mannequin: string | null }> {
  const url =
    `${MODAL_URL}/?pipeline_job_id=${encodeURIComponent(row.job_id)}` +
    `&segmented_image_url=${encodeURIComponent(row.segmented_image_url!)}` +
    `&vton_image_url=${encodeURIComponent(row.vton_image_url!)}`;

  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(MODAL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Modal HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = (await res.json()) as {
    status?: string;
    selected_mannequin?: string;
    transform?: Partial<Transform>;
    transforms?: Record<string, Partial<Transform>>;
    error?: string;
  };
  if (body.status !== 'completed' && body.status !== 'success') {
    throw new Error(`Modal status=${body.status}: ${String(body.error ?? '').slice(0, 300)}`);
  }
  const t = body.transform;
  if (!t || typeof t.scale !== 'number' || typeof t.tx !== 'number' || typeof t.ty !== 'number') {
    // The deployed pipeline predates the transform export — redeploy services/test_placement.
    throw new Error('Modal returned no usable transform — is the placement app redeployed?');
  }
  const transforms: Record<string, Transform> = {};
  for (const [mannequin, v] of Object.entries(body.transforms ?? {})) {
    if (typeof v?.scale !== 'number' || typeof v?.tx !== 'number' || typeof v?.ty !== 'number') continue;
    transforms[mannequin] = { scale: v.scale, rotationDeg: v.rotationDeg ?? 0, tx: v.tx, ty: v.ty };
  }
  if (!Object.keys(transforms).length) {
    // The deployed pipeline predates the per-mannequin export. Bailing loudly beats silently
    // rewriting the same single entry for every row in the catalogue.
    throw new Error('Modal returned no `transforms` — redeploy services/test_placement first');
  }

  return {
    transform: { scale: t.scale, rotationDeg: t.rotationDeg ?? 0, tx: t.tx, ty: t.ty },
    transforms,
    mannequin: body.selected_mannequin ?? null,
  };
}

async function persist(
  row: Row,
  transform: Transform,
  transforms: Record<string, Transform>,
  mannequin: string | null,
): Promise<void> {
  const existingMannequin = (row.data?.selectedMannequin as string | undefined) ?? null;
  const patch: Record<string, unknown> = {
    transform,
    transforms,
    transformBackfilledAt: new Date().toISOString(),
  };
  if (!existingMannequin && mannequin) patch.selectedMannequin = mannequin;

  await pgPool().query(
    `update public.pipeline_step_artifacts
        set data = coalesce(data, '{}'::jsonb) || $1::jsonb
      where id = $2`,
    [JSON.stringify(patch), row.id],
  );

  // Same write the manual save route performs, so the studio renders what the editor shows.
  // warp is [] — an automated placement has no lattice, only the affine.
  // One entry per mannequin. The merge is per key, so an existing manual edit to the other
  // mannequin survives untouched.
  const entries = placementEntriesFrom(
    { transform, transforms, warp: [], selectedMannequin: existingMannequin ?? mannequin },
    row.product_gender_type,
  );
  for (const e of entries) await writePlacementEntry(catalogId(row.job_id), e.key, e.entry);
}

async function main(): Promise<void> {
  const all = await findCandidates();
  const skipped = all.filter(r => r.current_state !== 'completed' || !r.segmented_image_url || !r.vton_image_url);
  let todo = all.filter(r => !skipped.includes(r));
  if (LIMIT) todo = todo.slice(0, LIMIT);

  console.log(
    `placement artifacts missing per-mannequin transforms: ${all.length}` +
      (ONLY_GENDER ? ` (gender=${ONLY_GENDER})` : ''),
  );
  for (const r of skipped) {
    const why = r.current_state !== 'completed' ? `state=${r.current_state}` : 'missing segmented/vton url';
    console.log(`  skip  ${r.job_id}  (${why})`);
  }
  console.log(`${APPLY ? 'backfilling' : 'would backfill'}: ${todo.length}${LIMIT ? ` (--limit ${LIMIT})` : ''}`);
  if (!APPLY) {
    for (const r of todo) console.log(`  todo  ${r.job_id}`);
    console.log('\ndry run — re-run with --apply to write.');
    return;
  }

  let ok = 0;
  const failures: { job_id: string; error: string }[] = [];
  const queue = [...todo];

  const worker = async (): Promise<void> => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const started = Date.now();
      try {
        const { transform, transforms, mannequin } = await runModal(row);
        await persist(row, transform, transforms, mannequin);
        ok++;
        const secs = ((Date.now() - started) / 1000).toFixed(0);
        console.log(
          `  ok    ${row.job_id}  ${secs}s  scale=${transform.scale.toFixed(4)} ` +
          `rot=${transform.rotationDeg.toFixed(3)} tx=${transform.tx.toFixed(1)} ty=${transform.ty.toFixed(1)}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ job_id: row.job_id, error: message });
        console.log(`  FAIL  ${row.job_id}  ${message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  console.log(`\ndone — ${ok} backfilled, ${failures.length} failed, ${skipped.length} skipped`);
  for (const f of failures) console.log(`  FAIL  ${f.job_id}  ${f.error}`);
  if (failures.length) process.exitCode = 1;
}

await main();
await pgPool().end();
