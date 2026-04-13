import { supabase } from "@/integrations/supabase/client"
import type { Database } from "@/integrations/supabase/types"
import type { PostgrestError } from "@supabase/supabase-js"
import type { Outfit } from "@/types"
import type { StudioOutfitDTO } from "@/features/studio/types"
import { mapDbOutfitToStudioOutfit } from "@/features/studio/mappers/renderedItemMapper"

import { mapDbOutfitToOutfit } from "@/services/shared/transformers/outfitTransformers"
import { reportStudioDataIssue } from "@/features/studio/utils/reportDataIssue"
import { searchService, type ProductSearchFilters, type ProductSearchResult } from "@/services/search/searchService"

type DbOutfitRow = Database["public"]["Tables"]["outfits"]["Row"] & {
  occasion: Database["public"]["Tables"]["occasions"]["Row"] | null
  top: Database["public"]["Tables"]["products"]["Row"] | null
  bottom: Database["public"]["Tables"]["products"]["Row"] | null
  shoes: Database["public"]["Tables"]["products"]["Row"] | null
}

export type StudioProductTraySlot = "top" | "bottom" | "shoes"

type Gender = "male" | "female" | null

export interface StudioProductTrayItem {
  slot: StudioProductTraySlot
  productId: string
  title: string
  brand: string | null
  price: number
  currency: string
  productUrl: string | null
  rating?: number | null
  reviewCount?: number | null
  imageUrl?: string | null
  placementX: number
  placementY: number
  imageLength: number
  color?: string | null
  size?: string | null
  itemType?: Database["public"]["Enums"]["item_type"] | null
  metadataSource: "product" | "default"
  fitTags: string[]
  feelTags: string[]
  vibeTags: string[]
  care: string | null
  materialType: string | null
  bodyPartsVisible?: string[] | null
}

export interface StudioProductDetail {
  id: string
  title: string
  brand: string | null
  price: number
  currency: string
  description: string | null
  imageUrl: string | null
  productUrl: string | null
  fitTags: string[]
  feelTags: string[]
  vibeTags: string[]
  slot: StudioProductTraySlot | null
  category: string | null
  gender: Gender
  care: string | null
  materialType: string | null
}

export interface StudioAlternativeProduct {
  id: string
  title: string
  brand: string | null
  price: number
  currency: string
  imageSrc: string
  productUrl: string | null
  placementX: number
  placementY: number
  imageLength: number
  color?: string | null
  size?: string | null
  itemType: StudioProductTraySlot
  gender?: Gender
  metadataSource: "product" | "default"
  bodyPartsVisible?: string[] | null
}

export interface StudioComplementaryProduct {
  id: string
  title: string
  brand: string | null
  price: number
  currency: string
  imageSrc: string
  itemType: StudioProductTraySlot | null
}

interface GetAlternativesInput {
  slot: StudioProductTraySlot
  gender: Gender
  limit?: number
  filters?: ProductSearchFilters
}

const OUTFIT_SELECT = `
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
    vibes,
    placement_x,
    placement_y,
    image_length,
    type_category,
    body_parts_visible,
    care,
    material_type
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
    vibes,
    placement_x,
    placement_y,
    image_length,
    type_category,
    body_parts_visible,
    care,
    material_type
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
    vibes,
    placement_x,
    placement_y,
    image_length,
    type_category,
    body_parts_visible,
    care,
    material_type
  )
`

interface SearchAlternativesInput {
  slot: StudioProductTraySlot
  query?: string
  imageUrl?: string
  filters?: ProductSearchFilters
  gender: Gender
}

