import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioProductTrayItem, type StudioProductTraySlot } from "@/services/studio/studioService"

interface UseStudioResolvedSlotsArgs {
  outfitId: string | null
  baseOutfitItems: StudioProductTrayItem[]
  requestedSlotIds: Partial<Record<StudioProductTraySlot, string | null>>
}

interface ResolvedSlotsResult {
  trayItems: StudioProductTrayItem[]
  isResolving: boolean
}

function toSlotOrder(): StudioProductTraySlot[] {
  return ["top", "bottom", "shoes"]
}

type SlotMap = Record<StudioProductTraySlot, StudioProductTrayItem | null>

function buildSlotMap(items: StudioProductTrayItem[]): SlotMap {
  const map: SlotMap = {
    top: null,
    bottom: null,
    shoes: null,
  }
  items.forEach((item) => {
    if (item.slot === "top" || item.slot === "bottom" || item.slot === "shoes") {
      map[item.slot] = item
    }
  })
  return map
}

function mergeSlotMaps(target: SlotMap, source: SlotMap): SlotMap {
  let changed = false
  const next: SlotMap = { ...target }
  toSlotOrder().forEach((slot) => {
    const incoming = source[slot]
    if (incoming && (!next[slot] || next[slot]?.productId !== incoming.productId)) {
      next[slot] = incoming
      changed = true
    }
  })
  return changed ? next : target
}

function computePendingSlots(
  requestedSlotIds: Partial<Record<StudioProductTraySlot, string | null>>,
  resolvedSlots: SlotMap,
): StudioProductTraySlot[] {
  return toSlotOrder().filter((slot) => {
    const requestedId = requestedSlotIds[slot]
    if (!requestedId) {
      return false
    }
    const resolved = resolvedSlots[slot]
    return !resolved || resolved.productId !== requestedId
  })
}

export function useStudioResolvedSlots({
  outfitId,
  baseOutfitItems,
  requestedSlotIds,
}: UseStudioResolvedSlotsArgs): ResolvedSlotsResult {
  const queryClient = useQueryClient()
  const baseSlotMap = useMemo(() => buildSlotMap(baseOutfitItems), [baseOutfitItems])
  const [resolvedSlots, setResolvedSlots] = useState<SlotMap>(() => baseSlotMap)
  const [isResolving, setIsResolving] = useState(false)

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

  return { trayItems, isResolving }
}


