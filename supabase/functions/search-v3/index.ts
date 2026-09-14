// @ts-nocheck
/* eslint-disable */
// search-v3: product search.
// Text query: the model writes 10 short product descriptions. Each description
// is embedded and matched against the product image vectors. The 10 result
// lists are merged by similarity bucket (see mergeBuckets).
// Image only, or a worn item only: the image vector is matched directly. The
// model is not called.
// Request and response fields are a superset of search-v2, so the frontend
// needs no shape change.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { PRODUCT_SEARCH_PROMPT, renderPrompt } from "./prompt.ts"

console.log("🚀 Search V3 Function Up!")

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY') || ''
// Production uses the Modal secrets that search-v2 already has. A local run
// sets EMBED_URL to a local embedding server without a token.
const EMBED_URL = Deno.env.get('EMBED_URL') || Deno.env.get('MODAL_API_URL') || 'http://host.docker.internal:8001'
const EMBED_TOKEN = Deno.env.get('EMBED_TOKEN') || Deno.env.get('MODAL_AUTH_TOKEN') || ''
// Local run only (bare `deno run`). LOCAL_RUN enables the `prompt` and `debug`
// request options. In production these options are ignored, so a caller cannot
// use the Gemini key with their own prompt.
const LOCAL_RUN = Deno.env.get('SEARCH_V3_LOCAL') === '1'
const LOG_FILE = LOCAL_RUN ? (Deno.env.get('SEARCH_V3_LOG_FILE') || '') : ''
const PORT = Deno.env.get('PORT')

const RESOLVER_MODEL = 'gemini-3.5-flash-lite'
const RESOLVER_TIMEOUT_MS = 6000
const IMAGE_BYTE_CAP = 4_000_000
const PER_LIST_COUNT = 100
const RESULT_COUNT = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// The `message` is logged on the server. The client receives only `code` and
// the fixed text for that code, so upstream URLs and error bodies never leave
// the function.
class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}
class BadRequestError extends HttpError { constructor(m: string) { super(400, 'bad_request', m) } }
class ImageError extends HttpError { constructor(m: string) { super(502, 'image_error', m) } }
class ResolverTimeoutError extends HttpError { constructor(m: string) { super(504, 'resolver_timeout', m) } }
class ResolverError extends HttpError { constructor(m: string) { super(502, 'resolver_error', m) } }
class EmbedError extends HttpError { constructor(m: string) { super(502, 'embed_error', m) } }

const CLIENT_MESSAGE: Record<string, string> = {
  bad_request: 'Invalid search request',
  image_error: 'The image could not be loaded',
  resolver_timeout: 'The search took too long',
  resolver_error: 'The search could not be processed',
  embed_error: 'The search could not be processed',
  internal: 'Search failed',
}

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
    const status = err instanceof HttpError ? err.status : 500
    const code = err instanceof HttpError ? err.code : 'internal'
    console.error(`❌ search-v3 ${code}:`, err?.message || err)
    return new Response(JSON.stringify({ error: CLIENT_MESSAGE[code], code }), {
      status, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
}, PORT ? { port: Number(PORT) } : {})

// ---------------------------------------------------------- parseRequest ----
type ParsedRequest = {
  q: string | null
  imageUrl: string | null
  imageB64: string | null
  productId: string | null
  filters: Record<string, any>
  gender: string | null
  promptOverride: string | null
  debug: boolean
}

function parseRequest(body: any): ParsedRequest {
  const q: string | null = (body.q || '').trim() || null
  const imageUrl: string | null = body.imageUrl ?? body.image_url ?? null
  const imageB64: string | null = body.image_b64 ?? null
  const productId: string | null = body.productId ?? body.product_id ?? null
  if (!q && !imageUrl && !imageB64 && !productId) {
    throw new BadRequestError('Provide at least one of q, imageUrl, image_b64, productId')
  }
  if (imageUrl && !imageUrl.startsWith('https://')) throw new BadRequestError('imageUrl must use https')
  return {
    q, imageUrl, imageB64, productId,
    filters: body.filters || {},
    gender: body.gender || null,
    promptOverride: LOCAL_RUN && typeof body.prompt === 'string' && body.prompt ? body.prompt : null,
    debug: LOCAL_RUN && body.debug === true,
  }
}