const isHttpUrl = (value?: string | null) => Boolean(value && /^https?:\/\//i.test(value))

async function searchAlternatives({
  slot,
  query,
  imageUrl,
  filters = {},
  gender,
}: SearchAlternativesInput): Promise<StudioAlternativeProduct[]> {
  const itemType = SLOT_TO_ITEM_TYPE[slot]
  const safeImageUrl = isHttpUrl(imageUrl) ? imageUrl : undefined

  // Create a new filters object merging the slot type and gender
  const searchFilters: ProductSearchFilters = {
    ...filters,
    typeCategories: [itemType],
  }

  // Force gender filter as requested by user ("whenever search query goes... just send filter as male and unisex")
  // This overrides any manually selected gender filters, but ensures the user always sees their gender + unisex in this flow.
  if (gender === 'male' || gender === 'female') {
    searchFilters.genders = [gender, 'unisex']
  }

  // Check if we have an active search (query or image)
  const hasActiveSearch = (query && query.trim().length > 0) || (safeImageUrl && safeImageUrl.trim().length > 0)

  if (!hasActiveSearch) {
    // Fallback to direct DB query with filters
    return getAlternatives({
      slot,
      gender,
      limit: 1000,
      filters: searchFilters,
    })
  }

  try {
    const { results } = await searchService.searchProducts({
      query,
      imageUrl: safeImageUrl,
      filters: searchFilters,
      limit: 48,
    })

    return results.map((result) => mapSearchResultToAlternative(result, slot))
  } catch (error) {
    console.warn("[studioService] searchProducts failed, falling back to DB results.", error)
    return getAlternatives({
      slot,
      gender,
      limit: 1000,
      filters: searchFilters,
    })
  }
}

const OUTFIT_TRAY_SELECT = `
  id,
  top:products!outfits_top_id_fkey(
    id,
    product_name,
    brand,
    price,
    currency,
    product_url,
    image_url,
    placement_x,
    placement_y,
    image_length,
    size,
    color,
    type,
    gender,
    fit,
    feel,
    vibes,
    body_parts_visible
  ),
  bottom:products!outfits_bottom_id_fkey(
    id,
    product_name,
    brand,
    price,
    currency,
    product_url,
    image_url,
    placement_x,
    placement_y,
    image_length,
    size,
    color,
    type,
    gender,
    fit,
    feel,
    vibes,
    body_parts_visible
  ),
  shoes:products!outfits_shoes_id_fkey(
    id,
    product_name,
    brand,
    price,
    currency,
    product_url,
    image_url,
    placement_x,
    placement_y,
    image_length,
    size,
    color,
    type,
    gender,
    fit,
    feel,
    vibes,
    body_parts_visible
  )
`

type DbOutfitTrayRow = {
  id: string
  top: Database["public"]["Tables"]["products"]["Row"] | null
  bottom: Database["public"]["Tables"]["products"]["Row"] | null
  shoes: Database["public"]["Tables"]["products"]["Row"] | null
}

function parseTagList(value?: string | null): string[] {
  if (!value) {
    return []
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== "null" && entry.toLowerCase() !== "nan")
}

function toTrayItem(slot: StudioProductTraySlot, product: Database["public"]["Tables"]["products"]["Row"] | null) {
  if (!product) {
    return null
  }

  const placement = normalizePlacement(slot, product)
  const fitTags = parseTagList(product.fit)
  const feelTags = parseTagList(product.feel)
  const vibeTags = parseTagList(product.vibes)

  return {
    slot,
    productId: product.id,
    title: product.product_name ?? product.brand ?? "Product",
    brand: product.brand ?? null,
    price: product.price ?? 0,
    currency: product.currency ?? "INR",
    productUrl: product.product_url ?? null,
    rating: null,
    reviewCount: null,
    imageUrl: product.image_url ?? null,
    placementX: placement.placementX,
    placementY: placement.placementY,
    imageLength: placement.imageLength,
    color: product.color ?? null,
    size: product.size ?? null,
    itemType: product.type ?? null,
    metadataSource: placement.metadataSource,
    fitTags,
    feelTags,
    vibeTags,
    care: product.care ?? null,
    materialType: product.material_type ?? null,
    bodyPartsVisible: (Array.isArray(product.body_parts_visible) ? product.body_parts_visible : null) as string[] | null,
  } satisfies StudioProductTrayItem
}

type OutfitSlotsRow = {
  top: Database["public"]["Tables"]["products"]["Row"] | null
  bottom: Database["public"]["Tables"]["products"]["Row"] | null
  shoes: Database["public"]["Tables"]["products"]["Row"] | null
}

function deriveTrayItemsFromRow(row: OutfitSlotsRow | null): StudioProductTrayItem[] {
  if (!row) {
    return []
  }

  return [toTrayItem("top", row.top), toTrayItem("bottom", row.bottom), toTrayItem("shoes", row.shoes)].filter(
    Boolean,
  ) as StudioProductTrayItem[]
}

function deriveTrayItemsFromOutfit(outfit: Outfit | null): StudioProductTrayItem[] {
  if (!outfit) {
    return []
  }

  const slotOrder: StudioProductTraySlot[] = ["top", "bottom", "shoes"]
  return slotOrder
    .map((slot) => {
      const product = outfit.items.find((item) => item.type === slot)
      if (!product) {
        return null
      }
      const placement = normalizeOutfitItemPlacement(slot, product)
      return {
        slot,
        productId: product.id,
        title: product.product_name ?? product.brand ?? "Product",
        brand: product.brand ?? null,
        price: product.price ?? 0,
        currency: product.currency ?? "INR",
        productUrl: product.productUrl ?? null,
        rating: null,
        reviewCount: null,
        imageUrl: product.imageUrl ?? null,
        placementX: placement.placementX,
        placementY: placement.placementY,
        imageLength: placement.imageLength,
        color: product.color ?? null,
        size: product.size ?? null,
        itemType: slot,
        metadataSource: placement.metadataSource,
        fitTags: parseTagList(product.fit),
        feelTags: parseTagList(product.feel),
        vibeTags: [],
        care: null, // Not available in legacy Outfit items
        materialType: null,
        bodyPartsVisible: null,
      } satisfies StudioProductTrayItem
    })
    .filter(Boolean) as StudioProductTrayItem[]
}

async function fetchOutfitRow(outfitId: string): Promise<DbOutfitRow | null> {
  const response = await supabase.from("outfits").select(OUTFIT_SELECT).eq("id", outfitId).maybeSingle()

  if (response.error) {
    throw new Error(response.error.message)
  }

  return (response.data as DbOutfitRow | null) ?? null
}

async function fetchOutfitTrayRow(outfitId: string): Promise<DbOutfitTrayRow | null> {
  const response = await supabase.from("outfits").select(OUTFIT_TRAY_SELECT).eq("id", outfitId).maybeSingle()

  if (response.error) {
    throw new Error(response.error.message)
  }

  return (response.data as DbOutfitTrayRow | null) ?? null
}

export interface StudioOutfitPayload {
  outfit: Outfit | null
  studioOutfit: StudioOutfitDTO | null
  trayItems: StudioProductTrayItem[]
}

type GetRandomOutfitByGenderInput = {
  gender: Gender
  excludeOutfitId?: string | null
}

async function getRandomOutfitByGender({
  gender: _gender,
  excludeOutfitId,
}: GetRandomOutfitByGenderInput): Promise<StudioOutfitPayload> {
  const query = supabase.from("outfits").select(OUTFIT_SELECT).limit(48)

  if (excludeOutfitId) {
    query.neq("id", excludeOutfitId)
  }

  // Filter by gender using the user's gender (and unisex)
  // Logic: (gender = user_gender) OR (gender = unisex)
  // We use the helper function buildGenderFilter which creates a comma-separated OR string
  query.or(buildGenderFilter(_gender))

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  const rows = (data as DbOutfitRow[] | null) ?? []
  if (rows.length === 0) {
    return { outfit: null, studioOutfit: null, trayItems: [] }
  }

  const picked = rows[Math.floor(Math.random() * rows.length)] ?? null
  if (!picked) {
    return { outfit: null, studioOutfit: null, trayItems: [] }
  }

  return {
    outfit: mapDbOutfitToOutfit(picked),
    studioOutfit: mapDbOutfitToStudioOutfit(picked as any),
    trayItems: deriveTrayItemsFromRow(picked),
  }
}

function buildGenderFilter(gender: Gender | null) {
  const clauses = ["gender.eq.unisex"]
  if (gender === "male" || gender === "female") {
    clauses.unshift(`gender.eq.${gender}`)
  } else {
    clauses.push("gender.eq.male", "gender.eq.female")
  }
  return clauses.join(",")
}

const SLOT_TO_ITEM_TYPE: Record<StudioProductTraySlot, Database["public"]["Enums"]["item_type"]> = {
  top: "top",
  bottom: "bottom",
  shoes: "shoes",
}

const SLOT_DEFAULTS: Record<
  StudioProductTraySlot,
  { placementX: number; placementY: number; imageLength: number }
> = {
  top: { placementX: 0, placementY: -3, imageLength: 68 },
  bottom: { placementX: 0, placementY: 33, imageLength: 70 },
  shoes: { placementX: 0, placementY: 80, imageLength: 40 },
}

function normalizePlacement(slot: StudioProductTraySlot, product: Database["public"]["Tables"]["products"]["Row"] | null) {
  const defaults = SLOT_DEFAULTS[slot]
  if (!product) {
    return { ...defaults, metadataSource: "default" as const }
  }

  const hasPlacement =
    typeof product.placement_y === "number" && typeof product.image_length === "number"

  if (!hasPlacement) {
    reportStudioDataIssue({
      type: "missing-placement",
      slot,
      productId: product.id,
      placement_x: product.placement_x,
      placement_y: product.placement_y,
      image_length: product.image_length,
    })
    return { ...defaults, metadataSource: "default" as const }
  }

  return {
    placementX: product.placement_x ?? defaults.placementX,
    placementY: product.placement_y ?? defaults.placementY,
    imageLength: product.image_length ?? defaults.imageLength,
    metadataSource: "product" as const,
  }
}

function normalizeOutfitItemPlacement(slot: StudioProductTraySlot, item?: Outfit["items"][number]) {
  const defaults = SLOT_DEFAULTS[slot]
  if (!item) {
    return { ...defaults, metadataSource: "default" as const }
  }

  const hasPlacement =
    typeof item.placement_y === "number" && typeof item.image_length === "number"

  if (!hasPlacement) {
    reportStudioDataIssue({
      type: "missing-placement",
      slot,
      productId: item.id,
      placement_x: item.placement_x,
      placement_y: item.placement_y,
      image_length: item.image_length,
    })
    return { ...defaults, metadataSource: "default" as const }
  }

  return {
    placementX: item.placement_x ?? defaults.placementX,
    placementY: item.placement_y ?? defaults.placementY,
    imageLength: item.image_length ?? defaults.imageLength,
    metadataSource: "product" as const,
  }
}

function hasPlacementStats(
  placementX: unknown,
  placementY: unknown,
  imageLength: unknown,
): boolean {
  return (
    typeof placementX === "number" &&
    Number.isFinite(placementX) &&
    typeof placementY === "number" &&
    Number.isFinite(placementY) &&
    typeof imageLength === "number" &&
    Number.isFinite(imageLength)
  )
}

function mapProductRowToAlternative(
  row: Database["public"]["Tables"]["products"]["Row"],
): StudioAlternativeProduct {
  const title = row.product_name ?? row.brand ?? "Product"
  const gender = row.gender === "male" || row.gender === "female" ? row.gender : null
  const itemType = (row.type as StudioProductTraySlot) ?? "top"
  const placementX = row.placement_x
  const placementY = row.placement_y
  const imageLength = row.image_length

  if (!hasPlacementStats(placementX, placementY, imageLength)) {
    reportStudioDataIssue({
      type: "missing-placement",
      slot: itemType,
      productId: row.id,
      placement_x: typeof placementX === "number" ? placementX : null,
      placement_y: typeof placementY === "number" ? placementY : null,
      image_length: typeof imageLength === "number" ? imageLength : null,
    })

    const defaults = SLOT_DEFAULTS[itemType]
    return {
      id: row.id,
      title,
      brand: row.brand ?? null,
      price: row.price ?? 0,
      currency: row.currency ?? "INR",
      imageSrc: row.image_url ?? "",
      productUrl: row.product_url ?? null,
      placementX: defaults.placementX,
      placementY: defaults.placementY,
      imageLength: defaults.imageLength,
      color: row.color ?? null,
      size: row.size ?? null,
      itemType,
      gender,
      metadataSource: "default",
      bodyPartsVisible: (Array.isArray(row.body_parts_visible) ? row.body_parts_visible : null) as string[] | null,
    }
  }

  return {
    id: row.id,
    title,
    brand: row.brand ?? null,
    price: row.price ?? 0,
    currency: row.currency ?? "INR",
    imageSrc: row.image_url ?? "",
    productUrl: row.product_url ?? null,
    placementX: placementX!,
    placementY: placementY!,
    imageLength: imageLength!,
    color: row.color ?? null,
    size: row.size ?? null,
    itemType,
    gender,
    metadataSource: "product",
    bodyPartsVisible: (Array.isArray(row.body_parts_visible) ? row.body_parts_visible : null) as string[] | null,
  }
}

/**
 * Maps a ProductSearchResult from hybrid search to StudioAlternativeProduct.
 * Used by getSimilarProductsByProductId to convert hybrid search results.
 */
function mapSearchResultToAlternative(
  result: ProductSearchResult,
  fallbackSlot?: StudioProductTraySlot,
): StudioAlternativeProduct {
  const itemType = (result.type as StudioProductTraySlot) ?? fallbackSlot ?? "top"
  const placementX = result.placementX
  const placementY = result.placementY
  const imageLength = result.imageLength

  if (!hasPlacementStats(placementX, placementY, imageLength)) {
    reportStudioDataIssue({
      type: "missing-placement",
      slot: itemType,
      productId: result.id,
      placement_x: typeof placementX === "number" ? placementX : null,
      placement_y: typeof placementY === "number" ? placementY : null,
      image_length: typeof imageLength === "number" ? imageLength : null,
    })

    const defaults = SLOT_DEFAULTS[itemType]
    return {
      id: result.id,
      title: result.title,
      brand: result.brand ?? null,
      price: result.price ?? 0,
      currency: result.currency ?? "INR",
      imageSrc: result.imageSrc,
      productUrl: result.productUrl ?? null,
      placementX: defaults.placementX,
      placementY: defaults.placementY,
      imageLength: defaults.imageLength,
      color: result.color ?? null,
      size: result.size ?? null,
      itemType,
      gender: (result.gender as Gender) ?? null,
      metadataSource: "default",
      bodyPartsVisible: result.bodyPartsVisible ?? null,
    }
  }

  return {
    id: result.id,
    title: result.title,
    brand: result.brand ?? null,
    price: result.price ?? 0,
    currency: result.currency ?? "INR",
    imageSrc: result.imageSrc,
    productUrl: result.productUrl ?? null,
    placementX: placementX!,
    placementY: placementY!,
    imageLength: imageLength!,
    color: result.color ?? null,
    size: result.size ?? null,
    itemType,
    gender: (result.gender as Gender) ?? null,
    metadataSource: "product",
    bodyPartsVisible: result.bodyPartsVisible ?? null,
  }
}

export function mapTrayItemToAlternative(item: StudioProductTrayItem): StudioAlternativeProduct {
  return {
    id: item.productId,
    title: item.title,
    brand: item.brand ?? null,
    price: item.price,
    currency: item.currency,
    imageSrc: item.imageUrl ?? "",
    productUrl: item.productUrl ?? null,
    placementX: item.placementX,
    placementY: item.placementY,
    imageLength: item.imageLength,
    color: item.color ?? null,
    size: item.size ?? null,
    itemType: item.slot,
    metadataSource: item.metadataSource,
    bodyPartsVisible: item.bodyPartsVisible ?? null,
  }
}

export function mapTrayItemToProductDetail(item: StudioProductTrayItem): StudioProductDetail {
  return {
    id: item.productId,
    title: item.title,
    brand: item.brand ?? null,
    price: item.price,
    currency: item.currency,
    description: null,
    imageUrl: item.imageUrl ?? null,
    productUrl: item.productUrl ?? null,
    fitTags: item.fitTags,
    feelTags: item.feelTags,
    vibeTags: item.vibeTags,
    slot: item.slot,
    category: null,
    gender: null,
    care: null,
    materialType: null,
  }
}

const COMPLEMENTARY_SLOT_MAP: Record<StudioProductTraySlot, StudioProductTraySlot[]> = {
  top: ["bottom", "shoes"],
  bottom: ["top", "shoes"],
  shoes: ["top", "bottom"],
}

type GenderFilterValue = "male" | "female" | "unisex"

function buildGenderList(gender: Gender | null): GenderFilterValue[] {
  if (gender === "male" || gender === "female") {
    return [gender, "unisex"]
  }

  return ["male", "female", "unisex"]
}

async function getOutfitById(outfitId: string): Promise<StudioOutfitPayload> {
  if (!outfitId) {
    return { outfit: null, studioOutfit: null, trayItems: [] }
  }

  const row = await fetchOutfitRow(outfitId)
  if (!row) {
    return { outfit: null, studioOutfit: null, trayItems: [] }
  }

  return {
    outfit: mapDbOutfitToOutfit(row),
    studioOutfit: mapDbOutfitToStudioOutfit(row as any),
    trayItems: deriveTrayItemsFromRow(row),
  }
}

async function getProductTrayItems(outfitId: string): Promise<StudioProductTrayItem[]> {
  if (!outfitId) {
    return []
  }

  const row = await fetchOutfitTrayRow(outfitId)
  return deriveTrayItemsFromRow(row)
}

async function getAlternatives({ slot, gender, limit = 24, filters }: GetAlternativesInput): Promise<StudioAlternativeProduct[]> {
  const itemType = SLOT_TO_ITEM_TYPE[slot]
  let query = supabase
    .from("products")
    .select(
      "id, product_name, brand, price, image_url, product_url, gender, type, placement_x, placement_y, image_length, size, currency, color, fit, feel, vibes, body_parts_visible",
    )
    .eq("type", itemType)
    .not("gender", "is", null)
    .limit(limit)
    .order("updated_at", { ascending: false })

  query = query.or(buildGenderFilter(gender))

  if (filters) {
    // Brands
    if (filters.brands && filters.brands.length > 0) {
      query = query.in("brand", filters.brands)
    }

    // Colors
    if (filters.colorGroups && filters.colorGroups.length > 0) {
      // Note: This matches exact color string. For robust color grouping, we'd need text search.
      // Keeping it simple for fallback: check if color is in the list
      query = query.in("color", filters.colorGroups)
    }

    // Price range
    if (filters.minPrice !== undefined) {
      query = query.gte("price", filters.minPrice)
    }
    if (filters.maxPrice !== undefined) {
      query = query.lte("price", filters.maxPrice)
    }

    // Tags (Fit, Feel, Vibes) - these are CSV strings in DB, so we use ilike
    const applyTagFilters = (column: string, tags?: string[]) => {
      if (tags && tags.length > 0) {
        // Construct OR filter: column.ilike.%tag1%,column.ilike.%tag2%
        const orClause = tags.map(tag => `${column}.ilike.%${tag}%`).join(",")
        query = query.or(orClause)
      }
    }

    applyTagFilters("fit", filters.fits)
    applyTagFilters("feel", filters.feels)
    applyTagFilters("vibes", filters.vibes)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? [])
    .map((row) => mapProductRowToAlternative(row as Database["public"]["Tables"]["products"]["Row"]))
    .filter((item): item is StudioAlternativeProduct => Boolean(item))
}

async function getProductById(productId: string): Promise<StudioProductTrayItem | null> {
  if (!productId) {
    return null
  }

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, product_name, brand, price, image_url, product_url, gender, type, placement_x, placement_y, image_length, size, currency, color, fit, feel, vibes, body_parts_visible, care, material_type",
    )
    .eq("id", productId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return null
  }

  const slot = (data.type as StudioProductTraySlot) ?? "top"
  const placement = normalizePlacement(slot, data as Database["public"]["Tables"]["products"]["Row"])

  return {
    slot,
    productId: data.id,
    title: data.product_name ?? data.brand ?? "Product",
    brand: data.brand ?? null,
    price: data.price ?? 0,
    currency: data.currency ?? "INR",
    productUrl: data.product_url ?? null,
    rating: null,
    reviewCount: null,
    imageUrl: data.image_url ?? null,
    placementX: placement.placementX,
    placementY: placement.placementY,
    imageLength: placement.imageLength,
    color: data.color ?? null,
    size: data.size ?? null,
    itemType: data.type ?? null,
    metadataSource: placement.metadataSource,
    fitTags: parseTagList(data.fit),
    feelTags: parseTagList(data.feel),
    vibeTags: parseTagList(data.vibes),
    care: data.care ?? null,
    materialType: data.material_type ?? null,
    bodyPartsVisible: (Array.isArray(data.body_parts_visible) ? data.body_parts_visible : null) as string[] | null,
  }
}

