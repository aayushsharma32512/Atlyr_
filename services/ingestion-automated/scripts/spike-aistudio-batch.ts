/**
 * Phase 0 contract spike — AI Studio batch VTON.
 *
 * A throwaway ~3-request image batch that answers the four questions the collector and poller
 * are built on top of. Everything it submits is real and billed; keep the tray small.
 *
 *   1. fileData reference   Can a batch request reference an avatar uploaded to the Files API
 *                           instead of inlining it? Load-bearing: inlined, a single female-avatar
 *                           request is ~3.1 MB against a 20 MB ceiling (~6 jobs per tray). By
 *                           reference, a 30-job tray is ~6 MB. Request 2 inlines the avatar as a
 *                           control, so a failure here is attributable to fileData and not to
 *                           batch itself.
 *   2. metadata echo        Do inlined requests echo `metadata` on their responses? The whole
 *                           correlation contract (job_id in metadata, never array index) rests
 *                           on this. If it does not echo, the lane moves to the file + `key` path.
 *   3. usageMetadata        Is per-response usage reported? If not, cost accounting uses the flat
 *                           0.5 × interactive fallback rather than silently pricing batch at 0.
 *   4. safetySettings       Are they honoured in batch? Abort criterion: if they are not and the
 *                           refusal rate is high, the refusal-fallback tax erases the economics
 *                           and the lane should not be built. Three requests cannot measure a
 *                           rate — this only establishes that the field is accepted and reports
 *                           what came back.
 *
 * Usage (from services/ingestion-automated):
 *   bun run scripts/spike-aistudio-batch.ts --dry-run          # build the tray, submit nothing
 *   bun run scripts/spike-aistudio-batch.ts                    # garments from the DB
 *   bun run scripts/spike-aistudio-batch.ts --garment <url> --garment <url>
 *   bun run scripts/spike-aistudio-batch.ts --model gemini-3-pro-image --timeout 1800
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { HarmBlockThreshold, HarmCategory, type InlinedRequest, type SafetySetting } from '@google/genai';
import { config } from '../src/config/index';
import { pgPool } from '../src/db/pg';
import {
  createInlineBatch,
  getBatch,
  uploadFile,
  type BatchHandle,
  type UploadedFile,
} from '../src/adapters/gemini-batch';
import {
  CORRELATION_KEY,
  isTerminalStatus,
  readBatchItem,
  resolveJobId,
  type RawBatchItem,
} from '../src/adapters/gemini-batch.protocol';
import {
  buildVtonRequest,
  fetchImageAsBase64,
  loadAvatarBytes,
  sniffMimeType,
  vtonGenerationConfig,
} from '../src/adapters/vton/vton-request';
import type { TryonInput } from '../src/domain/types';

// ─── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const garments: string[] = [];
  let model = config.GEMINI_IMAGE_MODEL;
  let dryRun = false;
  let timeoutSec = 1800;
  let pollSec = 15;
  let outDir = join(process.cwd(), 'spike-output');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--garment') garments.push(argv[++i]);
    else if (arg === '--model') model = argv[++i];
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--timeout') timeoutSec = Number(argv[++i]);
    else if (arg === '--poll') pollSec = Number(argv[++i]);
    else if (arg === '--out') outDir = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { garments, model, dryRun, timeoutSec, pollSec, outDir };
}

// ─── fixtures ────────────────────────────────────────────────────────────────

interface Fixture {
  label: string;
  input: TryonInput;
}

/**
 * Real garments and their real summaries, so the prompt the spike sends is the prompt production
 * sends. A synthetic prompt would tell us nothing about refusals, which is the one thing here
 * that can kill the lane.
 */
