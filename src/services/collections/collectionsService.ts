import { supabase } from "@/integrations/supabase/client"
import type { Database, Json } from "@/integrations/supabase/types"
import { mapDbOutfitToOutfit } from "@/services/shared/transformers/outfitTransformers"
import { mapDbOutfitToStudioOutfit } from "@/features/studio/mappers/renderedItemMapper"
import { parseBodyPartsVisible } from "@/features/studio/mappers/renderedItemMapper"
import type { StudioRenderedItem } from "@/features/studio/types"
import type { HomeOutfitEntry } from "@/services/home/homeService"
import type { Outfit } from "@/types"
import { getOutfitChips } from "@/utils/outfitChips"

const GENERATIONS_SIGNED_URL_TTL_SECONDS = 12 * 60 * 60
const GENERATIONS_SIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000
const GENERATIONS_SIGNED_URL_CACHE_KEY = "atlyr:generationSignedUrls:v1"
const GENERATIONS_SIGNED_URL_CACHE_LIMIT = 200

type SignedUrlCacheEntry = {
  signedUrl: string
  expiresAt: number
}

const generationSignedUrlCache = new Map<string, SignedUrlCacheEntry>()

function hydrateGenerationSignedUrlCache() {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return
  }
  try {
    const raw = window.sessionStorage.getItem(GENERATIONS_SIGNED_URL_CACHE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, SignedUrlCacheEntry>
    if (!parsed || typeof parsed !== "object") return
    const now = Date.now()
    Object.entries(parsed).forEach(([path, entry]) => {
      if (!path || typeof path !== "string") return
      if (!entry || typeof entry.signedUrl !== "string" || typeof entry.expiresAt !== "number") return
      if (entry.expiresAt <= now + GENERATIONS_SIGNED_URL_REFRESH_BUFFER_MS) return
      generationSignedUrlCache.set(path, entry)
    })
  } catch {
    // ignore cache hydration failures
  }
}

let didHydrateGenerationSignedUrlCache = false
function ensureGenerationSignedUrlCacheHydrated() {
  if (didHydrateGenerationSignedUrlCache) return
  didHydrateGenerationSignedUrlCache = true
  hydrateGenerationSignedUrlCache()
}

function persistGenerationSignedUrlCache() {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return
  }
  try {
    const entries = Array.from(generationSignedUrlCache.entries())
      .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
      .slice(0, GENERATIONS_SIGNED_URL_CACHE_LIMIT)
    window.sessionStorage.setItem(GENERATIONS_SIGNED_URL_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // ignore cache persistence failures
  }
}

function getCachedGenerationSignedUrl(path: string): string | null {
  ensureGenerationSignedUrlCacheHydrated()
  const entry = generationSignedUrlCache.get(path)
  if (!entry) return null
  if (entry.expiresAt <= Date.now() + GENERATIONS_SIGNED_URL_REFRESH_BUFFER_MS) {
    generationSignedUrlCache.delete(path)
    return null
  }
  return entry.signedUrl
}

function setCachedGenerationSignedUrl(path: string, signedUrl: string, expiresAt: number) {
  generationSignedUrlCache.set(path, { signedUrl, expiresAt })
  persistGenerationSignedUrlCache()
}

