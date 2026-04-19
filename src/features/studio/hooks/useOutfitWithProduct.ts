import { useQuery } from "@tanstack/react-query"

import { supabase } from "@/integrations/supabase/client"

interface OutfitWithProduct {
  id: string
  top_id: string | null
  bottom_id: string | null
  shoes_id: string | null
  gender: string | null
  background_id: string | null
}

/**
 * Finds the most recently created outfit that contains the given product in any slot.
 *
 * Sorting is currently by `created_at DESC` (latest made) — the `sortBy` parameter is a
 * placeholder so the callsite can be switched to rating / popularity / relevance score
 * later without touching this hook's internals.
 */
export function useOutfitWithProduct(
  productId: string | null,
  _sortBy: "latest" = "latest",
) {
  return useQuery<OutfitWithProduct | null>({
    queryKey: ["outfit-with-product", productId],
    enabled: Boolean(productId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!productId) return null

      const { data, error } = await supabase
        .from("outfits")
        .select("id, top_id, bottom_id, shoes_id, gender, background_id")
        .or(`top_id.eq.${productId},bottom_id.eq.${productId},shoes_id.eq.${productId}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.warn("[useOutfitWithProduct] Query failed:", error.message)
        return null
      }

      return data ?? null
    },
  })
}