async function fixturesFromDb(limit: number): Promise<Fixture[]> {
  const { rows } = await pgPool().query<{
    job_id: string;
    v_ton_preferred_image: string;
    product_type: string;
    product_gender_type: string;
    product_sub_type: string | null;
    summary: Record<string, unknown> | null;
  }>(
    `SELECT j.job_id, j.v_ton_preferred_image, j.product_type, j.product_gender_type,
            j.product_sub_type, a.data AS summary
       FROM ingestion_pipeline_jobs j
       JOIN LATERAL (
         SELECT data FROM pipeline_step_artifacts
          WHERE job_id = j.job_id AND artifact_type = 'garment_summary'
          ORDER BY created_at DESC LIMIT 1
       ) a ON true
      WHERE j.v_ton_preferred_image IS NOT NULL
        AND j.product_type IN ('topwear', 'bottomwear', 'dress')
      ORDER BY j.created_at DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((r) => ({
    label: r.job_id.slice(0, 8),
    input: {
      imageUrl: r.v_ton_preferred_image,
      gender: r.product_gender_type,
      productType: r.product_type,
      productSubType: r.product_sub_type ?? '',
      techPack: (r.summary?.tech_pack as string) ?? '',
      garmentPhysics: (r.summary?.garment_physics as string) ?? '',
      itemName: (r.summary?.item_name as string) ?? '',
      colorAndFabric: (r.summary?.color_and_fabric as string) ?? '',
    },
  }));
}

function fixturesFromUrls(urls: string[]): Fixture[] {
  return urls.map((url, i) => ({
    label: `url-${i + 1}`,
    input: {
      imageUrl: url,
      gender: 'female',
      productType: 'topwear',
      productSubType: '',
      techPack: '',
      garmentPhysics: '',
      itemName: 'garment',
      colorAndFabric: '',
    },
  }));
}

// ─── tray ────────────────────────────────────────────────────────────────────

/**
 * Deliberately permissive. Catalogue photography of clothed models is routinely misread as
 * sexual content by image safety filters, and every refusal costs a full-price instant re-run —
 * the tax the lane's ~40% (not 50%) real saving is quoted net of. Whether batch honours these at
 * all is spike question 4.
 */
const RELAXED_SAFETY: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

type AvatarMode = 'fileUri' | 'inline';

interface TrayItem {
  correlationId: string;
  label: string;
  avatarMode: AvatarMode;
  request: InlinedRequest;
}

function buildTrayItem(params: {
  correlationId: string;
  label: string;
  fixture: Fixture;
  garment: { b64: string; mimeType: string };
  avatarMode: AvatarMode;
  avatarFile: UploadedFile | null;
  model: string;
}): TrayItem {
  const spec = buildVtonRequest(params.fixture.input);

  const avatarPart =
    params.avatarMode === 'fileUri' && params.avatarFile
      ? { fileData: { fileUri: params.avatarFile.uri, mimeType: params.avatarFile.mimeType } }
      : { inlineData: { mimeType: spec.avatar.mimeType, data: spec.avatar.b64 } };

  return {
    correlationId: params.correlationId,
    label: params.label,
    avatarMode: params.avatarMode,
    request: {
      model: params.model,
      contents: [
        {
          role: 'user',
          parts: [
            avatarPart,
            { inlineData: { mimeType: params.garment.mimeType, data: params.garment.b64 } },
            { text: spec.prompt },
          ],
        },
      ],
      // Correlation rides here and nowhere else — never position in the array.
      metadata: { [CORRELATION_KEY]: params.correlationId },
      config: {
        ...vtonGenerationConfig(),
        systemInstruction: spec.system,
        safetySettings: RELAXED_SAFETY,
      },
    },
  };
}

const bytesOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

// ─── run ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(args.outDir, { recursive: true });

  console.log('── Phase 0 spike: AI Studio batch VTON ──');
  console.log(`model=${args.model}  dryRun=${args.dryRun}  out=${args.outDir}`);

  // Fixtures
  const fixtures = args.garments.length
    ? fixturesFromUrls(args.garments)
    : await fixturesFromDb(2);
  if (fixtures.length === 0) {
    throw new Error('no fixtures — pass --garment <url> or seed the DB with a summarised job');
  }
  console.log(`\nfixtures: ${fixtures.map((f) => `${f.label} (${f.input.productType}/${f.input.gender})`).join(', ')}`);

  // Avatar → Files API. Uploaded once and referenced by every fileUri request, which is the
  // whole point: the male asset alone is ~16 MB as base64.
  const avatarGender = fixtures[0].input.gender;
  const avatarBytes = loadAvatarBytes(avatarGender);
  const avatarMime = sniffMimeType(avatarBytes);
  console.log(`\navatar: gender=${avatarGender} ${mb(avatarBytes.length)} on disk, ${mb(avatarBytes.length * 4 / 3)} as base64, mime=${avatarMime}`);

  let avatarFile: UploadedFile | null = null;
  let uploadError: string | null = null;
  if (!args.dryRun) {
    try {
      avatarFile = await uploadFile({ bytes: avatarBytes, mimeType: avatarMime, displayName: `spike-avatar-${avatarGender}` });
      console.log(`  uploaded → ${avatarFile.uri} (expires ${avatarFile.expiresAt ?? 'unknown'})`);
    } catch (err) {
      uploadError = err instanceof Error ? err.message : String(err);
      console.log(`  UPLOAD FAILED → ${uploadError}`);
    }
  }

  // Garments
  const garments = await Promise.all(
    fixtures.map(async (f) => {
      const g = await fetchImageAsBase64(f.input.imageUrl);
      console.log(`  garment ${f.label}: ${mb(g.b64.length * 3 / 4)} (${g.mimeType})`);
      return g;
    }),
  );

  // Tray: fileUri for every fixture, plus one inline control so a fileData failure is
  // attributable to fileData rather than to batch.
  const items: TrayItem[] = fixtures.map((fixture, i) =>
    buildTrayItem({
      correlationId: `spike-${stamp}-file-${i}`,
      label: `${fixture.label}/fileUri`,
      fixture,
      garment: garments[i],
      avatarMode: avatarFile ? 'fileUri' : 'inline',
      avatarFile,
      model: args.model,
    }),
  );
  items.push(
    buildTrayItem({
      correlationId: `spike-${stamp}-inline-0`,
      label: `${fixtures[0].label}/inline`,
      fixture: fixtures[0],
      garment: garments[0],
      avatarMode: 'inline',
      avatarFile: null,
      model: args.model,
    }),
  );

  // Sizing — the number that decides inline vs. the JSONL file path.
  const perItem = items.map((it) => ({ label: it.label, mode: it.avatarMode, bytes: bytesOf(it.request) }));
  const trayBytes = bytesOf(items.map((i) => i.request));
  console.log('\n── sizing ──');
  for (const p of perItem) console.log(`  ${p.label.padEnd(22)} ${p.mode.padEnd(8)} ${mb(p.bytes)}`);
  console.log(`  tray total: ${mb(trayBytes)} (inline ceiling 20 MB)`);
  const inlineItem = perItem.find((p) => p.mode === 'inline');
  // Size a by-reference request even on a dry run, using a placeholder URI of realistic length:
  // this projection is the number that decides inline vs. the JSONL file path, and it should not
  // cost a submission to see.
  const referenceBytes = bytesOf(
    buildTrayItem({
      correlationId: 'sizing-probe',
      label: 'sizing-probe',
      fixture: fixtures[0],
      garment: garments[0],
      avatarMode: 'fileUri',
      avatarFile: avatarFile ?? {
        name: 'files/placeholder000',
        uri: 'https://generativelanguage.googleapis.com/v1beta/files/placeholder000',
        mimeType: avatarMime,
        expiresAt: null,
      },
      model: args.model,
    }).request,
  );
  console.log(`  projected 30-job tray: ${mb(referenceBytes * 30)} by reference vs ${mb((inlineItem?.bytes ?? 0) * 30)} inlined`);
  console.log(`  jobs that fit inline: ${Math.floor((20 * 1024 * 1024) / referenceBytes)} by reference vs ${Math.floor((20 * 1024 * 1024) / (inlineItem?.bytes ?? 1))} inlined`);

  if (args.dryRun) {
    console.log('\n--dry-run: nothing submitted.');
    await pgPool().end().catch(() => {});
    return;
  }

  // Submit
  console.log('\n── submitting ──');
  const submittedAt = Date.now();
  const created = await createInlineBatch({
    model: args.model,
    displayName: `spike-${stamp}`,
    requests: items.map((i) => i.request),
  });
  console.log(`  ${created.name}  state=${created.state}`);

  // Poll
  let handle: BatchHandle = created;
  let lastState = created.state;
  const deadline = submittedAt + args.timeoutSec * 1000;
  while (!isTerminalStatus(handle.status)) {
    if (Date.now() > deadline) {
      console.log(`\nTIMED OUT after ${args.timeoutSec}s in state=${handle.state}. The batch is still live: ${handle.name}`);
      break;
    }
    await new Promise((r) => setTimeout(r, args.pollSec * 1000));
    handle = await getBatch(created.name);
    if (handle.state !== lastState) {
      console.log(`  ${Math.round((Date.now() - submittedAt) / 1000)}s → ${handle.state}`);
      lastState = handle.state;
    }
  }
  const elapsedSec = Math.round((Date.now() - submittedAt) / 1000);
  console.log(`  terminal in ${elapsedSec}s: state=${handle.state} status=${handle.status}${handle.error ? ` error=${handle.error}` : ''}`);

  // Read results
  const rawItems: RawBatchItem[] = handle.items ?? [];
  if (!handle.items && handle.outputFileName) {
    console.log(`  NOTE: results arrived as a file (${handle.outputFileName}), not inlined.`);
  }

  const byId = new Map(items.map((i) => [i.correlationId, i]));
  const seen = new Set<string>();
  let images = 0;
  let refusals = 0;
  let errors = 0;
  let uncorrelated = 0;
  let usageReported = 0;
  const fileUriResults: string[] = [];
  const inlineResults: string[] = [];

  console.log('\n── results ──');
  for (const [index, raw] of rawItems.entries()) {
    const result = readBatchItem(raw);
    const rawKey = resolveJobId(raw);
    const sent = rawKey ? byId.get(rawKey) : undefined;
    const label = sent ? sent.label : `#${index} (unmatched key=${rawKey ?? 'none'})`;

    if (result.outcome === 'uncorrelated') {
      uncorrelated++;
      console.log(`  ${label}: UNCORRELATED — ${result.error}`);
      continue;
    }
    if (rawKey) seen.add(rawKey);

    if (result.outcome === 'error') {
      if (result.refusal) refusals++;
      else errors++;
      (sent?.avatarMode === 'inline' ? inlineResults : fileUriResults).push(result.refusal ? 'refusal' : 'error');
      console.log(`  ${label}: ${result.refusal ? 'REFUSAL' : 'ERROR'} — ${result.error}`);
      continue;
    }

    images++;
    if (result.usage) usageReported++;
    (sent?.avatarMode === 'inline' ? inlineResults : fileUriResults).push('image');

    const buf = Buffer.from(result.b64, 'base64');
    const meta = await sharp(buf).metadata().catch(() => null);
    const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
    const path = join(args.outDir, `${stamp}-${(sent?.label ?? `item-${index}`).replace(/\W+/g, '_')}.${ext}`);
    writeFileSync(path, buf);
    console.log(
      `  ${label}: IMAGE ${meta?.width}x${meta?.height} ${result.mimeType} ${mb(buf.length)}` +
      `  usage=${result.usage ? result.usage.total_tokens : 'ABSENT'}  → ${path}`,
    );
  }

  const missing = items.filter((i) => !seen.has(i.correlationId));

  // ── verdicts ──
  const fileUriSent = items.filter((i) => i.avatarMode === 'fileUri').length;
  const verdict = (ok: boolean | null, yes: string, no: string, unknown = 'INCONCLUSIVE') =>
    ok === null ? `? ${unknown}` : ok ? `PASS  ${yes}` : `FAIL  ${no}`;

  console.log('\n── verdicts ──');
  console.log(
    `1. fileData reference   ${verdict(
      uploadError ? false : fileUriSent === 0 ? null : fileUriResults.includes('image'),
      'avatar referenced by fileUri produced an image — tray stays inline-able',
      uploadError
        ? `Files API upload failed: ${uploadError}`
        : 'no image from a fileUri request — fall back to re-encoded avatar + JSONL path and a much smaller flush size',
      'no fileUri request was sent',
    )}`,
  );
  console.log(
    `2. metadata echo        ${verdict(
      rawItems.length === 0 ? null : uncorrelated === 0 && seen.size > 0,
      `${seen.size}/${items.length} results carried their ${CORRELATION_KEY} back — correlate on metadata`,
      `${uncorrelated} result(s) came back without ${CORRELATION_KEY} — switch to the file + key path`,
      'no results to inspect',
    )}`,
  );
  console.log(
    `3. usageMetadata        ${verdict(
      images === 0 ? null : usageReported === images,
      `usage present on all ${images} image(s) — exact cost accounting`,
      `usage on ${usageReported}/${images} image(s) — price the rest at the flat 0.5x fallback`,
      'no images to inspect',
    )}`,
  );
  console.log(
    `4. safetySettings       ${verdict(
      rawItems.length === 0 ? null : refusals === 0,
      'accepted, no refusals in this tray',
      `${refusals}/${rawItems.length} refused — measure the rate over a real pilot before building the lane (abort above ~25%)`,
      'no results to inspect',
    )}`,
  );
  console.log(
    `5. input method         ${trayBytes < 20 * 1024 * 1024 && fileUriResults.includes('image')
      ? 'INLINE — tray fits the 20 MB ceiling with avatars by reference'
      : 'FILE (JSONL) — inline ceiling is not safely reachable'}`,
  );

  console.log('\n── tally ──');
  console.log(`  sent=${items.length}  returned=${rawItems.length}  images=${images}  refusals=${refusals}  errors=${errors}  uncorrelated=${uncorrelated}  missing=${missing.length}`);
  if (missing.length) console.log(`  missing keys: ${missing.map((m) => m.label).join(', ')}`);
  console.log(`  turnaround: ${elapsedSec}s (24h SLA, 48h hard expiry)`);

  await pgPool().end().catch(() => {});
}

main().catch((err) => {
  console.error('\nspike failed:', err);
  process.exit(1);
});