async function getProductDetail(productId: string): Promise<StudioProductDetail | null> {
  if (!productId) {
    return null
  }

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, product_name, brand, price, currency, description, description_text, image_url, product_url, fit, feel, vibes, type, category_id, gender, care, material_type",
    )
    .eq("id", productId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return null
  }

  return {
    id: data.id,
    title: data.product_name ?? data.brand ?? "Product",
    brand: data.brand ?? null,
    price: data.price ?? 0,
    currency: data.currency ?? "INR",
    description: data.description_text ?? data.description ?? null,
    imageUrl: data.image_url ?? null,
    productUrl: data.product_url ?? null,
    fitTags: parseTagList(data.fit),
    feelTags: parseTagList(data.feel),
    vibeTags: parseTagList(data.vibes),
    slot: (data.type as StudioProductTraySlot) ?? null,
    category: (data as Database["public"]["Tables"]["products"]["Row"]).category_id ?? null,
    gender: data.gender === "male" || data.gender === "female" ? data.gender : null,
    care: data.care ?? null,
    materialType: data.material_type ?? null,
  }
}

interface GetProductOutfitsInput {
  slot: StudioProductTraySlot
  productId: string
  limit?: number
  userGender?: Gender | null
}

async function getOutfitsByProduct({
  slot,
  productId,
  limit = 12,
  userGender,
}: GetProductOutfitsInput): Promise<{ outfit: Outfit; studioOutfit: StudioOutfitDTO | null }[]> {
  if (!productId) {
    return []
  }

  const slotColumnMap: Record<StudioProductTraySlot, string> = {
    top: "top_id",
    bottom: "bottom_id",
    shoes: "shoes_id",
  }


  // Supabase's generated types struggle with the deeply nested select used for avatar pieces,
  // so we intentionally cast this builder to `any` to avoid the "type instantiation is excessively deep" error.
  const query = (supabase as any)
    .from("outfits")
    .select(OUTFIT_SELECT)
    .eq(slotColumnMap[slot], productId)
    .eq("visible_in_feed", true)
    .not("gender", "is", null)
    .or(buildGenderFilter(userGender ?? null))
    .limit(limit)
    .order("popularity", { ascending: false })

  const response = (await query) as { data: DbOutfitRow[] | null; error: PostgrestError | null }

  const { data, error } = response

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => ({
    outfit: mapDbOutfitToOutfit(row as DbOutfitRow),
    studioOutfit: mapDbOutfitToStudioOutfit(row as any),
  }))
}

