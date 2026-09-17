import { useMutation, useQueryClient } from "@tanstack/react-query"

import { outfitsKeys } from "@/features/outfits/queryKeys"
import { collectionsKeys } from "@/features/collections/queryKeys"
import { studioKeys } from "@/features/studio/queryKeys"
import { updateOutfit, type UpdateOutfitInput } from "@/services/outfits/outfitsService"

type StudioOutfitCache = { outfit: { name?: string; tags?: string[] | null } | null } | undefined

export function useUpdateOutfit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: outfitsKeys.update,
    mutationFn: (input: UpdateOutfitInput) => updateOutfit(input),
    onSuccess: (_data, input) => {
      // Patch rather than refetch: a refetch would rebuild the Studio tray and drop in-progress swaps.
      queryClient.setQueryData<StudioOutfitCache>(studioKeys.outfit(input.outfitId), (prev) =>
        prev?.outfit ? { ...prev, outfit: { ...prev.outfit, name: input.name, tags: input.tags ?? null } } : prev,
      )
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creationsAll() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creationsCounts() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardItemsAll() })
      queryClient.invalidateQueries({ queryKey: outfitsKeys.all })
    },
  })
}
