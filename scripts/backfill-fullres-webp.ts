/**
 * Add a full-resolution WebP sibling for every product's garment cut-out, and point
 * products.image_url at it.
 *
 *   bun run scripts/backfill-fullres-webp.ts             # dry run: counts + sampled size estimate
 *   bun run scripts/backfill-fullres-webp.ts --apply
 *   bun run scripts/backfill-fullres-webp.ts --apply --limit 20
 *
 * image_url is the image WORN on the mannequin — loaded at full size on every try-on, 1.4-2.5MB of
 * PNG each. thumbnail_url already covers grid tiles at 400px; that thumbnail can NOT be worn,
 * because shrinking the texture amplifies every warp offset by the same factor.
 *
 * ── Safety ──
 *
 *  · Format-only, at IDENTICAL dimensions, asserted per image before upload. The placement transform
 *    and its 88-point warp lattice are both measured in this image's own pixel space, so a re-encode
 *    is invisible to that maths and a resize would deform every garment ever placed.
 *  · The original is never deleted or overwritten — a `.fullres.webp` sibling is added beside it.
 *    `.webp` alone is already taken by the 400px thumbnail, hence the distinct suffix.
 *  · Reverting is one UPDATE putting the original extension back; the bytes are still there.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js"

const QUALITY = 90
const CONCURRENCY = 8
const SUFFIX = ".fullres.webp"
const SAMPLE = 12

type Row = { id: string; image_url: string | null }

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

/**
 * Bucket + object path, derived from the URL rather than hardcoded: these images live in at least
 * two buckets (ingested_inventory and ingestion-automated), and a converter pinned to one silently
 * skips the other's products.
 */
function parsePublicUrl(url: string, base: string) {
  const marker = `${base}/storage/v1/object/public/`
  if (!url.startsWith(marker)) return null
  const rest = url.slice(marker.length).split("?")[0]
  const slash = rest.indexOf("/")
  if (slash <= 0) return null
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apply = Boolean(args.get("apply"))
  const limArg = args.get("limit")
  const limit = limArg && limArg !== true ? Number(limArg) : Infinity

  const base = requireEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "")
  const supabase = createClient(base, requireEnv("SUPABASE_SERVICE_ROLE_KEY"))
  const sharp = (await import("sharp")).default

  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("products").select("id,image_url").range(from, from + 999)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as Row[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }

  const todo: { row: Row; bucket: string; path: string; outPath: string; outUrl: string }[] = []
  let already = 0
  let skipped = 0
  for (const row of rows) {
    const url = row.image_url ?? ""
    if (!url) { skipped += 1; continue }
    if (url.includes(SUFFIX)) { already += 1; continue }
    const p = parsePublicUrl(url, base)
    if (!p) { skipped += 1; continue }
    const outPath = p.path.replace(/\.[a-zA-Z0-9]+$/, SUFFIX)
    todo.push({
      row, bucket: p.bucket, path: p.path, outPath,
      outUrl: `${base}/storage/v1/object/public/${p.bucket}/${outPath}`,
    })
  }

  const byBucket: Record<string, number> = {}
  for (const t of todo) byBucket[t.bucket] = (byBucket[t.bucket] ?? 0) + 1
  console.log(`\n${rows.length} products · ${already} already converted · ${skipped} no usable image_url`)
  console.log(`${todo.length} to convert  ${JSON.stringify(byBucket)}`)

  if (!apply) {
    console.log(`\nDRY RUN — sampling ${SAMPLE} to estimate…`)
    let b = 0, a = 0, n = 0
    for (const job of todo.slice(0, SAMPLE)) {
      const dl = await supabase.storage.from(job.bucket).download(job.path)
      if (dl.error) continue
      const src = Buffer.from(await dl.data.arrayBuffer())
      const out = await sharp(src).webp({ quality: QUALITY, alphaQuality: 100, effort: 5 }).toBuffer()
      b += src.length; a += out.length; n += 1
    }
    if (n) {
      const ratio = a / b
      console.log(`  sampled ${n}: ${(b / 1048576).toFixed(1)}MB → ${(a / 1024).toFixed(0)}KB (−${((1 - ratio) * 100).toFixed(0)}%)`)
      console.log(`  projected for ${todo.length}: ~${((b / n) * todo.length / 1073741824).toFixed(2)}GB → ~${((a / n) * todo.length / 1048576).toFixed(0)}MB`)
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

      const sm = await sharp(src).metadata()
      const out = await sharp(src).webp({ quality: QUALITY, alphaQuality: 100, effort: 5 }).toBuffer()
      const om = await sharp(out).metadata()
      // Hard stop, not a warning: a size change here misplaces the garment on every avatar it has
      // ever been placed on, and nothing downstream would flag it.
      if (sm.width !== om.width || sm.height !== om.height) {
        throw new Error(`dimensions ${sm.width}x${sm.height} -> ${om.width}x${om.height}`)
      }

      const up = await supabase.storage
        .from(job.bucket)
        .upload(job.outPath, out, { contentType: "image/webp", upsert: true })
      if (up.error) throw new Error(`upload: ${up.error.message}`)

      const upd = await supabase.from("products").update({ image_url: job.outUrl }).eq("id", job.row.id)
      if (upd.error) throw new Error(`update: ${upd.error.message}`)

      before += src.length; after += out.length; done += 1
      if (done % 50 === 0 || done === work.length) {
        console.log(`  ${String(done).padStart(4)}/${work.length}  ${(before / 1073741824).toFixed(2)}GB → ${(after / 1048576).toFixed(0)}MB`)
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
  if (before) {
    console.log(`  bytes     : ${(before / 1073741824).toFixed(2)}GB → ${(after / 1048576).toFixed(0)}MB  (−${((1 - after / before) * 100).toFixed(1)}%)`)
    console.log(`  avg worn  : ${(before / done / 1024).toFixed(0)}KB → ${(after / done / 1024).toFixed(0)}KB per garment`)
  }
  console.log(`\n  Originals untouched. Revert: UPDATE products SET image_url = replace(image_url, '${SUFFIX}', '.png')`)
}

main().catch((e) => { console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1) })
