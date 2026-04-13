import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { studioService } from "@/services/studio/studioService"
import type { StudioOutfitDTO } from "@/features/studio/types"

const DEFAULT_AVATAR_HEAD = "/avatars/Default.png"
const DEFAULT_AVATAR_HEIGHT = 170

export function useStudioOutfit(outfitId: string | null) {
  const { gender, heightCm } = useProfileContext()

  return useQuery({
    queryKey: studioKeys.outfit(outfitId),
    enabled: Boolean(outfitId),
    queryFn: () =>
      outfitId
        ? studioService.getOutfitById(outfitId)
        : Promise.resolve({ outfit: null, studioOutfit: null, trayItems: [] }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    select: (payload) => {
      const studioOutfit = payload.studioOutfit as StudioOutfitDTO | null
      const fallbackGender: "male" | "female" = gender === "male" ? "male" : "female"
      const studioGender =
        studioOutfit?.gender === "male" || studioOutfit?.gender === "female" ? studioOutfit.gender : null

      return {
        outfit: payload.outfit,
        studioOutfit,
        trayItems: payload.trayItems,
        avatarHeadSrc: studioOutfit?.imageSrcFallback ?? DEFAULT_AVATAR_HEAD,
        avatarGender: studioGender ?? fallbackGender,
        avatarHeightCm: heightCm ?? DEFAULT_AVATAR_HEIGHT,
      }
    },
  })
}
