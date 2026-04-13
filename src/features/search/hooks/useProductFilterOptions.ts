import { useQuery } from "@tanstack/react-query"

import { searchKeys } from "@/features/search/queryKeys"
import { searchService } from "@/services/search/searchService"
import type { Database } from "@/integrations/supabase/types"

interface UseProductFilterOptionsParams {
  typeFilters?: Database["public"]["Enums"]["item_type"][]
  enabled?: boolean
}

export function useProductFilterOptions({ typeFilters, enabled = true }: UseProductFilterOptionsParams = {}) {
  return useQuery({
    queryKey: searchKeys.productFilterOptions(typeFilters as unknown as string[]),
    queryFn: () => searchService.getProductFilterOptions(typeFilters),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  })
}
