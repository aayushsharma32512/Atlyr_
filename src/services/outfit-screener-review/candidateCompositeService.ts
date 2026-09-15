import { supabase } from "@/integrations/supabase/client"
import type { StudioRenderedItem, StudioRenderedZone } from "@/features/studio/types"
import { mapSupabaseProductToStudioItem } from "@/features/studio/mappers/renderedItemMapper"

// Same columns outfitProductsService.ts selects for a saved outfit's top/bottom/shoes —
// a candidate pair has no outfits row yet, so this reads the three products directly
// instead of joining through outfits.
const PRODUCT_SELECT = `
  id,
  brand,
  product_name,
  image_url,
  thumbnail_url,
  placement_x,
  placement_y,
  image_length,
  placement,
  gender,
  body_parts_visible
`

interface DbProductRow {
    id: string
    brand: string | null
    product_name: string | null
    image_url: string | null
    thumbnail_url: string | null
    placement_x: number | null
    placement_y: number | null
    image_length: number | null
    placement: unknown
    gender: string | null
    body_parts_visible: unknown
}

export interface CandidateComposite {
    renderedItems: StudioRenderedItem[]
    /** Inferred from the top/bottom products; OutfitInspirationCard only accepts these two. */
    avatarGender: "male" | "female"
}

function genderOf(row: DbProductRow | undefined): "male" | "female" | null {
    return row?.gender === "male" || row?.gender === "female" ? row.gender : null
}

/** Live composite for one candidate pair: top + bottom + the effective shoe. */
export async function fetchCandidateComposite(
    topId: string,
    bottomId: string,
    shoesId: string,
): Promise<CandidateComposite> {
    const ids = Array.from(new Set([topId, bottomId, shoesId]))

    const { data, error } = await supabase.from("products").select(PRODUCT_SELECT).in("id", ids)

    if (error) {
        throw new Error(`Failed to fetch candidate products: ${error.message}`)
    }

    const byId = new Map<string, DbProductRow>(
        ((data ?? []) as DbProductRow[]).map((row) => [row.id, row]),
    )

    const zones: Array<[StudioRenderedZone, DbProductRow | null]> = [
        ["top", byId.get(topId) ?? null],
        ["bottom", byId.get(bottomId) ?? null],
        ["shoes", byId.get(shoesId) ?? null],
    ]

    const renderedItems = zones
        .map(([zone, product]) => mapSupabaseProductToStudioItem(zone, product))
        .filter((item): item is StudioRenderedItem => Boolean(item))

    const avatarGender =
        genderOf(byId.get(topId)) ?? genderOf(byId.get(bottomId)) ?? genderOf(byId.get(shoesId)) ?? "female"

    return { renderedItems, avatarGender }
}

export interface FootwearProductInfo {
    id: string
    thumbnail_url: string | null
    image_url: string | null
    product_name: string | null
    brand: string | null
}

/** Thumbnails for a theme's footwear_options, used by the shoe pickers. */
export async function fetchFootwearProducts(shoesIds: string[]): Promise<FootwearProductInfo[]> {
    if (shoesIds.length === 0) {
        return []
    }

    const { data, error } = await supabase
        .from("products")
        .select("id, thumbnail_url, image_url, product_name, brand")
        .in("id", shoesIds)

    if (error) {
        throw new Error(`Failed to fetch footwear products: ${error.message}`)
    }

    return (data ?? []) as FootwearProductInfo[]
}
