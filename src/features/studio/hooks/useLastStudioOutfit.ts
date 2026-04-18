import { useQuery } from "@tanstack/react-query"

import { supabase } from "@/integrations/supabase/client"
import { studioKeys } from "@/features/studio/queryKeys"

/**
 * Fetches the user's most recently updated outfit ID from the DB.
 * Only runs when `outfitId` is null (i.e., cold-start — no outfit in the URL/session yet).
 */
export function useLastStudioOutfit({
  userId,
  outfitId,
}: {
  userId: string | null
  outfitId: string | null
}) {
  return useQuery({
    queryKey: [...studioKeys.all, "last-outfit", userId ?? "anon"],
    enabled: Boolean(userId) && outfitId === null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outfits")
        .select("id")
        .eq("user_id", userId!)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.warn("[useLastStudioOutfit] Failed to fetch last outfit:", error.message)
        return null
      }

      return data?.id ?? null
    },
    select: (id) => id ?? null,
  })
}
