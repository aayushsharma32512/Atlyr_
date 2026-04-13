import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioProductTraySlot } from "@/services/studio/studioService"
import { buildStudioSearchParams, parseStudioSearchParams, type SlotIdMap } from "@/features/studio/utils/studioUrlState"
import type { Outfit } from "@/types"

export function useLaunchStudio() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  return useCallback(
    async (outfit?: Outfit | null) => {
      if (!outfit?.id) {
        return
      }

      const payload = await studioService.getOutfitById(outfit.id)
      queryClient.setQueryData(studioKeys.outfit(outfit.id), payload)
      queryClient.setQueryData(studioKeys.productTray(outfit.id), payload.trayItems)

      const slotIds: SlotIdMap = {}
      ;(["top", "bottom", "shoes"] as StudioProductTraySlot[]).forEach((slot) => {
        const item = payload.trayItems.find((trayItem) => trayItem.slot === slot)
        if (item) {
          slotIds[slot] = item.productId
        }
      })

      const params = buildStudioSearchParams({
        outfitId: outfit.id,
        slotIds,
        share: parseStudioSearchParams(new URLSearchParams(location.search)).share,
      })
      const originPath = `${location.pathname}${location.search}` || "/studio"
      params.set("returnTo", encodeURIComponent(originPath))
      const search = params.toString()
      navigate(`/studio${search ? `?${search}` : ""}`)
    },
    [location.pathname, location.search, navigate, queryClient],
  )
}
