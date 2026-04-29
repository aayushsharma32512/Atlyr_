import { useCallback, useMemo, useState } from "react"

import { useToast } from "@/hooks/use-toast"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackSavedToCollection, trackSaveToggled, type EntityUiContext } from "@/integrations/posthog/engagementTracking/entityEvents"
import {
  useCreateMoodboard,
  useFavoriteProducts,
  useCollectionsOverview,
  useProductCollectionMembership,
  useRemoveProductFromLibrary,
  useRemoveProductFromCollection,
  useSaveProductToCollection,
} from "@/features/collections/hooks/useMoodboards"
import type { Moodboard } from "@/services/collections/collectionsService"

// Slugs excluded from the moodboard picker (managed by tap, not Move Moodboard)
const SYSTEM_SLUGS = new Set(["favorites", "try-ons", "generations"])

type SaveActionState = {
  isPickerOpen: boolean
  pendingProductId: string | null
  pendingContext: EntityUiContext | null
  currentMoodboardSlugs: string[]
}

export function useProductSaveActions() {
  const { toast } = useToast()
  const analytics = useEngagementAnalytics()
  const favoritesQuery = useFavoriteProducts()
  const saveMutation = useSaveProductToCollection()
  const removeMutation = useRemoveProductFromLibrary()
  const removeFromCollectionMutation = useRemoveProductFromCollection()
  const createMoodboardMutation = useCreateMoodboard()
  const collectionsOverviewQuery = useCollectionsOverview()
  const membershipQuery = useProductCollectionMembership()
  const moodboards = collectionsOverviewQuery.data?.moodboards ?? []
  const selectableMoodboards = useMemo(
    () => moodboards.filter((m) => !m.isSystem || m.slug === "wardrobe"),
    [moodboards],
  )

  const [state, setState] = useState<SaveActionState>({
    isPickerOpen: false,
    pendingProductId: null,
    pendingContext: null,
    currentMoodboardSlugs: [],
  })

  const favoriteIds = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data])
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const membership = useMemo(() => membershipQuery.data ?? {}, [membershipQuery.data])

  const isSaved = useCallback((productId: string) => favoriteSet.has(productId), [favoriteSet])

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
          trackSaveToggled(analytics, { entity_type: "product", entity_id: productId, new_state: true, save_method: "click", ...uiContext })
          trackSavedToCollection(analytics, { entity_type: "product", entity_id: productId, collection_slug: "favorites", save_method: "click", ...uiContext })
        } else {
          await removeMutation.mutateAsync({ productId })
          trackSaveToggled(analytics, { entity_type: "product", entity_id: productId, new_state: false, save_method: "click", ...uiContext })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update favorite"
        toast({ title: "Save failed", description: message, variant: "destructive" })
        favoritesQuery.refetch()
      }
    },
    [analytics, favoritesQuery, removeMutation, saveMutation, toast],
  )

  const handleLongPressSave = useCallback(
    async (productId: string, uiContext: EntityUiContext = {}) => {
      const alreadySaved = favoriteSet.has(productId)
      try {
        if (!alreadySaved) {
          // Save to favorites first if not yet saved
          await saveMutation.mutateAsync({ productId, slug: "favorites", label: "Favorites" })
          trackSaveToggled(analytics, { entity_type: "product", entity_id: productId, new_state: true, save_method: "long_press", ...uiContext })
          trackSavedToCollection(analytics, { entity_type: "product", entity_id: productId, collection_slug: "favorites", save_method: "long_press", ...uiContext })
        }
        const currentSlugs = getProductMoodboardSlugs(productId)
        setState({ isPickerOpen: true, pendingProductId: productId, pendingContext: uiContext, currentMoodboardSlugs: currentSlugs })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save product"
        toast({ title: "Save failed", description: message, variant: "destructive" })
      }
    },
    [analytics, favoriteSet, getProductMoodboardSlugs, saveMutation, toast],
  )

  /** Diff-sync: add newly selected boards, remove deselected boards */
  const handleApplyMoodboards = useCallback(
    async (selectedSlugs: string[]) => {
      if (!state.pendingProductId) return

      const labelBySlug = new Map(selectableMoodboards.map((m) => [m.slug, m.label]))
      const current = new Set(state.currentMoodboardSlugs)
      const next = new Set(selectedSlugs)
      const toAdd = selectedSlugs.filter((s) => !current.has(s))
      const toRemove = state.currentMoodboardSlugs.filter((s) => !next.has(s))

      let hadError = false
      const uiContext = state.pendingContext ?? {}

      for (const slug of toAdd) {
        try {
          await saveMutation.mutateAsync({ productId: state.pendingProductId, slug, label: labelBySlug.get(slug) })
          trackSavedToCollection(analytics, { entity_type: "product", entity_id: state.pendingProductId, collection_slug: slug, save_method: "long_press", ...uiContext })
        } catch { hadError = true }
      }

      for (const slug of toRemove) {
        try {
          await removeFromCollectionMutation.mutateAsync({ productId: state.pendingProductId, slug })
        } catch { hadError = true }
      }

      setState({ isPickerOpen: false, pendingProductId: null, pendingContext: null, currentMoodboardSlugs: [] })

      if (hadError) {
        toast({ title: "Saved with issues", description: "Could not update all moodboards.", variant: "destructive" })
      }
    },
    [analytics, removeFromCollectionMutation, saveMutation, selectableMoodboards, state, toast],
  )

  const handleCreateMoodboard = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      try {
        const created = await createMoodboardMutation.mutateAsync(trimmed)
        const slug = typeof created === "object" && created?.slug ? created.slug : null
        if (slug && state.pendingProductId) {
          await saveMutation.mutateAsync({ productId: state.pendingProductId, slug, label: created?.label })
          const uiContext = state.pendingContext ?? {}
          trackSavedToCollection(analytics, { entity_type: "product", entity_id: state.pendingProductId, collection_slug: slug, save_method: "long_press", ...uiContext })
        }
        return slug
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not create moodboard"
        toast({ title: "Create failed", description: message, variant: "destructive" })
        return undefined
      }
    },
    [analytics, createMoodboardMutation, saveMutation, state, toast],
  )

  const closePicker = useCallback(() => {
    setState({ isPickerOpen: false, pendingProductId: null, pendingContext: null, currentMoodboardSlugs: [] })
  }, [])

  return {
    moodboards: selectableMoodboards as Moodboard[],
    favoriteIds,
    isSaved,
    onToggleSave: handleToggleSave,
    onLongPressSave: handleLongPressSave,
    onApplyMoodboards: handleApplyMoodboards,
    onCreateMoodboard: handleCreateMoodboard,
    isPickerOpen: state.isPickerOpen,
    pendingProductId: state.pendingProductId,
    currentMoodboardSlugs: state.currentMoodboardSlugs,
    closePicker,
    isSaving: saveMutation.isPending || createMoodboardMutation.isPending || removeFromCollectionMutation.isPending,
  }
}
