import { FunctionsHttpError } from "@supabase/supabase-js"
import { supabase } from "@/integrations/supabase/client"
import type { Database } from "@/integrations/supabase/types"
import type { Outfit } from "@/types"
import type { StudioOutfitDTO } from "@/features/studio/types"
import { mapDbOutfitToStudioOutfit } from "@/features/studio/mappers/renderedItemMapper"
import { mapDbOutfitToOutfit } from "@/services/shared/transformers/outfitTransformers"
import { getOutfitChips } from "@/utils/outfitChips"
import { buildGenderFilter } from "./genderFilter"

type Gender = "male" | "female" | null

interface CategoryMetadata {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
}

export interface SearchBrowseOutfit {
  id: string
  title: string
  chips: string[]
  outfit: Outfit
  studioOutfit?: StudioOutfitDTO | null
  avatarHeadUrl: string | null
  avatarGender: Gender
  avatarHeightCm: number | null
}

export interface SearchBrowseCollection {
  categoryId: string
  title: string
  subtitle?: string
  /** When the category was created — what makes a curation "new". */
  createdAt?: string
  outfits: SearchBrowseOutfit[]
}

interface GetBrowseCollectionsInput {
  gender: Gender
  avatarHeadUrl: string | null
  avatarHeightCm: number | null
  limitPerCategory?: number
}

type DbOutfitWithJoins = Database["public"]["Tables"]["outfits"]["Row"] & {
  occasion: Database["public"]["Tables"]["occasions"]["Row"] | null
  top: Database["public"]["Tables"]["products"]["Row"] | null
  bottom: Database["public"]["Tables"]["products"]["Row"] | null
  shoes: Database["public"]["Tables"]["products"]["Row"] | null
}

export interface OutfitSearchFilters {
  categories?: string[]
  occasions?: string[]
  fits?: string[]
}

export interface ProductSearchFilters {
  typeCategories?: string[]
  brands?: string[]
  fits?: string[]
  feels?: string[]
  colorGroups?: string[]
  sizes?: string[]
  minPrice?: number
  maxPrice?: number
  genders?: string[]
  categoryIds?: string[]
  vibes?: string[]
  typeSubCategories?: string[]
}

interface SearchOutfitsInput {
  query?: string
  imageUrl?: string
  gender: Gender
  cursor?: number | null
  limit?: number
  filters?: OutfitSearchFilters
}

interface SearchProductsInput {
  query?: string
  imageUrl?: string
  productId?: string
  cursor?: number | null
  limit?: number
  filters?: ProductSearchFilters
  /** Profile gender. search-v3 uses it only to phrase the LLM query, never as a filter. */
  gender?: Gender
}

/** Thrown by searchProducts when search-v3 responds with a non-2xx status. */
export class ProductSearchError extends Error {
  status?: number
  code?: string

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message)
    this.name = "ProductSearchError"
    this.status = options?.status
    this.code = options?.code
  }
}

interface SearchV3ErrorBody {
  error?: string
  code?: string
}

/** One search-v3 result row. `final_score` decreases with rank; the app sorts by it. */
interface SearchV3Result {
  id: string
  product_name: string | null
  similarity: number
  final_score: number
  /** Similarity bucket floor in percent (10 = 10.0-10.99 %). */
  tier: number
  /** The description that placed this product, and the product's rank in that description's list. */
  matched: { description_index: number | null; description: string | null; rank: number }
}

/** search-v3's response shape. `descriptions` and `timings` feed the dev console log. */
interface SearchV3Response {
  results?: SearchV3Result[]
  nextCursor?: number | null
  descriptions?: string[]
  resolver?: { model?: string | null; ms?: number }
  timings?: { resolver_ms?: number; embed_ms?: number; search_ms?: number; total_ms?: number }
}

/** One search-outfits-v3 result row. `final_score` decreases with rank; the app sorts by it. */
interface SearchOutfitsV3Result {
  id: string
  name: string | null
  category: string | null
  occasion: string | null
  gender: string | null
  similarity: number
  final_score: number
  /** Similarity band floor, whole percent (31 = 31.0-31.99 %). */
  tier: number
  /** The description that found this outfit first, and its rank in that description's list. */
  matched: { description_index: number | null; description: string | null; rank: number }
}

