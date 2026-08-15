/**
 * Give every product a `product_images` row that try-on can actually use.
 *
 *   bun run scripts/backfill-missing-product-images.ts            # dry run
 *   bun run scripts/backfill-missing-product-images.ts --apply
 *   bun run scripts/backfill-missing-product-images.ts --apply --limit 5
 *
 * ── Why ──
 *
 * tryon-generate-summary feeds Gemini the product's front image, and it finds that image through
 * supabase/functions/_shared/modelImages.ts :: getFrontImageCandidates — which only looks at
 * `product_images` rows with kind 'model' or 'flatlay' and vto_eligible = true. A product with no
 * such row returns E_NO_IMAGES (422), and because tryon-generate throws on a non-ok summary
 * response, one unusable garment fails the whole outfit's try-on.
 *
 * Products that come through the ingestion pipeline get these rows from syncImageRows. Products
 * inserted straight into `products` — an older seed/CSV path — never did, so their image exists in
 * storage and is on products.image_url, but nothing records that try-on may use it.
 *
 * This writes that missing record. It creates no image and uploads nothing.
 *
 * ── Safety ──
 *
 *  · Only touches products that currently have NO eligible row. Products already working are
 *    skipped, so nothing changes which image an existing try-on picks.
 *  · is_primary/sort_order are only claimed when the product has no rows at all; where rows exist
 *    but none are eligible, the new row is appended instead of displacing the current primary.
 *  · Additive — no existing row is modified or deleted. Revert is a DELETE of the rows this made.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
type Product = { id: string; image_url: string | null; gender: string | null; product_name: string | null; type: string | null }
type ImageRow = { product_id: string; kind: string | null; url: string | null; vto_eligible: boolean | null; sort_order: number | null }

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
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }

  async function page<T>(table: string, select: string): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${base}/rest/v1/${table}?select=${select}`, {
        headers: { ...H, Range: `${from}-${from + 999}` },
      })
      if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
      const rows = (await res.json()) as T[]
      out.push(...rows)
      if (rows.length < 1000) break
    }
    return out
  }

  const products = await page<Product>("products", "id,image_url,gender,product_name,type")
  const images = await page<ImageRow>("product_images", "product_id,kind,url,vto_eligible,sort_order")

  // Exactly the predicate getFrontImageCandidates uses.
  const eligible = new Set<string>()
  const rowsByProduct = new Map<string, ImageRow[]>()
  for (const r of images) {
    const list = rowsByProduct.get(r.product_id) ?? []
    list.push(r)
    rowsByProduct.set(r.product_id, list)
    if ((r.kind === "model" || r.kind === "flatlay") && r.vto_eligible === true && r.url) eligible.add(r.product_id)
  }

  const todo = products.filter((p) => !eligible.has(p.id) && p.image_url)
  const unfixable = products.filter((p) => !eligible.has(p.id) && !p.image_url)

  const byType: Record<string, number> = {}
  for (const p of todo) byType[p.type ?? "?"] = (byType[p.type ?? "?"] ?? 0) + 1

  console.log(`\n${products.length} products · ${eligible.size} already usable by try-on`)
  console.log(`${todo.length} to fix  ${JSON.stringify(byType)}`)
  if (unfixable.length) console.log(`${unfixable.length} cannot be fixed here — no image_url either`)

  function buildRow(p: Product) {
    const existing = rowsByProduct.get(p.id) ?? []
    const maxOrder = existing.reduce((m, r) => Math.max(m, r.sort_order ?? 0), -1)
    return {
      product_id: p.id,
      url: p.image_url,
      // 'flatlay', not 'model': this is the garment cut-out, not a photo of someone wearing it.
      // Both are accepted by getFrontImageCandidates; the distinction is honest labelling.
      kind: "flatlay",
      product_view: "front",
      vto_eligible: true,
      summary_eligible: true,
      ghost_eligible: false,
      // Only claim primary when there is nothing to displace.
      is_primary: existing.length === 0,
      sort_order: maxOrder + 1,
      ...(p.gender ? { gender: p.gender } : {}),
    }
  }

  if (!apply) {
    console.log(`\nDRY RUN — first 5 rows that would be inserted:\n`)
    for (const p of todo.slice(0, 5)) {
      console.log(`  ${(p.product_name ?? p.id).slice(0, 44)}`)
      console.log(`    ${JSON.stringify(buildRow(p))}`)
    }
    console.log(`\n  Nothing written. Re-run with --apply.`)
    return
  }

  const work = todo.slice(0, limit === Infinity ? todo.length : limit)
  console.log(`\nAPPLYING to ${work.length}…\n`)

  let done = 0
  const failures: string[] = []
  // Chunked insert — one round trip per 50 rows rather than per product.
  for (let i = 0; i < work.length; i += 50) {
    const chunk = work.slice(i, i + 50).map(buildRow)
    const res = await fetch(`${base}/rest/v1/product_images`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      failures.push(`rows ${i}-${i + chunk.length - 1}: ${res.status} ${(await res.text()).slice(0, 200)}`)
      continue
    }
    done += chunk.length
    console.log(`  ${done}/${work.length}`)
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log(`  inserted : ${done}`)
  console.log(`  failed   : ${work.length - done}`)
  if (failures.length) console.log(failures.map((f) => `    x ${f}`).join("\n"))
  console.log(`\n  Additive only. Revert: DELETE FROM product_images WHERE kind = 'flatlay'`)
  console.log(`  AND created_at > <the time you ran this>;`)
}

main().catch((e) => { console.error(`\nx ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1) })
