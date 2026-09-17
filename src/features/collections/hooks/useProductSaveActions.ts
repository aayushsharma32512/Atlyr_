import { useCallback, useMemo } from "react"

import { useToast } from "@/hooks/use-toast"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackSavedToCollection, trackSaveToggled, type EntityUiContext } from "@/integrations/posthog/engagementTracking/entityEvents"
import {
  useCreateMoodboard,
  useFavoriteProducts,
  useCollectionsOverview,
  useProductCollectionMembership,
  useRemoveProductFromCollection,
  useSaveProductToCollection,
  useSavedProductTags,
} from "@/features/collections/hooks/useMoodboards"
import { useSaveTray } from "@/features/collections/providers/SaveTrayProvider"
import type { Moodboard } from "@/services/collections/collectionsService"
import { addNotice, saveLine } from "@/features/notifications/notices"

// Slugs excluded from the moodboard picker (managed by tap, not the save tray)
const SYSTEM_SLUGS = new Set(["favorites", "try-ons", "generations"])

export function useProductSaveActions() {
  const { toast } = useToast()
  const analytics = useEngagementAnalytics()
  const { openPieceSave } = useSaveTray()
  const favoritesQuery = useFavoriteProducts()
  const saveMutation = useSaveProductToCollection()
  const removeFromCollectionMutation = useRemoveProductFromCollection()
  const createMoodboardMutation = useCreateMoodboard()
  const collectionsOverviewQuery = useCollectionsOverview()
  const membershipQuery = useProductCollectionMembership()
  const savedTagsQuery = useSavedProductTags()
  const getSavedProductTags = useCallback(
    (productId: string) => savedTagsQuery.data?.[productId] ?? [],
    [savedTagsQuery.data],
  )
  const selectableMoodboards = useMemo(
    () => (collectionsOverviewQuery.data?.moodboards ?? [])
      .filter((m) => !m.isSystem || m.slug === "wardrobe"),
    [collectionsOverviewQuery.data?.moodboards],
  )

  const favoriteIds = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data])
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const membership = useMemo(() => membershipQuery.data ?? {}, [membershipQuery.data])

  const isSaved = useCallback((productId: string) => favoriteSet.has(productId), [favoriteSet])
  const isInWardrobe = useCallback(
    (productId: string) => membership.wardrobe?.has(productId) ?? false,
    [membership],
  )

  /** Returns the custom moodboard slugs a product currently belongs to */
  const getProductMoodboardSlugs = useCallback(
    (productId: string): string[] =>
      Object.entries(membership)
        .filter(([slug, ids]) => !SYSTEM_SLUGS.has(slug) && ids.has(productId))
        .map(([slug]) => slug),
    [membership],
  )

  const handleToggleSave = useCallback(
    async (productId: string, nextSaved: boolean, uiContext: EntityUiContext = {}) => {
      try {
        if (nextSaved) {
          await saveMutation.mutateAsync({ productId, slug: "favorites", label: "Favorites" })
          addNotice({ id: "save:product:" + productId + ":favorites:" + Date.now(), kind: "save", title: "Saved to Favourites", line: saveLine(uiContext.section), at: Date.now(), payload: { productId, slug: "favorites" } })
          trackSaveToggled(analytics, { entity_type: "product", entity_id: productId, collection_slug: "favorites", new_state: true, save_method: "click", ...uiContext })
          trackSavedToCollection(analytics, { entity_type: "product", entity_id: productId, collection_slug: "favorites", save_method: "click", ...uiContext })
        } else {
          await removeFromCollectionMutation.mutateAsync({ productId, slug: "favorites" })
          trackSaveToggled(analytics, { entity_type: "product", entity_id: productId, collection_slug: "favorites", new_state: false, save_method: "click", ...uiContext })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update favorite"
        toast({ title: "Save failed", description: message, variant: "destructive" })
        favoritesQuery.refetch()
      }
    },
    [analytics, favoritesQuery, removeFromCollectionMutation, saveMutation, toast],
  )

  const handleToggleWardrobe = useCallback(
    async (productId: string, nextSaved: boolean, uiContext: EntityUiContext = {}) => {
      try {
        if (nextSaved) {
          await saveMutation.mutateAsync({ productId, slug: "wardrobe", label: "Wardrobe" })
          addNotice({ id: "save:product:" + productId + ":wardrobe:" + Date.now(), kind: "save", title: "Added to Wardrobe", line: saveLine(uiContext.section), at: Date.now(), payload: { productId, slug: "wardrobe" } })
          trackSaveToggled(analytics, { entity_type: "product", entity_id: productId, collection_slug: "wardrobe", new_state: true, save_method: "click", ...uiContext })
          trackSavedToCollection(analytics, { entity_type: "product", entity_id: productId, collection_slug: "wardrobe", save_method: "click", ...uiContext })
        } else {
          await removeFromCollectionMutation.mutateAsync({ productId, slug: "wardrobe" })
          trackSaveToggled(analytics, { entity_type: "product", entity_id: productId, collection_slug: "wardrobe", new_state: false, save_method: "click", ...uiContext })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update Wardrobe"
        toast({ title: "Wardrobe update failed", description: message, variant: "destructive" })
        membershipQuery.refetch()
      }
    },
    [analytics, membershipQuery, removeFromCollectionMutation, saveMutation, toast],
  )

  const handleLongPressSave = useCallback(
    (productId: string, uiContext: EntityUiContext = {}) => {
      openPieceSave(productId, uiContext)
    },
    [openPieceSave],
  )

  /** Every board a product is on, Favorites included — the save card's starting selection. */
  const getProductBoardSlugs = useCallback(
    (productId: string): string[] => [
      ...(favoriteSet.has(productId) ? ["favorites"] : []),
      ...getProductMoodboardSlugs(productId),
    ],
    [favoriteSet, getProductMoodboardSlugs],
  )

  /** The save card: sync a product to exactly these boards, Favorites included, with these tags. */
  const handleSaveToBoards = useCallback(
    async (productId: string, slugs: string[], tags: string[] = [], uiContext: EntityUiContext = {}) => {
      const current = getProductBoardSlugs(productId)
      const labelBySlug = new Map<string, string>([["favorites", "Favorites"]])
      selectableMoodboards.forEach((m) => labelBySlug.set(m.slug, m.label))
      try {
        const added = slugs.filter((s) => !current.includes(s))
        for (const slug of added) {
          await saveMutation.mutateAsync({ productId, slug, label: labelBySlug.get(slug), tags })
          trackSavedToCollection(analytics, { entity_type: "product", entity_id: productId, collection_slug: slug, save_method: "click", ...uiContext })
        }
        for (const slug of current.filter((s) => !slugs.includes(s))) {
          await removeFromCollectionMutation.mutateAsync({ productId, slug })
        }
        // Boards may be unchanged while only the tags changed — piggyback the tag write on
        // one surviving board so every row for this product still ends up agreeing.
        if (added.length === 0 && slugs.length > 0) {
          const slug = slugs[0]
          await saveMutation.mutateAsync({ productId, slug, label: labelBySlug.get(slug), tags })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save product"
        toast({ title: "Save failed", description: message, variant: "destructive" })
        throw err
      }
    },
    [analytics, getProductBoardSlugs, removeFromCollectionMutation, saveMutation, selectableMoodboards, toast],
  )

  const handleCreateMoodboard = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      try {
        const created = await createMoodboardMutation.mutateAsync(trimmed)
        return typeof created === "object" && created?.slug ? created.slug : undefined
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not create moodboard"
        toast({ title: "Create failed", description: message, variant: "destructive" })
        return undefined
      }
    },
    [createMoodboardMutation, toast],
  )

  return {
    moodboards: selectableMoodboards as Moodboard[],
    favoriteIds,
    isSaved,
    isInWardrobe,
    onToggleSave: handleToggleSave,
    onToggleWardrobe: handleToggleWardrobe,
    onLongPressSave: handleLongPressSave,
    getProductBoardSlugs,
    getSavedProductTags,
    onSaveToBoards: handleSaveToBoards,
    onCreateMoodboard: handleCreateMoodboard,
    isSaving: saveMutation.isPending || createMoodboardMutation.isPending || removeFromCollectionMutation.isPending,
  }
}