/** search-outfits-v3's response shape. `descriptions` and `timings` feed the dev console log. */
interface SearchOutfitsV3Response {
  results?: SearchOutfitsV3Result[]
  descriptions?: string[]
  resolver?: { model?: string | null; ms?: number }
  timings?: { resolver_ms?: number; embed_ms?: number; search_ms?: number; total_ms?: number }
}

export interface OutfitSearchResult {
  outfit: Outfit
  studioOutfit?: StudioOutfitDTO | null
  similarity?: number
}

export interface ProductSearchResult {
  id: string
  title: string
  brand: string
  price: number
  currency: string | null
  priceLabel: string
  imageSrc: string
  thumbnailSrc: string
  renderImageSrc: string
  similarity?: number
  gender?: string | null
  category_id?: string | null
  fit?: string | null
  feel?: string | null
  vibes?: string | null
  type_category?: string | null
  type?: Database["public"]["Enums"]["item_type"] | null
  size?: string | null
  productUrl?: string | null
  placementX?: number | null
  placementY?: number | null
  imageLength?: number | null
  color: string | null  // Added color property
  bodyPartsVisible?: string[] | null
  placement?: Database["public"]["Tables"]["products"]["Row"]["placement"]
}

interface SearchFunctionResponse<T> {
  results: T[]
  nextCursor: number | null
}

async function getFeaturedCategories(): Promise<CategoryMetadata[]> {
  const { data, error } = await supabase.from("categories").select("id,name,slug,created_at").order("name", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((category) => ({
    id: category.id,
    title: category.name,
    subtitle: category.slug.replace(/-/g, " "),
    createdAt: category.created_at ?? undefined,
  }))
}

async function fetchCategoryOutfits(categoryId: string, gender: Gender, from: number, limit: number) {
  const query = supabase
    .from("outfits")
    .select(
      `
        id,
        name,
        category,
        gender,
        background_id,
        fit,
        feel,
        vibes,
        word_association,
        tags,
        rating,
        popularity,
        created_at,
        created_by,
        user_id,
        layer_order,
        occasion:occasions!occasion(
          id,
          name,
          slug,
          background_url,
          description
        ),
        top:products!outfits_top_id_fkey(
          id,
          type,
          brand,
          gender,
          product_name,
          size,
          price,
          currency,
          image_url,
          thumbnail_url,
          product_url,
          description,
          color,
          color_group,
          category_id,
          fit,
          feel,
          vibes,
          material_type,
          placement_x,
          placement_y,
          image_length,
          placement,
          type_category,
          body_parts_visible
        ),
        bottom:products!outfits_bottom_id_fkey(
          id,
          type,
          brand,
          gender,
          product_name,
          size,
          price,
          currency,
          image_url,
          thumbnail_url,
          product_url,
          description,
          color,
          color_group,
          category_id,
          fit,
          feel,
          vibes,
          material_type,
          placement_x,
          placement_y,
          image_length,
          placement,
          type_category,
          body_parts_visible
        ),
        shoes:products!outfits_shoes_id_fkey(
          id,
          type,
          brand,
          gender,
          product_name,
          size,
          price,
          currency,
          image_url,
          thumbnail_url,
          product_url,
          description,
          color,
          color_group,
          category_id,
          fit,
          feel,
          vibes,
          material_type,
          placement_x,
          placement_y,
          image_length,
          placement,
          type_category,
          body_parts_visible
        )
      `,
    )
    .eq("category", categoryId)
    .eq("visible_in_feed", true)
    .not("gender", "is", null)
    .order("popularity", { ascending: false })
    // Ties on popularity need a fixed order, or a page can repeat a row.
    .order("id", { ascending: true })
    .range(from, from + limit - 1)

  query.or(buildGenderFilter(gender))

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as DbOutfitWithJoins[]
}

function toBrowseOutfit(
  row: DbOutfitWithJoins,
  gender: Gender,
  avatarHeadUrl: string | null,
  avatarHeightCm: number | null,
): SearchBrowseOutfit {
  const outfit = mapDbOutfitToOutfit(row)
  const studioOutfit = mapDbOutfitToStudioOutfit(row as unknown as Parameters<typeof mapDbOutfitToStudioOutfit>[0])
  return {
    id: outfit.id,
    title: outfit.name,
    chips: getOutfitChips(outfit),
    outfit,
    studioOutfit,
    avatarHeadUrl,
    avatarGender: gender,
    avatarHeightCm,
  }
}

export async function getBrowseCollections({
  gender,
  avatarHeadUrl,
  avatarHeightCm,
  limitPerCategory = 10,
}: GetBrowseCollectionsInput): Promise<SearchBrowseCollection[]> {
  const [categories] = await Promise.all([getFeaturedCategories()])

  const collections = await Promise.all(
    categories.map(async (category) => {
      const outfits = await fetchCategoryOutfits(category.id, gender, 0, limitPerCategory)

      const mapped = outfits.map((row) => toBrowseOutfit(row, gender, avatarHeadUrl, avatarHeightCm))

      return {
        categoryId: category.id,
        title: category.title,
        subtitle: category.subtitle,
        createdAt: category.createdAt,
        outfits: mapped,
      } satisfies SearchBrowseCollection
    }),
  )

  return collections.filter((collection) => collection.outfits.length > 0)
}

const BROWSE_COLLECTION_LOOKS_PAGE = 20

interface BrowseCollectionLooksInput {
  categoryId: string
  gender: Gender
  avatarHeadUrl: string | null
  avatarHeightCm: number | null
  cursor?: number | null
}

/** One curation, opened: every look in the category, most popular first, a page at a time. */
export async function browseCollectionLooks({
  categoryId,
  gender,
  avatarHeadUrl,
  avatarHeightCm,
  cursor,
}: BrowseCollectionLooksInput): Promise<SearchFunctionResponse<SearchBrowseOutfit>> {
  const from = Math.max(cursor ?? 0, 0)
  const rows = await fetchCategoryOutfits(categoryId, gender, from, BROWSE_COLLECTION_LOOKS_PAGE)
  return {
    results: rows.map((row) => toBrowseOutfit(row, gender, avatarHeadUrl, avatarHeightCm)),
    nextCursor: rows.length === BROWSE_COLLECTION_LOOKS_PAGE ? from + BROWSE_COLLECTION_LOOKS_PAGE : null,
  }
}

const PRODUCT_PRICE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

function formatPrice(price: number, currency?: string | null) {
  if (currency && currency !== "INR") {
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(price)
    } catch {
      return PRODUCT_PRICE_FORMATTER.format(price)
    }
  }
  return PRODUCT_PRICE_FORMATTER.format(price)
}