/**
 * Build search text matching the embedding format from buildProductText in generate-fashion-siglip-embeddings-local.js
 * Format: product_name. description. fit. feel. color. vibes. type_category (joined with '. ')
 */
function buildSimilarProductSearchText(product: {
  product_name: string | null
  description: string | null
  fit: string | null
  feel: string | null
  color: string | null
  vibes: string | null
  type_category: string | null
}): string {
  const fields = [
    product.product_name,
    product.description,
    product.fit,
    product.feel,
    product.color,
    product.vibes,
    product.type_category,
  ]
  return fields
    .filter((field) => field != null && field !== "")
    .join(". ")
    .trim()
}

/**
 * Get similar products using hybrid search (semantic + keyword).
 * Uses the same text format as the embedding generation for optimal matching.
 * Filters by same item type and gender, excludes the current product.
 */
async function getSimilarProductsByProductId(
  productId: string,
  limit = 12,
): Promise<StudioAlternativeProduct[]> {
  if (!productId) {
    console.log("[SimilarProducts] No productId provided")
    return []
  }

  // Fetch product with all fields needed for search text (matches embedding format)
  const { data: productData, error: productError } = await supabase
    .from("products")
    .select("id, product_name, description, fit, feel, color, vibes, type_category, type, gender")
    .eq("id", productId)
    .maybeSingle()

  if (productError) {
    console.log("[SimilarProducts] Error fetching product:", productError.message)
    return []
  }

  if (!productData) {
    console.log("[SimilarProducts] Product not found:", productId)
    return []
  }

  // Build search text matching the embedding format
  const searchText = buildSimilarProductSearchText(productData)
  if (!searchText) {
    console.log("[SimilarProducts] No searchable text found for product:", productId)
    return []
  }

  // Build filters for same item type and compatible gender
  const slot = (productData.type as StudioProductTraySlot) ?? null
  const gender = productData.gender === "male" || productData.gender === "female" ? productData.gender : null

  const filters: ProductSearchFilters = {}
  if (slot) {
    filters.typeCategories = [slot]
  }
  if (gender) {
    filters.genders = [gender]
  }

  console.log("[SimilarProducts] Searching with:", {
    productId,
    searchQuery: searchText,
    filters,
  })

  // Use hybrid search with the same text format as embeddings
  const { results } = await searchService.searchProducts({
    query: searchText,
    filters,
  })

  console.log("[SimilarProducts] Raw results from hybrid search:", results.length)

  // Exclude current product and map to StudioAlternativeProduct
  const filtered = results.filter((r) => r.id !== productId)
  console.log("[SimilarProducts] After excluding current product:", filtered.length)

  const finalResults = filtered
    .map((result) => mapSearchResultToAlternative(result))
    .filter((item): item is StudioAlternativeProduct => Boolean(item))
    .slice(0, limit)
  console.log("[SimilarProducts] Final results (limited to", limit, "):", finalResults.length)

  return finalResults
}

