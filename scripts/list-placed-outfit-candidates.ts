/**
 * Find already-placed products for the landing page mini studio, and emit them as demo data.
 *
 * The mini studio can only draw on the photoreal mannequin when every garment on the body carries a
 * `placement` entry for that mannequin. Nothing on the landing page had one, so the demo was stuck
 * on the legacy SVG avatar. Rather than hand-placing garments in the mesh editor, this pulls
 * products out of the catalog that the pipeline has ALREADY placed.
 *
 *   bun run scripts/list-placed-outfit-candidates.ts --list [--filter kurta,saree]
 *   bun run scripts/list-placed-outfit-candidates.ts --emit <topId>,<bottomId> --gender female
 *   bun run scripts/list-placed-outfit-candidates.ts --emit-alternates --gender female [--limit 24]
 *
 * Zones are top + bottom + shoes. Shoes were omitted while no pair was 3D-placed for male; the
 * pipeline has since placed 23 for female and 6 for male. Note the catalog still holds no ethnic
 * footwear — every placed male pair is a sneaker — so the shoe filter is deliberately left off the
 * ethnic term list, or no gender would fill the slot.
 *
 * 2D placement (placement_x / placement_y / image_length) is NOT required. It gates the legacy SVG
 * renderer, and the demo no longer falls back to it — every garment it can show, default or
 * alternate, is 3D-placed. Requiring it would exclude essentially the whole ethnic range, which went
 * straight to 3D: 45 female tops have 3D, exactly 1 also has 2D.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

type Zone = "top" | "bottom" | "shoes"
type Gender = "male" | "female"

const ZONES: Zone[] = ["top", "bottom", "shoes"]
const OUT_DIR = path.join(process.cwd(), "public", "landing-outfits")

type PlacementEntry = { tx?: number; ty?: number; scale?: number; rotationDeg?: number; warp?: unknown }

type Row = {
  id: string
  product_name: string | null
  brand: string | null
  price: number | null
  currency: string | null
  image_url: string | null
  thumbnail_url: string | null
  gender: string | null
  type: string | null
  placement: Record<string, PlacementEntry> | null
  placement_x: number | null
  placement_y: number | null
  image_length: number | null
  body_parts_visible: unknown
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      args.set(key, true)
    } else {
      args.set(key, next)
      i += 1
    }
  }
  return args
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined)
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

/**
 * Mirrors readEntry() in src/features/studio/mappers/renderedItemMapper.ts — same key shape
 * ("male:bodytype1") and the same "scale/tx/ty must all be numbers" bar. If that mapper rejects an
 * entry the renderer will too, so a candidate this accepts but the app doesn't would be worse than
 * useless.
 */
function read3D(placement: Row["placement"], mannequin: Gender) {
  if (!placement || typeof placement !== "object") return null
  const entry = placement[`${mannequin}:bodytype1`]
  if (!entry || typeof entry.scale !== "number" || typeof entry.tx !== "number" || typeof entry.ty !== "number") {
    return null
  }
  const warp = Array.isArray(entry.warp)
    ? (entry.warp as unknown[]).filter(
        (w): w is { x: number; y: number } =>
          !!w && typeof (w as { x?: unknown }).x === "number" && typeof (w as { y?: unknown }).y === "number",
      )
    : []
  return { scale: entry.scale, rotationDeg: entry.rotationDeg ?? 0, tx: entry.tx, ty: entry.ty, warp, mannequin }
}

function normalizeZone(type: string | null): Zone | null {
  const t = (type ?? "").toLowerCase()
  return ZONES.includes(t as Zone) ? (t as Zone) : null
}

function normalizeGender(g: string | null): Gender | null {
  const v = (g ?? "").toLowerCase()
  if (v.startsWith("m")) return "male"
  if (v.startsWith("f") || v.startsWith("w")) return "female"
  return null
}

function matchesFilter(row: Row, terms: string[]): boolean {
  if (!terms.length) return true
  const hay = `${row.product_name ?? ""} ${row.brand ?? ""}`.toLowerCase()
  return terms.some((t) => hay.includes(t))
}