const RECENT_INVOCATIONS = new Map<string, { ts: number; result: SearchFunctionResponse<unknown> }>()
const INVOCATION_TTL = 2000

async function invokeSearchFunction<T>(payload: Record<string, unknown>): Promise<SearchFunctionResponse<T>> {
  const signature = JSON.stringify(payload)
  const cached = RECENT_INVOCATIONS.get(signature)
  if (cached && Date.now() - cached.ts < INVOCATION_TTL) {
    return JSON.parse(JSON.stringify(cached.result)) as SearchFunctionResponse<T>
  }

  const { data, error } = await supabase.functions.invoke("search", {
    body: payload,
  })

  if (error) {
    throw new Error(error.message)
  }

  const normalized = (data ?? { results: [], nextCursor: null }) as SearchFunctionResponse<T>
  const result = {
    results: Array.isArray(normalized.results) ? normalized.results : [],
    nextCursor: normalized.nextCursor ?? null,
  }

  try {
    RECENT_INVOCATIONS.set(signature, { ts: Date.now(), result: JSON.parse(JSON.stringify(result)) })
  } catch (e) {
    // ignore serialization errors
  }

  return result
}

async function fetchOutfitsByIds(
  ids: string[],
): Promise<Record<string, { outfit: Outfit; studioOutfit: StudioOutfitDTO | null }>> {
  if (ids.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from("outfits")
    .select(
      `
        *,
        occasion:occasions!occasion(*),
        top:products!outfits_top_id_fkey(*, body_parts_visible),
        bottom:products!outfits_bottom_id_fkey(*, body_parts_visible),
        shoes:products!outfits_shoes_id_fkey(*, body_parts_visible)
      `,
    )
    .in("id", ids)

  if (error) {
    throw new Error(error.message)
  }

  const map: Record<string, { outfit: Outfit; studioOutfit: StudioOutfitDTO | null }> = {}
  for (const row of data ?? []) {
    const typedRow = row as unknown as DbOutfitWithJoins
    map[typedRow.id] = {
      outfit: mapDbOutfitToOutfit(typedRow),
      studioOutfit: mapDbOutfitToStudioOutfit(
        typedRow as unknown as Parameters<typeof mapDbOutfitToStudioOutfit>[0],
      ),
    }
  }
  return map
}

export async function fetchProductsByIds(
  ids: string[],
): Promise<Record<string, Database["public"]["Tables"]["products"]["Row"]>> {
  if (ids.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("id", ids)

  if (error) {
    throw new Error(error.message)
  }

  const map: Record<string, Database["public"]["Tables"]["products"]["Row"]> = {}
  for (const row of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typed = row as any as Database["public"]["Tables"]["products"]["Row"]
    map[typed.id] = typed
  }
  return map
}

export interface SearchOutfitsV3RequestBody {
  q?: string
  imageUrl?: string
  filters?: OutfitSearchFilters
  gender?: string
}

/** Builds the search-outfits-v3 request body from a searchOutfits call. Exported for tests. */
export function buildSearchOutfitsV3RequestBody({
  query,
  imageUrl,
  filters,
  gender,
}: Pick<SearchOutfitsInput, "query" | "imageUrl" | "filters" | "gender">): SearchOutfitsV3RequestBody {
  const trimmed = query?.trim() ?? ""
  return {
    q: trimmed || undefined,
    imageUrl: imageUrl || undefined,
    filters: filters || {},
    gender: gender || undefined,
  }
}

/** Dev only: one collapsed console group per search with one table: position, tier,
 * similarity, outfit name, the description that placed it, and its rank in that description's list. */
function logSearchOutfitsV3Dev(body: SearchOutfitsV3RequestBody, data: SearchOutfitsV3Response): void {
  const t = data.timings ?? {}
  const descriptions = data.descriptions ?? []
  const results = data.results ?? []
  const header =
    `[search-outfits-v3] "${body.q ?? ""}" · ${body.gender ?? "any"} · ${t.total_ms ?? "?"} ms ` +
    `(resolver ${t.resolver_ms ?? 0}, embed ${t.embed_ms ?? 0}, search ${t.search_ms ?? 0}) · ` +
    `${descriptions.length} descriptions · ${results.length} results`

  // keyed by position so the table's index column is the 1-based numbering
  const rows: Record<number, Record<string, unknown>> = {}
  results.forEach((r, i) => {
    rows[i + 1] = {
      tier: r.tier,
      similarity: (r.similarity * 100).toFixed(3) + " %",
      outfit: r.name,
      description: r.matched.description_index != null ? descriptions[r.matched.description_index] : null,
      rank: r.matched.rank,
    }
  })
  console.groupCollapsed(header)
  console.table(rows)
  console.groupEnd()
}

async function searchOutfits({
  query,
  imageUrl,
  gender,
  cursor = 0,
  limit = 12,
  filters,
}: SearchOutfitsInput): Promise<SearchFunctionResponse<OutfitSearchResult>> {
  const trimmed = query?.trim() ?? ""

  if (!trimmed && !imageUrl) {
    return { results: [], nextCursor: null }
  }

  const body = buildSearchOutfitsV3RequestBody({ query: trimmed, imageUrl, gender, filters })
  const data = await invokeSearchOutfitsV3(body)

  if (import.meta.env.DEV) logSearchOutfitsV3Dev(body, data)

  const rawResults = (data.results ?? [])
    .sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0))

  const ids = rawResults.map((row) => row.id)

  if (!ids.length) {
    return { results: [], nextCursor: null }
  }

  const outfitMap = await fetchOutfitsByIds(ids)

  const ordered: OutfitSearchResult[] = ids
    .map((id) => {
      const entry = outfitMap[id]
      if (!entry) {
        return null
      }

      const rawMatch = rawResults.find((r) => r.id === id)

      return {
        outfit: entry.outfit,
        studioOutfit: entry.studioOutfit,
        similarity: rawMatch?.similarity,
      }
    })
    .filter(Boolean) as OutfitSearchResult[]

  // search-outfits-v3 returns a fixed page (top 50), no backend cursor pagination yet.
  return { results: ordered, nextCursor: null }
}

