/**
 * Bundles optimised local copies of the garment cut-outs behind the landing page's ten curated
 * looks (the tops and bottoms referenced by LANDING_LOOKS, plus the shoes), so the landing page
 * renders those looks from src/assets/landing-looks/ instead of fetching full-res product images
 * at runtime. It also bakes the raw database rows the opening look needs (its products, the
 * default female mannequin, and the active female hair styles) into first-look.json, so that look
 * can render with zero Supabase round-trips. Re-run it whenever
 * LANDING_LOOKS/LANDING_TOPS/LANDING_BOTTOMS/LANDING_SHOES change in landingInventory.ts, or a
 * referenced product's image is replaced in the catalog.
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
  LANDING_FIRST_LOOK_IDS,
} from "../src/features/landing-page/landingInventory.ts"

const OUT_DIR = path.join(process.cwd(), "src", "assets", "landing-looks")
const FIRST_LOOK_JSON = path.join(OUT_DIR, "first-look.json")
/** Longer edge of the emitted canvas; product cut-outs are laid out at well under this on the landing page. */
const LONG_EDGE = 1024

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

type Row = { id: string; image_url: string | null }

/** Fetches one Supabase REST endpoint and returns the parsed JSON rows, failing loudly on a non-2xx response. */
async function fetchRows(url: string, anonKey: string): Promise<unknown[]> {
  const res = await fetch(url, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } })
  if (!res.ok) throw new Error(`Supabase REST fetch failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as unknown[]
}

/** Bakes the opening look's product rows, default female mannequin, and active female hair styles into first-look.json. */
async function buildFirstLookJson(supabaseUrl: string, anonKey: string) {
  const productsUrl =
    `${supabaseUrl}/rest/v1/products?select=id,product_name,brand,price,image_url,thumbnail_url,` +
    `product_url,gender,type,type_category,placement_x,placement_y,image_length,placement,size,` +
    `currency,color,fit,feel,vibes,color_group,material_type,body_parts_visible` +
    `&id=in.(${LANDING_FIRST_LOOK_IDS.join(",")})`
  const productRows = (await fetchRows(productsUrl, anonKey)) as { id: string }[]
  const byId = new Map(productRows.map((r) => [r.id, r]))
  const missing = LANDING_FIRST_LOOK_IDS.filter((id) => !byId.has(id))
  if (missing.length > 0) throw new Error(`first-look.json: no product row for ids: ${missing.join(", ")}`)
  // Preserve LANDING_FIRST_LOOK_IDS order; Supabase's `in.()` filter does not guarantee row order.
  const products = LANDING_FIRST_LOOK_IDS.map((id) => byId.get(id)!)

  const mannequinUrl =
    `${supabaseUrl}/rest/v1/mannequin?select=id,gender,body_type,height_cm,default_scale,` +
    `segment_config,is_default,created_at,updated_at&gender=eq.female` +
    `&order=is_default.desc,updated_at.desc&limit=1`
  const mannequinRows = await fetchRows(mannequinUrl, anonKey)
  if (mannequinRows.length === 0) throw new Error("first-look.json: no default female mannequin row found")
  const mannequin = mannequinRows[0]

  const hairStylesUrl =
    `${supabaseUrl}/rest/v1/avatar_hair_styles?select=id,gender,style_key,asset_url,length_pct,` +
    `y_offset_pct,x_offset_pct,z_index,is_default,is_active,sort_order&gender=eq.female` +
    `&is_active=eq.true&order=sort_order.asc`
  const hairStyles = await fetchRows(hairStylesUrl, anonKey)

  fs.mkdirSync(path.dirname(FIRST_LOOK_JSON), { recursive: true })
  fs.writeFileSync(FIRST_LOOK_JSON, JSON.stringify({ products, mannequin, hairStyles }, null, 2))

  console.log(
    `first-look.json: ${products.length} products, ${hairStyles.length} hair styles, ` +
      `mannequin id=${(mannequin as { id: string }).id}`,
  )
}

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
  keep.add(path.basename(FIRST_LOOK_JSON))
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

  await buildFirstLookJson(supabaseUrl, anonKey)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
