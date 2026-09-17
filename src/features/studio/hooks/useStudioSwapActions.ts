import { useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useStudioContext } from "@/features/studio/context/StudioContext"
import {
  studioService,
  type StudioProductTrayItem,
  type StudioAlternativeProduct,
  type StudioProductTraySlot,
} from "@/services/studio/studioService"
import type { Outfit } from "@/types"
import { toTrayItem, upsertTrayItem } from "@/features/studio/utils/trayMutations"

type StudioOutfitCacheEntry = {
  outfit: Outfit | null
  trayItems: StudioProductTrayItem[]
  swappedTrayItems?: Partial<Record<StudioProductTraySlot, StudioProductTrayItem>>
}

interface SwapVariables {
  slot: StudioProductTraySlot
  product: StudioAlternativeProduct
}

interface SwapContext {
  previousOutfit?: StudioOutfitCacheEntry
  previousTray?: StudioProductTrayItem[]
  previousAlternatives?: StudioAlternativeProduct[]
  alternativesKey: ReturnType<typeof studioKeys.alternatives>
}

export function useStudioSwapActions(outfitId: string | null) {
  const queryClient = useQueryClient()
  const { gender } = useProfileContext()
  const { setSlotProductId } = useStudioContext()

  const mutation = useMutation({
    mutationKey: studioKeys.swap(outfitId),
    // Rack tiles carry no tag fields; the full row fills them in once it lands. A failed
    // fetch must not roll the swap back, so it resolves to null instead of throwing.
    mutationFn: async ({ product }: SwapVariables) => {
      try {
        return await studioService.getProductById(product.id)
      } catch {
        return null
      }
    },
    onMutate: async ({ slot, product }) => {
      if (!outfitId) {
        return null
      }

      await Promise.all([
        queryClient.cancelQueries({ queryKey: studioKeys.outfit(outfitId) }),
        queryClient.cancelQueries({ queryKey: studioKeys.productTray(outfitId) }),
        queryClient.cancelQueries({ queryKey: studioKeys.hero(outfitId, slot) }),
      ])

      const alternativesKey = studioKeys.alternatives({
        outfitId,
        slot,
        gender: gender ?? null,
      })

      const context: SwapContext = {
        previousOutfit: queryClient.getQueryData(studioKeys.outfit(outfitId)),
        previousTray: queryClient.getQueryData(studioKeys.productTray(outfitId)),
        previousAlternatives: queryClient.getQueryData(alternativesKey),
        alternativesKey,
      }

      const trayItem = toTrayItem(slot, product)

      queryClient.setQueryData<StudioOutfitCacheEntry | undefined>(studioKeys.outfit(outfitId), (prev) => {
        if (!prev) {
          return prev
        }

        const currentItems = prev.trayItems ?? []
        const updatedTrayItems = upsertTrayItem(currentItems, trayItem)
        const swappedTrayItems = {
          ...(prev.swappedTrayItems ?? {}),
          [slot]: trayItem,
        }

        return {
          ...prev,
          trayItems: updatedTrayItems,
          swappedTrayItems,
        }
      })

      queryClient.setQueryData<StudioProductTrayItem[] | undefined>(
        studioKeys.productTray(outfitId),
        (prevItems = []) => upsertTrayItem(prevItems, trayItem),
      )

      // The hero query is not seeded: with staleTime Infinity a seeded rack tile would never be
      // replaced by the full product row, and the tray fallback already covers the fetch gap.

      // The rack is deliberately left alone: the worn tile is outlined in place.
      // Removing it and injecting the displaced piece at the front made the
      // list jump under the finger on every wear.

      setSlotProductId(slot, product.id)

      return context
    },
    onSuccess: (fullItem, { slot }) => {
      if (!outfitId || !fullItem) {
        return
      }
      // Only the fields the rack tile lacked; render fields stay as the optimistic swap set them.
      const fill = (item: StudioProductTrayItem) =>
        item.slot === slot && item.productId === fullItem.productId
          ? {
              ...item,
              fitTags: fullItem.fitTags,
              feelTags: fullItem.feelTags,
              vibeTags: fullItem.vibeTags,
              colorGroup: fullItem.colorGroup ?? null,
              materialType: fullItem.materialType ?? null,
              care: fullItem.care ?? null,
            }
          : item

      queryClient.setQueryData<StudioOutfitCacheEntry | undefined>(studioKeys.outfit(outfitId), (prev) => {
        if (!prev) {
          return prev
        }
        const swapped = prev.swappedTrayItems?.[slot]
        return {
          ...prev,
          trayItems: (prev.trayItems ?? []).map(fill),
          swappedTrayItems: swapped ? { ...prev.swappedTrayItems, [slot]: fill(swapped) } : prev.swappedTrayItems,
        }
      })

      queryClient.setQueryData<StudioProductTrayItem[] | undefined>(
        studioKeys.productTray(outfitId),
        (prevItems = []) => prevItems.map(fill),
      )
    },
    onError: (_error, _variables, context) => {
      if (!context || !outfitId) {
        return
      }
      if (context.previousOutfit) {
        queryClient.setQueryData(studioKeys.outfit(outfitId), context.previousOutfit)
      }
      if (context.previousTray) {
        queryClient.setQueryData(studioKeys.productTray(outfitId), context.previousTray)
      }
      if (context.previousAlternatives) {
        queryClient.setQueryData(context.alternativesKey, context.previousAlternatives)
      }
    },
  })

  const swapSlot = useCallback(
    (slot: StudioProductTraySlot, product: StudioAlternativeProduct) => {
      if (!outfitId) {
        return
      }
      mutation.mutate({ slot, product })
    },
    [mutation, outfitId],
  )

  return { swapSlot, isSwapping: mutation.isPending }
}

