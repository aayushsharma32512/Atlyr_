import type { QueryClient } from "@tanstack/react-query"
import firstLook from "@/assets/landing-looks/first-look.json"
import { getAvatarHairStylesQueryOptions } from "@/features/profile/hooks/useAvatarHairStyles"
import { getMannequinConfigQueryOptions } from "@/features/studio/hooks/useMannequinConfig"
import { avatarHairStylesService } from "@/services/profile/avatarHairStylesService"
import { mannequinService } from "@/services/studio/mannequinService"
import { studioService } from "@/services/studio/studioService"
import type { Database } from "@/integrations/supabase/types"
import { landingKeys } from "./queryKeys"
import { prefetchLandingStudio } from "./hooks/useLandingStudioData"

type ProductRow = Database["public"]["Tables"]["products"]["Row"]
type MannequinRow = Parameters<typeof mannequinService.mapRowToConfig>[0]
type HairRow = Parameters<typeof avatarHairStylesService.mapRow>[0]

export const LANDING_PATHS = new Set(["/", "/waitlist", "/landing", "/marketing"])

/**
 * Runs at app start for the landing routes, before React renders anything: seeds the opening look,
 * the mannequin and the hair styles from data baked at build time, starts the studio chunk download,
 * and refreshes the seeded data in the background so the database still wins if it changed.
 */
export function bootLanding(queryClient: QueryClient) {
  // Seeded as stale, so the live refetch below replaces it without an observer noticing a gap.
  const seeded = { updatedAt: 0 }
  queryClient.setQueryData(
    landingKeys.firstLook(),
    (firstLook.products as unknown as ProductRow[]).map(studioService.mapProductRowToAlternative),
    seeded,
  )
  const mannequin = getMannequinConfigQueryOptions({ gender: "female" })
  queryClient.setQueryData(mannequin.queryKey, mannequinService.mapRowToConfig(firstLook.mannequin as unknown as MannequinRow), seeded)
  const hair = getAvatarHairStylesQueryOptions("female")
  queryClient.setQueryData(hair.queryKey, (firstLook.hairStyles as unknown as HairRow[]).map(avatarHairStylesService.mapRow), seeded)

  void import("./components/LandingStudio")
  prefetchLandingStudio(queryClient)
  void queryClient.fetchQuery({ ...mannequin, staleTime: 0 }).catch(() => {})
  void queryClient.fetchQuery({ ...hair, staleTime: 0 }).catch(() => {})
}
