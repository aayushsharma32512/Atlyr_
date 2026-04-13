import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { likenessKeys } from "@/features/likeness/queryKeys"
import { listLikeness, type LikenessPose } from "@/services/likeness/likenessService"
import { openLikenessDrawer } from "@/features/likeness/openLikenessDrawer"
import type { LikenessOutfitItemsParam, LikenessOutfitSnapshotParam, LikenessStep } from "@/features/likeness/types"

interface StartLikenessFlowOptions {
  initialStep?: LikenessStep
  outfitItems?: LikenessOutfitItemsParam
  outfitSnapshot?: LikenessOutfitSnapshotParam
}

/**
 * Shared launcher for the likeness (neutral pose) flow.
 * Stores the origin location in the query string so the flow can route back cleanly.
 */
export function useStartLikenessFlow() {
  const queryClient = useQueryClient()

  return useCallback(
    async (options?: StartLikenessFlowOptions) => {
      let resolvedStep: LikenessStep | undefined = options?.initialStep

      if (!resolvedStep) {
        try {
          const cached = queryClient.getQueryData<LikenessPose[]>(likenessKeys.list())
          const poses =
            cached ??
            (await queryClient.fetchQuery({
              queryKey: likenessKeys.list(),
              queryFn: () => listLikeness(),
            }))
          resolvedStep = poses && poses.length > 0 ? 3 : 1
        } catch (error) {
          console.error("[useStartLikenessFlow] failed to fetch poses", error)
          resolvedStep = 1
        }
      }

      openLikenessDrawer({
        initialStep: resolvedStep ?? 1,
        outfitItems: options?.outfitItems,
        outfitSnapshot: options?.outfitSnapshot,
        entrySource: "direct",
      })
    },
    [queryClient],
  )
}



