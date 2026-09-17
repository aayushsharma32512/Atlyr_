import { supabase } from "@/integrations/supabase/client"
import type { Database } from "@/integrations/supabase/types"

// count_outfits_for_product / delete_product are not in the generated Supabase
// types yet — same gap noted in candidatePairsService.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedSupabase = supabase as any

/** How many outfits reference this product — shown before a delete is confirmed. */
export async function countOutfitsForProduct(productId: string): Promise<number> {
    const { data, error } = await untypedSupabase.rpc("count_outfits_for_product", {
        p_product_id: productId,
    })

    if (error) {
        throw new Error(`Failed to count outfits: ${error.message}`)
    }

    return (data as number | null) ?? 0
}

/** Hard-deletes the product; its outfits, favorites, images and candidate pairs cascade. Returns the outfit count. */
export async function deleteProduct(productId: string): Promise<number> {
    const { data, error } = await untypedSupabase.rpc("delete_product", {
        p_product_id: productId,
    })

    if (error) {
        throw new Error(`Failed to delete product: ${error.message}`)
    }

    return (data as number | null) ?? 0
}

export interface ProductBrowseRow {
    id: string
    product_name: string | null
    brand: string
    price: number
    currency: string
    type: string
    thumbnail_url: string | null
    image_url: string
}

export interface ProductsPage {
    rows: ProductBrowseRow[]
    nextCursor: number | null
}

export type ProductGenderFilter = "male" | "female" | "unisex"
export type ProductTypeFilter = Database["public"]["Enums"]["item_type"]

export interface FetchProductsPageParams {
    q?: string
    gender?: ProductGenderFilter | null
    type?: ProductTypeFilter | null
    cursor?: number
    pageSize?: number
}

const PRODUCT_BROWSE_SELECT = "id, product_name, brand, price, currency, type, thumbnail_url, image_url"

// `,`, `(` and `)` are PostgREST's .or() delimiters, `%` is the ilike wildcard —
// strip them so free-text search input can't reshape the query it lands in.
function sanitizeSearchTerm(term: string): string {
    return term.replace(/[%,()]/g, "")
}

/** One page of the products browse, filtered by free-text search, gender and type. Newest first. */
export async function fetchProductsPage({
    q = "",
    gender = null,
    type = null,
    cursor = 0,
    pageSize = 24,
}: FetchProductsPageParams = {}): Promise<ProductsPage> {
    const from = cursor
    const to = cursor + pageSize - 1

    let query = supabase.from("products").select(PRODUCT_BROWSE_SELECT)

    if (gender) {
        query = query.eq("gender", gender)
    }
    if (type) {
        query = query.eq("type", type)
    }

    const term = sanitizeSearchTerm(q.trim())
    if (term) {
        query = query.or(`product_name.ilike.%${term}%,brand.ilike.%${term}%`)
    }

    const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)

    if (error) {
        throw new Error(`Failed to load products: ${error.message}`)
    }

    const rows = (data ?? []) as ProductBrowseRow[]
    return {
        rows,
        nextCursor: rows.length === pageSize ? cursor + pageSize : null,
    }
}