interface GetComplementaryProductsInput {
  productId: string
  limit?: number
  userGender?: Gender | null
}

interface GetComplementaryProductsBySlotInput {
  productId: string
  slot: StudioProductTraySlot
  limit?: number
  userGender?: Gender | null
}

async function getComplementaryProductsByProductId({
  productId,
  limit = 12,
  userGender,
}: GetComplementaryProductsInput): Promise<StudioAlternativeProduct[]> {
  if (!productId) {
    return []
  }

  const { data, error } = await supabase
    .from("products")
    .select("id, type")
    .eq("id", productId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return []
  }

  const slot = (data.type as StudioProductTraySlot) ?? "top"
  const complementarySlots = COMPLEMENTARY_SLOT_MAP[slot] ?? []

  if (complementarySlots.length === 0) {
    return []
  }

  const genderList = buildGenderList(userGender ?? null)

  const query = supabase
    .from("products")
    .select(
      "id, product_name, brand, price, image_url, product_url, gender, type, placement_x, placement_y, image_length, size, currency, color, fit, feel, vibes, body_parts_visible",
    )
    .in("type", complementarySlots)
    .neq("id", productId)
    .limit(limit)
    .order("updated_at", { ascending: false })
    .not("gender", "is", null)
    .in("gender", genderList)

  const { data: rows, error: rowsError } = await query

  if (rowsError) {
    throw new Error(rowsError.message)
  }

  return (rows ?? [])
    .map((row) => mapProductRowToAlternative(row as Database["public"]["Tables"]["products"]["Row"]))
    .filter((item): item is StudioAlternativeProduct => Boolean(item))
}

