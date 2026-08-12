/**
 * Record, on every stored placement entry, the size of the garment image its warp lattice was
 * authored against.
 *
 *   bun run scripts/backfill-placement-ref-size.ts              # dry run
 *   bun run scripts/backfill-placement-ref-size.ts --apply
 *   bun run scripts/backfill-placement-ref-size.ts --apply --limit 20
 *   bun run scripts/backfill-placement-ref-size.ts --apply --ids <id>,<id>   # just these products
 *
 * ── Why ──
 *
 * The 88 warp offsets are ABSOLUTE PIXELS in the space of the image the lattice was drawn on. A
 * renderer showing the garment at another resolution — a gallery tile textured with the 400px
 * thumbnail, say — must scale them by texW / refW, and it cannot derive that factor on its own: a
 * 234x400 texture looks identical whether the offsets were measured at 768 or 2048 wide. Without
 * refW a 165px fold authored on a 1200px image becomes a 70% displacement on the thumbnail and the
 * garment tears apart.
 *
 * `scale`, `tx` and `ty` need no equivalent — the renderer's `fit` factor comes from the loaded
 * texture and already self-compensates for resolution.
 *
 * ── Safety ──
 *
 *  · Additive only. Existing keys are never modified; entries that already carry refW are skipped.
 *  · A missing refW means "assume the texture is the authored size", i.e. exactly today's
 *    behaviour, so a partial run is safe and can be resumed.
 *  · refW is read from products.image_url — the image the mesh editor loads, hence the one the
 *    lattice was authored against.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
const CONCURRENCY = 8

type Entry = Record<string, unknown>
type Row = { id: string; image_url: string | null; placement: Record<string, Entry> | null }

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
 * Dimensions of a PNG from its IHDR, which lives at a fixed offset — so a 24-byte Range request
 * replaces downloading a 1-5MB image. Returns null for anything that is not a PNG; the caller then
 * falls back to a full fetch.
 */
async function pngSizeViaRange(url: string): Promise<{ w: number; h: number } | null> {
  const res = await fetch(url, { headers: { Range: "bytes=0-23" } })
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 24) return null
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (!isPng || buf.subarray(12, 16).toString("ascii") !== "IHDR") return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

async function imageSize(url: string, sharp: typeof import("sharp")): Promise<{ w: number; h: number } | null> {
  const quick = await pngSizeViaRange(url).catch(() => null)
  if (quick) return quick
  const res = await fetch(url)
  if (!res.ok) return null
  const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
  return m.width && m.height ? { w: m.width, h: m.height } : null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apply = Boolean(args.get("apply"))
  const limArg = args.get("limit")
  const limit = limArg && limArg !== true ? Number(limArg) : Infinity
  const idsArg = args.get("ids")
  // Narrow to specific products — how you try this on a couple of known items before the catalog.
  const only = idsArg && idsArg !== true ? new Set(idsArg.split(",").map((s) => s.trim()).filter(Boolean)) : null

  const base = requireEnv("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "")
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  const sharp = (await import("sharp")).default
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }

  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${base}/rest/v1/products?select=id,image_url,placement`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    })
    if (!res.ok) throw new Error(`fetch products: ${res.status} ${await res.text()}`)
    const page = (await res.json()) as Row[]
    rows.push(...page)
    if (page.length < 1000) break
  }

  const todo = rows.filter((r) => {
    if (only && !only.has(r.id)) return false
    if (!r.image_url || !r.placement || typeof r.placement !== "object") return false
    // Something to do only if at least one entry lacks refW.
    return Object.values(r.placement).some((e) => e && typeof e === "object" && !(e as Entry).refW)
  })

  const withPlacement = rows.filter((r) => r.placement && Object.keys(r.placement).length).length
  console.log(`\n${rows.length} products · ${withPlacement} with a placement · ${todo.length} needing refW`)
  if (only) console.log(`restricted to ${only.size} id(s) via --ids`)

  if (!apply) {
    console.log(`\nDRY RUN — sampling 5 to show what would be written…`)
    for (const r of todo.slice(0, 5)) {
      const size = await imageSize(r.image_url!, sharp)
      console.log(`  ${r.id.slice(0, 12)}  keys=[${Object.keys(r.placement!).join(",")}]  ->  refW=${size?.w} refH=${size?.h}`)
    }
    console.log(`\n  Nothing written. Re-run with --apply.`)
    return
  }

  const work = todo.slice(0, limit === Infinity ? todo.length : limit)
  console.log(`\nAPPLYING to ${work.length}…\n`)
  let done = 0, failed = 0, skipped = 0
  const failures: string[] = []

  async function run(r: Row) {
    try {
      const size = await imageSize(r.image_url!, sharp)
      if (!size) { skipped += 1; return }

      const next: Record<string, Entry> = {}
      let changed = false
      for (const [k, e] of Object.entries(r.placement!)) {
        if (!e || typeof e !== "object") { next[k] = e; continue }
        if ((e as Entry).refW) { next[k] = e; continue }
        next[k] = { ...e, refW: size.w, refH: size.h }
        changed = true
      }
      if (!changed) { skipped += 1; return }

      // Both tables share the deterministic product id; the PATCH is a no-op on whichever lacks it.
      for (const table of ["products", "ingested_products"] as const) {
        const res = await fetch(`${base}/rest/v1/${table}?id=eq.${r.id}`, {
          method: "PATCH",
          headers: H,
          body: JSON.stringify({ placement: next }),
        })
        if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 120)}`)
      }

      done += 1
      if (done % 50 === 0 || done === work.length) console.log(`  ${String(done).padStart(4)}/${work.length}`)
    } catch (e) {
      failed += 1
      if (failures.length < 15) failures.push(`${r.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
      while (cursor < work.length) {
        const r = work[cursor]; cursor += 1
        await run(r)
      }
    }),
  )

  console.log(`\n${"=".repeat(50)}`)
  console.log(`  updated : ${done}`)
  console.log(`  skipped : ${skipped}  (unreadable image, or already had refW)`)
  console.log(`  failed  : ${failed}`)
  if (failures.length) console.log(failures.map((f) => `    x ${f}`).join("\n"))
  console.log(`\n  Additive only — no existing key was modified. Revert is not needed; a renderer`)
  console.log(`  ignoring refW behaves exactly as before.`)
}

main().catch((e) => { console.error(`\nx ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1) })