async function fetchRows(supabase: ReturnType<typeof createClient>): Promise<Row[]> {
  const columns =
    "id,product_name,brand,price,currency,image_url,thumbnail_url,gender,type,placement,placement_x,placement_y,image_length,body_parts_visible"
  const rows: Row[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select(columns)
      .not("placement", "is", null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`products query failed: ${error.message}`)
    const batch = (data ?? []) as unknown as Row[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

function bucket(rows: Row[], terms: string[]) {
  const byGenderZone = new Map<string, Row[]>()
  for (const row of rows) {
    const zone = normalizeZone(row.type)
    const gender = normalizeGender(row.gender)
    if (!zone || !gender) continue
    if (!row.image_url) continue
    if (!read3D(row.placement, gender)) continue
    if (!matchesFilter(row, terms)) continue
    const key = `${gender}:${zone}`
    if (!byGenderZone.has(key)) byGenderZone.set(key, [])
    byGenderZone.get(key)!.push(row)
  }
  return byGenderZone
}

function runList(rows: Row[], terms: string[]) {
  const buckets = bucket(rows, terms)
  const cap = terms.length ? 40 : 12
  console.log(`\nScanned ${rows.length} products carrying a placement map.`)
  if (terms.length) console.log(`Filtering on: ${terms.join(", ")}`)
  console.log()

  for (const gender of ["female", "male"] as Gender[]) {
    const counts = ZONES.map((z) => buckets.get(`${gender}:${z}`)?.length ?? 0)
    console.log(`── ${gender.toUpperCase()} ── top:${counts[0]} bottom:${counts[1]} shoes:${counts[2]}`)
    if (counts.some((c) => c === 0)) {
      console.log(`   ⚠ INCOMPLETE — ${gender} is missing a zone.\n`)
      continue
    }
    for (const zone of ZONES) {
      const list = buckets.get(`${gender}:${zone}`) ?? []
      console.log(`\n   ${zone} (${list.length}):`)
      for (const r of list.slice(0, cap)) {
        const warpN = read3D(r.placement, gender)?.warp.length ?? 0
        console.log(
          `     ${r.id}  ${(r.brand ?? "—").padEnd(22).slice(0, 22)}  ${(r.product_name ?? "—").slice(0, 44)}` +
            `   [${warpN ? `warp:${warpN}pts` : "affine-only"}]`,
        )
      }
      if (list.length > cap) console.log(`     … ${list.length - cap} more`)
    }
    console.log()
  }
}

/**
 * Fetch a garment cut-out and re-encode it as WebP at its ORIGINAL dimensions.
 *
 * Format-only, deliberately — no resizing. These are worn on the mannequin, and two things are
 * measured in source-texture pixels: the placement transform, and the 88-point warp lattice, whose
 * offsets are added straight onto mesh vertices. Scale the image and the warp silently deforms the
 * garment by the same factor. A thumbnail is doubly wrong here for the same reason, which is why
 * renderedItemMapper calls thumbnail_url "display-only".
 *
 * Lossless would keep the alpha mathematically exact but barely beats PNG; these are photographs of
 * cloth displayed ~360px wide, so lossy at a high quality is invisible and roughly an order of
 * magnitude smaller. WebP carries the alpha channel either way, which is what the cut-out needs.
 */
async function download(url: string, dest: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`)
  const src = Buffer.from(await res.arrayBuffer())

  const sharp = (await import("sharp")).default
  const meta = await sharp(src).metadata()
  // Already WebP (the catalog backfill converted image_url), so copy the bytes rather than
  // re-encoding — a second lossy pass over a lossy source loses quality for nothing.
  const out =
    meta.format === "webp"
      ? src
      : await sharp(src).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer()
  fs.writeFileSync(dest, out)

  return { before: src.length, after: out.length, width: meta.width, height: meta.height }
}

/** One product literal. `local` swaps the remote URL for a cached copy under /landing-outfits. */
function productLiteral(r: Row, gender: Gender, indent: string, local?: string, wornLocal?: string): string {
  const p = read3D(r.placement, gender)!
  const zone = normalizeZone(r.type)!
  const bpv = Array.isArray(r.body_parts_visible) ? r.body_parts_visible : []
  const i = indent
  return (
    `${i}{\n` +
    `${i}  id: ${JSON.stringify(r.id)},\n` +
    `${i}  type: "${zone}" as const,\n` +
    `${i}  brand: ${JSON.stringify(r.brand ?? "")},\n` +
    `${i}  price: ${r.price ?? 0},\n` +
    `${i}  currency: ${JSON.stringify(r.currency ?? "INR")},\n` +
    `${i}  imageUrl: ${JSON.stringify(wornLocal ?? (local ? `/landing-outfits/${local}` : r.image_url))},\n` +
    // Grid tiles only. The mannequin must keep imageUrl — see renderedItemMapper: the placement
    // transform is measured against the full image, so wearing a 400px thumbnail would shift the
    // garment and misapply the warp.
    `${i}  thumbnailUrl: ${JSON.stringify(r.thumbnail_url ?? null)},\n` +
    `${i}  productName: ${JSON.stringify(r.product_name ?? "")},\n` +
    // Legacy 2D fields are required by the type but unused: the demo never falls back to the SVG
    // renderer now, and most of this catalog has no 2D placement to carry anyway.
    `${i}  placementX: ${r.placement_x ?? 0},\n` +
    `${i}  placementY: ${r.placement_y ?? 0},\n` +
    `${i}  imageLengthCm: ${r.image_length ?? 0},\n` +
    `${i}  gender: "${gender}" as const,\n` +
    `${i}  bodyPartsVisible: ${JSON.stringify(bpv)} as MannequinSegmentName[],\n` +
    `${i}  placement: {\n` +
    `${i}    ${gender}: {\n` +
    `${i}      scale: ${p.scale},\n` +
    `${i}      rotationDeg: ${p.rotationDeg},\n` +
    `${i}      tx: ${p.tx},\n` +
    `${i}      ty: ${p.ty},\n` +
    `${i}      warp: ${JSON.stringify(p.warp)},\n` +
    `${i}      mannequin: "${gender}" as const,\n` +
    `${i}    },\n` +
    `${i}  },\n` +
    `${i}},`
  )
}

async function runEmit(rows: Row[], ids: string[], gender: Gender) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const picked = {} as Record<Zone, Row>

  for (const id of ids) {
    const row = byId.get(id)
    if (!row) throw new Error(`id not found among placed products: ${id}`)
    const zone = normalizeZone(row.type)
    if (!zone) throw new Error(`product ${id} has unusable type "${row.type}"`)
    if (!read3D(row.placement, gender)) throw new Error(`product ${id} has no 3D placement for ${gender}`)
    picked[zone] = row
  }
  for (const zone of ZONES) {
    if (!picked[zone]) throw new Error(`no ${zone} supplied — need one id per zone (${ZONES.join(", ")})`)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const parts: string[] = []
  for (const zone of ZONES) {
    const r = picked[zone]
    const file = `${gender}-${zone}.webp`
    // Cached locally because the default outfit must render with no network — the demo card is
    // above the fold and the page is deliberately offline-capable.
    const { before, after, width, height } = await download(r.image_url!, path.join(OUT_DIR, file))
    const saved = ((1 - after / before) * 100).toFixed(0)
    console.error(
      `  ↓ ${file.padEnd(20)} ${width}x${height}  ${(before / 1024).toFixed(0)}KB → ` +
        `${(after / 1024).toFixed(0)}KB  (−${saved}%)  ← ${r.id}`,
    )
    // `file`, not the remote URL — the whole point of downloading is that the default outfit
    // renders with no network. Emitting the Supabase URL here would download the image and then
    // never use it, silently forfeiting the offline load.
    parts.push(`  ${zone}: ` + productLiteral(r, gender, "  ", file).trimStart().replace(/,$/, "") + ",")
  }

  const constName = gender === "male" ? "MOCK_OUTFIT_ITEMS_MALE" : "MOCK_OUTFIT_ITEMS_FEMALE"
  console.log(`\nexport const ${constName}: OutfitItems = {`)
  console.log(parts.join("\n"))
  console.log(`}`)
}

/**
 * Alternates are WORN when selected, so their image goes through the same maths as the default
 * outfit: the placement transform and the warp lattice are measured in the source image's own pixel
 * space. The `.webp` sibling in storage is a 400px thumbnail — right for the grid tile, and wrong
 * here, because shrinking a 768x1344 texture to 229x400 amplifies every warp offset by 3.4x.
 *
 * So each worn image is cached locally as a full-resolution WebP, exactly as the default outfits
 * are. Format-only, dimensions asserted unchanged. Storage and the database are untouched.
 */
async function runEmitAlternates(rows: Row[], gender: Gender, limit: number, terms: string[]) {
  const buckets = bucket(rows, terms)
  const sharp = (await import("sharp")).default
  const dir = path.join(process.cwd(), "public", "landing-alternates")
  fs.mkdirSync(dir, { recursive: true })

  const out: string[] = []
  let before = 0
  let after = 0
  for (const zone of ZONES) {
    const list = (buckets.get(`${gender}:${zone}`) ?? []).slice(0, limit)
    console.error(`  ${gender} ${zone}: ${list.length}`)
    for (const r of list) {
      const file = `${r.id}.webp`
      try {
        const res = await fetch(r.image_url!)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const src = Buffer.from(await res.arrayBuffer())
        const srcMeta = await sharp(src).metadata()
        const buf =
          srcMeta.format === "webp"
            ? src
            : await sharp(src).webp({ quality: 90, alphaQuality: 100, effort: 5 }).toBuffer()
        const outMeta = await sharp(buf).metadata()
        if (srcMeta.width !== outMeta.width || srcMeta.height !== outMeta.height) {
          throw new Error(`dimension change ${srcMeta.width}x${srcMeta.height} -> ${outMeta.width}x${outMeta.height}`)
        }
        fs.writeFileSync(path.join(dir, file), buf)
        before += src.length
        after += buf.length
        out.push(productLiteral(r, gender, "  ", undefined, `/landing-alternates/${file}`))
      } catch (e) {
        console.error(`    ✗ ${r.id}: ${e instanceof Error ? e.message : String(e)} — keeping remote url`)
        out.push(productLiteral(r, gender, "  "))
      }
    }
  }
  if (before) {
    console.error(
      `  worn images: ${(before / 1048576).toFixed(1)}MB → ${(after / 1024).toFixed(0)}KB ` +
        `(−${((1 - after / before) * 100).toFixed(0)}%)`,
    )
  }
  const constName = gender === "male" ? "MOCK_ALTERNATIVES_MALE" : "MOCK_ALTERNATIVES_FEMALE"
  console.log(`\nexport const ${constName}: LandingMockProduct[] = [`)
  console.log(out.join("\n"))
  console.log(`]`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabase = createClient(
    requireEnv("SUPABASE_URL", "VITE_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  )
  const rows = await fetchRows(supabase)

  const filter = args.get("filter")
  const terms =
    filter && filter !== true
      ? String(filter).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : []

  const gender = normalizeGender(String(args.get("gender") ?? ""))

  if (args.get("emit-alternates")) {
    if (!gender) throw new Error("--emit-alternates requires --gender male|female")
    const limitArg = args.get("limit")
    await runEmitAlternates(rows, gender, limitArg && limitArg !== true ? Number(limitArg) : 24, terms)
    return
  }

  const emit = args.get("emit")
  if (emit && emit !== true) {
    if (!gender) throw new Error("--emit requires --gender male|female")
    await runEmit(rows, String(emit).split(",").map((s) => s.trim()).filter(Boolean), gender)
    return
  }

  runList(rows, terms)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
