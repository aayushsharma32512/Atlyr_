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
  cursor?: number | null
  limit?: number
  filters?: ProductSearchFilters
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
}

interface SearchFunctionResponse<T> {
  results: T[]
  nextCursor: number | null
}

async function getFeaturedCategories(): Promise<CategoryMetadata[]> {
  const { data, error } = await supabase.from("categories").select("id,name,slug").order("name", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((category) => ({
    id: category.id,
    title: category.name,
    subtitle: category.slug.replace(/-/g, " "),
  }))
}

async function fetchCategoryOutfits(categoryId: string, limit: number, gender: Gender) {
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
        rating,
        popularity,
        created_at,
        created_by,
        user_id,
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
          product_url,
          description,
          color,
          color_group,
          category_id,
          fit,
          feel,
          placement_x,
          placement_y,
          image_length,
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
          product_url,
          description,
          color,
          color_group,
          category_id,
          fit,
          feel,
          placement_x,
          placement_y,
          image_length,
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
          product_url,
          description,
          color,
          color_group,
          category_id,
          fit,
          feel,
          placement_x,
          placement_y,
          image_length,
          type_category,
          body_parts_visible
        )
      `,
    )
    .eq("category", categoryId)
    .eq("visible_in_feed", true)
    .not("gender", "is", null)
    .order("popularity", { ascending: false })
    .limit(limit)

  query.or(buildGenderFilter(gender))

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as DbOutfitWithJoins[]
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
      const outfits = await fetchCategoryOutfits(category.id, limitPerCategory, gender)

      const mapped = outfits.map((row) => {
        const outfit = mapDbOutfitToOutfit(row)
        const studioOutfit = mapDbOutfitToStudioOutfit(row as any)

        return {
          id: outfit.id,
          title: outfit.name,
          chips: getOutfitChips(outfit),
          outfit,
          studioOutfit,
          avatarHeadUrl,
          avatarGender: gender,
          avatarHeightCm,
        } satisfies SearchBrowseOutfit
      })

      return {
        categoryId: category.id,
        title: category.title,
        subtitle: category.subtitle,
        outfits: mapped,
      } satisfies SearchBrowseCollection
    }),
  )

  return collections.filter((collection) => collection.outfits.length > 0)
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
      studioOutfit: mapDbOutfitToStudioOutfit(typedRow as any),
    }
  }
  return map
}

async function fetchProductsByIds(
  ids: string[],
): Promise<Record<string, Database["public"]["Tables"]["products"]["Row"]>> {
  if (ids.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, product_name, brand, price, currency, image_url, color, type, type_category, gender, fit, feel, vibes, category_id, color_group, size, product_url, placement_x, placement_y, image_length, body_parts_visible",
    )
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

  // Use the new Modal-based edge function for outfit search
  const { data, error } = await supabase.functions.invoke("search-outfits-v2", {
    body: {
      q: trimmed,
      imageUrl: imageUrl,
      filters: filters || {},
    },
  })

  if (error) {
    throw new Error(error.message)
  }

  const raw = (data ?? { results: [] }) as { results?: Record<string, unknown>[] }
  const rawResults = raw.results ?? []

  const ids = rawResults
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value))

  if (!ids.length) {
    return { results: [], nextCursor: null }
  }

  const outfitMap = await fetchOutfitsByIds(ids)

  const ordered: OutfitSearchResult[] = ids
    .map((id, index) => {
      const entry = outfitMap[id]
      if (!entry) {
        return null
      }

      const rawMatch = rawResults.find(r => r.id === id)
      // search-outfits-v2 returns 'final_score' (from fusion) or we can look for 'similarity'
      const similarity = typeof rawMatch?.final_score === "number"
        ? rawMatch.final_score
        : (typeof rawMatch?.similarity === "number" ? rawMatch.similarity : undefined)

      return {
        outfit: entry.outfit,
        studioOutfit: entry.studioOutfit,
        similarity,
      }
    })
    .filter(Boolean) as OutfitSearchResult[]

  // Note: search-outfits-v2 currently returns a fixed set (top 50) without backend-side cursor pagination logic.
  // We return nextCursor: null to signal end of list for now, or we could implement client-side slicing.
  return { results: ordered, nextCursor: null }
}

function mapProductRowToResult(row: Record<string, unknown>): ProductSearchResult | null {
  if (typeof row.id !== "string") {
    return null
  }

  const imageUrl = typeof row.image_url === "string" ? row.image_url : ""
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
  }
}

async function searchProducts({
  query,
  imageUrl,
  filters,
}: SearchProductsInput): Promise<SearchFunctionResponse<ProductSearchResult>> {
  const trimmed = query?.trim() ?? ""

  if (!trimmed && !imageUrl) {
    return { results: [], nextCursor: null }
  }

  const { data, error } = await supabase.functions.invoke("search-v2", {
    body: {
      q: trimmed,
      imageUrl: imageUrl,
      filters: filters || {},
    },
  })

  if (error) {
    throw new Error(error.message)
  }

  const raw = (data ?? { results: [] }) as { results?: Record<string, unknown>[] }
  const rawResults = raw.results ?? []

  const ids = rawResults
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value))

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
        placement_x: productRow.placement_x,
        placement_y: productRow.placement_y,
        image_length: productRow.image_length,
        body_parts_visible: productRow.body_parts_visible,
      }

      return mapProductRowToResult(combined)
    })
    .filter(Boolean) as ProductSearchResult[]

  return { results: mapped, nextCursor: null }
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

export const searchService = {
  getBrowseCollections,
  searchOutfits,
  searchProducts,
  getProductFilterOptions,
}