// ---------------------------------------------------- resolveDescriptions ----
// Ask the model for 10 short product descriptions. The photo of the worn item
// or the uploaded image is sent with the prompt when there is one.
async function resolveDescriptions(opts: {
  q: string; gender: string | null
  imageB64: string | null; imageUrl: string | null; promptOverride: string | null
}): Promise<{ descriptions: string[]; ms: number }> {
  const prompt = renderPrompt(opts.promptOverride || PRODUCT_SEARCH_PROMPT, {
    query: opts.q, gender: opts.gender || 'any',
  })

  const parts: any[] = [{ text: prompt }]
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${RESOLVER_MODEL}:generateContent`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GOOGLE_API_KEY },
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

// Returns null when the image is larger than maxBytes; the search then runs on text only.
async function fetchImageAsInlinePart(url: string, maxBytes: number) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mclozilla/5.0' } }).catch((e) => {
    throw new ImageError(`image download failed for ${url}: ${e?.message || e}`)
  })
  if (!resp.ok) throw new ImageError(`image download failed for ${url}: HTTP ${resp.status}`)
  const declaredLength = Number(resp.headers.get('content-length') || 0)
  if (declaredLength && declaredLength > maxBytes) { await resp.body?.cancel(); return null }
  const mimeType = resp.headers.get('content-type') || 'image/jpeg'
  const buffer = await resp.arrayBuffer()
  if (buffer.byteLength > maxBytes) return null
  return { inlineData: { mimeType, data: base64Encode(new Uint8Array(buffer)) } }
}

// -------------------------------------------------------------------- embed --
// Same wire format as search-v2: post {text} or {image_b64}, send X-Modal-Token
// when a token exists, read {vector} | {embedding} | a bare vector.
async function embed(payload: { text: string } | { image_b64: string }): Promise<number[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (EMBED_TOKEN) headers['X-Modal-Token'] = EMBED_TOKEN
  let resp: Response
  try {
    resp = await fetch(EMBED_URL, { method: 'POST', headers, body: JSON.stringify(payload) })
  } catch (e: any) {
    throw new EmbedError(`embed fetch failed for ${EMBED_URL}: ${e?.message || e}`)
  }
  if (!resp.ok) throw new EmbedError(`embed server error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  return data.vector ?? data.embedding ?? data
}

// One /embed/batch call, vectors in input order; a host without that route falls back to one call per text.
async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length <= 1) return Promise.all(texts.map((t) => embed({ text: t })))
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (EMBED_TOKEN) headers['X-Modal-Token'] = EMBED_TOKEN
  try {
    const resp = await fetch(`${EMBED_URL}/embed/batch`, { method: 'POST', headers, body: JSON.stringify({ texts }) })
    if (resp.ok) {
      const data = await resp.json()
      if (Array.isArray(data?.vectors) && data.vectors.length === texts.length) return data.vectors
    }
  } catch (_e) {
    // fall through to one request per text
  }
  return Promise.all(texts.map((t) => embed({ text: t })))
}

async function embedImageUrl(imageUrl: string): Promise<number[]> {
  const resp = await fetch(imageUrl).catch((e) => {
    throw new ImageError(`image download failed for ${imageUrl}: ${e?.message || e}`)
  })
  if (!resp.ok) throw new ImageError(`image download failed for ${imageUrl}: HTTP ${resp.status}`)
  const bytes = new Uint8Array(await resp.arrayBuffer())
  return embed({ image_b64: base64Encode(bytes) })
}

// ------------------------------------------------------------ matchProducts --
type MatchRow = { id: string; product_name: string; brand: string; color: string; type_category: string; similarity: number }

