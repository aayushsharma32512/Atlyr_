import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { Creation } from "@/services/collections/collectionsService"
import { getMannequinConfigQueryOptions } from "@/features/studio/hooks/useMannequinConfig"
import { getOutfitProductsQueryOptions } from "@/features/studio/hooks/useOutfitProducts"

const resolveGender = (value?: string | null): "male" | "female" => (value === "male" ? "male" : "female")

type PrefetchCreationAssetsOptions = {
  creations: Creation[]
  currentSlide: number
  vtoImageErrorUrls: Record<string, string>
}

export function usePrefetchCreationAssets({
  creations,
  currentSlide,
  vtoImageErrorUrls,
}: PrefetchCreationAssetsOptions) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!creations.length) return
    const wrap = (index: number) => (index + creations.length) % creations.length
    const indices = Array.from(new Set([currentSlide, wrap(currentSlide + 1)]))

    indices.forEach((idx) => {
      const creation = creations[idx]
      const outfitId = creation?.outfitId
      if (!outfitId) return
      const gender = resolveGender(creation.gender)
      const vtoUrl = creation.vtoImageUrl
      const vtoErrored = Boolean(vtoUrl && vtoImageErrorUrls[outfitId] === vtoUrl)
      const needsAvatarPreview = !vtoUrl || vtoErrored

      if (!needsAvatarPreview) {
        return
      }

      queryClient.prefetchQuery(getMannequinConfigQueryOptions({ gender }))
      queryClient.prefetchQuery(getOutfitProductsQueryOptions(outfitId))
    })
  }, [creations, currentSlide, queryClient, vtoImageErrorUrls])
}
