import { useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useStudioContext } from "@/features/studio/context/StudioContext"
import type {
  StudioProductTrayItem,
  StudioAlternativeProduct,
  StudioProductTraySlot,
} from "@/services/studio/studioService"
import type { Outfit } from "@/types"
import { injectDisplacedAlternative, toTrayItem, upsertTrayItem } from "@/features/studio/utils/trayMutations"

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
    mutationFn: async (variables: SwapVariables) => variables,
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
      let displacedItem: StudioProductTrayItem | null = null

      queryClient.setQueryData<StudioOutfitCacheEntry | undefined>(studioKeys.outfit(outfitId), (prev) => {
        if (!prev) {
          return prev
        }

        const currentItems = prev.trayItems ?? []
        displacedItem = currentItems.find((item) => item.slot === slot) ?? null
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

      queryClient.setQueryData<StudioProductTrayItem | null>(
        [...studioKeys.hero(outfitId, slot), trayItem.productId ?? "default"],
        () => trayItem,
      )

      queryClient.setQueryData<StudioAlternativeProduct[]>(alternativesKey, (prevList = []) => {
        const filtered = prevList.filter((alt) => alt.id !== product.id)
        return injectDisplacedAlternative(filtered, displacedItem)
      })

      setSlotProductId(slot, product.id)

      return context
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

