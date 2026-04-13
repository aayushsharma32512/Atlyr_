import { supabase } from "@/integrations/supabase/client"
import type { Database } from "@/integrations/supabase/types"

/**
 * Product image from the product_images table
 */
export interface StudioProductImage {
    id: string
    productId: string
    url: string
    kind: "flatlay" | "model" | "detail"
    sortOrder: number
    isPrimary: boolean
    gender: "male" | "female" | null
}

type DbProductImageRow = Database["public"]["Tables"]["product_images"]["Row"]

function mapDbRowToProductImage(row: DbProductImageRow): StudioProductImage {
    return {
        id: row.id,
        productId: row.product_id,
        url: row.url,
        kind: (row.kind as "flatlay" | "model" | "detail") ?? "model",
        sortOrder: row.sort_order ?? 0,
        isPrimary: row.is_primary ?? false,
        gender: row.gender === "male" || row.gender === "female" ? row.gender : null,
    }
}

/**
 * Fetch all images for a product from the product_images table.
 * Orders by: is_primary DESC, sort_order ASC, id ASC for stability.
 */
async function getProductImages(productId: string): Promise<StudioProductImage[]> {
    if (!productId) {
        return []
    }

    const { data, error } = await supabase
        .from("product_images")
        .select("*")
        .eq("product_id", productId)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })

    if (error) {
        throw new Error(error.message)
    }

    return (data ?? []).map(mapDbRowToProductImage)
}

export const productImagesService = {
    getProductImages,
}