async function matchProducts(supabase: any, vector: number[], filters: Record<string, any>, count: number): Promise<MatchRow[]> {
  const { data, error } = await supabase.rpc('match_products_image', {
    query_embedding: vector,
    filters: filters || {},
    match_threshold: -1,
    match_count: count,
  })
  if (error) throw error
  return data || []
}

// -------------------------------------------------------------- mergeRounds --
// Alternative to mergeBuckets, not active. Round r takes the next unplaced
// product from each list, sorts the picks by similarity, and appends them.
// The first list to reach a product places it. Repeat until `limit` products
// are placed or every list is empty.
type MergedResult = {
  id: string; product_name: string | null; brand: string | null; color: string | null
  type_category: string | null; similarity: number; final_score: number; norm_score: number
  tier: number; matched: { description_index: number | null; description: string | null; rank: number }
}

function mergeRounds(lists: MatchRow[][], descriptions: (string | null)[], limit: number): MergedResult[] {
  const placed = new Set<string>()
  const pointers = lists.map(() => 0)
  const merged: MergedResult[] = []
  let round = 1
  while (merged.length < limit) {
    const picks: { row: MatchRow; listIndex: number; rank: number }[] = []
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i]
      let p = pointers[i]
      while (p < list.length && placed.has(list[p].id)) p++
      if (p < list.length) {
        picks.push({ row: list[p], listIndex: i, rank: p + 1 })
        placed.add(list[p].id)
        p++
      }
      pointers[i] = p
    }
    if (!picks.length) break
    picks.sort((a, b) => b.row.similarity - a.row.similarity)
    for (const pick of picks) {
      merged.push({
        id: pick.row.id,
        product_name: pick.row.product_name ?? null,
        brand: pick.row.brand ?? null,
        color: pick.row.color ?? null,
        type_category: pick.row.type_category ?? null,
        similarity: pick.row.similarity,
        final_score: 0,
        norm_score: 0,
        tier: round,
        matched: {
          description_index: descriptions[pick.listIndex] !== null ? pick.listIndex : null,
          description: descriptions[pick.listIndex],
          rank: pick.rank,
        },
      })
      if (merged.length >= limit) break
    }
    round++
  }
  merged.forEach((m, idx) => {
    const score = round6(1 - idx / 1000)
    m.final_score = score
    m.norm_score = score
  })
  return merged
}

function round6(n: number) { return Math.round(n * 1e6) / 1e6 }