export type Moodboard = {
  slug: string
  label: string
  itemCount: number
  isSystem: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type CollectionItemType = "outfit" | "product"

export type MoodboardPreviewItem =
  | {
    itemType: "outfit"
    id: string
    gender?: "male" | "female" | null
    renderedItems?: StudioRenderedItem[]
  }
  | {
    itemType: "product"
    id: string
    imageUrl: string | null
    brand?: string | null
    price?: number | null
    currency?: string | null
    productName?: string | null
  }

export type MoodboardPreview = {
  slug: string
  items: MoodboardPreviewItem[]
}

export type MoodboardItem =
  | {
    itemType: "outfit"
    id: string
    createdAt: string
    gender?: "male" | "female" | null
    renderedItems?: StudioRenderedItem[]
    outfit?: Outfit
  }
  | {
    itemType: "product"
    id: string
    createdAt: string
    imageUrl: string | null
    brand?: string | null
    price?: number | null
    currency?: string | null
    productName?: string | null
  }

type DbOutfitWithJoins = Database["public"]["Tables"]["outfits"]["Row"] & {
  occasion: Database["public"]["Tables"]["occasions"]["Row"] | null
  top: Database["public"]["Tables"]["products"]["Row"] | null
  bottom: Database["public"]["Tables"]["products"]["Row"] | null
  shoes: Database["public"]["Tables"]["products"]["Row"] | null
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
`

const SYSTEM_MOODBOARDS: Moodboard[] = [
  { slug: "wardrobe", label: "Wardrobe", itemCount: 0, isSystem: true, createdAt: null, updatedAt: null },
  { slug: "try-ons", label: "Try-ons", itemCount: 0, isSystem: true, createdAt: null, updatedAt: null },
  { slug: "favorites", label: "Favorites", itemCount: 0, isSystem: true, createdAt: null, updatedAt: null },
]

function mapRowsToEntries(rows: DbOutfitWithJoins[]): HomeOutfitEntry[] {
  return rows.map((row) => {
    const outfit = mapDbOutfitToOutfit(row)
    const studioOutfit = mapDbOutfitToStudioOutfit(row as any)
    return {
      id: outfit.id,
      title: outfit.name ?? "Moodboard look",
      chips: getOutfitChips(outfit),
      outfit,
      renderedItems: studioOutfit?.renderedItems,
    }
  })
}

function parseStudioRenderedItems(items: any): StudioRenderedItem[] | undefined {
  if (!Array.isArray(items)) return undefined
  const parsed = items
    .map((item: any): StudioRenderedItem | null => {
      const id = typeof item?.id === "string" ? item.id : null
      const zone = item?.zone === "top" || item?.zone === "bottom" || item?.zone === "shoes" ? item.zone : null
      const imageUrl = typeof item?.imageUrl === "string" ? item.imageUrl : null
      if (!id || !zone || !imageUrl) return null
      const placementX = typeof item?.placementX === "number" && Number.isFinite(item.placementX) ? item.placementX : 0
      const placementY = typeof item?.placementY === "number" && Number.isFinite(item.placementY) ? item.placementY : 0
      const imageLengthCm =
        typeof item?.imageLengthCm === "number" && Number.isFinite(item.imageLengthCm) ? item.imageLengthCm : 0
      return {
        id,
        zone,
        imageUrl,
        placementX,
        placementY,
        imageLengthCm,
        bodyPartsVisible: parseBodyPartsVisible(item?.bodyPartsVisible),
        brand: null,
        productName: null,
        description: null,
        price: null,
        currency: null,
        size: null,
        color: null,
        colorGroup: null,
        gender: null,
        productUrl: null,
        extras: null,
      }
    })
    .filter((entry): entry is StudioRenderedItem => Boolean(entry))

  return parsed.length ? parsed : undefined
}

function parsePreviewItem(entry: any): MoodboardPreviewItem | null {
  const rawType = entry?.itemType ?? entry?.item_type
  if (rawType === "outfit") {
    const id = typeof (entry?.itemId ?? entry?.item_id) === "string" ? (entry?.itemId ?? entry?.item_id) : null
    if (!id) return null
    const genderValue = entry?.gender
    const gender = genderValue === "male" || genderValue === "female" ? genderValue : null
    const renderedItems = parseStudioRenderedItems(entry?.renderedItems ?? entry?.rendered_items)
    return {
      itemType: "outfit",
      id,
      gender,
      renderedItems,
    }
  }

  if (rawType === "product") {
    const id = typeof (entry?.itemId ?? entry?.item_id) === "string" ? (entry?.itemId ?? entry?.item_id) : null
    if (!id) return null
    const imageUrl =
      typeof (entry?.imageUrl ?? entry?.image_url) === "string" ? (entry?.imageUrl ?? entry?.image_url) : null
    const brand = typeof entry?.brand === "string" ? entry.brand : null
    const price = typeof entry?.price === "number" && Number.isFinite(entry.price) ? entry.price : null
    const currency = typeof entry?.currency === "string" ? entry.currency : null
    const productName = typeof (entry?.productName ?? entry?.product_name) === "string"
      ? (entry?.productName ?? entry?.product_name)
      : null
    return {
      itemType: "product",
      id,
      imageUrl,
      brand,
      price,
      currency,
      productName,
    }
  }

  return null
}

function parsePreviewItems(raw: unknown): MoodboardPreviewItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parsePreviewItem).filter((item): item is MoodboardPreviewItem => Boolean(item))
}

function slugify(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "moodboard"
}

function coalesceSystemSlug(slug: string) {
  if (slug === "generations") return "try-ons"
  return slug
}

export async function fetchMoodboards(userId: string | null): Promise<Moodboard[]> {
  if (!userId) {
    return SYSTEM_MOODBOARDS
  }

  const { data, error } = await supabase.rpc("get_user_collections", { p_user_id: userId })
  if (error) {
    throw new Error(error.message)
  }

  const mapped =
    data?.map((row) => {
      const slug = coalesceSystemSlug(row.collection_slug)
      const isSystem = SYSTEM_MOODBOARDS.some((sys) => sys.slug === slug)
      const label =
        slug === "try-ons" && row.collection_label === "Generations" ? "Try-ons" : row.collection_label
      return {
        slug,
        label,
        itemCount: row.item_count ?? 0,
        isSystem,
        createdAt: typeof row.collection_created_at === "string" ? row.collection_created_at : null,
        updatedAt: typeof (row as any).collection_updated_at === "string" ? (row as any).collection_updated_at : null,
      } satisfies Moodboard
    }) ?? []

  // ensure system moodboards exist and ordered first
  const userBoards = mapped.filter((m) => !m.isSystem)
  const systemBoards = SYSTEM_MOODBOARDS.map((sys) => {
    const override = mapped.find((m) => m.slug === sys.slug)
    return override ?? sys
  })

  return [...systemBoards, ...userBoards]
}

export async function createMoodboard(userId: string, name: string): Promise<Moodboard> {
  if (!userId) {
    throw new Error("User must be authenticated to create a moodboard")
  }
  const slug = slugify(name)
  if (SYSTEM_MOODBOARDS.some((sys) => sys.slug === slug)) {
    throw new Error("Cannot create a system moodboard")
  }

  const { error } = await supabase.rpc("manage_collection", {
    p_operation: "create",
    p_collection_slug: slug,
    p_collection_label: name,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(error.message)
  }

  return {
    slug,
    label: name,
    itemCount: 0,
    isSystem: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export async function deleteMoodboard(userId: string, slug: string): Promise<void> {
  if (!userId) {
    throw new Error("User must be authenticated to delete a moodboard")
  }
  const normalizedSlug = slug.toLowerCase()
  if (SYSTEM_MOODBOARDS.some((sys) => sys.slug === normalizedSlug)) {
    throw new Error("Cannot delete a system moodboard")
  }

  const { error } = await supabase.rpc("manage_collection", {
    p_operation: "delete",
    p_collection_slug: normalizedSlug,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function saveToCollection(params: {
  userId: string
  outfitId: string
  slug: string
  label?: string
}): Promise<void> {
  const { userId, outfitId, slug, label } = params
  if (!userId) {
    throw new Error("User must be authenticated to save")
  }

  const normalizedSlug = slug.toLowerCase()
  if (normalizedSlug === "wardrobe") {
    throw new Error("Wardrobe only supports products")
  }
  const collectionLabel = label ?? (SYSTEM_MOODBOARDS.find((s) => s.slug === normalizedSlug)?.label ?? slug)

  const { error } = await supabase.from("user_favorites").upsert(
    {
      user_id: userId,
      outfit_id: outfitId,
      collection_slug: normalizedSlug,
      collection_label: collectionLabel,
    },
    { onConflict: "user_id,outfit_id,collection_slug" },
  )

  // Update the collection timestamp for recency sorting
  await supabase
    .from("user_collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("slug", normalizedSlug)

  if (error) {
    throw new Error(error.message)
  }
}

export async function saveProductToCollection(params: {
  userId: string
  productId: string
  slug: string
  label?: string
}): Promise<void> {
  const { userId, productId, slug, label } = params
  if (!userId) {
    throw new Error("User must be authenticated to save")
  }

  const normalizedSlug = slug.toLowerCase()
  const collectionLabel = label ?? (SYSTEM_MOODBOARDS.find((s) => s.slug === normalizedSlug)?.label ?? slug)

  const { error } = await supabase.from("user_favorites").upsert(
    {
      user_id: userId,
      product_id: productId,
      collection_slug: normalizedSlug,
      collection_label: collectionLabel,
    },
    { onConflict: "user_id,collection_slug,product_id" },
  )

  // Update the collection timestamp for recency sorting
  await supabase
    .from("user_collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("slug", normalizedSlug)

  if (error) {
    throw new Error(error.message)
  }
}

export async function removeFromCollection(params: { userId: string; outfitId: string; slug: string }): Promise<void> {
  const { userId, outfitId, slug } = params
  if (!userId) {
    throw new Error("User must be authenticated to remove")
  }
  const normalizedSlug = slug.toLowerCase()
  const { error } = await supabase
    .from("user_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("outfit_id", outfitId)
    .eq("collection_slug", normalizedSlug)

  // Update the collection timestamp for recency sorting
  await supabase
    .from("user_collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("slug", normalizedSlug)
  if (error) {
    throw new Error(error.message)
  }
}

export async function removeProductFromCollection(params: {
  userId: string
  productId: string
  slug: string
}): Promise<void> {
  const { userId, productId, slug } = params
  if (!userId) {
    throw new Error("User must be authenticated to remove")
  }
  const normalizedSlug = slug.toLowerCase()
  const { error } = await supabase
    .from("user_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId)
    .eq("collection_slug", normalizedSlug)

  // Update the collection timestamp for recency sorting
  await supabase
    .from("user_collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("slug", normalizedSlug)
  if (error) {
    throw new Error(error.message)
  }
}

export async function removeOutfitFromLibrary(params: { userId: string; outfitId: string }): Promise<void> {
  const { userId, outfitId } = params
  if (!userId) {
    throw new Error("User must be authenticated to remove")
  }

  const { error } = await supabase
    .from("user_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("outfit_id", outfitId)
    .neq("collection_slug", "try-ons")
    .neq("collection_slug", "generations")

  if (error) {
    throw new Error(error.message)
  }
}

export async function removeProductFromLibrary(params: { userId: string; productId: string }): Promise<void> {
  const { userId, productId } = params
  if (!userId) {
    throw new Error("User must be authenticated to remove")
  }

  const { error } = await supabase
    .from("user_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId)
    .neq("collection_slug", "try-ons")
    .neq("collection_slug", "generations")

  if (error) {
    throw new Error(error.message)
  }
}

export async function fetchFavorites(userId: string | null): Promise<string[]> {
  if (!userId) return []
  const { data, error } = await supabase
    .from("user_favorites")
    .select("outfit_id")
    .eq("user_id", userId)
    .eq("collection_slug", "favorites")
    .not("outfit_id", "is", null)
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []).map((row) => row.outfit_id).filter((id): id is string => typeof id === "string")
}

export async function fetchFavoriteProducts(userId: string | null): Promise<string[]> {
  if (!userId) return []
  const { data, error } = await supabase
    .from("user_favorites")
    .select("product_id")
    .eq("user_id", userId)
    .eq("collection_slug", "favorites")
    .not("product_id", "is", null)
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []).map((row) => row.product_id).filter((id): id is string => typeof id === "string")
}

export type SavedProduct = {
  id: string
  createdAt: string
  imageUrl: string | null
  brand: string | null
  price: number | null
  currency: string | null
  productName?: string | null
}

export type CollectionProduct = {
  id: string
  createdAt: string
  title: string
  imageUrl: string | null
  brand: string | null
  price: number | null
  currency: string | null
  productUrl: string | null
  itemType: "top" | "bottom" | "shoes" | null
  gender: "male" | "female" | null
}

export async function fetchSavedProducts(userId: string | null): Promise<SavedProduct[]> {
  if (!userId) return []
  const { data, error } = await supabase
    .from("user_favorites")
    .select(
      `
      created_at,
      product:product_id(
        *
      )
    `,
    )
    .eq("user_id", userId)
    .not("product_id", "is", null)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const deduped = new Map<string, SavedProduct>()

  for (const row of data ?? []) {
    const product = row?.product
    const id = typeof product?.id === "string" ? product.id : null
    if (!id) continue
    const createdAt = typeof row?.created_at === "string" ? row.created_at : ""
    const existing = deduped.get(id)
    if (existing && existing.createdAt >= createdAt) {
      continue
    }
    deduped.set(id, {
      id,
      createdAt,
      imageUrl: product?.image_url ?? null,
      brand: product?.brand ?? null,
      price: product?.price ?? null,
      currency: product?.currency ?? null,
      productName: product?.product_name ?? null,
    })
  }

  return Array.from(deduped.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function fetchCollectionProducts(
  userId: string | null,
  slug: string,
): Promise<CollectionProduct[]> {
  if (!userId || !slug) return []
  const normalizedSlug = coalesceSystemSlug(slug)
  const { data, error } = await supabase
    .from("user_favorites")
    .select(
      `
      created_at,
      product:product_id(
        *
      )
    `,
    )
    .eq("user_id", userId)
    .eq("collection_slug", normalizedSlug)
    .not("product_id", "is", null)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const deduped = new Map<string, CollectionProduct>()

  for (const row of data ?? []) {
    const product = row?.product
    const id = typeof product?.id === "string" ? product.id : null
    if (!id) continue
    const createdAt = typeof row?.created_at === "string" ? row.created_at : ""
    const existing = deduped.get(id)
    if (existing && existing.createdAt >= createdAt) {
      continue
    }
    const title = product?.product_name ?? product?.brand ?? "Product"
    const rawType = product?.type
    const itemType = rawType === "top" || rawType === "bottom" || rawType === "shoes" ? rawType : null
    const rawGender = product?.gender
    const gender = rawGender === "male" || rawGender === "female" ? rawGender : null
    deduped.set(id, {
      id,
      createdAt,
      title,
      imageUrl: product?.image_url ?? null,
      brand: product?.brand ?? null,
      price: product?.price ?? null,
      currency: product?.currency ?? null,
      productUrl: product?.product_url ?? null,
      itemType,
      gender,
    })
  }

  return Array.from(deduped.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export type TryOn = {
  id: string
  storagePath: string | null
  status: Database["public"]["Enums"]["generation_status"]
  createdAt: string
  outfitId: string | null
  imageUrl: string | null
}

export type CreationsCounts = {
  tryOnOutfitCount: number
  savedOutfitCount: number
  totalCount: number
}

export async function fetchTryOns(params: {
  userId: string | null
  page: number
  size: number
}): Promise<TryOn[]> {
  const { userId, page, size } = params
  if (!userId) return []
  const from = page * size
  const to = from + size - 1
  const { data, error } = await supabase
    .from("user_generations")
    .select("id, storage_path, status, created_at, outfit_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) {
    throw new Error(error.message)
  }

  const rows = data ?? []
  const paths = rows.map((row) => row.storage_path).filter((path): path is string => Boolean(path))
  const cachedUrls: Record<string, string> = {}
  const missingPaths: string[] = []

  paths.forEach((path) => {
    const cached = getCachedGenerationSignedUrl(path)
    if (cached) {
      cachedUrls[path] = cached
    } else {
      missingPaths.push(path)
    }
  })

  if (missingPaths.length) {
    const { data: signed, error: signedError } = await supabase.storage
      .from("generations")
      .createSignedUrls(missingPaths, GENERATIONS_SIGNED_URL_TTL_SECONDS)

    if (signedError) {
      throw new Error(signedError.message)
    }

    const signedResults = (signed ?? []).filter(
      (entry): entry is { path: string; signedUrl: string; error: string | null } =>
        Boolean(entry?.path && entry?.signedUrl && !entry?.error),
    )

    const expiresAt = Date.now() + GENERATIONS_SIGNED_URL_TTL_SECONDS * 1000
    signedResults.forEach((entry) => {
      setCachedGenerationSignedUrl(entry.path, entry.signedUrl, expiresAt)
      cachedUrls[entry.path] = entry.signedUrl
    })
  }

  return (
    rows.map((row) => ({
      id: row.id,
      storagePath: row.storage_path,
      status: row.status,
      createdAt: row.created_at,
      outfitId: row.outfit_id,
      imageUrl: row.storage_path ? cachedUrls[row.storage_path] ?? null : null,
    })) ?? []
  )
}

export async function fetchCreationsCounts(userId: string | null): Promise<CreationsCounts> {
  if (!userId) {
    return {
      tryOnOutfitCount: 0,
      savedOutfitCount: 0,
      totalCount: 0,
    }
  }

  const client = supabase as any
  const { data, error } = await client.rpc("get_user_creations_counts", { p_user_id: userId })
  if (error) {
    throw new Error(error.message)
  }

  const row = Array.isArray(data) ? data[0] : data
  const tryOnOutfitCount = Number(row?.tryon_outfit_count ?? 0)
  const savedOutfitCount = Number(row?.saved_outfit_count ?? 0)
  const totalCount = Number(row?.total_count ?? tryOnOutfitCount + savedOutfitCount)

  return {
    tryOnOutfitCount,
    savedOutfitCount,
    totalCount,
  }
}

export type CollectionMeta = {
  order: string[]
  [slug: string]: Json | undefined
}

export async function fetchCollectionsMeta(userId: string | null): Promise<CollectionMeta> {
  if (!userId) {
    return {
      order: ["wardrobe", "try-ons", "favorites", "for-you"],
      wardrobe: { label: "Wardrobe", isSystem: true },
      "try-ons": { label: "Try-ons", isSystem: true },
      favorites: { label: "Favorites", isSystem: true },
      "for-you": { label: "For You", isSystem: true },
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("collections_meta")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  const meta = (data?.collections_meta as CollectionMeta | null) ?? null

  if (meta && Array.isArray(meta.order)) {
    return meta
  }

  // Upsert default if missing
  const defaultMeta: CollectionMeta = {
    order: ["wardrobe", "try-ons", "favorites", "for-you"],
    wardrobe: { label: "Wardrobe", isSystem: true },
    "try-ons": { label: "Try-ons", isSystem: true },
    favorites: { label: "Favorites", isSystem: true },
    "for-you": { label: "For You", isSystem: true },
  }

  await supabase.from("profiles").update({ collections_meta: defaultMeta }).eq("user_id", userId)
  return defaultMeta
}

export async function fetchMoodboardPreview(slug: string, userId: string | null): Promise<MoodboardPreview> {
  if (!userId || !slug) {
    return { slug, items: [] }
  }

  const normalizedSlug = coalesceSystemSlug(slug)

  const { data, error } = await supabase.rpc("get_moodboard_previews", {
    p_user_id: userId,
    p_slugs: [normalizedSlug],
  })

  if (error) {
    throw new Error(error.message)
  }

  const items =
    data
      ?.filter((row) => coalesceSystemSlug(row.collection_slug) === normalizedSlug)
      .map((row) =>
        parsePreviewItem({
          item_type: row.item_type,
          item_id: row.item_id,
          image_url: row.image_url,
          gender: row.gender,
          rendered_items: row.rendered_items,
          brand: row.brand,
          price: row.price,
          currency: row.currency,
          product_name: row.product_name,
        }),
      )
      .filter((item): item is MoodboardPreviewItem => Boolean(item)) ?? []

  return {
    slug: normalizedSlug,
    items,
  }
}

export async function fetchMoodboardPreviews(
  slugs: string[],
  userId: string | null,
): Promise<Record<string, MoodboardPreview>> {
  if (!userId || !slugs.length) {
    return {}
  }

  const normalizedSlugs = slugs.map((slug) => coalesceSystemSlug(slug))

  const { data, error } = await supabase.rpc("get_moodboard_previews", {
    p_user_id: userId,
    p_slugs: normalizedSlugs,
  })

  if (error) {
    throw new Error(error.message)
  }

  const grouped = new Map<string, MoodboardPreview>(normalizedSlugs.map((slug) => [slug, { slug, items: [] }]))

  for (const row of data ?? []) {
    const slug = coalesceSystemSlug(row.collection_slug)
    const preview = grouped.get(slug) ?? { slug, items: [] }
    if (preview.items.length < 3) {
      const parsed = parsePreviewItem({
        item_type: row.item_type,
        item_id: row.item_id,
        image_url: row.image_url,
        gender: row.gender,
        rendered_items: row.rendered_items,
        brand: row.brand,
        price: row.price,
        currency: row.currency,
        product_name: row.product_name,
      })
      if (parsed) {
        preview.items.push(parsed)
      }
    }
    grouped.set(slug, preview)
  }

  return Object.fromEntries(grouped)
}

export type CollectionsWithPreviews = {
  moodboards: Moodboard[]
  previews: Record<string, MoodboardPreview>
}

export async function fetchCollectionsWithPreviews(userId: string | null): Promise<CollectionsWithPreviews> {
  if (!userId) {
    const moodboards = SYSTEM_MOODBOARDS
    return {
      moodboards,
      previews: Object.fromEntries(moodboards.map((m) => [m.slug, { slug: m.slug, items: [] }])),
    }
  }

  const client = supabase as any

  // RPC doesn't return timestamps, so we fetch them directly from the table
  const [rpcResponse, tableResponse] = await Promise.all([
    client.rpc("get_collections_with_previews", { p_user_id: userId }),
    client.from("user_collections").select("slug, created_at, updated_at").eq("user_id", userId)
  ])

  const { data: rpcData, error: rpcError } = rpcResponse
  const { data: tableData } = tableResponse

  if (rpcError) {
    throw new Error(rpcError.message)
  }

  const rawMoodboards: Moodboard[] =
    rpcData?.map((row: any) => {
      const slug = coalesceSystemSlug(row.collection_slug)
      const isSystem = Boolean(row.is_system)
      const label =
        slug === "try-ons" && row.collection_label === "Generations" ? "Try-ons" : row.collection_label

      // Find matching timestamp from table data
      const tableRow = tableData?.find((t: any) => t.slug === slug)

      return {
        slug,
        label,
        itemCount: row.item_count ?? 0,
        isSystem,
        createdAt: tableRow?.created_at || null,
        updatedAt: tableRow?.updated_at || null,
      } satisfies Moodboard
    }) ?? []

  // Defensive dedupe: some legacy users/rows can produce duplicate slugs (e.g. wardrobe).
  // Prefer system moodboards; otherwise prefer the most recently updated.
  const dedupedBySlug = new Map<string, Moodboard>()
  for (const board of rawMoodboards) {
    const existing = dedupedBySlug.get(board.slug)
    if (!existing) {
      dedupedBySlug.set(board.slug, board)
      continue
    }

    if (!existing.isSystem && board.isSystem) {
      dedupedBySlug.set(board.slug, board)
      continue
    }

    const existingUpdated = typeof existing.updatedAt === "string" ? Date.parse(existing.updatedAt) : NaN
    const nextUpdated = typeof board.updatedAt === "string" ? Date.parse(board.updatedAt) : NaN
    if (!Number.isNaN(nextUpdated) && (Number.isNaN(existingUpdated) || nextUpdated > existingUpdated)) {
      dedupedBySlug.set(board.slug, board)
    }
  }

  const moodboards = Array.from(dedupedBySlug.values())

  const previews: Record<string, MoodboardPreview> = Object.fromEntries(
    moodboards.map((moodboard) => {
      const match =
        rpcData?.find(
          (row: any) =>
            coalesceSystemSlug(row.collection_slug) === moodboard.slug && Boolean(row.is_system) === moodboard.isSystem,
        ) ??
        rpcData?.find((row: any) => coalesceSystemSlug(row.collection_slug) === moodboard.slug)
      const rawItems = Array.isArray(match?.preview_items) ? match.preview_items : []
      const items = parsePreviewItems(rawItems)
      return [
        moodboard.slug,
        {
          slug: moodboard.slug,
          items,
        } satisfies MoodboardPreview,
      ] as const
    }),
  )

  return { moodboards, previews }
}

export async function fetchMoodboardOutfits(params: {
  userId: string | null
  slug: string
  page: number
  size: number
}): Promise<HomeOutfitEntry[]> {
  const { userId, slug, page, size } = params
  if (!userId || !slug) {
    return []
  }

  const normalizedSlug = coalesceSystemSlug(slug)
  if (normalizedSlug === "try-ons" || normalizedSlug === "for-you") {
    return []
  }

  const from = page * size
  const to = from + size - 1

  const { data, error } = await supabase
    .from("user_favorites")
    .select(
      `
      created_at,
      outfits:outfit_id(
        ${OUTFIT_SELECT}
      )
    `,
    )
    .eq("user_id", userId)
    .eq("collection_slug", normalizedSlug)
    .not("outfit_id", "is", null)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) {
    throw new Error(error.message)
  }

  const outfits =
    data
      ?.map((row) => row.outfits)
      .filter((row): row is DbOutfitWithJoins => Boolean(row?.id)) ?? []

  return mapRowsToEntries(outfits)
}

export async function fetchMoodboardItems(params: {
  userId: string | null
  slug: string
  page: number
  size: number
}): Promise<MoodboardItem[]> {
  const { userId, slug, page, size } = params
  if (!userId || !slug) {
    return []
  }

  const normalizedSlug = coalesceSystemSlug(slug)
  if (normalizedSlug === "try-ons" || normalizedSlug === "for-you") {
    return []
  }

  const from = page * size
  const to = from + size - 1

  const { data, error } = await supabase
    .from("user_favorites")
    .select(
      `
      created_at,
      outfit:outfit_id(
        ${OUTFIT_SELECT}
      ),
      product:product_id(
        id,
        image_url,
        brand,
        price,
        currency,
        product_name
      )
    `,
    )
    .eq("user_id", userId)
    .eq("collection_slug", normalizedSlug)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) {
    throw new Error(error.message)
  }

  const items =
    data
      ?.map((row: any): MoodboardItem | null => {
        const createdAt = typeof row?.created_at === "string" ? row.created_at : ""
        if (row?.outfit?.id) {
          const genderValue = row.outfit.gender
          const gender =
            genderValue === "male" || genderValue === "female" ? (genderValue as "male" | "female") : null
          const studioOutfit = mapDbOutfitToStudioOutfit(row.outfit as any)
          const outfit = mapDbOutfitToOutfit(row.outfit as any)
          return {
            itemType: "outfit",
            id: row.outfit.id,
            createdAt,
            gender,
            renderedItems: studioOutfit?.renderedItems,
            outfit,
          }
        }

        if (row?.product?.id) {
          return {
            itemType: "product",
            id: row.product.id,
            createdAt,
            imageUrl: row.product.image_url ?? null,
            brand: row.product.brand ?? null,
            price: row.product.price ?? null,
            currency: row.product.currency ?? null,
            productName: row.product.product_name ?? null,
          }
        }

        return null
      })
      .filter((item): item is MoodboardItem => Boolean(item)) ?? []

  return items
}

export async function fetchMoodboardItemsBatch(params: {
  userId: string | null
  slugs: string[]
  page: number
  size: number
}): Promise<Record<string, MoodboardItem[]>> {
  const { userId, slugs, page, size } = params
  if (!userId || slugs.length === 0) {
    return {}
  }

  const normalizedSlugs = slugs.map((slug) => coalesceSystemSlug(slug))
  const offset = page * size

  const { data, error } = await supabase.rpc("get_moodboard_items_batch", {
    p_user_id: userId,
    p_slugs: normalizedSlugs,
    p_limit: size,
    p_offset: offset,
  })

  if (error) {
    throw new Error(error.message)
  }

  type MoodboardItemsBatchRow = Database["public"]["Functions"]["get_moodboard_items_batch"]["Returns"][number]
  const rows = Array.isArray(data) ? (data as MoodboardItemsBatchRow[]) : []
  const grouped = new Map<string, MoodboardItem[]>(normalizedSlugs.map((slug) => [slug, []]))

  for (const row of rows) {
    const slug = coalesceSystemSlug(row.collection_slug)
    const createdAt = typeof row.created_at === "string" ? row.created_at : ""

    if (row.item_type === "outfit" && row.outfit?.id) {
      const genderValue = row.outfit.gender
      const gender = genderValue === "male" || genderValue === "female" ? (genderValue as "male" | "female") : null
      const studioOutfit = mapDbOutfitToStudioOutfit(row.outfit as any)
      const outfit = mapDbOutfitToOutfit(row.outfit as any)
      grouped.get(slug)?.push({
        itemType: "outfit",
        id: row.outfit.id,
        createdAt,
        gender,
        renderedItems: studioOutfit?.renderedItems,
        outfit,
      })
      continue
    }

    if (row.item_type === "product" && row.product?.id) {
      grouped.get(slug)?.push({
        itemType: "product",
        id: row.product.id,
        createdAt,
        imageUrl: row.product.image_url ?? null,
        brand: row.product.brand ?? null,
        price: row.product.price ?? null,
        currency: row.product.currency ?? null,
        productName: row.product.product_name ?? null,
      })
    }
  }

  return Object.fromEntries(grouped)
}

export type Creation = {
  id: string
  name: string
  createdAt: string
  outfitId: string
  backgroundId: string | null
  gender: "male" | "female" | "unisex" | null
  isPrivate: boolean | null
  visibleInFeed: boolean | null
  vtoImageUrl: string | null
  latestGenerationStatus: Database["public"]["Enums"]["generation_status"] | null
  latestGenerationCreatedAt: string | null
}

export async function fetchCreations(params: {
  userId: string | null
  page: number
  size: number
}): Promise<Creation[]> {
  const { userId, page, size } = params
  if (!userId) return []
  const client = supabase as any
  const { data, error } = await client.rpc("get_user_creations_page", {
    p_user_id: userId,
    p_page: page,
    p_size: size,
  })

  if (error) {
    throw new Error(error.message)
  }

  const rows = Array.isArray(data) ? data : []
  const latestByOutfit = new Map<string, string>()
  rows.forEach((row: any) => {
    const outfitId = typeof row?.outfit_id === "string" ? row.outfit_id : null
    const storagePathRaw =
      typeof row?.latest_generation_storage_path === "string" ? row.latest_generation_storage_path : null
    const storagePath = storagePathRaw?.trim() ? storagePathRaw.trim() : null
    if (outfitId && storagePath) {
      latestByOutfit.set(outfitId, storagePath)
    }
  })

  const paths = Array.from(new Set(Array.from(latestByOutfit.values())))
  const cachedUrls: Record<string, string> = {}
  const missingPaths: string[] = []

  paths.forEach((path) => {
    const cached = getCachedGenerationSignedUrl(path)
    if (cached) {
      cachedUrls[path] = cached
    } else {
      missingPaths.push(path)
    }
  })

  if (missingPaths.length) {
    const { data: signed, error: signedError } = await supabase.storage
      .from("generations")
      .createSignedUrls(missingPaths, GENERATIONS_SIGNED_URL_TTL_SECONDS)

    if (signedError) {
      throw new Error(signedError.message)
    }

    const signedResults = (signed ?? []).filter(
      (entry): entry is { path: string; signedUrl: string; error: string | null } =>
        Boolean(entry?.path && entry?.signedUrl && !entry?.error),
    )

    const expiresAt = Date.now() + GENERATIONS_SIGNED_URL_TTL_SECONDS * 1000
    signedResults.forEach((entry) => {
      setCachedGenerationSignedUrl(entry.path, entry.signedUrl, expiresAt)
      cachedUrls[entry.path] = entry.signedUrl
    })
  }

  const vtoUrls: Record<string, string | null> = {}
  Array.from(latestByOutfit.entries()).forEach(([outfitId, path]) => {
    vtoUrls[outfitId] = cachedUrls[path] ?? null
  })

  return (
    rows.map((row: any) => {
      const outfitId = typeof row?.outfit_id === "string" ? row.outfit_id : ""
      const genderValue = row?.gender
      const gender =
        genderValue === "male" || genderValue === "female" || genderValue === "unisex" ? genderValue : null
      const statusValue = typeof row?.latest_generation_status === "string" ? row.latest_generation_status : null
      const latestGenerationStatus =
        statusValue === "queued" || statusValue === "generating" || statusValue === "ready" || statusValue === "failed"
          ? (statusValue satisfies Database["public"]["Enums"]["generation_status"])
          : null
      const isPrivate = typeof row?.is_private === "boolean" ? row.is_private : null
      const visibleInFeed = typeof row?.visible_in_feed === "boolean" ? row.visible_in_feed : null
      return {
        id: outfitId,
        name: typeof row?.outfit_name === "string" ? row.outfit_name : "",
        createdAt: typeof row?.created_at === "string" ? row.created_at : "",
        outfitId,
        backgroundId: typeof row?.background_id === "string" ? row.background_id : null,
        gender,
        isPrivate,
        visibleInFeed,
        vtoImageUrl: vtoUrls[outfitId] ?? null,
        latestGenerationStatus,
        latestGenerationCreatedAt:
          typeof row?.latest_generation_created_at === "string" ? row.latest_generation_created_at : null,
      } satisfies Creation
    }) ?? []
  )
}
