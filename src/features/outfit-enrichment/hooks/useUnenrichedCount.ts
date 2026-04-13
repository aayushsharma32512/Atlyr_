import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { enrichmentQueryKeys } from "../queryKeys"
import { getUnenrichedOutfitsCount } from "@/services/outfit-enrichment/batchEnrichmentService"

export function useUnenrichedCount() {
    return useQuery({
        queryKey: enrichmentQueryKeys.counts(),
        queryFn: () => getUnenrichedOutfitsCount(supabase),
        staleTime: 60_000, // 1 minute
    })
}
