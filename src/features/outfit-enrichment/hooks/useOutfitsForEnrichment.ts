import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { enrichmentQueryKeys } from "../queryKeys"

export type EnrichmentStatus = "enriched" | "pending" | "not_generated" | "no_image"

export interface OutfitForEnrichment {
    id: string
    name: string
    outfit_images: string | null
    enriched_fit: string[] | null
    enriched_feel: string[] | null
    enriched_vibes: string[] | null
    created_at: string
    enrichmentStatus: EnrichmentStatus
}

/**
 * Fetch all outfits with their enrichment status.
 * Also checks for pending drafts to show "Pending Review" status.
 */
export function useOutfitsForEnrichment(page: number = 1, limit: number = 50) {
    return useQuery<OutfitForEnrichment[], Error>({
        queryKey: [...enrichmentQueryKeys.all, "outfits", page, limit] as const,
        queryFn: async () => {
            const start = (page - 1) * limit
            const end = start + limit - 1

            // Fetch outfits
            const { data: outfits, error: outfitsError } = await supabase
                .from("outfits")
                .select("id, name, outfit_images, enriched_fit, enriched_feel, enriched_vibes, created_at")
                .order("updated_at", { ascending: false })
                .range(start, end)

            if (outfitsError) {
                throw new Error(`Failed to fetch outfits: ${outfitsError.message}`)
            }

            // Fetch pending drafts to check which outfits have pending enrichment
            const { data: pendingDrafts, error: draftsError } = await supabase
                .from("outfit_enrichment_drafts")
                .select("outfit_id")
                .eq("approval_status", "pending")

            if (draftsError) {
                throw new Error(`Failed to fetch drafts: ${draftsError.message}`)
            }

            const pendingOutfitIds = new Set(pendingDrafts?.map((d) => d.outfit_id) ?? [])

            // Compute enrichment status for each outfit
            return (outfits ?? []).map((outfit) => {
                let enrichmentStatus: EnrichmentStatus

                if (outfit.enriched_fit) {
                    enrichmentStatus = "enriched"
                } else if (pendingOutfitIds.has(outfit.id)) {
                    enrichmentStatus = "pending"
                } else if (!outfit.outfit_images) {
                    enrichmentStatus = "no_image"
                } else {
                    enrichmentStatus = "not_generated"
                }

                return {
                    ...outfit,
                    enrichmentStatus,
                }
            })
        },
        staleTime: 30_000, // 30 seconds
        gcTime: 5 * 60_000, // 5 minutes
        placeholderData: (previousData) => previousData,
    })
}
