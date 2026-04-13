import { supabase } from "@/integrations/supabase/client"
import type { Database } from "@/integrations/supabase/types"
import type { StudioRenderedItem, StudioRenderedZone } from "@/features/studio/types"
import { mapSupabaseProductToStudioItem } from "@/features/studio/mappers/renderedItemMapper"

type DbProductRow = Database["public"]["Tables"]["products"]["Row"] & {
  body_parts_visible?: string[] | null
}

const OUTFIT_PRODUCTS_SELECT = `
  id,
  top:products!outfits_top_id_fkey(
    id,
    brand,
    product_name,
    image_url,
    placement_x,
    placement_y,
    image_length,
    body_parts_visible
  ),
  bottom:products!outfits_bottom_id_fkey(
    id,
    brand,
    product_name,
    image_url,
    placement_x,
    placement_y,
    image_length,
    body_parts_visible
  ),
  shoes:products!outfits_shoes_id_fkey(
    id,
    brand,
    product_name,
    image_url,
    placement_x,
    placement_y,
    image_length,
    body_parts_visible
  )
`

type OutfitWithProducts = {
  id: string
  top: DbProductRow | null
  bottom: DbProductRow | null
  shoes: DbProductRow | null
}

export async function fetchOutfitProducts(outfitId: string): Promise<StudioRenderedItem[]> {
  if (!outfitId) {
    return []
  }

  const { data, error } = await supabase
    .from("outfits")
    .select(OUTFIT_PRODUCTS_SELECT)
    .eq("id", outfitId)
    .maybeSingle<OutfitWithProducts>()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return []
  }

  const zones: Array<[StudioRenderedZone, DbProductRow | null]> = [
    ["top", data.top],
    ["bottom", data.bottom],
    ["shoes", data.shoes],
  ]

  return zones
    .map(([zone, product]) => mapSupabaseProductToStudioItem(zone, product))
    .filter((item): item is StudioRenderedItem => Boolean(item))
}

export const outfitProductsService = {
  fetchOutfitProducts,
}
