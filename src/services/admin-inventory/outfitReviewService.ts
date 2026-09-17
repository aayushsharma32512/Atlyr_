import { supabase } from "@/integrations/supabase/client"
import type { StudioRenderedItem, StudioRenderedZone } from "@/features/studio/types"
import { mapSupabaseProductToStudioItem } from "@/features/studio/mappers/renderedItemMapper"

// outfits.reviewed_at and the review/restore RPCs are not in the generated
// Supabase types yet — same gap noted in candidatePairsService.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedSupabase = supabase as any

export type OutfitReviewDecision = "keep" | "hide"

export interface ReviewQueueOutfit {
    id: string
    name: string
    category: string
    top_id: string | null
    bottom_id: string | null
    shoes_id: string | null
    created_at: string
}

export interface OutfitCategory {
    id: string
    name: string
}

export interface OutfitComposite {
    renderedItems: StudioRenderedItem[]
    /** Inferred from the top/bottom/shoes products; OutfitInspirationCard only accepts these two. */
    avatarGender: "male" | "female"
}

const QUEUE_SELECT = "id, name, category, top_id, bottom_id, shoes_id, created_at"
const OUTFIT_BROWSE_SELECT = "id, name, category, top_id, bottom_id, shoes_id, created_at"

// Same columns fetchCandidateComposite (candidateCompositeService.ts) selects — everything
// mapSupabaseProductToStudioItem needs to build a mannequin composite.
const OUTFIT_PRODUCT_SELECT = `
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

interface OutfitProductRow {
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

function genderOf(row: OutfitProductRow | null | undefined): "male" | "female" | null {
    return row?.gender === "male" || row?.gender === "female" ? row.gender : null
}

export interface PageParams {
    cursor?: number
    pageSize?: number
}

export interface ReviewQueuePage {
    rows: ReviewQueueOutfit[]
    nextCursor: number | null
}

/** One page of outfits still awaiting a keep/hide decision, newest first. Backs the swipe queue only. */
export async function fetchReviewQueue(
    categoryId: string | null,
    { cursor = 0, pageSize = 20 }: PageParams = {},
): Promise<ReviewQueuePage> {
    let query = untypedSupabase
        .from("outfits")
        .select(QUEUE_SELECT)
        .eq("visible_in_feed", true)
        .is("reviewed_at", null)
        .order("created_at", { ascending: false })
        .order("id")

    if (categoryId) {
        query = query.eq("category", categoryId)
    }

    const { data, error } = await query.range(cursor, cursor + pageSize - 1)

    if (error) {
        throw new Error(`Failed to load review queue: ${error.message}`)
    }

    const rows = (data ?? []) as ReviewQueueOutfit[]
    return { rows, nextCursor: rows.length === pageSize ? cursor + pageSize : null }
}

export interface OutfitsBrowsePage {
    rows: ReviewQueueOutfit[]
    composites: Record<string, OutfitComposite>
    nextCursor: number | null
}

export interface FetchOutfitsPageParams extends PageParams {
    visible: boolean
    q?: string
    categoryId?: string | null
}

// `,`, `(` and `)` are PostgREST's .or() delimiters, `%` is the ilike wildcard —
// strip them so free-text search input can't reshape the query it lands in.
function sanitizeSearchTerm(term: string): string {
    return term.replace(/[%,()]/g, "")
}

/** One page of the Active/Hidden outfits grid, with the page's mannequin composites built from one products query. */
export async function fetchOutfitsPage({
    visible,
    q = "",
    categoryId = null,
    cursor = 0,
    pageSize = 20,
}: FetchOutfitsPageParams): Promise<OutfitsBrowsePage> {
    let query = untypedSupabase
        .from("outfits")
        .select(OUTFIT_BROWSE_SELECT)
        .eq("visible_in_feed", visible)
        .order("created_at", { ascending: false })
        .order("id")

    if (categoryId) {
        query = query.eq("category", categoryId)
    }

    const term = sanitizeSearchTerm(q.trim())
    if (term) {
        query = query.ilike("name", `%${term}%`)
    }

    const { data, error } = await query.range(cursor, cursor + pageSize - 1)

    if (error) {
        throw new Error(`Failed to load outfits: ${error.message}`)
    }

    const rows = (data ?? []) as ReviewQueueOutfit[]

    const productIds = Array.from(
        new Set(
            rows
                .flatMap((row) => [row.top_id, row.bottom_id, row.shoes_id])
                .filter((id): id is string => Boolean(id)),
        ),
    )

    const productsById = new Map<string, OutfitProductRow>()
    if (productIds.length > 0) {
        const { data: productRows, error: productError } = await supabase
            .from("products")
            .select(OUTFIT_PRODUCT_SELECT)
            .in("id", productIds)

        if (productError) {
            throw new Error(`Failed to load outfit products: ${productError.message}`)
        }

        for (const row of (productRows ?? []) as OutfitProductRow[]) {
            productsById.set(row.id, row)
        }
    }

    const productFor = (id: string | null): OutfitProductRow | null => (id ? productsById.get(id) ?? null : null)

    const composites: Record<string, OutfitComposite> = {}
    for (const row of rows) {
        const top = productFor(row.top_id)
        const bottom = productFor(row.bottom_id)
        const shoes = productFor(row.shoes_id)

        const zones: Array<[StudioRenderedZone, OutfitProductRow | null]> = [
            ["top", top],
            ["bottom", bottom],
            ["shoes", shoes],
        ]
        const renderedItems = zones
            .map(([zone, product]) => mapSupabaseProductToStudioItem(zone, product))
            .filter((item): item is StudioRenderedItem => Boolean(item))

        composites[row.id] = {
            renderedItems,
            avatarGender: genderOf(top) ?? genderOf(bottom) ?? genderOf(shoes) ?? "female",
        }
    }

    return { rows, composites, nextCursor: rows.length === pageSize ? cursor + pageSize : null }
}

/** Categories for the outfits grid's filter dropdown. */
export async function fetchOutfitCategories(): Promise<OutfitCategory[]> {
    const { data, error } = await supabase.from("categories").select("id, name").order("name", { ascending: true })

    if (error) {
        throw new Error(`Failed to load categories: ${error.message}`)
    }

    return (data ?? []) as OutfitCategory[]
}

/** Keep sets reviewed_at only; hide also clears visible_in_feed. */
export async function reviewOutfit(outfitId: string, decision: OutfitReviewDecision): Promise<void> {
    const { error } = await untypedSupabase.rpc("review_outfit", {
        p_outfit_id: outfitId,
        p_decision: decision,
    })

    if (error) {
        throw new Error(`Failed to save decision: ${error.message}`)
    }
}

/** Puts a hidden outfit back in the feed and back in the review queue. */
export async function restoreOutfit(outfitId: string): Promise<void> {
    const { error } = await untypedSupabase.rpc("restore_outfit", {
        p_outfit_id: outfitId,
    })

    if (error) {
        throw new Error(`Failed to restore outfit: ${error.message}`)
    }
}
