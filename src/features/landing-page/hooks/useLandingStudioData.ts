import { useQuery, type QueryClient } from "@tanstack/react-query"
import {
  studioService,
  type StudioAlternativeProduct,
  type StudioProductTraySlot,
} from "@/services/studio/studioService"
import { getMannequinConfigQueryOptions } from "@/features/studio/hooks/useMannequinConfig"
import { getAvatarHairStylesQueryOptions } from "@/features/profile/hooks/useAvatarHairStyles"
import type { MannequinConfig } from "@/features/studio/types"
import { landingKeys } from "../queryKeys"
import { LANDING_FIRST_LOOK_IDS, LANDING_INVENTORY_IDS } from "../landingInventory"
import { bundledGarmentUrl } from "../landingLookAssets"

// Three rows, so the opening look never waits for the whole catalogue's 200KB.
const firstLookOptions = {
  queryKey: landingKeys.firstLook(),
  queryFn: () => studioService.getProductsByIds(LANDING_FIRST_LOOK_IDS),
  staleTime: Infinity,
  gcTime: Infinity,
}

const inventoryOptions = {
  queryKey: landingKeys.inventory(),
  queryFn: () => studioService.getProductsByIds(LANDING_INVENTORY_IDS),
  staleTime: Infinity,
  gcTime: Infinity,
}

const mannequinOptions = getMannequinConfigQueryOptions({ gender: "female" })

export function useLandingFirstLook() {
  return useQuery<StudioAlternativeProduct[]>(firstLookOptions)
}

/** The fixed demo catalogue. Never goes stale within a visit. */
export function useLandingInventory() {
  return useQuery<StudioAlternativeProduct[]>(inventoryOptions)
}

/** One vibe search for a slot, by text, a photo, or both. Same call the in-app rack makes, women's catalogue only. */
export function useLandingSearch(slot: StudioProductTraySlot, query: string, imageUrl: string | null) {
  return useQuery<StudioAlternativeProduct[]>({
    queryKey: landingKeys.search(slot, query, imageUrl),
    queryFn: () => studioService.searchAlternatives({ slot, query, imageUrl: imageUrl ?? undefined, gender: "female" }),
    enabled: query.trim().length > 0 || Boolean(imageUrl),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
}

/** Fired from the page shell, so the data and the mannequin images race the renderer's chunk instead of waiting for it. */
export function prefetchLandingStudio(queryClient: QueryClient) {
  // The opening look's bundled garments, fetched the way the renderer fetches them so the cache entry matches.
  for (const id of LANDING_FIRST_LOOK_IDS) {
    const url = bundledGarmentUrl(id)
    if (url) fetch(url, { mode: "cors" }).then((res) => res.blob()).catch(() => {})
  }
  // Data seeded at boot carries updatedAt 0, so the live rows must be fetched past the infinite staleTime.
  const seeded = queryClient.getQueryState(landingKeys.firstLook())?.dataUpdatedAt === 0
  void (seeded ? queryClient.fetchQuery({ ...firstLookOptions, staleTime: 0 }).catch(() => {}) : queryClient.prefetchQuery(firstLookOptions))
  void queryClient.prefetchQuery(inventoryOptions)
  void queryClient.prefetchQuery(getAvatarHairStylesQueryOptions("female"))
  void queryClient.prefetchQuery(mannequinOptions).then(() => {
    const config = queryClient.getQueryData<MannequinConfig | null>(mannequinOptions.queryKey)
    for (const segment of Object.values(config?.segments ?? {})) {
      // Same crossOrigin as the renderer's own loader, so the cache entry matches.
      const image = new Image()
      image.crossOrigin = "anonymous"
      image.src = segment.assetUrl
    }
  })
}
