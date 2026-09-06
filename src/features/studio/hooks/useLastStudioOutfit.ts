import { useQuery } from "@tanstack/react-query"

import { supabase } from "@/integrations/supabase/client"
import { studioKeys } from "@/features/studio/queryKeys"

/**
 * Fetches the user's most recently updated outfit ID for a given gender.
 * Only runs when `outfitId` is null (i.e., cold-start — no outfit in the URL/session yet).
 *
 * The gender filter is what keeps a profile switch honest: a male outfit is the
 * "most recently updated" one long after the user became female, and without the
 * filter the studio would keep resurrecting it while the rest of the app moved on.
 * Rows with no gender are excluded rather than guessed at — the starter outfit is
 * the fallback when this comes back empty.
 */
export function useLastStudioOutfit({
  userId,
  outfitId,
  gender,
}: {
  userId: string | null
  outfitId: string | null
  gender: "male" | "female" | null
}) {
  return useQuery({
    queryKey: [...studioKeys.all, "last-outfit", userId ?? "anon", gender ?? "neutral"],
    enabled: Boolean(userId) && Boolean(gender) && outfitId === null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outfits")
        .select("id")
        .eq("user_id", userId!)
        .eq("gender", gender!)
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