export interface SearchV3RequestBody {
  q?: string
  imageUrl?: string
  productId?: string
  filters?: ProductSearchFilters
  gender?: string
}

/** Builds the search-v3 request body from a searchProducts call. Exported for tests. */
export function buildSearchV3RequestBody({
  query,
  imageUrl,
  productId,
  filters,
  gender,
}: SearchProductsInput): SearchV3RequestBody {
  const trimmed = query?.trim() ?? ""
  return {
    q: trimmed || undefined,
    imageUrl: imageUrl || undefined,
    productId: productId || undefined,
    filters: filters || {},
    gender: gender || undefined,
  }
}

/** Dev only: one collapsed console group per search with one table: position, round,
 * similarity, product, the description that placed it, and its rank in that description's list. */
function logSearchV3Dev(body: SearchV3RequestBody, data: SearchV3Response): void {
  const t = data.timings ?? {}
  const descriptions = data.descriptions ?? []
  const results = data.results ?? []
  const source = body.productId ? "product" : body.imageUrl ? "image" : null
  const mode = source ? (body.q ? `${source}+text` : source) : "text"
  const header =
    `[search-v3] "${body.q ?? ""}" · ${mode} · ${body.gender ?? "any"} · ${t.total_ms ?? "?"} ms ` +
    `(resolver ${t.resolver_ms ?? 0}, embed ${t.embed_ms ?? 0}, search ${t.search_ms ?? 0}) · ${results.length} results`

  // keyed by position so the table's index column is the 1-based numbering
  const rows: Record<number, Record<string, unknown>> = {}
  results.forEach((r, i) => {
    rows[i + 1] = {
      bucket: r.tier,
      similarity: (r.similarity * 100).toFixed(3) + " %",
      product: r.product_name,
      description: r.matched.description_index != null ? descriptions[r.matched.description_index] : "image",
      rank: r.matched.rank,
    }
  })
  console.groupCollapsed(header)
  console.table(rows)
  console.groupEnd()
}