// -------------------------------------------------------------- mergeBuckets --
// Active strategy. Each product gets its best similarity across the lists.
// Products are grouped into whole-percent buckets, highest bucket first. Inside
// a bucket, round 1 takes the best product of each description, sorted by
// similarity, round 2 the next best, and so on. `tier` is the bucket floor in
// percent (10 = 10.0-10.99 %).
function mergeBuckets(lists: MatchRow[][], descriptions: (string | null)[], limit: number): MergedResult[] {
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
  const keys = [...buckets.keys()].sort((a, b) => b - a)
  for (const key of keys) {
    // per description, best first
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
        merged.push({
          id: pick.row.id,
          product_name: pick.row.product_name ?? null,
          brand: pick.row.brand ?? null,
          color: pick.row.color ?? null,
          type_category: pick.row.type_category ?? null,
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

// ------------------------------------------------------------------ handle --
async function handle(body: any, supabase: any, t0: number) {
  const req = parseRequest(body)
  const hasText = Boolean(req.q)

  let anchor: { image_vector: number[]; image_url: string | null } | null = null
  if (req.productId) {
    const { data, error } = await supabase.from('products').select('id, image_vector, image_url').eq('id', req.productId).single()
    if (error || !data) throw new BadRequestError(`productId not found: ${req.productId}${error ? ' (' + error.message + ')' : ''}`)
    anchor = data
  }

  let descriptions: (string | null)[] = [null]
  let resolverMs = 0
  if (hasText) {
    const photoUrl = req.imageB64 ? null : (req.imageUrl ?? anchor?.image_url ?? null)
    const r = await resolveDescriptions({
      q: req.q!, gender: req.gender, imageB64: req.imageB64, imageUrl: photoUrl, promptOverride: req.promptOverride,
    })
    descriptions = r.descriptions
    resolverMs = r.ms
  }

  const embedStart = Date.now()
  let vectors: number[][]
  if (hasText) {
    vectors = await embedTexts(descriptions as string[])
  } else if (anchor) {
    // A product added after the last embedding run has no stored vector. Embed its photo now.
    vectors = [anchor.image_vector ?? (await embedImageUrl(anchor.image_url!))]
  } else if (req.imageB64) {
    vectors = [await embed({ image_b64: req.imageB64 })]
  } else {
    vectors = [await embedImageUrl(req.imageUrl!)]
  }
  const embedMs = Date.now() - embedStart

  const searchStart = Date.now()
  const lists = await Promise.all(vectors.map((v) => matchProducts(supabase, v, req.filters, PER_LIST_COUNT)))
  const searchMs = Date.now() - searchStart

  // Ranking strategy. mergeRounds is the alternative.
  const results = mergeBuckets(lists, descriptions, RESULT_COUNT)
  const timings = { resolver_ms: resolverMs, embed_ms: embedMs, search_ms: searchMs, total_ms: Date.now() - t0 }

  const response: any = {
    results,
    descriptions: hasText ? descriptions : [],
    resolver: { model: hasText ? RESOLVER_MODEL : null, ms: resolverMs },
    timings,
  }

  if (req.debug) {
    const productMap = await hydrateDebugProducts(supabase, results.map((r) => r.id))
    response.results = results.map((r) => ({ ...r, product: productMap.get(r.id) ?? null }))
    response.lists = lists.map((list, i) => ({
      description: descriptions[i] ?? null,
      items: list.map((row) => ({ id: row.id, similarity: row.similarity })),
    }))
  }

  logRequest(body, req, results.length, hasText ? descriptions.length : 0, timings, response)
  return response
}

async function hydrateDebugProducts(supabase: any, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  if (!ids.length) return map
  const fields = 'id, product_name, brand, price, currency, image_url, thumbnail_url, gender, type, type_category, color_group'
  const { data, error } = await supabase.from('products').select(fields).in('id', ids)
  if (error) throw error
  for (const row of data || []) map.set(row.id, row)
  return map
}

// ------------------------------------------------------------ observability --
function requestMode(req: ParsedRequest): string {
  if (req.productId && req.q) return 'anchor+text'
  if (req.productId) return 'anchor'
  if (req.q && (req.imageB64 || req.imageUrl)) return 'image+text'
  if (req.q) return 'text'
  return 'image'
}

function logRequest(body: any, req: ParsedRequest, resultCount: number, descriptionCount: number, timings: any, response: any) {
  try {
    console.log(
      `[search-v3] mode=${requestMode(req)} gender=${req.gender ?? 'null'} filters=[${Object.keys(req.filters).join(',')}] ` +
      `descriptions=${descriptionCount} results=${resultCount} timings=${JSON.stringify(timings)}`,
    )
  } catch (_e) { /* never let logging break the response */ }

  if (!LOG_FILE) return
  ;(async () => {
    try {
      const sanitizedRequest = { ...body }
      if (typeof sanitizedRequest.image_b64 === 'string') sanitizedRequest.image_b64 = `<${sanitizedRequest.image_b64.length} bytes>`
      const line = JSON.stringify({ ts: new Date().toISOString(), request: sanitizedRequest, response }) + '\n'
      await Deno.writeTextFile(LOG_FILE, line, { append: true, create: true })
    } catch (e: any) {
      console.error('[search-v3] failed to write the log file:', e?.message || e)
    }
  })()
}
