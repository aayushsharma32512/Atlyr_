import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import {
  buildSlotMap,
  computePendingSlots,
  firstResolveDone,
  firstResolveState,
  mergeSlotMaps,
  type FirstResolveState,
  type RequestedSlotIds,
  type SlotMap,
} from "@/features/studio/utils/resolvedSlotsState"
import { studioService, type StudioProductTrayItem, type StudioProductTraySlot } from "@/services/studio/studioService"

interface UseStudioResolvedSlotsArgs {
  outfitId: string | null
  baseOutfitItems: StudioProductTrayItem[]
  requestedSlotIds: RequestedSlotIds
}

interface ResolvedSlotsResult {
  trayItems: StudioProductTrayItem[]
  /** A fetch for a requested piece is in flight. */
  isResolving: boolean
  /** True until the URL's pieces are in for the first time since mount or an outfit change. */
  awaitingFirstResolve: boolean
}

function toSlotOrder(): StudioProductTraySlot[] {
  return ["top", "bottom", "shoes"]
}

export function useStudioResolvedSlots({
  outfitId,
  baseOutfitItems,
  requestedSlotIds,
}: UseStudioResolvedSlotsArgs): ResolvedSlotsResult {
  const queryClient = useQueryClient()
  const baseSlotMap = useMemo(() => buildSlotMap(baseOutfitItems), [baseOutfitItems])
  const [resolvedSlots, setResolvedSlots] = useState<SlotMap>(() => baseSlotMap)
  const [isResolving, setIsResolving] = useState(() => computePendingSlots(requestedSlotIds, baseSlotMap).length > 0)
  // Set from the very first render, so no screen draws the saved pieces before the requested ones arrive.
  const [firstResolve, setFirstResolve] = useState<FirstResolveState>(() =>
    firstResolveState(null, outfitId, computePendingSlots(requestedSlotIds, baseSlotMap).length),
  )
  // An outfit change is decided during render, so no frame draws the previous look's pieces on the new one.
  if (firstResolve.outfitId !== outfitId) {
    setFirstResolve(firstResolveState(firstResolve, outfitId, computePendingSlots(requestedSlotIds, resolvedSlots).length))
  }

  useEffect(() => {
    setResolvedSlots((prev) => mergeSlotMaps(prev, baseSlotMap))
  }, [baseSlotMap])

  const pendingSlots = useMemo(
    () => computePendingSlots(requestedSlotIds, resolvedSlots),
    [requestedSlotIds, resolvedSlots],
  )

  useEffect(() => {
    if (pendingSlots.length === 0) {
      setIsResolving(false)
      setFirstResolve(firstResolveDone)
      return
    }

    let cancelled = false
    async function hydrate() {
      setIsResolving(true)
      for (const slot of pendingSlots) {
        if (cancelled) {
          break
        }

        const requestedId = requestedSlotIds[slot]
        if (!requestedId) {
          continue
        }

        // Try cache if we have an outfit ID
        if (outfitId) {
          const cached = queryClient.getQueryData<StudioProductTrayItem[]>(studioKeys.productTray(outfitId)) ?? []
          const cachedMatch = cached.find((item) => item.slot === slot && item.productId === requestedId)
          if (cachedMatch) {
            setResolvedSlots((prev) => {
              if (prev[slot]?.productId === cachedMatch.productId) {
                return prev
              }
              return { ...prev, [slot]: cachedMatch }
            })
            continue
          }
        }

        const fetched = await studioService.getProductById(requestedId)
        if (!fetched || cancelled) {
          continue
        }

        // Update cache if we have an outfit ID
        if (outfitId) {
          queryClient.setQueryData<StudioProductTrayItem[]>(studioKeys.productTray(outfitId), (prev = []) => {
            const filtered = prev.filter((item) => item.slot !== fetched.slot)
            return [...filtered, fetched]
          })
        }

        setResolvedSlots((prev) => ({ ...prev, [slot]: fetched }))
      }
      if (!cancelled) {
        setIsResolving(false)
        setFirstResolve(firstResolveDone)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [outfitId, pendingSlots, queryClient, requestedSlotIds])

  const trayItems = useMemo(() => {
    const items: StudioProductTrayItem[] = []
    toSlotOrder().forEach((slot) => {
      const resolved = resolvedSlots[slot]
      if (resolved) {
        items.push(resolved)
      }
    })
    return items
  }, [resolvedSlots])

  return { trayItems, isResolving, awaitingFirstResolve: firstResolve.awaiting }
}
