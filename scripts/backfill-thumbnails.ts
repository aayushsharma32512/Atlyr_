/**
 * Give every product a 400px WebP thumbnail and point products.thumbnail_url at it.
 *
 *   bun run scripts/backfill-thumbnails.ts                 # dry run: counts + sampled size estimate
 *   bun run scripts/backfill-thumbnails.ts --apply
 *   bun run scripts/backfill-thumbnails.ts --apply --limit 3
 *
 * thumbnail_url feeds grid tiles and outfit cards, which resolve their image as
 * `thumbnail_url || image_url`. Where the column is NULL that fallback serves the full-res 2K
 * garment PNG — 1.3-2.5MB — into a ~90px tile. Nothing has ever populated the column: it was added
 * as a read optimisation and filled by hand, so every product published since the last manual pass
 * is serving PNGs. `writeThumbnail` in services/ingestion-automated/src/domain/catalog.ts now does
 * this at go-live; this script is the one-off for everything published before that.
 *
 * ── Safety ──
 *
 *  · image_url is NEVER touched. The studio hero wears it on the 1800x3072 mannequin canvas, and
 *    the placement transform + 88-point warp lattice are measured in its pixel space (`refW`/`refH`
 *    in products.placement). It stays a full-res PNG.
 *  · Only rows where thumbnail_url IS NULL are considered — an existing thumbnail is never
 *    re-encoded or overwritten.
 *  · Reverting is one UPDATE: `UPDATE products SET thumbnail_url = NULL WHERE ...` — consumers fall
 *    straight back to image_url, and the .webp objects are harmless orphans.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js"
import {
  encodeThumbnail,
  parsePublicUrl,
  thumbnailPathFor,
} from "../services/ingestion-automated/src/utils/thumbnail"

const CONCURRENCY = 8
const SAMPLE = 12

type Row = { id: string; image_url: string | null; thumbnail_url: string | null }

function parseArgs(argv: string[]) {
  const a = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i]
    if (!t.startsWith("--")) continue
    const k = t.slice(2)
    const n = argv[i + 1]
    if (!n || n.startsWith("--")) a.set(k, true)
    else { a.set(k, n); i += 1 }
  }
  return a
}

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? (fallback ? process.env[fallback] : undefined)
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apply = Boolean(args.get("apply"))
  const limArg = args.get("limit")
  const limit = limArg && limArg !== true ? Number(limArg) : Infinity

  const base = requireEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "")
  const supabase = createClient(base, requireEnv("SUPABASE_SERVICE_ROLE_KEY"))

  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id,image_url,thumbnail_url")
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as Row[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }

  const todo: { row: Row; bucket: string; path: string; outPath: string; outUrl: string }[] = []
  let already = 0
  let skipped = 0
  for (const row of rows) {
    if (row.thumbnail_url?.trim()) { already += 1; continue }
    const p = row.image_url ? parsePublicUrl(row.image_url, base) : null
    if (!p) { skipped += 1; continue }
    const outPath = thumbnailPathFor(p.path)
    // Would overwrite its own source — image_url is already a .webp at full size.
    if (outPath === p.path) { skipped += 1; continue }
    todo.push({
      row, bucket: p.bucket, path: p.path, outPath,
      outUrl: `${base}/storage/v1/object/public/${p.bucket}/${outPath}`,
    })
  }

  const byBucket: Record<string, number> = {}
  for (const t of todo) byBucket[t.bucket] = (byBucket[t.bucket] ?? 0) + 1
  console.log(`\n${rows.length} products · ${already} already have a thumbnail · ${skipped} no usable image_url`)
  console.log(`${todo.length} to convert  ${JSON.stringify(byBucket)}`)

  if (!todo.length) {
    console.log(`\n  Nothing to do.`)
    return
  }

  if (!apply) {
    console.log(`\nDRY RUN — sampling ${Math.min(SAMPLE, todo.length)} to estimate…`)
    let b = 0, a = 0, n = 0
    for (const job of todo.slice(0, SAMPLE)) {
      const dl = await supabase.storage.from(job.bucket).download(job.path)
      if (dl.error) continue
      const src = Buffer.from(await dl.data.arrayBuffer())
      const out = await encodeThumbnail(src)
      b += src.length; a += out.length; n += 1
    }
    if (n) {
      console.log(`  sampled ${n}: ${(b / 1048576).toFixed(1)}MB → ${(a / 1024).toFixed(0)}KB (−${((1 - a / b) * 100).toFixed(1)}%)`)
      console.log(`  avg tile: ${(b / n / 1024).toFixed(0)}KB → ${(a / n / 1024).toFixed(0)}KB per garment`)
    }
    console.log(`\n  Nothing written. Re-run with --apply.`)
    return
  }

  const work = todo.slice(0, limit === Infinity ? todo.length : limit)
  console.log(`\nAPPLYING to ${work.length}…\n`)
  let before = 0, after = 0, done = 0, failed = 0
  const failures: string[] = []

  async function run(job: (typeof work)[number]) {
    try {
      const dl = await supabase.storage.from(job.bucket).download(job.path)
      if (dl.error) throw new Error(`download: ${dl.error.message}`)
      const src = Buffer.from(await dl.data.arrayBuffer())
      const out = await encodeThumbnail(src)

      const up = await supabase.storage
        .from(job.bucket)
        .upload(job.outPath, out, { contentType: "image/webp", upsert: true })
      if (up.error) throw new Error(`upload: ${up.error.message}`)

      const upd = await supabase.from("products").update({ thumbnail_url: job.outUrl }).eq("id", job.row.id)
      if (upd.error) throw new Error(`update: ${upd.error.message}`)

      before += src.length; after += out.length; done += 1
      if (done % 25 === 0 || done === work.length) {
        console.log(`  ${String(done).padStart(4)}/${work.length}  ${(before / 1048576).toFixed(1)}MB → ${(after / 1024).toFixed(0)}KB`)
      }
    } catch (e) {
      failed += 1
      const msg = `${job.row.id}: ${e instanceof Error ? e.message : String(e)}`
      if (failures.length < 15) failures.push(msg)
    }
  }

  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
      while (cursor < work.length) {
        const job = work[cursor]; cursor += 1
        await run(job)
      }
    }),
  )

  console.log(`\n${"=".repeat(56)}`)
  console.log(`  converted : ${done}`)
  console.log(`  failed    : ${failed}`)
  if (failures.length) console.log(failures.map((f) => `    ✗ ${f}`).join("\n"))
  if (before && done) {
    console.log(`  bytes     : ${(before / 1048576).toFixed(1)}MB → ${(after / 1024).toFixed(0)}KB  (−${((1 - after / before) * 100).toFixed(1)}%)`)
    console.log(`  avg tile  : ${(before / done / 1024).toFixed(0)}KB → ${(after / done / 1024).toFixed(0)}KB per garment`)
  }
  console.log(`\n  image_url untouched. Revert: UPDATE products SET thumbnail_url = NULL WHERE ...`)
}

main().catch((e) => { console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1) })
