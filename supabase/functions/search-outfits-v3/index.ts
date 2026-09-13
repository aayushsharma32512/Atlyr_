// @ts-nocheck
/* eslint-disable */
// search-outfits-v3: search the outfits people assembled in the app (the
// `outfits` table), not products. Same method as search-v3: query -> N short
// outfit descriptions from the model -> N parallel similarity searches against
// `outfits.image_vector` -> mergeBuckets, with an optional per-description cap.
// Image only skips the model and runs one list from the image embedding.
// Self-contained, same style as search-v3.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { OUTFIT_SEARCH_PROMPT, renderPrompt } from "./prompt.ts"

console.log("🚀 Search Outfits V3 Function Up!")

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY') || ''
// Same fallback names search-v2/search-v3 already read, so a production deploy needs no new secret.
const EMBED_URL = Deno.env.get('EMBED_URL') || Deno.env.get('MODAL_API_URL') || 'http://host.docker.internal:8001'
const EMBED_TOKEN = Deno.env.get('EMBED_TOKEN') || Deno.env.get('MODAL_AUTH_TOKEN') || ''
const SEARCH_OUTFITS_V3_LOG_FILE = Deno.env.get('SEARCH_OUTFITS_V3_LOG_FILE') || ''
const PORT = Number(Deno.env.get('PORT') ?? 8000) // bare `deno run` mode only; ignored under `supabase functions serve`

const RESOLVER_MODEL = 'gemini-3.5-flash-lite'
const RESOLVER_TIMEOUT_MS = 6000
const IMAGE_BYTE_CAP = 4_000_000
const DEFAULT_N = 10
const DEFAULT_MAX_PER_DESCRIPTION = 0 // 0 = no cap
const PER_LIST_COUNT = 100
const RESULT_COUNT = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}
class BadRequestError extends HttpError { constructor(m: string) { super(400, 'bad_request', m) } }
class ResolverTimeoutError extends HttpError { constructor(m: string) { super(504, 'resolver_timeout', m) } }
class ResolverError extends HttpError { constructor(m: string) { super(502, 'resolver_error', m) } }
class EmbedError extends HttpError { constructor(m: string) { super(502, 'embed_error', m) } }

// --------------------------------------------------------------- server ----
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const t0 = Date.now()
  try {
    let body: any
    try { body = await req.json() } catch (e: any) { throw new BadRequestError(`invalid JSON body: ${e?.message || e}`) }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const result = await handle(body, supabase, t0)
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (err: any) {
    console.error('❌ search-outfits-v3 error:', err?.message || err)
    const status = err instanceof HttpError ? err.status : 500
    const code = err instanceof HttpError ? err.code : 'internal'
    return new Response(JSON.stringify({ error: err?.message || String(err), code }), {
      status, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
}, { port: PORT })

// ---------------------------------------------------------- parseRequest ----
type ParsedRequest = {
  q: string | null
  imageUrl: string | null
  imageB64: string | null
  filters: Record<string, any>
  gender: string | null
  promptOverride: string | null
  n: number
  maxPerDescription: number
  debug: boolean
}

function parseRequest(body: any): ParsedRequest {
  const q: string | null = (body.q || '').trim() || null
  const imageUrl: string | null = body.imageUrl ?? null
  const imageB64: string | null = body.image_b64 ?? null
  if (!q && !imageUrl && !imageB64) {
    throw new BadRequestError('Provide at least one of q, imageUrl, image_b64')
  }
  return {
    q, imageUrl, imageB64,
    filters: body.filters || {},
    gender: body.gender || null,
    promptOverride: typeof body.prompt === 'string' && body.prompt ? body.prompt : null,
    n: typeof body.n === 'number' && body.n > 0 ? body.n : DEFAULT_N,
    maxPerDescription: typeof body.max_per_description === 'number' && body.max_per_description >= 0
      ? body.max_per_description
      : DEFAULT_MAX_PER_DESCRIPTION,
    debug: body.debug === true,
  }
}

// filters.genders wins when the app already sent one; otherwise the profile
// gender becomes the hard filter. match_outfits_v3 lets 'unisex' through on
// its own, so this list never needs to carry it.
function buildFilters(appFilters: Record<string, any>, gender: string | null): Record<string, any> {
  const filters = { ...appFilters }
  const hasGenders = Array.isArray(filters.genders) && filters.genders.length > 0
  if (gender && !hasGenders) filters.genders = [gender]
  return filters
}

// ---------------------------------------------------- resolveDescriptions ----
// Text present: ask the model for up to n short outfit descriptions. An
// uploaded image, if any, goes in with it as context.
async function resolveDescriptions(opts: {
  q: string; gender: string | null; n: number; imageB64: string | null; imageUrl: string | null; template: string
}): Promise<{ descriptions: string[]; ms: number }> {
  const hadQueryPlaceholder = /\{\{query\}\}/.test(opts.template)
  const rendered = renderPrompt(opts.template, { query: opts.q, gender: opts.gender || 'any', n: opts.n })

  const parts: any[] = [{ text: rendered }]
  // The built-in outfit_v1.md prompt has no {{query}} placeholder -- append the
  // shopper's ask as its own part so the model actually sees it.
  if (!hadQueryPlaceholder) parts.push({ text: `User request: ${opts.q}` })
  if (opts.imageB64) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: opts.imageB64 } })
  } else if (opts.imageUrl) {
    const inline = await fetchImageAsInlinePart(opts.imageUrl, IMAGE_BYTE_CAP)
    if (inline) parts.push(inline)
  }

  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS)
  let data: any
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${RESOLVER_MODEL}:generateContent?key=${GOOGLE_API_KEY}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
        },
      }),
    })
    if (!resp.ok) throw new ResolverError(`gemini HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`)
    data = await resp.json()
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new ResolverTimeoutError(`resolver timeout after ${RESOLVER_TIMEOUT_MS}ms`)
    if (e instanceof HttpError) throw e
    throw new ResolverError(e?.message || String(e))
  } finally {
    clearTimeout(timer)
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''
  let parsed: any
  try { parsed = JSON.parse(text) } catch { throw new ResolverError(`resolver returned invalid JSON: ${text.slice(0, 300)}`) }
  if (!Array.isArray(parsed) || !parsed.every((s: any) => typeof s === 'string')) {
    throw new ResolverError(`resolver did not return an array of strings: ${JSON.stringify(parsed).slice(0, 300)}`)
  }

  const seen = new Set<string>()
  const descriptions: string[] = []
  for (const raw of parsed) {
    const s = raw.trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    descriptions.push(s)
  }
  if (!descriptions.length) throw new ResolverError('resolver returned zero usable descriptions')
  return { descriptions, ms: Date.now() - start }
}

