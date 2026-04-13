import { useCallback, useMemo, useState } from "react"

import { useToast } from "@/hooks/use-toast"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackSavedToCollection, trackSaveToggled, type EntityUiContext } from "@/integrations/posthog/engagementTracking/entityEvents"
import {
  useCreateMoodboard,
  useFavoriteProducts,
  useCollectionsOverview,
  useRemoveProductFromLibrary,
  useSaveProductToCollection,
} from "@/features/collections/hooks/useMoodboards"
import type { Moodboard } from "@/services/collections/collectionsService"

type SaveActionState = {
  isPickerOpen: boolean
  pendingProductId: string | null
  pendingContext: EntityUiContext | null
}

export function useProductSaveActions() {
  const { toast } = useToast()
  const analytics = useEngagementAnalytics()
  const favoritesQuery = useFavoriteProducts()
  const saveMutation = useSaveProductToCollection()
  const removeMutation = useRemoveProductFromLibrary()
  const createMoodboardMutation = useCreateMoodboard()
  const collectionsOverviewQuery = useCollectionsOverview()
  const moodboards = collectionsOverviewQuery.data?.moodboards ?? []
  const selectableMoodboards = useMemo(
    () => moodboards.filter((m) => !m.isSystem || m.slug === "wardrobe"),
    [moodboards],
  )

  const [state, setState] = useState<SaveActionState>({
    isPickerOpen: false,
    pendingProductId: null,
    pendingContext: null,
  })

  const favoriteIds = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data])
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  const isSaved = useCallback((productId: string) => favoriteSet.has(productId), [favoriteSet])

  const handleToggleSave = useCallback(
    async (productId: string, nextSaved: boolean, uiContext: EntityUiContext = {}) => {
      try {
        if (nextSaved) {
          await saveMutation.mutateAsync({ productId, slug: "favorites", label: "Favorites" })
          trackSaveToggled(analytics, {
            entity_type: "product",
            entity_id: productId,
            new_state: true,
            save_method: "click",
            ...uiContext,
          })
          trackSavedToCollection(analytics, {
            entity_type: "product",
            entity_id: productId,
            collection_slug: "favorites",
            save_method: "click",
            ...uiContext,
          })
        } else {
          await removeMutation.mutateAsync({ productId })
          trackSaveToggled(analytics, {
            entity_type: "product",
            entity_id: productId,
            new_state: false,
            save_method: "click",
            ...uiContext,
          })
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
      try {
        await saveMutation.mutateAsync({ productId, slug: "favorites", label: "Favorites" })
        trackSaveToggled(analytics, {
          entity_type: "product",
          entity_id: productId,
          new_state: true,
          save_method: "long_press",
          ...uiContext,
        })
        trackSavedToCollection(analytics, {
          entity_type: "product",
          entity_id: productId,
          collection_slug: "favorites",
          save_method: "long_press",
          ...uiContext,
        })
        setState({ isPickerOpen: true, pendingProductId: productId, pendingContext: uiContext })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save product"
        toast({ title: "Save failed", description: message, variant: "destructive" })
      }
    },
    [analytics, saveMutation, toast],
  )

  const handleApplyMoodboards = useCallback(
    async (selectedSlugs: string[]) => {
      if (!state.pendingProductId) return
      if (!selectedSlugs.length) {
        toast({ title: "Select moodboards and try again." })
        return
      }

      const labelBySlug = new Map(selectableMoodboards.map((moodboard) => [moodboard.slug, moodboard.label]))
      let hadError = false
      const uiContext = state.pendingContext ?? {}

      for (const slug of selectedSlugs) {
        try {
          await saveMutation.mutateAsync({
            productId: state.pendingProductId,
            slug,
            label: labelBySlug.get(slug),
          })
          trackSavedToCollection(analytics, {
            entity_type: "product",
            entity_id: state.pendingProductId,
            collection_slug: slug,
            save_method: "long_press",
            ...uiContext,
          })
        } catch {
          hadError = true
        }
      }

      setState({ isPickerOpen: false, pendingProductId: null, pendingContext: null })

      if (hadError) {
        toast({
          title: "Saved with issues",
          description: "Saved product, but could not add it to all moodboards.",
          variant: "destructive",
        })
      }
    },
    [analytics, selectableMoodboards, saveMutation, state.pendingContext, state.pendingProductId, toast],
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
          trackSavedToCollection(analytics, {
            entity_type: "product",
            entity_id: state.pendingProductId,
            collection_slug: slug,
            save_method: "long_press",
            ...uiContext,
          })
        }
        return slug
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not create moodboard"
        toast({ title: "Create failed", description: message, variant: "destructive" })
        return undefined
      }
    },
    [analytics, createMoodboardMutation, saveMutation, state.pendingContext, state.pendingProductId, toast],
  )

  const closePicker = useCallback(() => {
    setState({ isPickerOpen: false, pendingProductId: null, pendingContext: null })
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
    closePicker,
    isSaving: saveMutation.isPending || createMoodboardMutation.isPending,
  }
}