async function readErrorBody(response: Response | undefined): Promise<SearchV3ErrorBody> {
  if (!response) return {}
  try {
    return (await response.json()) as SearchV3ErrorBody
  } catch {
    return {}
  }
}

/** Dev-only: an edge function's URL when calling it directly instead of through supabase.functions.invoke. */
function getDevFunctionUrl(envKey: "VITE_SEARCH_V3_URL" | "VITE_SEARCH_OUTFITS_V3_URL"): string | undefined {
  const env = import.meta.env as { DEV?: boolean } & Record<string, string | undefined>
  const value = env[envKey]
  return env.DEV && value ? value : undefined
}

/** Shared by search-v3 and search-outfits-v3: dev-only direct fetch when a dev URL is set,
 * else supabase.functions.invoke. Non-2xx becomes a ProductSearchError either way. */
async function invokeEdgeFunction<TBody extends Record<string, unknown>, TResponse>(
  functionName: string,
  devUrl: string | undefined,
  body: TBody,
): Promise<TResponse> {
  if (devUrl) {
    const env = import.meta.env as { VITE_SUPABASE_ANON_KEY?: string }
    const anonKey = env.VITE_SUPABASE_ANON_KEY ?? ""
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token || anonKey

    const response = await fetch(devUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorBody = await readErrorBody(response)
      throw new ProductSearchError(errorBody.error ?? `${functionName} request failed (${response.status})`, {
        status: response.status,
        code: errorBody.code,
      })
    }

    return (await response.json()) as TResponse
  }

  const { data, error } = await supabase.functions.invoke(functionName, { body })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response | undefined
      const errorBody = await readErrorBody(response)
      throw new ProductSearchError(errorBody.error ?? error.message, {
        status: response?.status,
        code: errorBody.code,
      })
    }
    throw new ProductSearchError(error.message)
  }

  return (data ?? {}) as TResponse
}

async function invokeSearchV3(body: SearchV3RequestBody): Promise<SearchV3Response> {
  return invokeEdgeFunction<SearchV3RequestBody, SearchV3Response>(
    "search-v3",
    getDevFunctionUrl("VITE_SEARCH_V3_URL"),
    body,
  )
}