async function getComplementaryProductsBySlot({
  productId,
  slot,
  limit = 12,
  userGender,
}: GetComplementaryProductsBySlotInput): Promise<StudioComplementaryProduct[]> {
  if (!productId) {
    return []
  }

  const complementarySlots = COMPLEMENTARY_SLOT_MAP[slot] ?? []
  if (complementarySlots.length === 0) {
    return []
  }

  const genderList = buildGenderList(userGender ?? null)

  const query = supabase
    .from("products")
    .select("id, product_name, brand, price, currency, image_url, gender, type")
    .in("type", complementarySlots)
    .neq("id", productId)
    .limit(limit)
    .order("updated_at", { ascending: false })
    .not("gender", "is", null)
    .in("gender", genderList)

  const { data: rows, error: rowsError } = await query

  if (rowsError) {
    throw new Error(rowsError.message)
  }

  return (rows ?? [])
    .map((row) => ({
      id: row.id,
      title: row.product_name ?? row.brand ?? "Product",
      brand: row.brand ?? null,
      price: row.price ?? 0,
      currency: row.currency ?? "INR",
      imageSrc: row.image_url ?? "",
      itemType: (row.type as StudioProductTraySlot) ?? null,
    }))
    .filter((item) => Boolean(item.id))
}

async function getOutfitsByCategory(
  category: string | null,
  limit = 12,
  gender: Gender | null = null,
): Promise<{ outfit: Outfit; studioOutfit: StudioOutfitDTO | null }[]> {
  if (!category) {
    return []
  }

  const page = await getOutfitsByCategoryPage({
    categoryId: category,
    gender,
    cursor: 0,
    limit,
  })

  return page.results
}

