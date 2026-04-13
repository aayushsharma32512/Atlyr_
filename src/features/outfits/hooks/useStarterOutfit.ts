import { useQuery } from "@tanstack/react-query"

import { outfitsKeys } from "@/features/outfits/queryKeys"
import { fetchStarterOutfitByGender } from "@/services/outfits/outfitsService"

type Gender = "male" | "female"

interface UseStarterOutfitParams {
  gender: Gender
  enabled?: boolean
}

/**
 * Hook to fetch a starter outfit for the given gender.
 * Used by admin studio to load a default outfit when no outfitId is in URL.
 * 
 * Follows architecture rule: Service → Hook → Component
 */
export function useStarterOutfit({ gender, enabled = true }: UseStarterOutfitParams) {
  return useQuery({
    queryKey: outfitsKeys.starterByGender(gender),
    queryFn: () => fetchStarterOutfitByGender(gender),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1, // Only retry once on failure
  })
}
