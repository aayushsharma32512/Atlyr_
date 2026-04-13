import type { Database } from "@/integrations/supabase/types"
import type { StudioRenderedItem, StudioRenderedZone, ZoneVisibilityMap } from "./renderedItem"

export type SupabaseOutfitRow = Database["public"]["Tables"]["outfits"]["Row"]
export type SupabaseProductRow = Database["public"]["Tables"]["products"]["Row"]

export interface SupabaseOutfitWithProducts extends SupabaseOutfitRow {
  top: SupabaseProductRow | null
  bottom: SupabaseProductRow | null
  shoes: SupabaseProductRow | null
}

export interface StudioOutfitDTO {
  id: string
  name?: string | null
  gender?: "male" | "female" | "unisex" | null
  fit?: string | null
  feel?: string | null
  wordAssociation?: string | null
  renderedItems: StudioRenderedItem[]
  bodyPartsVisibleByZone?: ZoneVisibilityMap
  imageSrcFallback?: string | null
}

export interface StudioOutfitProductsResult {
  renderedItems: StudioRenderedItem[]
  bodyPartsVisibleByZone: ZoneVisibilityMap
}

export type SupabaseProductLike =
  | {
      id: string
      type?: Database["public"]["Enums"]["item_type"] | null
      brand?: string | null
      product_name?: string | null
      description?: string | null
      price?: number | null
      currency?: string | null
      size?: string | null
      color?: string | null
      color_group?: string | null
      gender?: string | null
      product_url?: string | null
      image_url?: string | null
      placement_x?: number | null
      placement_y?: number | null
      image_length?: number | null
      body_parts_visible?: unknown
    }
  | null
