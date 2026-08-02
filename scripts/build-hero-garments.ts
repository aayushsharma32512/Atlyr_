/**
 * Rebuild the floating garments that orbit the landing page's demo card.
 *
 * They were stock Western pieces (blazer, leather jacket, loafers) left over from before the
 * rebrand, which read oddly around a card demoing Indian ethnic wear. This swaps in real catalog
 * cut-outs and writes them to public/landing-hero/.
 *
 *   bun run scripts/build-hero-garments.ts
 *
 * ── Why every image is padded to a fixed per-slot aspect ratio ──
 *
 * The layout in constants.ts sets a WIDTH per slot, so each image's height falls out of its aspect
 * ratio. The original photos were flat-shot tops, near square (0.88-1.15), with trousers at ~0.57.
 * Ethnic kurtas are 0.42-0.57 — at the same width they render roughly twice as tall as the tops
 * they replaced, which is what made the right-hand garments collide.
 *
 * So each garment is trimmed to its opaque bounds, then centred on a transparent canvas cut to the
 * aspect ratio of the ORIGINAL image in that slot. Every slot then occupies exactly the box it did
 * before, and the composition is unchanged — only the clothes differ. Candidates are matched to
 * slots by closest natural aspect so the padding stays small and garments render as large as the
 * slot allows.
 *
 * Trimming and padding are safe here only because nothing is composited onto a mannequin: no
 * placement transform or warp lattice is measured against these pixels, unlike the worn garments in
 * landingMockProducts, which must keep their original dimensions.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const OUT_DIR = path.join(process.cwd(), "public", "landing-hero")
/** Longest edge of the emitted canvas. Slots render <=180px wide, so this is generous for retina. */
const CANVAS_LONG_EDGE = 560

/** Terms that reliably indicate Indian ethnic wear in this catalog's product names. */
const ETHNIC = [
  "kurta", "kurti", "saree", "lehenga", "salwar", "churidar", "anarkali", "palazzo",
  "sharara", "chikankari", "bandhani", "ajrakh", "block print", "ethnic", "dupatta",
  "pathani", "angrakha", "handloom", "trouser", "pyjama",
]

/**
 * One-piece and dress-length cuts. They hang as wide as they are long, so whatever box they land in
 * they read as a dress rather than as a separate — which is exactly the note on the first build.
 */
const EXCLUDE = [
  "kaftan", "dress", "jumpsuit", "gown", "set of 2", "kurta set", "peplum", "co-ord",
  // Rejected on sight in review:
  "boxy top",                     // the cut-out carries a printed brand watermark
  "dark green cotton printed",    // catalog mismatch — the name says kurta, the photo is a white shirt
]

/**
 * The nine slots, VERBATIM from the pre-rebrand layout — same positions, same width classes, same
 * breakpoints. `ratio` is the aspect of the original image that used to sit there; padding each new
 * garment to it reproduces the old bounding box exactly.
 */
const SLOTS: {
  zone: "top" | "bottom"
  ratio: number
  /** Force a gender for this slot; otherwise the pool alternates. */
  gender?: "male" | "female"
  className: string
  style: { top: string; left: string }
}[] = [
  { zone: "top",    ratio: 0.98, className: "hidden lg:block w-[160px] xl:w-[180px]", style: { top: "14%", left: "1%" } },
  { zone: "top",    ratio: 0.90, gender: "female", className: "hidden lg:block w-[140px] xl:w-[160px]", style: { top: "58%", left: "2%" } },
  { zone: "bottom", ratio: 0.56, className: "hidden xl:block w-[120px]",              style: { top: "25%", left: "25%" } },
  { zone: "top",    ratio: 1.09, gender: "female", className: "hidden lg:block w-[100px] xl:w-[100px]", style: { top: "8%",  left: "90%" } },
  { zone: "top",    ratio: 0.88, className: "hidden lg:block w-[140px] xl:w-[140px]", style: { top: "2%",  left: "70%" } },
  // Slots 6 and 9 sit at nearly the same `left` with centres only 22% apart, and both images are
  // taller than that gap — they collided. Pushed apart vertically and offset horizontally; this is
  // the one place the layout deviates from the pre-rebrand positions, and deliberately.
  { zone: "top",    ratio: 0.98, className: "hidden xl:block w-[160px]",              style: { top: "72%", left: "77%" } },
  { zone: "bottom", ratio: 0.98, className: "hidden xl:block w-[100px]",              style: { top: "78%", left: "25%" } },
  { zone: "top",    ratio: 1.15, className: "hidden 2xl:block w-[150px]",             style: { top: "-12%", left: "18%" } },
  { zone: "bottom", ratio: 0.58, className: "hidden 2xl:block w-[120px]",             style: { top: "34%", left: "87%" } },
]

/** Candidates fetched per zone before matching. Each costs one download, so keep it modest. */
const POOL_PER_ZONE = 14

