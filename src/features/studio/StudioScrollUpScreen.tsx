import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"

import { cn } from "@/lib/utils"

import {
  LeftActionRail,
  MoodboardPickerDrawer,
  OutfitInspirationTile,
  RightActionRail,
  ScreenHeader,
  SaveOutfitDrawer,
} from "@/design-system/primitives"

import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useStudioProductOutfits } from "@/features/studio/hooks/useStudioProductOutfits"
import { useStudioResolvedSlots } from "@/features/studio/hooks/useStudioResolvedSlots"
import { mapTrayItemToProductDetail } from "@/services/studio/studioService"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"
import type { Outfit, OutfitItem } from "@/types"
import { useElementHeight } from "@/shared/hooks/useElementHeight"
import { useCollectionsOverview, useCreateMoodboard, useFavorites, useRemoveOutfitFromLibrary, useSaveToCollection } from "@/features/collections/hooks/useMoodboards"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"

import { ProductSummaryCard } from "./components/ProductSummaryCard"
import { ScrollUpActionRow } from "./components/ScrollUpActionRow"
import { BASE_DELIVERY_SPECS, BASE_PRIMARY_SPECS } from "./constants/specs"
import { StudioLayout } from "./StudioLayout"
import { useStudioContext } from "./context/StudioContext"
import { useStudioTourContext } from "./context/StudioTourContext"
import { mapLegacyOutfitItemsToStudioItems, mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import type { StudioRenderedItem } from "@/features/studio/types"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { useSaveOutfit } from "@/features/outfits/hooks/useSaveOutfit"
import { useOutfitSnapshot } from "@/features/outfits/hooks/useOutfitSnapshot"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useFindOutfitByItems } from "@/features/outfits/hooks/useFindOutfitByItems"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useStudioHistory } from "@/features/studio/hooks/useStudioHistory"
import { useLaunchStudio } from "@/features/studio/hooks/useLaunchStudio"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import { useStudioRemix } from "@/features/studio/hooks/useStudioRemix"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { buildStudioUrl, parseStudioSearchParams, type SlotIdMap } from "@/features/studio/utils/studioUrlState"
import { mergeOutfitItemsWithTray } from "@/features/studio/utils/mergeOutfitItemsWithTray"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackProductBuyClicked } from "@/integrations/posthog/engagementTracking/entityEvents"
import {
  setPendingStudioComboChange,
  trackStudioProductViewed,
  useStudioCombinationTracking,
} from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import { trackTryonFlowStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

export function StudioScrollUpView() {
  const {
    selectedOutfitId,
    slotProductIds,
    setFocusedItem,
    closeScrollUp,
    openProduct,
  } = useStudioContext()
  const tour = useStudioTourContext()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const decodedReturnTo = useMemo(() => {
    const raw = searchParams.get("returnTo")
    if (!raw) {
      return null
    }
    try {
      return decodeURIComponent(raw)
    } catch {
      return null
    }
  }, [searchParams])
  const parsedParams = useMemo(() => parseStudioSearchParams(searchParams), [searchParams])
  const hiddenSlots = useMemo(
    () => ({
      top: Boolean(parsedParams.hiddenSlots?.top),
      bottom: Boolean(parsedParams.hiddenSlots?.bottom),
      shoes: Boolean(parsedParams.hiddenSlots?.shoes),
    }),
    [parsedParams.hiddenSlots?.bottom, parsedParams.hiddenSlots?.shoes, parsedParams.hiddenSlots?.top],
  )
  const startLikenessFlow = useStartLikenessFlow()
  const { mutateAsync: saveOutfitMutation } = useSaveOutfit()
  const { mutateAsync: createDraftOutfitMutation } = useCreateDraftOutfit()
  const { mutateAsync: findOutfitByItemsMutation } = useFindOutfitByItems()
  const { mutateAsync: saveToCollectionMutation, isPending: isSavingToCollection } = useSaveToCollection()
  const favoritesQuery = useFavorites()
  const favoriteIds = favoritesQuery.data ?? []
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const { mutateAsync: removeOutfitFromLibraryMutation } = useRemoveOutfitFromLibrary()
  const { user } = useAuth()
  const { toast } = useToast()
  const { profile } = useProfileContext()
  const { applySnapshot, canRedo, canUndo, checkpointActive, recordChange, redo, toggleCheckpoint, undo } =
    useStudioHistory()
  const { isViewOnly } = useStudioShareMode()
  const launchStudio = useLaunchStudio()
  const analytics = useEngagementAnalytics()
  const [isSaveDrawerOpen, setIsSaveDrawerOpen] = useState(false)
  const [pendingOutfitId, setPendingOutfitId] = useState<string | null>(null)
  const [isOutfitPickerOpen, setIsOutfitPickerOpen] = useState(false)
  const productSaveActions = useProductSaveActions()
  const { snapshotRef, setAvatarReady, captureSnapshot } = useOutfitSnapshot({
    userId: user?.id ?? null,
    onSuccess: (url) => {
      console.log("[StudioScrollUpScreen] Snapshot captured successfully:", url)
    },
    onError: (error) => {
      console.error("[StudioScrollUpScreen] Failed to capture outfit snapshot:", error)
    },
  })
  const { data: outfitData, isLoading: isOutfitLoading } = useStudioOutfit(selectedOutfitId)
  const { remix, isRemixing } = useStudioRemix({
    gender: outfitData?.avatarGender ?? "female",
    excludeOutfitId: selectedOutfitId,
  })
  const basePath = useMemo(() => {
    const match = location.pathname.match(/(.*\/studio)(?:\/.*)?$/)
    if (match?.[1]) {
      return match[1]
    }
    return location.pathname.replace(/\/*$/, "") || "/studio"
  }, [location.pathname])
  const shareOutfitId = parsedParams.outfitId ?? selectedOutfitId
  const shareSlotIds = useMemo(
    () => ({
      top: parsedParams.slotIds.top ?? slotProductIds.top ?? null,
      bottom: parsedParams.slotIds.bottom ?? slotProductIds.bottom ?? null,
      shoes: parsedParams.slotIds.shoes ?? slotProductIds.shoes ?? null,
    }),
    [
      parsedParams.slotIds.bottom,
      parsedParams.slotIds.shoes,
      parsedParams.slotIds.top,
      slotProductIds.bottom,
      slotProductIds.shoes,
      slotProductIds.top,
    ],
  )
  const { top: topOverride, bottom: bottomOverride, shoes: shoesOverride } = slotProductIds
  const requestedSlotIds = useMemo(
    () => ({
      top: topOverride ?? null,
      bottom: bottomOverride ?? null,
      shoes: shoesOverride ?? null,
    }),
    [bottomOverride, shoesOverride, topOverride],
  )
  const { trayItems: resolvedTrayItems, isResolving: slotsResolving } = useStudioResolvedSlots({
    outfitId: selectedOutfitId,
    baseOutfitItems: outfitData?.trayItems ?? [],
    requestedSlotIds,
  })
  const heroAvatarItems = useMemo(
    () => {
      const merged = mergeOutfitItemsWithTray(outfitData?.outfit ?? null, resolvedTrayItems)
      return merged.filter((item) => {
        const slot = normalizeSlot(item.type)
        if (!slot) {
          return true
        }
        return !hiddenSlots[slot]
      })
    },
    [hiddenSlots, outfitData?.outfit, resolvedTrayItems],
  )
  const heroRenderedItems = useMemo<StudioRenderedItem[]>(() => {
    const baseRendered = outfitData?.studioOutfit?.renderedItems ?? null
    const trayRendered = resolvedTrayItems
      .map((item) => mapTrayItemToStudioRenderedItem(item))
      .filter((entry): entry is StudioRenderedItem => Boolean(entry))
    if ((!baseRendered || baseRendered.length === 0) && trayRendered.length === 0) {
      return []
    }
    const zones: Array<StudioRenderedItem["zone"]> = ["top", "bottom", "shoes"]
    const baseByZone = new Map<StudioRenderedItem["zone"], StudioRenderedItem>()
    baseRendered?.forEach((item) => baseByZone.set(item.zone, item))
    const trayByZone = new Map<StudioRenderedItem["zone"], StudioRenderedItem>()
    trayRendered.forEach((item) => trayByZone.set(item.zone, item))

    return zones
      .map((zone) => {
        if (hiddenSlots[zone]) {
          return null
        }
        const trayItem = trayByZone.get(zone)
        const baseItem = baseByZone.get(zone)
        if (trayItem) {
          const fallbackBodyPartsVisible =
            baseItem?.id === trayItem.id ? baseItem.bodyPartsVisible ?? null : null
          return {
            ...(baseItem ?? {}),
            ...trayItem,
            bodyPartsVisible: trayItem.bodyPartsVisible ?? fallbackBodyPartsVisible,
          }
        }
        return baseItem ?? null
      })
      .filter((item): item is StudioRenderedItem => Boolean(item?.imageUrl))
  }, [hiddenSlots, outfitData?.studioOutfit?.renderedItems, resolvedTrayItems])
  const orderedProducts = useMemo(
    () => resolvedTrayItems.filter((item) => !hiddenSlots[item.slot]),
    [hiddenSlots, resolvedTrayItems],
  )
  const outfitItems = useMemo(
    () => ({
      topId: hiddenSlots.top ? null : orderedProducts.find((item) => item.slot === "top")?.productId ?? null,
      bottomId: hiddenSlots.bottom ? null : orderedProducts.find((item) => item.slot === "bottom")?.productId ?? null,
      footwearId: hiddenSlots.shoes ? null : orderedProducts.find((item) => item.slot === "shoes")?.productId ?? null,
    }),
    [hiddenSlots.bottom, hiddenSlots.shoes, hiddenSlots.top, orderedProducts],
  )
  const tryOnOutfitItems = useMemo(
    () => ({
      topId: outfitItems.topId,
      bottomId: outfitItems.bottomId,
      footwearId: outfitItems.footwearId,
    }),
    [outfitItems.bottomId, outfitItems.footwearId, outfitItems.topId],
  )

  useStudioCombinationTracking({
    analytics,
    surface: analytics.state.surface,
    outfitId: selectedOutfitId,
    slotIds: {
      topId: outfitItems.topId,
      bottomId: outfitItems.bottomId,
      shoesId: outfitItems.footwearId,
    },
    hiddenSlots,
  })
  const baseSlotIds = useMemo(
    () => ({
      topId: outfitData?.outfit?.items.find((item) => item.type === "top")?.id ?? null,
      bottomId: outfitData?.outfit?.items.find((item) => item.type === "bottom")?.id ?? null,
      shoesId: outfitData?.outfit?.items.find((item) => item.type === "shoes")?.id ?? null,
    }),
    [outfitData?.outfit?.items],
  )
  const hasSlotOverrides = useMemo(
    () =>
      outfitItems.topId !== baseSlotIds.topId ||
      outfitItems.bottomId !== baseSlotIds.bottomId ||
      outfitItems.footwearId !== baseSlotIds.shoesId,
    [baseSlotIds.bottomId, baseSlotIds.shoesId, baseSlotIds.topId, outfitItems.bottomId, outfitItems.footwearId, outfitItems.topId],
  )

  const resolveTryOnSnapshot = useCallback(async () => {
    if (!outfitData?.outfit || !user?.id) {
      return null
    }
    if (!hasSlotOverrides) {
      return {
        id: outfitData.outfit.id,
        name: outfitData.outfit.name ?? null,
        category: outfitData.outfit.category ?? null,
        occasionId: outfitData.outfit.occasion?.id ?? null,
        backgroundId: outfitData.outfit.backgroundId ?? null,
        gender: outfitData.outfit.gender ?? null,
      }
    }
    const existing = await findOutfitByItemsMutation({
      topId: outfitItems.topId,
      bottomId: outfitItems.bottomId,
      shoesId: outfitItems.footwearId,
    })
    if (existing?.id) {
      return {
        id: existing.id,
        name: existing.name ?? null,
        category: existing.category ?? null,
        occasionId: existing.occasion ?? null,
        backgroundId: existing.background_id ?? null,
        gender: existing.gender ?? null,
      }
    }
    const draft = await createDraftOutfitMutation({
      userId: user.id,
      topId: outfitItems.topId,
      bottomId: outfitItems.bottomId,
      shoesId: outfitItems.footwearId,
      gender: outfitData.outfit.gender ?? null,
      backgroundId: outfitData.outfit.backgroundId ?? null,
      createdByName: profile?.name ?? null,
    })
    return {
      id: draft.id,
      name: draft.name ?? null,
      category: draft.category ?? null,
      occasionId: draft.occasion ?? null,
      backgroundId: draft.background_id ?? null,
      gender: draft.gender ?? null,
    }
  }, [
    createDraftOutfitMutation,
    findOutfitByItemsMutation,
    hasSlotOverrides,
    outfitData?.outfit,
    outfitItems.bottomId,
    outfitItems.footwearId,
    outfitItems.topId,
    profile?.name,
    user?.id,
  ])

  const handleTryOn = useCallback(async () => {
    try {
      const outfitSnapshot = await resolveTryOnSnapshot()
      trackTryonFlowStarted(analytics, {
        slotIds: {
          topId: tryOnOutfitItems.topId,
          bottomId: tryOnOutfitItems.bottomId,
          shoesId: tryOnOutfitItems.footwearId,
        },
      })
      await startLikenessFlow({ outfitItems: tryOnOutfitItems, outfitSnapshot: outfitSnapshot ?? undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start try-on"
      toast({ title: "Try-on failed", description: message, variant: "destructive" })
    }
  }, [analytics, resolveTryOnSnapshot, startLikenessFlow, toast, tryOnOutfitItems])
  const handleRemix = useCallback(async () => {
    if (isViewOnly) {
      return
    }
    try {
      const payload = await remix()
      const outfitId = payload.outfit?.id ?? null
      if (!outfitId) {
        toast({
          title: "Remix failed",
          description: "No outfit found for this remix.",
          variant: "destructive",
        })
        return
      }
      const nextSlotIds: SlotIdMap = {
        top: null,
        bottom: null,
        shoes: null,
      }
      payload.trayItems.forEach((item) => {
        nextSlotIds[item.slot] = item.productId
      })
      const nextSnapshot = {
        outfitId,
        slotIds: {
          top: nextSlotIds.top ?? null,
          bottom: nextSlotIds.bottom ?? null,
          shoes: nextSlotIds.shoes ?? null,
        },
        hiddenSlots: {
          top: false,
          bottom: false,
          shoes: false,
        },
      }
      setPendingStudioComboChange({ change_type: "remix" })
      recordChange(nextSnapshot)
      applySnapshot(nextSnapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remix failed."
      toast({
        title: "Remix failed",
        description: message,
        variant: "destructive",
      })
    }
  }, [applySnapshot, isViewOnly, recordChange, remix, toast])
  const handleBack = useCallback(() => {

    if (decodedReturnTo) {
      navigate(decodedReturnTo)
      return
    }
    closeScrollUp()
  }, [closeScrollUp, decodedReturnTo, navigate, tour])
  const handleSimilar = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("home:activeMoodboard", "for-you")
    }
    navigate("/home?moodboard=for-you")
  }, [navigate])

  const handleCheckpoint = useCallback(() => {
    setPendingStudioComboChange({ change_type: "checkpoint" })
    toggleCheckpoint()
  }, [toggleCheckpoint])

  const handleUndo = useCallback(() => {
    setPendingStudioComboChange({ change_type: "undo" })
    undo()
  }, [undo])

  const handleRedo = useCallback(() => {
    setPendingStudioComboChange({ change_type: "redo" })
    redo()
  }, [redo])

  const handleShare = useCallback(async () => {
    if (!shareOutfitId) {
      return
    }
    const sharePath = buildStudioUrl(basePath, "studio", {
      outfitId: shareOutfitId,
      slotIds: shareSlotIds,
      hiddenSlots,
      share: true,
    })
    const shareUrl =
      typeof window === "undefined" ? sharePath : `${window.location.origin}${sharePath}`

    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Check this outfit", url: shareUrl })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl)
        toast({ title: "Link copied" })
        return
      } catch {
        // Fall through to toast below.
      }
    }

    toast({
      title: "Unable to copy link",
      description: "Please copy the URL from the address bar.",
    })
  }, [basePath, hiddenSlots, shareOutfitId, shareSlotIds, toast])
  const handleProductOpen = useCallback(
    (product: StudioProductTrayItem) => {
      if (isViewOnly) {
        return
      }
      openProduct(product.productId, { initialProduct: mapTrayItemToProductDetail(product) })
    },
    [isViewOnly, openProduct],
  )
  const handleOutfitOpen = useCallback(
    (outfit: Outfit) => {
      if (isViewOnly) {
        return
      }
      launchStudio(outfit)
    },
    [isViewOnly, launchStudio],
  )

  const collectionsOverviewQuery = useCollectionsOverview()
  const moodboards = collectionsOverviewQuery.data?.moodboards ?? []
  const selectableMoodboards = useMemo(() => moodboards.filter((m) => !m.isSystem), [moodboards])
  const moodboardsLoading = collectionsOverviewQuery.isLoading
  const createMoodboardMutation = useCreateMoodboard()

  const handleSaveOutfit = useCallback(
    async (data: {
      outfitName: string
      categoryId: string
      occasionId: string
      vibe: string
      keywords: string
      isPrivate: boolean
      moodboardIds?: string[]
    }) => {
      if (!user?.id) {
        const error = new Error("Please sign in to save outfits")
        toast({
          title: "Sign in required",
          description: "Create an account or sign in to save outfits.",
          variant: "destructive",
        })
        throw error
      }

      try {
        const saved = await saveOutfitMutation({
          name: data.outfitName,
          categoryId: data.categoryId,
          occasionId: data.occasionId,
          topId: outfitItems.topId,
          bottomId: outfitItems.bottomId,
          shoesId: outfitItems.footwearId,
          gender: outfitData?.avatarGender ?? "female",
          vibe: data.vibe,
          keywords: data.keywords,
          isPrivate: data.isPrivate,
          createdByName: profile?.name ?? null,
          userId: user.id,
          backgroundId: outfitData?.outfit?.backgroundId ?? null,
        })
        const selectedMoodboardSlugs = data.moodboardIds ?? []
        const moodboardLabelBySlug = new Map(selectableMoodboards.map((m) => [m.slug, m.label] as const))

        let hadCollectionError = false
        try {
          await saveToCollectionMutation({ outfitId: saved.id, slug: "favorites" })
        } catch {
          hadCollectionError = true
        }

        for (const slug of selectedMoodboardSlugs) {
          try {
            await saveToCollectionMutation({ outfitId: saved.id, slug, label: moodboardLabelBySlug.get(slug) })
          } catch {
            hadCollectionError = true
          }
        }

        toast({
          title: "Outfit saved",
          description: hadCollectionError ? "Saved outfit, but could not add it to all collections." : undefined,
        })

        console.log("[StudioScrollUpScreen] Starting snapshot capture for outfit:", saved.id)
        captureSnapshot(saved.id).catch(() => {})
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save outfit"
        toast({
          title: "Save failed",
          description: message,
          variant: "destructive",
        })
        throw error
      }
    },
    [
      outfitData?.avatarGender,
      outfitData?.outfit?.backgroundId,
      outfitItems.bottomId,
      outfitItems.footwearId,
      outfitItems.topId,
      captureSnapshot,
      profile?.name,
      saveOutfitMutation,
      saveToCollectionMutation,
      selectableMoodboards,
      toast,
      user?.id,
    ],
  )

  const handleToggleOutfitById = useCallback(
    async (outfitId: string, nextSaved: boolean) => {
      try {
        if (nextSaved) {
          await saveToCollectionMutation({ outfitId, slug: "favorites", label: "Favorites" })
        } else {
          await removeOutfitFromLibraryMutation({ outfitId })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update favorite"
        toast({ title: "Save failed", description: message, variant: "destructive" })
        favoritesQuery.refetch()
      }
    },
    [favoritesQuery, removeOutfitFromLibraryMutation, saveToCollectionMutation, toast],
  )

  const handleLongPressOutfitById = useCallback(
    async (outfitId: string) => {
      try {
        await saveToCollectionMutation({ outfitId, slug: "favorites", label: "Favorites" })
        setPendingOutfitId(outfitId)
        setIsOutfitPickerOpen(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save outfit"
        toast({ title: "Save failed", description: message, variant: "destructive" })
      }
    },
    [saveToCollectionMutation, toast],
  )

  const handleMoodboardPickerApply = useCallback(
    async (slugs: string[]) => {
      if (!pendingOutfitId) return
      try {
        for (const slug of slugs) {
          const label = selectableMoodboards.find((board) => board.slug === slug)?.label ?? slug
          await saveToCollectionMutation({ outfitId: pendingOutfitId, slug, label })
        }
        setPendingOutfitId(null)
        setIsOutfitPickerOpen(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to add to moodboards"
        toast({ title: "Add failed", description: message, variant: "destructive" })
      }
    },
    [pendingOutfitId, saveToCollectionMutation, selectableMoodboards, toast],
  )

  const handleCreateMoodboard = useCallback(
    async (name: string) => {
      const result = await createMoodboardMutation.mutateAsync(name)
      return result.slug
    },
    [createMoodboardMutation],
  )

  const isHydratingProducts = (isOutfitLoading || slotsResolving) && orderedProducts.length === 0
  const isHeroLoading = (isOutfitLoading || slotsResolving) && Boolean(selectedOutfitId)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)



  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden max-w-[100vw] px-2 pb-4 pt-3 w-full"
      >
        <section className={cn(
          "flex h-[36vh] fixed top-0 left-0 right-0 flex-none items-end justify-center gap-3 px-4 bg-card py-3",
          tour.isHighlighted("back-from-details") ? "z-[75]" : "z-10"
        )}>
          <div className={cn(
            "flex h-full w-12 flex-col items-center justify-between",
            tour.isHighlighted("back-from-details") && "z-[75] relative"
          )}>
            <ScreenHeader
              onAction={handleBack}
              highlightAction={tour.isHighlighted("back-from-details")}
              className="w-full justify-center px-0 pt-0 pb-0"
            />
            <LeftActionRail
              variant="compact"
              onRemix={isViewOnly ? undefined : handleRemix}
              remixDisabled={isViewOnly || !selectedOutfitId || isRemixing}
              className={isHeroLoading ? "pointer-events-none opacity-50" : undefined}
              onShare={shareOutfitId ? handleShare : undefined}
            />
          </div>
          <div 
            className="flex h-full w-auto max-w-[36vh] items-end justify-center cursor-pointer"
            onClick={isViewOnly ? undefined : closeScrollUp}
            role={isViewOnly ? undefined : "button"}
            tabIndex={isViewOnly ? undefined : 0}
          >
            {selectedOutfitId ? (
              <OutfitInspirationTile
                preset="heroCanonical"
                outfitId={selectedOutfitId}
                renderedItems={heroRenderedItems}
                wrapperRef={snapshotRef}
                fallbackImageSrc={
                  hiddenSlots.top || hiddenSlots.bottom || hiddenSlots.shoes
                    ? heroRenderedItems[0]?.imageUrl
                    : outfitData?.studioOutfit?.imageSrcFallback
                }
                title={outfitData?.studioOutfit?.name ?? outfitData?.outfit?.name ?? ""}
                chips={[
                  outfitData?.studioOutfit?.fit ?? outfitData?.outfit?.fit,
                  outfitData?.studioOutfit?.feel ?? outfitData?.outfit?.feel,
                ].filter(Boolean) as string[]}
                // attribution={resolveOutfitAttribution(outfitData?.outfit?.created_by)}
                isSaved={false}
                avatarHeadSrc={outfitData?.avatarHeadSrc}
                avatarGender={outfitData?.avatarGender ?? "female"}
                avatarHeightCm={outfitData?.avatarHeightCm}
                cardClassName="h-full w-full max-h-[36vh]"
                onItemSelect={isViewOnly ? undefined : (item) => setFocusedItem(item)}
                onAvatarReady={setAvatarReady}
              />
            ) : (
              <div className="h-full w-full max-h-[28vh] aspect-[3/4] rounded-md bg-border" />
            )}
          </div>
          <RightActionRail
            variant="compact"
            canRedo={!isViewOnly && canRedo}
            canUndo={!isViewOnly && canUndo}
            isCheckpointActive={checkpointActive}
            onCheckpoint={isViewOnly ? undefined : handleCheckpoint}
            onRedo={isViewOnly ? undefined : handleRedo}
            onUndo={isViewOnly ? undefined : handleUndo}
            className={isHeroLoading ? "pointer-events-none opacity-50" : undefined}
          />
        </section>

        {/* Dummy section to push the content down */}
        <section className="flex h-[36vh] invisible flex-none items-end justify-center gap-3 px-1">
        </section>
        <div className="flex flex-1 min-h-0 items-start justify-center px-0">
          
          <div className="flex w-full flex-1 min-h-0 flex-col gap-0.5 px-1">
            {orderedProducts.length > 0 ? (
              orderedProducts.map((product) => {
                const isSaved = productSaveActions.isSaved(product.productId)
                return (
                  <RecommendationRow
                    key={`${product.slot}-${product.productId}`}
                    product={product}
                    avatarHeadSrc={outfitData?.avatarHeadSrc}
                    avatarGender={outfitData?.avatarGender ?? "female"}
                    avatarHeightCm={outfitData?.avatarHeightCm}
                    onItemFocus={setFocusedItem}
                    onProductOpen={handleProductOpen}
                    onOutfitOpen={handleOutfitOpen}
                    favoriteOutfitIds={favoriteSet}
                    onToggleOutfitSave={isViewOnly ? undefined : handleToggleOutfitById}
                    onLongPressOutfitSave={isViewOnly ? undefined : handleLongPressOutfitById}
                    isSaved={isSaved}
                    onToggleSave={isViewOnly ? undefined : () => productSaveActions.onToggleSave(product.productId, !isSaved)}
                    onLongPressSave={isViewOnly ? undefined : () => productSaveActions.onLongPressSave(product.productId)}
                  />
                )
              })
            ) : isHydratingProducts ? (
              <div className="mt-4 rounded-xl border border-dashed border-muted-foreground/40 bg-muted/10 p-4 text-center text-xs text-muted-foreground">
                Loading outfit items…
              </div>
            ) : null}
            <div className="flex bg-white left-0 right-0 invisible w-[100px]">
              <ScrollUpActionRow
                className="mt-0.0 invisible"
                onSave={() => {}}
                onTryOn={() => {}}
              />
            </div>
            <div className="flex fixed bottom-11 pt-1 pb-3 bg-card left-0 right-0">
            <ScrollUpActionRow
              className="mt-0.0"
              onSave={isViewOnly ? undefined : () => setIsSaveDrawerOpen(true)}
              onTryOn={isViewOnly ? undefined : handleTryOn}
              onSimilar={isViewOnly ? undefined : handleSimilar}
              disabled={isViewOnly}
            />
            </div>
          </div>
        </div>
      </div>
      <SaveOutfitDrawer
        open={isSaveDrawerOpen}
        onOpenChange={setIsSaveDrawerOpen}
        defaultOutfitName={outfitData?.outfit?.name ?? ""}
        defaultCategoryId={outfitData?.outfit?.category ?? undefined}
        defaultOccasionId={outfitData?.outfit?.occasion?.id ?? undefined}
        isLoadingMoodboards={moodboardsLoading}
        moodboards={selectableMoodboards}
        onCreateMoodboard={(name) => createMoodboardMutation.mutateAsync(name).then((res) => res.slug)}
        onSave={handleSaveOutfit}
      />

      <MoodboardPickerDrawer
        open={isOutfitPickerOpen}
        onOpenChange={(open) => {
          setIsOutfitPickerOpen(open)
          if (!open) {
            setPendingOutfitId(null)
          }
        }}
        moodboards={selectableMoodboards}
        mode="multi"
        onSelect={() => {}}
        onApply={handleMoodboardPickerApply}
        onCreate={handleCreateMoodboard}
        isSaving={isSavingToCollection || createMoodboardMutation.isPending}
        title="Add to moodboard"
      />
      
      {/* Moodboard picker drawer for product save long-press */}
      <MoodboardPickerDrawer
        open={productSaveActions.isPickerOpen}
        onOpenChange={(open) => {
          if (!open) {
            productSaveActions.closePicker()
          }
        }}
        moodboards={productSaveActions.moodboards}
        mode="multi"
        onSelect={() => {}}
        onApply={productSaveActions.onApplyMoodboards}
        onCreate={productSaveActions.onCreateMoodboard}
        isSaving={productSaveActions.isSaving}
        title="Add to moodboard"
      />
    </div>
  )
}

interface RecommendationRowProps {
  product: StudioProductTrayItem
  avatarHeadSrc?: string | null
  avatarGender?: "male" | "female"
  avatarHeightCm?: number
  onItemFocus: (item: OutfitItem | null) => void
  onProductOpen: (product: StudioProductTrayItem) => void
  isSaved?: boolean
  onToggleSave?: () => void
  onLongPressSave?: () => void
  onOutfitOpen?: (outfit: Outfit) => void
  favoriteOutfitIds?: Set<string>
  onToggleOutfitSave?: (outfitId: string, nextSaved: boolean) => void
  onLongPressOutfitSave?: (outfitId: string) => void
}

function RecommendationRow({
  product,
  avatarHeadSrc,
  avatarGender = "female",
  avatarHeightCm,
  onItemFocus,
  onProductOpen,
  isSaved,
  onToggleSave,
  onLongPressSave,
  onOutfitOpen,
  favoriteOutfitIds,
  onToggleOutfitSave,
  onLongPressOutfitSave,
}: RecommendationRowProps) {
  const [attachRef, summaryHeight] = useElementHeight<HTMLElement>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const analytics = useEngagementAnalytics()
  const didEmitProductViewedRef = useRef(false)
  const fluidHeight = summaryHeight > 0 ? summaryHeight : undefined
  const {
    data: relatedOutfits = [],
    isLoading: outfitsLoading,
  } = useStudioProductOutfits({
    productId: product.productId,
    slot: product.slot,
  })
  const tags = useMemo(() => [...product.fitTags, ...product.feelTags, ...product.vibeTags], [
    product.feelTags,
    product.fitTags,
    product.vibeTags,
  ])
  
  // Build dynamic specs from product data
  const primarySpecs = useMemo(() => {
    const items: typeof BASE_PRIMARY_SPECS = []
    
    // Material type (e.g., Cotton) - from products.material_type
    if (product.materialType) {
      items.push({
        icon: BASE_PRIMARY_SPECS[0].icon,
        label: product.materialType,
      })
    }
    
    // Care instructions (e.g., Machine) - from products.care
    if (product.care) {
      items.push({
        icon: BASE_PRIMARY_SPECS[1].icon,
        label: product.care,
      })
    }
    
    return items
  }, [product.materialType, product.care])
  
  // Delivery specs - now just includes the Heart icon for saving
  const deliverySpecs = useMemo(() => {
    // Only include the heart icon (last item in BASE_DELIVERY_SPECS)
    return [BASE_DELIVERY_SPECS[BASE_DELIVERY_SPECS.length - 1]]
  }, [])
  
  const handleAddToBag = useCallback(() => {
    if (product.productUrl) {
      trackProductBuyClicked(analytics, { entity_id: product.productId })
      window.open(product.productUrl, "_blank", "noopener,noreferrer")
    }
  }, [analytics, product.productId, product.productUrl])

  useEffect(() => {
    if (didEmitProductViewedRef.current) return
    didEmitProductViewedRef.current = true
    trackStudioProductViewed(analytics, product.productId)
  }, [analytics, product.productId])
  const isInteractive = Boolean(onOutfitOpen)

  const handleScrollLeft = useCallback(() => {
    if (scrollContainerRef.current) {
      const viewportWidth = window.innerWidth
      scrollContainerRef.current.scrollBy({
        left: viewportWidth,
        behavior: "smooth",
      })
    }
  }, [])

  return (
    <div className="flex flex-col gap-1">
      <div ref={scrollContainerRef} className="flex items-stretch gap-2 overflow-x-auto px-1 pb-2 scrollbar-hide">
        <div className="w-full flex-shrink-0 border border-border/40 rounded-lg ">
          <ProductSummaryCard
            ref={attachRef}
            imageSrc={product.imageUrl ?? ""}
            brand={product.brand ?? "Atlyr"}
            title={product.title}
            price={product.price}
            primarySpecs={[...primarySpecs, BASE_PRIMARY_SPECS[2]]}
            deliverySpecs={deliverySpecs}
            tags={tags}
            onAddToBag={product.productUrl ? handleAddToBag : undefined}
            onSizeGuide={product.productUrl ? handleAddToBag : undefined}
            onClick={() => onProductOpen(product)}
            isSaved={isSaved}
            onToggleSave={onToggleSave}
            onLongPressSave={onLongPressSave}
            onScrollLeft={handleScrollLeft}
            scrollLeft={true}
          />
        </div>
        {outfitsLoading ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
            Loading outfits…
          </div>
        ) : relatedOutfits.length > 0 ? (
          relatedOutfits.map(({ outfit, studioOutfit }, index) => {
            const renderedItems = studioOutfit?.renderedItems ?? mapLegacyOutfitItemsToStudioItems(outfit.items)
            const outfitId = studioOutfit?.id ?? outfit.id ?? null
            const isOutfitSaved = outfitId ? favoriteOutfitIds?.has(outfitId) ?? false : false
            const key =
              `${product.productId}-${studioOutfit?.id ?? outfit.id ?? outfit.name ?? outfit.word_association ?? index}`
            const fallbackImageSrc =
              studioOutfit?.imageSrcFallback ?? renderedItems?.[0]?.imageUrl ?? outfit.items?.[0]?.imageUrl

            return (
              <OutfitInspirationTile
                key={key}
                preset="compact"
                wrapperClassName={`flex-shrink-0${isInteractive ? " cursor-pointer" : ""}`}
                wrapperProps={{
                  role: isInteractive ? "button" : undefined,
                  tabIndex: isInteractive ? 0 : undefined,
                  onClick: isInteractive ? () => onOutfitOpen?.(outfit) : undefined,
                  onKeyDown: isInteractive
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          onOutfitOpen?.(outfit)
                        }
                      }
                    : undefined,
                }}
                outfitId={outfitId ?? undefined}
                renderedItems={renderedItems}
                fallbackImageSrc={fallbackImageSrc}
                title={studioOutfit?.name ?? outfit.name}
                chips={[]}
                attribution={resolveOutfitAttribution(outfit.created_by)}
                isSaved={isOutfitSaved}
                avatarHeadSrc={avatarHeadSrc ?? undefined}
                avatarGender={avatarGender}
                avatarHeightCm={avatarHeightCm}
                sizeMode="fluid"
                cardClassName="h-full"
                fluidHeight={fluidHeight}
                onItemSelect={(item) => onItemFocus(item)}
                onToggleSave={
                  outfitId && onToggleOutfitSave
                    ? () => onToggleOutfitSave(outfitId, !isOutfitSaved)
                    : undefined
                }
                onLongPressSave={
                  outfitId && onLongPressOutfitSave
                    ? () => onLongPressOutfitSave(outfitId)
                    : undefined
                }
                disableAvatarSwipe
              />
            )
          })
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
            No outfits yet for this piece.
          </div>
        )}
      </div>
    </div>
  )
}

function normalizeSlot(type: OutfitItem["type"]): StudioProductTraySlot | null {
  if (type === "top" || type === "bottom" || type === "shoes") {
    return type
  }
  return null
}

export function StudioScrollUpScreen() {
  return (
    <StudioLayout>
      <StudioScrollUpView />
    </StudioLayout>
  )
}

export default StudioScrollUpScreen
