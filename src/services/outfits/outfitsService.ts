import { supabase } from "@/integrations/supabase/client"
import type { Database } from "@/integrations/supabase/types"

type CategoryRow = Database["public"]["Tables"]["categories"]["Row"]
type OccasionRow = Database["public"]["Tables"]["occasions"]["Row"]
type OutfitInsert = Database["public"]["Tables"]["outfits"]["Insert"]
type OutfitRow = Database["public"]["Tables"]["outfits"]["Row"]
type OutfitByItemsRow = Pick<
  OutfitRow,
  "id" | "name" | "category" | "occasion" | "background_id" | "gender" | "top_id" | "bottom_id" | "shoes_id" | "layer_order"
>

export interface CategoryOption {
  id: string
  name: string
  slug: string
}

export interface OccasionOption {
  id: string
  name: string
  slug: string
  backgroundUrl: string | null
}

export interface SaveOutfitInput {
  name: string
  categoryId: string
  occasionId: string
  topId?: string | null
  bottomId?: string | null
  shoesId?: string | null
  gender?: string | null
  tags?: string[] | null
  isPrivate: boolean
  createdByName?: string | null
  userId: string
  backgroundId?: string | null
  sourceOutfitId?: string | null
  /** Stacking, front-most first. Null: the default rule applies. */
  layerOrder?: string[] | null
}

export interface DraftOutfitInput {
  userId: string
  name?: string | null
  categoryId?: string | null
  occasionId?: string | null
  topId?: string | null
  bottomId?: string | null
  shoesId?: string | null
  gender?: string | null
  backgroundId?: string | null
  createdByName?: string | null
}

export interface UpdateOutfitInput {
  outfitId: string
  userId: string
  name: string
  categoryId: string
  occasionId: string
  backgroundId?: string | null
  isPrivate: boolean
  tags?: string[] | null
  createdByName?: string | null
  /** Omit to leave the stored stacking as is; null clears it. */
  layerOrder?: string[] | null
}

export interface FindOutfitByItemsInput {
  topId?: string | null
  bottomId?: string | null
  shoesId?: string | null
  /** Omit to match any stacking; null matches rows on the default rule; an array matches that exact order. */
  layerOrder?: string[] | null
}

function mapCategory(row: CategoryRow): CategoryOption {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
  }
}

function mapOccasion(row: OccasionRow): OccasionOption {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    backgroundUrl: row.background_url ?? null,
  }
}