async function invokeSearchOutfitsV3(body: SearchOutfitsV3RequestBody): Promise<SearchOutfitsV3Response> {
  return invokeEdgeFunction<SearchOutfitsV3RequestBody, SearchOutfitsV3Response>(
    "search-outfits-v3",
    getDevFunctionUrl("VITE_SEARCH_OUTFITS_V3_URL"),
    body,
  )
}

function mapProductRowToResult(row: Record<string, unknown>): ProductSearchResult | null {
  if (typeof row.id !== "string") {
    return null
  }

  const imageUrl =
    (typeof row.thumbnail_url === "string" && row.thumbnail_url) ||
    (typeof row.image_url === "string" ? row.image_url : "")
  const price = typeof row.price === "number" ? row.price : 0
  const currency = typeof row.currency === "string" ? row.currency : "INR"
  const brand = typeof row.brand === "string" ? row.brand : "Brand"
  const title =
    (typeof row.product_name === "string" && row.product_name?.length > 0 ? row.product_name : undefined) ??
    (typeof row.description === "string" && row.description.length > 0 ? row.description : undefined) ??
    brand

  return {
    id: row.id,
    title,
    brand,
    price,
    currency,
    priceLabel: formatPrice(price, currency),
    imageSrc: imageUrl,
    thumbnailSrc: imageUrl,
    renderImageSrc: typeof row.image_url === "string" ? row.image_url : imageUrl,
    similarity: typeof row.similarity === "number" ? (row.similarity as number) : undefined,
    gender: typeof row.gender === "string" ? row.gender : null,
    category_id: typeof row.category_id === "string" ? row.category_id : null,
    fit: typeof row.fit === "string" ? row.fit : null,
    feel: typeof row.feel === "string" ? row.feel : null,
    vibes: typeof row.vibes === "string" ? row.vibes : null,
    type_category: typeof row.type_category === "string" ? row.type_category : null,
    type: (row.type as Database["public"]["Enums"]["item_type"]) ?? null,
    size: typeof row.size === "string" ? row.size : null,
    productUrl: typeof row.product_url === "string" ? row.product_url : null,
    placementX: typeof row.placement_x === "number" ? row.placement_x : null,
    placementY: typeof row.placement_y === "number" ? row.placement_y : null,
    imageLength: typeof row.image_length === "number" ? row.image_length : null,
    color: typeof row.color === "string" ? row.color : null,
    bodyPartsVisible: Array.isArray(row.body_parts_visible)
      ? (row.body_parts_visible as string[])
      : null,
    placement: (row.placement as Database["public"]["Tables"]["products"]["Row"]["placement"]) ?? null,
  }
}

async function searchProducts({
  query,
  imageUrl,
  productId,
  filters,
  gender,
}: SearchProductsInput): Promise<SearchFunctionResponse<ProductSearchResult>> {
  const trimmed = query?.trim() ?? ""

  if (!trimmed && !imageUrl && !productId) {
    return { results: [], nextCursor: null }
  }

  const body = buildSearchV3RequestBody({ query: trimmed, imageUrl, productId, filters, gender })
  const data = await invokeSearchV3(body)

  if (import.meta.env.DEV) logSearchV3Dev(body, data)

  const rawResults = (data.results ?? [])
    .sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0))

  const ids = rawResults.map((row) => row.id)

  if (!ids.length) {
    return { results: [], nextCursor: null }
  }

  const productMap = await fetchProductsByIds(ids)

  const products = ids
    .map((id) => productMap[id])
    .filter((product): product is Database["public"]["Tables"]["products"]["Row"] => Boolean(product))

  const mapped = products
    .map((productRow) => {
      const baseRow = rawResults.find((r) => r.id === productRow.id) ?? {}

      const combined: Record<string, unknown> = {
        ...baseRow,
        id: productRow.id,
        product_name: productRow.product_name,
        brand: productRow.brand,
        price: productRow.price,
        currency: productRow.currency,
        image_url: productRow.image_url,
        thumbnail_url: productRow.thumbnail_url,
        color: productRow.color,
        type: productRow.type,
        type_category: productRow.type_category,
        gender: productRow.gender,
        category_id: productRow.category_id,
        fit: productRow.fit,
        feel: productRow.feel,
        vibes: productRow.vibes,
        size: productRow.size,
        product_url: productRow.product_url,
        placement: productRow.placement,
        placement_x: productRow.placement_x,
        placement_y: productRow.placement_y,
        image_length: productRow.image_length,
        body_parts_visible: productRow.body_parts_visible,
      }

      return mapProductRowToResult(combined)
    })
    .filter(Boolean) as ProductSearchResult[]

  const idOrder = new Map(ids.map((id, index) => [id, index]))
  const sorted = mapped.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999))

  return { results: sorted, nextCursor: null }
}