async function fetchImageAsInlinePart(url: string, maxBytes: number) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mclozilla/5.0' } })
  if (!resp.ok) throw new Error(`failed to download image: ${resp.status}`)
  const declaredLength = Number(resp.headers.get('content-length') || 0)
  if (declaredLength && declaredLength > maxBytes) { await resp.body?.cancel(); return null }
  const mimeType = resp.headers.get('content-type') || 'image/jpeg'
  const buffer = await resp.arrayBuffer()
  if (buffer.byteLength > maxBytes) return null
  return { inlineData: { mimeType, data: base64Encode(new Uint8Array(buffer)) } }
}

// -------------------------------------------------------------------- embed --
// Same contract as search-v3's embed: {text} or {image_b64} posted as-is,
// X-Modal-Token header when a token exists, response is {vector} | {embedding} | a bare vector.
async function embed(payload: { text: string } | { image_b64: string } | { image_url: string }): Promise<number[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (EMBED_TOKEN) headers['X-Modal-Token'] = EMBED_TOKEN
  const url = EMBED_TOKEN ? EMBED_URL : `${EMBED_URL}/embed`
  let resp: Response
  try {
    resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  } catch (e: any) {
    throw new EmbedError(`embed fetch failed for ${EMBED_URL}: ${e?.message || e}`)
  }
  if (!resp.ok) throw new EmbedError(`embed server error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  return data.vector ?? data.embedding ?? data
}

async function embedImageUrl(imageUrl: string): Promise<number[]> {
  if (!EMBED_TOKEN) return embed({ image_url: imageUrl })
  // Modal has no image_url branch -- download and re-send as image_b64.
  const resp = await fetch(imageUrl)
  if (!resp.ok) throw new EmbedError(`embed: failed to download imageUrl (HTTP ${resp.status})`)
  const bytes = new Uint8Array(await resp.arrayBuffer())
  return embed({ image_b64: base64Encode(bytes) })
}

// ------------------------------------------------------------ matchOutfits --
type MatchRow = { id: string; similarity: number }

async function matchOutfits(supabase: any, vector: number[], filters: Record<string, any>, count: number): Promise<MatchRow[]> {
  const { data, error } = await supabase.rpc('match_outfits_v3', {
    query_embedding: vector,
    filters: filters || {},
    match_count: count,
  })
  if (error) throw error
  return (data || []).map((r: any) => ({ id: r.id, similarity: r.score }))
}

// -------------------------------------------------------------- mergeBuckets --
// Copied from search-v3's mergeBuckets (score every outfit by its best similarity
// across the lists, group into whole-percent buckets top down, round-robin one
// pick per description per round inside a bucket), plus one rule: once a
// description has placed maxPerDescription outfits it places no more -- those
// candidates are dropped, never handed to another description. maxPerDescription
// 0 disables the rule and reproduces the original output exactly.
type MergedResult = {
  id: string; similarity: number; final_score: number; norm_score: number; tier: number
  matched: { description_index: number | null; description: string | null; rank: number }
}

function mergeBuckets(lists: MatchRow[][], descriptions: (string | null)[], limit: number, maxPerDescription: number): MergedResult[] {
  type Best = { row: MatchRow; listIndex: number; rank: number }
  const best = new Map<string, Best>()
  lists.forEach((list, listIndex) => {
    list.forEach((row, i) => {
      const cur = best.get(row.id)
      if (!cur || row.similarity > cur.row.similarity) best.set(row.id, { row, listIndex, rank: i + 1 })
    })
  })

  const buckets = new Map<number, Best[]>()
  for (const b of best.values()) {
    const key = Math.floor(b.row.similarity * 100)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(b)
  }

  const merged: MergedResult[] = []
  const placedPerList = new Map<number, number>()
  const capReached = (listIndex: number) =>
    maxPerDescription > 0 && (placedPerList.get(listIndex) || 0) >= maxPerDescription

  const keys = [...buckets.keys()].sort((a, b) => b - a)
  for (const key of keys) {
    const perList = new Map<number, Best[]>()
    for (const b of buckets.get(key)!) {
      if (!perList.has(b.listIndex)) perList.set(b.listIndex, [])
      perList.get(b.listIndex)!.push(b)
    }
    for (const arr of perList.values()) arr.sort((a, b) => b.row.similarity - a.row.similarity)

    for (let round = 0; merged.length < limit; round++) {
      const picks = [...perList.values()].map((arr) => arr[round]).filter(Boolean) as Best[]
      if (!picks.length) break
      picks.sort((a, b) => b.row.similarity - a.row.similarity)
      for (const pick of picks) {
        if (merged.length >= limit) break
        if (capReached(pick.listIndex)) continue
        merged.push({
          id: pick.row.id,
          similarity: pick.row.similarity,
          final_score: 0,
          norm_score: 0,
          tier: key,
          matched: {
            description_index: descriptions[pick.listIndex] !== null ? pick.listIndex : null,
            description: descriptions[pick.listIndex],
            rank: pick.rank,
          },
        })
        placedPerList.set(pick.listIndex, (placedPerList.get(pick.listIndex) || 0) + 1)
      }
    }
    if (merged.length >= limit) break
  }
  merged.forEach((m, idx) => {
    const score = round6(1 - idx / 1000)
    m.final_score = score
    m.norm_score = score
  })
  return merged
}

function round6(n: number) { return Math.round(n * 1e6) / 1e6 }

// ---------------------------------------------------------------- hydrate --
// Non-debug: the app hydrates by id itself, so only the four v2 list fields.
async function hydrateOutfitFields(supabase: any, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  if (!ids.length) return map
  const { data, error } = await supabase.from('outfits').select('id, name, category, occasion, gender').in('id', ids)
  if (error) throw error
  for (const row of data || []) map.set(row.id, row)
  return map
}

// Debug only: the outfit row plus its top, bottom and shoes product rows.
async function hydrateOutfitsFull(supabase: any, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  if (!ids.length) return map
  const fields = 'id, name, gender, category, occasion, visible_in_feed, top_id, bottom_id, shoes_id, render_note_v3'
  const { data, error } = await supabase.from('outfits').select(fields).in('id', ids)
  if (error) throw error

  const productIds = new Set<string>()
  for (const row of data || []) {
    if (row.top_id) productIds.add(row.top_id)
    if (row.bottom_id) productIds.add(row.bottom_id)
    if (row.shoes_id) productIds.add(row.shoes_id)
  }
  const productMap = await hydrateProducts(supabase, Array.from(productIds))

  for (const row of data || []) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      gender: row.gender,
      category: row.category,
      occasion: row.occasion,
      visible_in_feed: row.visible_in_feed,
      render_note: row.render_note_v3 ?? null,
      top: row.top_id ? (productMap.get(row.top_id) ?? { id: row.top_id }) : null,
      bottom: row.bottom_id ? (productMap.get(row.bottom_id) ?? { id: row.bottom_id }) : null,
      shoes: row.shoes_id ? (productMap.get(row.shoes_id) ?? null) : null,
    })
  }
  return map
}

async function hydrateProducts(supabase: any, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  if (!ids.length) return map
  const fields = 'id, product_name, brand, price, currency, gender, type, image_url'
  const { data, error } = await supabase.from('products').select(fields).in('id', ids)
  if (error) throw error
  for (const row of data || []) map.set(row.id, row)
  return map
}

// ------------------------------------------------------------------ handle --
async function handle(body: any, supabase: any, t0: number) {
  const req = parseRequest(body)
  const hasText = Boolean(req.q)

  let descriptions: (string | null)[] = [null]
  let resolverMs = 0
  if (hasText) {
    const template = req.promptOverride || OUTFIT_SEARCH_PROMPT
    const photoUrl = req.imageB64 ? null : req.imageUrl
    const r = await resolveDescriptions({
      q: req.q!, gender: req.gender, n: req.n, imageB64: req.imageB64, imageUrl: photoUrl, template,
    })
    descriptions = r.descriptions
    resolverMs = r.ms
  }

  const embedStart = Date.now()
  let vectors: number[][]
  if (hasText) {
    vectors = await Promise.all(descriptions.map((d) => embed({ text: d as string })))
  } else if (req.imageB64) {
    vectors = [await embed({ image_b64: req.imageB64 })]
  } else {
    vectors = [await embedImageUrl(req.imageUrl!)]
  }
  const embedMs = Date.now() - embedStart

  const filters = buildFilters(req.filters, req.gender)

  const searchStart = Date.now()
  const lists = await Promise.all(vectors.map((v) => matchOutfits(supabase, v, filters, PER_LIST_COUNT)))
  const searchMs = Date.now() - searchStart

  const merged = mergeBuckets(lists, descriptions, RESULT_COUNT, req.maxPerDescription)

  const fieldsMap = req.debug
    ? await hydrateOutfitsFull(supabase, merged.map((m) => m.id))
    : await hydrateOutfitFields(supabase, merged.map((m) => m.id))

  const results = merged.map((m) => {
    const f = fieldsMap.get(m.id)
    const base: any = {
      id: m.id,
      name: f?.name ?? null,
      category: f?.category ?? null,
      occasion: f?.occasion ?? null,
      gender: f?.gender ?? null,
      similarity: m.similarity,
      final_score: m.final_score,
      norm_score: m.norm_score,
      tier: m.tier,
      matched: m.matched,
    }
    if (req.debug) base.outfit = f ?? null
    return base
  })

  const timings = { resolver_ms: resolverMs, embed_ms: embedMs, search_ms: searchMs, total_ms: Date.now() - t0 }
  const response: any = {
    results,
    descriptions: hasText ? descriptions : [],
    resolver: { model: hasText ? RESOLVER_MODEL : null, ms: resolverMs },
    timings,
  }

  if (req.debug) {
    response.lists = {}
    lists.forEach((list, i) => {
      response.lists[String(i)] = list.slice(0, 20).map((row) => ({ id: row.id, similarity: row.similarity }))
    })
  }

  logRequest(body, req, filters, results.length, hasText ? descriptions.length : 0, timings, response)
  return response
}

// ------------------------------------------------------------ observability --
function requestMode(req: ParsedRequest): string {
  if (req.q && (req.imageB64 || req.imageUrl)) return 'image+text'
  if (req.q) return 'text'
  return 'image'
}

function logRequest(body: any, req: ParsedRequest, filters: Record<string, any>, resultCount: number, descriptionCount: number, timings: any, response: any) {
  try {
    console.log(
      `[search-outfits-v3] mode=${requestMode(req)} gender=${req.gender ?? 'null'} filters=[${Object.keys(filters).join(',')}] ` +
      `n=${req.n} descriptions=${descriptionCount} results=${resultCount} timings=${JSON.stringify(timings)}`,
    )
  } catch (_e) { /* never let logging break the response */ }

  if (!SEARCH_OUTFITS_V3_LOG_FILE) return
  ;(async () => {
    try {
      const sanitizedRequest = { ...body }
      if (typeof sanitizedRequest.image_b64 === 'string') sanitizedRequest.image_b64 = `<${sanitizedRequest.image_b64.length} bytes>`
      const line = JSON.stringify({ ts: new Date().toISOString(), request: sanitizedRequest, response }) + '\n'
      await Deno.writeTextFile(SEARCH_OUTFITS_V3_LOG_FILE, line, { append: true, create: true })
    } catch (e: any) {
      console.error('[search-outfits-v3] failed to write SEARCH_OUTFITS_V3_LOG_FILE:', e?.message || e)
    }
  })()
}
