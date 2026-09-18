/**
 * Bundles optimised local copies of the garment cut-outs behind the landing page's ten curated
 * looks (the tops and bottoms referenced by LANDING_LOOKS, plus the shoes), so the landing page
 * renders those looks from src/assets/landing-looks/ instead of fetching full-res product images
 * at runtime. Re-run it whenever LANDING_LOOKS/LANDING_TOPS/LANDING_BOTTOMS/LANDING_SHOES change
 * in landingInventory.ts, or a referenced product's image is replaced in the catalog.
 *
 *   bun scripts/build-landing-looks.ts
 *
 * Env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Bun loads .env automatically).
 */
import fs from "node:fs"
import path from "node:path"
import {
  LANDING_TOPS,
  LANDING_BOTTOMS,
  LANDING_SHOES,
  LANDING_LOOKS,
} from "../src/features/landing-page/landingInventory.ts"

const OUT_DIR = path.join(process.cwd(), "src", "assets", "landing-looks")
/** Longer edge of the emitted canvas; product cut-outs are laid out at well under this on the landing page. */
const LONG_EDGE = 1024

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

type Row = { id: string; image_url: string | null }

async function main() {
  const supabaseUrl = requireEnv("VITE_SUPABASE_URL")
  const anonKey = requireEnv("VITE_SUPABASE_ANON_KEY")
  const sharp = (await import("sharp")).default

  const ids = new Set<string>()
  for (const [topIndex, bottomIndex] of LANDING_LOOKS) {
    ids.add(LANDING_TOPS[topIndex].id)
    ids.add(LANDING_BOTTOMS[bottomIndex].id)
  }
  ids.add(LANDING_SHOES.id)
  const idList = [...ids]

  const res = await fetch(
    `${supabaseUrl}/rest/v1/products?select=id,image_url&id=in.(${idList.join(",")})`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  if (!res.ok) throw new Error(`Supabase REST fetch failed: ${res.status} ${await res.text()}`)
  const rows = (await res.json()) as Row[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const missing = idList.filter((id) => !byId.get(id)?.image_url)
  if (missing.length > 0) throw new Error(`No image_url found for ids: ${missing.join(", ")}`)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const rowsOut: {
    id: string
    srcBytes: number
    srcW: number
    srcH: number
    outBytes: number
    outW: number
    outH: number
  }[] = []
  let totalBefore = 0
  let totalAfter = 0

  for (const id of idList) {
    const imageUrl = byId.get(id)!.image_url!
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Download failed for ${id}: ${imgRes.status}`)
    const src = Buffer.from(await imgRes.arrayBuffer())
    const srcMeta = await sharp(src).metadata()

    const out = await sharp(src)
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100, effort: 6 })
      .toBuffer()
    const outMeta = await sharp(out).metadata()

    fs.writeFileSync(path.join(OUT_DIR, `${id}.webp`), out)

    totalBefore += src.length
    totalAfter += out.length
    rowsOut.push({
      id,
      srcBytes: src.length,
      srcW: srcMeta.width ?? 0,
      srcH: srcMeta.height ?? 0,
      outBytes: out.length,
      outW: outMeta.width ?? 0,
      outH: outMeta.height ?? 0,
    })
  }

  // Stale files from a previous inventory (a swapped-out look, a removed garment) would otherwise
  // linger in the folder and get bundled for nothing.
  const keep = new Set(idList.map((id) => `${id}.webp`))
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (!keep.has(file)) fs.rmSync(path.join(OUT_DIR, file))
  }

  const fmt = (n: number) => `${(n / 1024).toFixed(0)}KB`
  console.log(
    "id".padEnd(42) +
      "orig bytes".padStart(11) +
      "orig WxH".padStart(12) +
      "out bytes".padStart(11) +
      "out WxH".padStart(12),
  )
  for (const r of rowsOut) {
    console.log(
      r.id.padEnd(42) +
        fmt(r.srcBytes).padStart(11) +
        `${r.srcW}x${r.srcH}`.padStart(12) +
        fmt(r.outBytes).padStart(11) +
        `${r.outW}x${r.outH}`.padStart(12),
    )
  }
  console.log(
    "TOTAL".padEnd(42) +
      fmt(totalBefore).padStart(11) +
      "".padStart(12) +
      fmt(totalAfter).padStart(11),
  )
  console.log(`${rowsOut.length} files written to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
