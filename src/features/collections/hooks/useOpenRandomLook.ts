import { useCallback } from "react"
import { useNavigate } from "react-router-dom"

import { useFavorites } from "@/features/collections/hooks/useMoodboards"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { buildStudioUrl } from "@/features/studio/utils/studioUrlState"
import { fetchRandomOutfitId } from "@/services/outfits/outfitsService"

/** Opens Studio on one of the user's favourites, or on a random feed look when there are none. */
export function useOpenRandomLook() {
  const navigate = useNavigate()
  const { gender } = useProfileContext()
  const favorites = useFavorites().data ?? []

  return useCallback(async () => {
    const outfitId = favorites.length
      ? favorites[Math.floor(Math.random() * favorites.length)]
      : await fetchRandomOutfitId(gender)
    navigate(buildStudioUrl("/studio", "studio", { outfitId }))
  }, [favorites, gender, navigate])
}
