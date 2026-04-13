import { supabase } from "@/integrations/supabase/client"
import type { Database } from "@/integrations/supabase/types"
import type { Outfit } from "@/types"
import type { StudioRenderedItem } from "@/features/studio/types"
import { mapDbOutfitToStudioOutfit } from "@/features/studio/mappers/renderedItemMapper"

import { mapDbOutfitToOutfit } from "@/services/shared/transformers/outfitTransformers"
import { getOutfitChips } from "@/utils/outfitChips"

type Gender = "male" | "female" | null

type DbOutfitWithJoins = Database["public"]["Tables"]["outfits"]["Row"] & {
  occasion: Database["public"]["Tables"]["occasions"]["Row"] | null
  top: Database["public"]["Tables"]["products"]["Row"] | null
  bottom: Database["public"]["Tables"]["products"]["Row"] | null
  shoes: Database["public"]["Tables"]["products"]["Row"] | null
}

export interface HomeOutfitEntry {
  id: string
  title: string
  chips: string[]
  outfit: Outfit
  renderedItems?: StudioRenderedItem[]
}

interface RecentStylesInput {
  userId: string | null
  gender: Gender
  limit?: number
}

interface CuratedOutfitsInput {
  gender: Gender
  page: number
  size?: number
  seed: string
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

function buildGenderFilter(gender: Gender) {
  const filters = ["gender.eq.unisex"]
  if (gender === "male" || gender === "female") {
    filters.push(`gender.eq.${gender}`)
  }
  return filters.join(",")
}

function mapRowsToEntries(rows: DbOutfitWithJoins[]): HomeOutfitEntry[] {
  return rows.map((row) => {
    const outfit = mapDbOutfitToOutfit(row)
    const studioOutfit = mapDbOutfitToStudioOutfit(row as any)
    return {
      id: outfit.id,
      title: outfit.name ?? "Curated look",
      chips: getOutfitChips(outfit),
      outfit,
      renderedItems: studioOutfit?.renderedItems,
    }
  })
}

async function fetchOutfitsByIds(ids: string[], gender: Gender): Promise<DbOutfitWithJoins[]> {
  if (ids.length === 0) {
    return []
  }

  const query = supabase
    .from("outfits")
    .select(OUTFIT_SELECT)
    .in("id", ids)
    .eq("visible_in_feed", true)
    .neq("category", "others")
    .not("gender", "is", null)

  query.or(buildGenderFilter(gender))

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as DbOutfitWithJoins[]
}

async function getRecentStyles({ userId, gender, limit = 10 }: RecentStylesInput): Promise<HomeOutfitEntry[]> {
  if (!userId) {
    return []
  }

  const interactionLimit = Math.max(limit * 3, limit)
  const { data: interactions, error } = await supabase
    .from("user_interactions")
    .select("outfit_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(interactionLimit)

  if (error) {
    throw new Error(error.message)
  }

  const orderedIds: string[] = []
  for (const interaction of interactions ?? []) {
    const outfitId = interaction.outfit_id
    if (outfitId && !orderedIds.includes(outfitId)) {
      orderedIds.push(outfitId)
    }
    if (orderedIds.length >= limit) {
      break
    }
  }

  if (orderedIds.length === 0) {
    return []
  }

  const rows = await fetchOutfitsByIds(orderedIds, gender)
  const rowMap = new Map(rows.map((row) => [row.id, row]))

  return orderedIds
    .map((id) => rowMap.get(id))
    .filter((row): row is DbOutfitWithJoins => Boolean(row))
    .map((row) => mapRowsToEntries([row])[0])
}

async function getCuratedOutfits({ gender, page, size = 50, seed }: CuratedOutfitsInput): Promise<HomeOutfitEntry[]> {
  const offset = Math.max(page, 0) * size
  const { data, error } = await supabase.rpc("get_curated_outfit_ids_seeded", {
    p_gender: gender,
    p_seed: seed,
    p_limit: size,
    p_offset: offset,
  })

  if (error) {
    throw new Error(error.message)
  }

  const orderedIds = (data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id))

  if (orderedIds.length === 0) {
    return []
  }

  const rows = await fetchOutfitsByIds(orderedIds, gender)
  const entriesById = new Map(mapRowsToEntries(rows).map((entry) => [entry.id, entry]))

  return orderedIds.map((id) => entriesById.get(id)).filter((entry): entry is HomeOutfitEntry => Boolean(entry))
}

export const homeService = {
  getRecentStyles,
  getCuratedOutfits,
}