export interface ProductFilterOptions {
  types: string[]
  genders: string[]
  brands: string[]
  categoryIds: string[]
  fits: string[]
  feels: string[]
  vibes: string[]
  typeSubCategories: string[]
}

async function getProductFilterOptions(typeFilters?: Database["public"]["Enums"]["item_type"][]): Promise<ProductFilterOptions> {
  const { data: allProducts, error: allError } = await supabase
    .from("products")
    .select("type")

  if (allError) {
    throw new Error(allError.message)
  }

  const allTypes = [...new Set((allProducts ?? []).map((p) => p.type).filter(Boolean))]

  let filteredQuery = supabase
    .from("products")
    .select("gender, brand, category_id, fit, feel, vibes, type_category")

  if (typeFilters && typeFilters.length > 0) {
    filteredQuery = filteredQuery.in("type", typeFilters)
  }

  const { data: filteredProducts, error: filteredError } = await filteredQuery

  if (filteredError) {
    throw new Error(filteredError.message)
  }

  const products = filteredProducts ?? []

  const splitAndUnique = (items: (string | null)[]) => {
    const allValues = items
      .filter((i): i is string => typeof i === 'string' && i.length > 0)
      .flatMap(i => i.split(',').map(s => s.trim()))
    return [...new Set(allValues)].sort()
  }

  const genders = [...new Set(products.map((p) => p.gender).filter(Boolean))].sort()
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort()
  const categoryIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))].sort()

  const fits = splitAndUnique(products.map((p) => p.fit))
  const feels = splitAndUnique(products.map((p) => p.feel))
  const vibes = splitAndUnique(products.map((p) => p.vibes))
  const typeSubCategories = [...new Set(products.map((p) => p.type_category).filter(Boolean))].sort()

  return {
    types: allTypes.sort(),
    genders,
    brands,
    categoryIds,
    fits,
    feels,
    vibes,
    typeSubCategories,
  }
}

export const BROWSE_PRODUCTS_PAGE = 24

const PRODUCT_COLUMNS =
  "id, product_name, brand, price, currency, image_url, thumbnail_url, color, type, type_category, gender, fit, feel, vibes, category_id, color_group, size, product_url, placement, placement_x, placement_y, image_length, body_parts_visible"

interface BrowseProductsInput {
  slot: Database["public"]["Enums"]["item_type"]
  gender: Gender
  cursor?: number | null
}

/** No-query browse for a slot: newest pieces the profile gender can wear. */
export async function browseProducts({ slot, gender, cursor }: BrowseProductsInput): Promise<SearchFunctionResponse<ProductSearchResult>> {
  const from = Math.max(cursor ?? 0, 0)
  let query = supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("type", slot)
    .not("image_url", "is", null)
    // Never placed on any mannequin — the studio cannot draw it. The exact
    // per-mannequin check is the feed's (isPlaceableOnMannequin); this only
    // keeps a page from filling with rows that will all be dropped.
    .not("placement", "is", null)
  if (gender === "male" || gender === "female") {
    query = query.or(`${buildGenderFilter(gender)},gender.is.null`)
  }
  const { data, error } = await query.order("created_at", { ascending: false }).range(from, from + BROWSE_PRODUCTS_PAGE - 1)
  if (error) {
    throw new Error(error.message)
  }
  const rows = data ?? []
  const results = rows
    .map((row) => mapProductRowToResult(row as unknown as Record<string, unknown>))
    .filter((row): row is ProductSearchResult => Boolean(row))
  // Base pagination on the raw row count, not results.length — a row that fails mapping
  // shouldn't be mistaken for the end of the list.
  return { results, nextCursor: rows.length === BROWSE_PRODUCTS_PAGE ? from + BROWSE_PRODUCTS_PAGE : null }
}

export const searchService = {
  getBrowseCollections,
  browseCollectionLooks,
  searchOutfits,
  searchProducts,
  getProductFilterOptions,
  browseProducts,
}