function normalizeText(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function resolveDraftName(inputName?: string | null) {
  const normalized = normalizeText(inputName)
  if (normalized) return normalized
  return `draft-look-${Date.now()}`
}

function normalizeGender(value?: string | null) {
  if (value === "male" || value === "female" || value === "unisex") {
    return value
  }
  return null
}

function normalizeTags(tags?: string[] | null): string[] | null {
  return tags && tags.length > 0 ? tags : null
}

export async function fetchCategories({
  limit = 50,
  term,
}: { limit?: number; term?: string } = {}): Promise<CategoryOption[]> {
  let query = supabase
    .from("categories")
    .select("id,name,slug")
    .order("name", { ascending: true })
    .neq("id", "others")
    .limit(limit)

  if (term?.trim()) {
    query = query.ilike("name", `%${term.trim()}%`)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map(mapCategory)
}

export async function fetchOccasions({
  limit = 50,
  term,
}: { limit?: number; term?: string } = {}): Promise<OccasionOption[]> {
  let query = supabase
    .from("occasions")
    .select("id,name,slug,background_url")
    .order("name", { ascending: true })
    .neq("id", "others")
    .limit(limit)

  if (term?.trim()) {
    query = query.ilike("name", `%${term.trim()}%`)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  const seen = new Set<string>()
  return (data ?? []).map(mapOccasion).filter((o) => {
    if (seen.has(o.name.toLowerCase())) return false
    seen.add(o.name.toLowerCase())
    return true
  })
}

export async function saveOutfit(input: SaveOutfitInput) {
  if (!input.userId) {
    throw new Error("User must be authenticated to save an outfit")
  }

  const createdBy = input.isPrivate ? "ATLYR" : normalizeText(input.createdByName) ?? "ATLYR"

  // Idempotent: a repeat tap, or a re-save of the same pieces and stacking, reuses the user's own
  // row and refreshes its details instead of adding a copy.
  let lookup = supabase.from("outfits").select().eq("user_id", input.userId)
  lookup = input.topId ? lookup.eq("top_id", input.topId) : lookup.is("top_id", null)
  lookup = input.bottomId ? lookup.eq("bottom_id", input.bottomId) : lookup.is("bottom_id", null)
  lookup = input.shoesId ? lookup.eq("shoes_id", input.shoesId) : lookup.is("shoes_id", null)
  lookup = input.layerOrder
    ? lookup.filter("layer_order", "eq", `{${input.layerOrder.join(",")}}`)
    : lookup.is("layer_order", null)
  const { data: existing } = await lookup.order("created_at", { ascending: true }).limit(1).maybeSingle()
  if (existing) {
    const { data, error } = await supabase
      .from("outfits")
      .update({
        name: input.name,
        category: input.categoryId,
        occasion: input.occasionId,
        background_id: input.backgroundId ?? null,
        is_private: input.isPrivate,
        visible_in_feed: true,
        created_by: createdBy,
        tags: normalizeTags(input.tags),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single()
    if (error) {
      throw new Error(error.message)
    }
    return data
  }

  const newId = crypto.randomUUID()
  const payload: OutfitInsert = {
    id: newId,
    name: input.name,
    category: input.categoryId,
    occasion: input.occasionId,
    top_id: input.topId ?? null,
    bottom_id: input.bottomId ?? null,
    shoes_id: input.shoesId ?? null,
    background_id: input.backgroundId ?? null,
    gender: input.gender ?? null,
    created_by: createdBy,
    is_private: input.isPrivate,
    visible_in_feed: true,
    tags: normalizeTags(input.tags),
    user_id: input.userId,
    // original: source_outfit_id = own id. copy: source_outfit_id = source outfit's id.
    source_outfit_id: input.sourceOutfitId ?? newId,
    layer_order: input.layerOrder ?? null,
  }

  const { data, error } = await supabase.from("outfits").insert(payload).select().single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function createDraftOutfit(input: DraftOutfitInput) {
  if (!input.userId) {
    throw new Error("User must be authenticated to create a draft outfit")
  }

  const payload: OutfitInsert = {
    id: crypto.randomUUID(),
    name: resolveDraftName(input.name),
    category: "others",
    occasion: "others",
    top_id: input.topId ?? null,
    bottom_id: input.bottomId ?? null,
    shoes_id: input.shoesId ?? null,
    background_id: input.backgroundId ?? null,
    gender: normalizeGender(input.gender),
    created_by: normalizeText(input.createdByName) ?? "ATLYR",
    is_private: true,
    visible_in_feed: false,
    user_id: input.userId,
  }

  const { data, error } = await supabase.from("outfits").insert(payload).select().single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function updateOutfit(input: UpdateOutfitInput) {
  if (!input.userId) {
    throw new Error("User must be authenticated to update an outfit")
  }

  const createdBy = input.isPrivate ? "ATLYR" : normalizeText(input.createdByName) ?? "ATLYR"

  const payload: Partial<OutfitInsert> = {
    name: input.name,
    category: input.categoryId,
    occasion: input.occasionId,
    background_id: input.backgroundId ?? null,
    is_private: input.isPrivate,
    visible_in_feed: true, // private only anonymises created_by — never hides from feed
    created_by: createdBy,
    tags: normalizeTags(input.tags),
    updated_at: new Date().toISOString(),
    ...(input.layerOrder !== undefined ? { layer_order: input.layerOrder } : {}),
  }

  const { data, error } = await supabase
    .from("outfits")
    .update(payload)
    .eq("id", input.outfitId)
    .eq("user_id", input.userId)
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error("Outfit not found or you do not have permission to edit it")
  }

  return data
}

export async function findOutfitByItems(input: FindOutfitByItemsInput): Promise<OutfitByItemsRow | null> {
  const topId = input.topId ?? null
  const bottomId = input.bottomId ?? null
  const shoesId = input.shoesId ?? null

  let query = supabase
    .from("outfits")
    .select("id,name,category,occasion,background_id,gender,top_id,bottom_id,shoes_id,layer_order")
    .eq("visible_in_feed", true)
    .eq("is_private", false)
    .limit(1)

  query = topId ? query.eq("top_id", topId) : query.is("top_id", null)
  query = bottomId ? query.eq("bottom_id", bottomId) : query.is("bottom_id", null)
  query = shoesId ? query.eq("shoes_id", shoesId) : query.is("shoes_id", null)
  if (input.layerOrder !== undefined) {
    // Array equality is order-sensitive, which is the point: {bottom,top,shoes} is a different look.
    query = input.layerOrder
      ? query.filter("layer_order", "eq", `{${input.layerOrder.join(",")}}`)
      : query.is("layer_order", null)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data ?? null
}

/** An original, not a user's copy of another look. Copies show only in their owner's boards. */
export function isOriginalOutfit(row: { id: string; source_outfit_id?: string | null }): boolean {
  return !row.source_outfit_id || row.source_outfit_id === row.id
}

/** One random feed-visible original, for the user's gender when known. Null when there is none. */
export async function fetchRandomOutfitId(gender: "male" | "female" | null): Promise<string | null> {
  let query = supabase
    .from("outfits")
    .select("id,source_outfit_id")
    .eq("visible_in_feed", true)
    .eq("is_private", false)
    .not("top_id", "is", null)
    .limit(40)
  if (gender) query = query.eq("gender", gender)
  const { data, error } = await query
  const originals = (data ?? []).filter(isOriginalOutfit)
  if (error || !originals.length) return null
  return originals[Math.floor(Math.random() * originals.length)].id
}

/**
 * Fetch a starter outfit for the given gender.
 * Used by admin studio to load a default outfit when no outfitId is in URL.
 * Returns null if no matching outfit found (shows empty mannequin).
 */
export async function fetchStarterOutfitByGender(gender: "male" | "female"): Promise<string | null> {
  const { data, error } = await supabase
    .from("outfits")
    .select("id")
    .eq("gender", gender)
    .eq("visible_in_feed", true)
    .eq("is_private", false)
    .not("top_id", "is", null)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn("[outfitsService] Error fetching starter outfit:", error)
    return null
  }

  return data?.id ?? null
}