interface GetCategoryOutfitsPageInput {
  categoryId: string
  gender: Gender | null
  cursor?: number | null
  limit?: number
}

interface CategoryOutfitsPage {
  results: { outfit: Outfit; studioOutfit: StudioOutfitDTO | null }[]
  nextCursor: number | null
}

async function getOutfitsByCategoryPage({
  categoryId,
  gender,
  cursor,
  limit = 50,
}: GetCategoryOutfitsPageInput): Promise<CategoryOutfitsPage> {
  const normalizedCursor = typeof cursor === "number" ? cursor : 0
  const from = normalizedCursor
  const to = normalizedCursor + Math.max(1, limit) - 1

  const response = (await (supabase as any)
    .from("outfits")
    .select(OUTFIT_SELECT)
    .eq("category", categoryId)
    .eq("visible_in_feed", true)
    .not("gender", "is", null)
    .or(buildGenderFilter(gender))
    .order("popularity", { ascending: false })
    .range(from, to)) as { data: DbOutfitRow[] | null; error: PostgrestError | null }

  const { data, error } = response

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []) as DbOutfitRow[]
  const results = rows.map((row) => ({
    outfit: mapDbOutfitToOutfit(row as DbOutfitRow),
    studioOutfit: mapDbOutfitToStudioOutfit(row as any),
  }))

  const nextCursor = rows.length >= limit ? normalizedCursor + limit : null
  return { results, nextCursor }
}



export const studioService = {
  getOutfitById,
  getRandomOutfitByGender,
  getProductTrayItems,
  deriveTrayItemsFromOutfit,
  getAlternatives,
  getProductById,
  getOutfitsByProduct,
  getProductDetail,
  getSimilarProductsByProductId,
  getComplementaryProductsByProductId,
  getComplementaryProductsBySlot,
  getOutfitsByCategory,
  getOutfitsByCategoryPage,
  searchAlternatives,
}

export { SLOT_DEFAULTS }