type Row = {
  id: string
  product_name: string | null
  brand: string | null
  image_url: string | null
  gender: string | null
  type: string | null
}

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? (fallback ? process.env[fallback] : undefined)
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const hay = (r: Row) => `${r.product_name ?? ""} ${r.brand ?? ""}`.toLowerCase()
const isEthnic = (r: Row) => ETHNIC.some((t) => hay(r).includes(t)) && !EXCLUDE.some((t) => hay(r).includes(t))
const genderOf = (r: Row) => {
  const v = (r.gender ?? "").toLowerCase()
  return v.startsWith("m") ? "male" : v.startsWith("f") || v.startsWith("w") ? "female" : null
}

async function main() {
  const supabase = createClient(
    requireEnv("SUPABASE_URL", "VITE_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  )
  const sharp = (await import("sharp")).default

  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id,product_name,brand,image_url,gender,type")
      .not("placement", "is", null)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as Row[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }

  // Alternate genders so the ring isn't all womenswear or all menswear.
  const pool: Record<"top" | "bottom", Row[]> = { top: [], bottom: [] }
  for (const zone of ["top", "bottom"] as const) {
    const all = rows.filter((r) => (r.type ?? "").toLowerCase() === zone && r.image_url && isEthnic(r))
    const f = all.filter((r) => genderOf(r) === "female")
    const m = all.filter((r) => genderOf(r) === "male")
    pool[zone] = Array.from({ length: Math.max(f.length, m.length) }, (_, i) => [f[i], m[i]])
      .flat()
      .filter(Boolean)
      .slice(0, POOL_PER_ZONE)
  }
  console.error(`pool: ${pool.top.length} tops, ${pool.bottom.length} bottoms`)

  // Download + trim once, so each candidate's true silhouette is known before assigning slots.
  type Cand = { row: Row; trimmed: Buffer; w: number; h: number; ratio: number; srcBytes: number }
  const cands: Record<"top" | "bottom", Cand[]> = { top: [], bottom: [] }
  for (const zone of ["top", "bottom"] as const) {
    for (const row of pool[zone]) {
      const res = await fetch(row.image_url!)
      if (!res.ok) continue
      const src = Buffer.from(await res.arrayBuffer())
      const trimmed = await sharp(src).trim({ threshold: 1 }).toBuffer()
      const m = await sharp(trimmed).metadata()
      if (!m.width || !m.height) continue
      cands[zone].push({ row, trimmed, w: m.width, h: m.height, ratio: m.width / m.height, srcBytes: src.length })
    }
  }

  // Wiped so stale garments from a previous run can't linger and be served.
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const used = new Set<string>()
  const out: string[] = []
  let before = 0
  let after = 0

  for (const [i, slot] of SLOTS.entries()) {
    // Closest natural aspect to the slot keeps padding minimal, so the garment fills as much of the
    // original box as it honestly can.
    const eligible = cands[slot.zone]
      .filter((c) => !used.has(c.row.id))
      .filter((c) => !slot.gender || genderOf(c.row) === slot.gender)
    const pick = eligible.sort((a, b) => Math.abs(a.ratio - slot.ratio) - Math.abs(b.ratio - slot.ratio))[0]
    if (!pick) throw new Error(`ran out of ${slot.zone} candidates at slot ${i + 1}`)
    used.add(pick.row.id)

    // Canvas cut to the slot's original aspect, garment centred inside it.
    const cw = slot.ratio >= 1 ? CANVAS_LONG_EDGE : Math.round(CANVAS_LONG_EDGE * slot.ratio)
    const ch = slot.ratio >= 1 ? Math.round(CANVAS_LONG_EDGE / slot.ratio) : CANVAS_LONG_EDGE

    const buf = await sharp(pick.trimmed)
      .resize({ width: cw, height: ch, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toBuffer()
    // Content hash in the name so a rebuild can never be served from browser cache. Swapping a
    // garment while keeping the filename is exactly how a stale image survives a refresh.
    const hash = crypto.createHash("md5").update(buf).digest("hex").slice(0, 8)
    const file = `${i + 1}-${slot.zone}-${hash}.webp`
    fs.writeFileSync(path.join(OUT_DIR, file), buf)

    before += pick.srcBytes
    after += buf.length
    console.error(
      `  ${file.padEnd(26)} slot ${slot.ratio.toFixed(2)} ← garment ${pick.ratio.toFixed(2)}  ` +
        `${cw}x${ch}  ${(buf.length / 1024).toFixed(0)}KB   ${(pick.row.product_name ?? "").slice(0, 38)}`,
    )

    out.push(
      `  {\n` +
        `    src: "/landing-hero/${file}",\n` +
        `    alt: ${JSON.stringify(pick.row.product_name ?? "Ethnic garment")},\n` +
        `    className: ${JSON.stringify(slot.className)},\n` +
        `    style: { top: ${JSON.stringify(slot.style.top)}, left: ${JSON.stringify(slot.style.left)} },\n` +
        `  },`,
    )
  }

  console.error(
    `\n  total ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB ` +
      `(−${((1 - after / before) * 100).toFixed(0)}%)\n`,
  )
  console.log(`export const heroGarments: HeroGarment[] = [`)
  console.log(out.join("\n"))
  console.log(`];`)
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
