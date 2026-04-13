import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Columns2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { IconButton, LeftActionRail, OutfitInspirationTile, RightActionRail } from "@/design-system/primitives"
import { ProductTray } from "./components/ProductTray"
import type { OutfitItem } from "@/types"
import { mapTrayItemToProductDetail } from "@/services/studio/studioService"
import type { StudioProductTrayItem } from "@/services/studio/studioService"
import { StudioLayout } from "./StudioLayout"
import { useStudioTourContext } from "./context/StudioTourContext"
import { useStudioContext } from "./context/StudioContext"
import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useStudioProductTray } from "@/features/studio/hooks/useStudioProductTray"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { studioKeys } from "@/features/studio/queryKeys"
import { prefetchStudioAlternatives } from "@/features/studio/hooks/useStudioAlternatives"
import { prefetchStudioSearchResults } from "@/features/studio/hooks/useStudioSearchResults"
import { useStudioResolvedSlots } from "@/features/studio/hooks/useStudioResolvedSlots"
import type { StudioProductTraySlot } from "@/services/studio/studioService"
import { buildStudioUrl, parseStudioSearchParams, type SlotIdMap } from "@/features/studio/utils/studioUrlState"
import { mapLegacyOutfitItemsToStudioItems, mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import type { StudioRenderedItem } from "@/features/studio/types"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { useSaveOutfit } from "@/features/outfits/hooks/useSaveOutfit"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useFindOutfitByItems } from "@/features/outfits/hooks/useFindOutfitByItems"
import { useCollectionsOverview, useCreateMoodboard, useSaveToCollection } from "@/features/collections/hooks/useMoodboards"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import { useStudioHistory } from "@/features/studio/hooks/useStudioHistory"
import { useStudioRemix } from "@/features/studio/hooks/useStudioRemix"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { mergeOutfitItemsWithTray } from "@/features/studio/utils/mergeOutfitItemsWithTray"
import { useOutfitSnapshot } from "@/features/outfits/hooks/useOutfitSnapshot"
import { useOptionalAdminGender } from "@/features/admin/providers/AdminGenderContext"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { setPendingStudioComboChange, useStudioCombinationTracking } from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import { trackTryonFlowStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

const DEFAULT_AVATAR_HEAD = "/avatars/Default.png"
const isHttpUrl = (value?: string | null) => Boolean(value && /^https?:\/\//i.test(value))

export function StudioScreenView() {
  const tour = useStudioTourContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const parsedParams = useMemo(() => parseStudioSearchParams(searchParams), [searchParams])
  const outfitId = parsedParams.outfitId
  const topIdParam = parsedParams.slotIds.top
  const bottomIdParam = parsedParams.slotIds.bottom
  const shoesIdParam = parsedParams.slotIds.shoes
  const {
    openAlternatives,
    openAlternativesSplit,
    openProduct,
    openScrollUp,
    selectedOutfitId,
    setSelectedOutfitId,
    setSlotProductId,
    slotProductIds,
  } = useStudioContext()
  
  const {
    data: outfitData,
    isLoading: isOutfitLoading,
  } = useStudioOutfit(outfitId)
  const studioAvatar = outfitData?.outfit ?? null
  const avatarHeadSrc = outfitData?.avatarHeadSrc ?? DEFAULT_AVATAR_HEAD
  const avatarGender = outfitData?.avatarGender ?? "female"
  const avatarHeightCm = outfitData?.avatarHeightCm ?? 170
  const traySourceId = outfitData?.trayItems?.length
    ? null
    : (outfitId ?? selectedOutfitId ?? studioAvatar?.id ?? null)
  const productTrayQuery = useStudioProductTray(traySourceId)
  const productTrayItems = outfitData?.trayItems?.length ? outfitData.trayItems : productTrayQuery.data ?? []
  const collectionsOverviewQuery = useCollectionsOverview()
  const moodboards = collectionsOverviewQuery.data?.moodboards ?? []
  const selectableMoodboards = useMemo(() => moodboards.filter((m) => !m.isSystem), [moodboards])
  const moodboardsLoading = collectionsOverviewQuery.isLoading
  const createMoodboardMutation = useCreateMoodboard()
  const queryClient = useQueryClient()
  const { gender, profile } = useProfileContext()
  const startLikenessFlow = useStartLikenessFlow()
  const { mutateAsync: saveOutfitMutation } = useSaveOutfit()
  const { mutateAsync: createDraftOutfitMutation } = useCreateDraftOutfit()
  const { mutateAsync: findOutfitByItemsMutation } = useFindOutfitByItems()
  const { mutateAsync: saveToCollectionMutation } = useSaveToCollection()
  const { user } = useAuth()
  const { toast } = useToast()
  const { applySnapshot, canRedo, canUndo, checkpointActive, recordChange, redo, toggleCheckpoint, undo } =
    useStudioHistory()
  const { isViewOnly } = useStudioShareMode()
  const adminGender = useOptionalAdminGender()
  const isAdminMode = adminGender !== null
  const analytics = useEngagementAnalytics()

  // Outfit snapshot capture
  const { snapshotRef, setAvatarReady, captureSnapshot, isCapturing } = useOutfitSnapshot({
    userId: user?.id ?? null,
    onError: (error) => {
      console.error("[StudioScreen] Snapshot capture failed:", error)
    },
  })

  const resolvedOutfitId = outfitId ?? studioAvatar?.id ?? null
  const syncOutfitId = outfitId ?? selectedOutfitId ?? null
  const basePath = useMemo(() => {
    const match = location.pathname.match(/(.*\/studio)(?:\/.*)?$/)
    if (match?.[1]) {
      return match[1]
    }
    return location.pathname.replace(/\/*$/, "") || "/studio"
  }, [location.pathname])
  const shareOutfitId = parsedParams.outfitId ?? resolvedOutfitId
  const hiddenSlots = useMemo(
    () => ({
      top: Boolean(parsedParams.hiddenSlots?.top),
      bottom: Boolean(parsedParams.hiddenSlots?.bottom),
      shoes: Boolean(parsedParams.hiddenSlots?.shoes),
    }),
    [parsedParams.hiddenSlots?.bottom, parsedParams.hiddenSlots?.shoes, parsedParams.hiddenSlots?.top],
  )
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

  const { remix, isRemixing } = useStudioRemix({
    gender: avatarGender,
    excludeOutfitId: resolvedOutfitId,
  })

  const [hasHydratedFromUrl, setHasHydratedFromUrl] = useState(false)

  useEffect(() => {
    setHasHydratedFromUrl(true)
  }, [])

  useEffect(() => {
    setSelectedOutfitId(resolvedOutfitId)
  }, [resolvedOutfitId, setSelectedOutfitId])

  useEffect(() => {
    if (studioAvatar) {
      const topItem = studioAvatar.items.find((item) => item.type === "top")
      const bottomItem = studioAvatar.items.find((item) => item.type === "bottom")
      const shoesItem = studioAvatar.items.find((item) => item.type === "shoes")
      if (!topIdParam && topItem) {
        setSlotProductId("top", topItem.id)
      }
      if (!bottomIdParam && bottomItem) {
        setSlotProductId("bottom", bottomItem.id)
      }
      if (!shoesIdParam && shoesItem) {
        setSlotProductId("shoes", shoesItem.id)
      }
    }
  }, [bottomIdParam, setSlotProductId, shoesIdParam, studioAvatar, topIdParam])

  // Prefetch search alternatives for all 3 slots when outfit loads
  // (The alternatives screen auto-searches with the current item's image)
  useEffect(() => {
    if (!resolvedOutfitId || !studioAvatar || tour.isActive) return

    const slots: StudioProductTraySlot[] = ["top", "bottom", "shoes"]
    
    slots.forEach((slot) => {
      // Find the product item for this slot to get its image URL
      const item = studioAvatar.items.find((i) => i.type === slot)
      const imageUrl = item?.imageUrl ?? null
      
      if (isHttpUrl(imageUrl)) {
        // Use hook-layer prefetch function (side effects live in hooks layer)
        prefetchStudioSearchResults(queryClient, {
          slot,
          query: "",
          imageUrl,
          filters: {},
          gender: adminGender ?? gender,
        }).catch(() => {
          // Prefetch failures should not block the UI
        })
      }
    })
  }, [resolvedOutfitId, studioAvatar, queryClient, tour.isActive, adminGender, gender])

  useEffect(() => {
    if (!hasHydratedFromUrl || !syncOutfitId) {
      return
    }
    if (selectedOutfitId && outfitId && selectedOutfitId !== outfitId) {
      return
    }
    const params = new URLSearchParams(searchParams)
    let changed = false
    if (params.get("outfitId") !== syncOutfitId) {
      params.set("outfitId", syncOutfitId)
      changed = true
    }
    ; (["top", "bottom", "shoes"] as StudioProductTraySlot[]).forEach((slot) => {
      const id = slotProductIds[slot]
      const key = `${slot}Id`
      const current = params.get(key)
      if (id && current !== id) {
        params.set(key, id)
        changed = true
      } else if (!id && current) {
        params.delete(key)
        changed = true
      }
    })
    if (changed) {
      setSearchParams(params, { replace: true })
    }
  }, [hasHydratedFromUrl, selectedOutfitId, slotProductIds, syncOutfitId])

  const requestedSlotIds = useMemo<SlotIdMap>(
    () => ({
      top: topIdParam ?? slotProductIds.top ?? null,
      bottom: bottomIdParam ?? slotProductIds.bottom ?? null,
      shoes: shoesIdParam ?? slotProductIds.shoes ?? null,
    }),
    [bottomIdParam, shoesIdParam, slotProductIds.bottom, slotProductIds.shoes, slotProductIds.top, topIdParam],
  )

  useStudioCombinationTracking({
    analytics,
    surface: analytics.state.surface,
    outfitId: syncOutfitId,
    slotIds: {
      topId: requestedSlotIds.top ?? null,
      bottomId: requestedSlotIds.bottom ?? null,
      shoesId: requestedSlotIds.shoes ?? null,
    },
    hiddenSlots,
  })

  const defaultSlotOrder = useMemo<StudioProductTraySlot[]>(() => ["top", "bottom", "shoes"], [])
  const [slotOrder, setSlotOrder] = useState<StudioProductTraySlot[]>(defaultSlotOrder)

  useEffect(() => {
    setSlotOrder(defaultSlotOrder)
  }, [defaultSlotOrder, resolvedOutfitId])

  const { trayItems: resolvedTrayItems, isResolving: slotsResolving } = useStudioResolvedSlots({
    outfitId: resolvedOutfitId,
    baseOutfitItems: productTrayItems,
    requestedSlotIds,
  })

  const normalizeSlot = useCallback((type: OutfitItem["type"]): StudioProductTraySlot | null => {
    if (type === "top" || type === "bottom" || type === "shoes") {
      return type
    }
    return null
  }, [])

  const resolvedAvatarItems = useMemo(() => {
    if (!studioAvatar) {
      return null
    }

    return mergeOutfitItemsWithTray(studioAvatar, resolvedTrayItems)
  }, [resolvedTrayItems, studioAvatar])

  const visibleAvatarItems = useMemo(() => {
    if (!resolvedAvatarItems) {
      return null
    }
    return resolvedAvatarItems.filter((item) => {
      const slot = normalizeSlot(item.type)
      if (!slot) {
        return true
      }
      return !hiddenSlots[slot]
    })
  }, [hiddenSlots, normalizeSlot, resolvedAvatarItems])

  const handleAvatarItemSelect = useCallback(
    (item: OutfitItem) => {
      if (tour.isHighlighted("mannequin")) {
        tour.nextStep()
        openAlternatives(item)
        return
      }
      if (isViewOnly) {
        return
      }
      const slot = normalizeSlot(item.type)

      if (syncOutfitId && slot) {
        const trayMatch = resolvedTrayItems.find((trayItem) => trayItem.slot === slot)
        if (trayMatch) {
          queryClient.setQueryData(
            [...studioKeys.hero(syncOutfitId, slot), trayMatch.productId ?? "default"],
            trayMatch,
          )
        }

        prefetchStudioAlternatives(queryClient, {
          outfitId: syncOutfitId,
          slot,
          gender,
        }).catch(() => {
          // Prefetch failures should not block navigation
        })
      }

      openAlternatives(item, { outfitId: syncOutfitId })
    },
    [gender, isViewOnly, normalizeSlot, openAlternatives, queryClient, resolvedTrayItems, syncOutfitId],
  )

  const handleProductPress = useCallback(
    (product: StudioProductTrayItem) => {
      if (isViewOnly) {
        return
      }
      openProduct(product.productId, { initialProduct: mapTrayItemToProductDetail(product) })
    },
    [isViewOnly, openProduct],
  )

  useEffect(() => {
    if (tour.isActive && (tour.getCurrentStep()?.id === "alternatives" || tour.getCurrentStep()?.id === "full-screen")) {
      openAlternativesSplit("top")
    }
  }, [tour.isActive, tour.currentStepIndex, openAlternativesSplit, tour])


  const handleDetailsPress = useCallback(() => {
    if (isViewOnly) {
      return
    }
    openScrollUp()
  }, [isViewOnly, openScrollUp])

  // const handleTouchStart = useCallback<React.TouchEventHandler<HTMLDivElement>>((event) => {
  //   const touch = event.touches[0]
  //   if (!touch) {
  //     return
  //   }
  //   gestureStartYRef.current = touch.clientY
  //   gestureStartXRef.current = touch.clientX
  //   gestureActiveRef.current = true
  // }, [])


  // const handleTouchEnd = useCallback<React.TouchEventHandler<HTMLDivElement>>(
  //   (event) => {
  //     if (!gestureActiveRef.current || gestureStartYRef.current === null || gestureStartXRef.current === null) {
  //       return
  //     }
  //     const touch = event.changedTouches[0]
  //     if (!touch) {
  //       return
  //     }
  //     const deltaY = touch.clientY - gestureStartYRef.current
  //     const deltaX = touch.clientX - gestureStartXRef.current
  //     gestureStartYRef.current = null
  //     gestureStartXRef.current = null
  //     gestureActiveRef.current = false
  //     if (deltaY < -100 && Math.abs(deltaX) < 80 && !isViewOnly) {
  //       openScrollUp()
  //     }
  //   },
  //   [isViewOnly, openScrollUp],
  // )

  // const handlePointerDown = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
  //   if (event.pointerType === "touch") {
  //     return
  //   }
  //   gestureStartYRef.current = event.clientY
  //   gestureStartXRef.current = event.clientX
  //   gestureActiveRef.current = true
  // }, [])

  // const handlePointerUp = useCallback<React.PointerEventHandler<HTMLDivElement>>(
  //   (event) => {
  //     if (event.pointerType === "touch") {
  //       return
  //     }
  //     if (!gestureActiveRef.current || gestureStartYRef.current === null || gestureStartXRef.current === null) {
  //       return
  //     }
  //     const deltaY = event.clientY - gestureStartYRef.current
  //     const deltaX = event.clientX - gestureStartXRef.current
  //     gestureStartYRef.current = null
  //     gestureStartXRef.current = null
  //     gestureActiveRef.current = false
  //     if (deltaY < -140 && Math.abs(deltaX) < 120 && !isViewOnly) {
  //       openScrollUp()
  //     }
  //   },
  //   [isViewOnly, openScrollUp],
  // )

  const baseAvatarItems = useMemo(() => {
    if (!studioAvatar) {
      return []
    }
    return studioAvatar.items.filter((item) => {
      const slot = normalizeSlot(item.type)
      if (!slot) {
        return true
      }
      return !hiddenSlots[slot]
    })
  }, [hiddenSlots, normalizeSlot, studioAvatar])

  const displayAvatarItems = visibleAvatarItems ?? baseAvatarItems

  const displayRenderedItems = useMemo<StudioRenderedItem[] | null>(() => {
    const baseRendered = outfitData?.studioOutfit?.renderedItems ?? null
    const trayRendered = resolvedTrayItems
      .map((item) => mapTrayItemToStudioRenderedItem(item))
      .filter((entry): entry is StudioRenderedItem => Boolean(entry))

    if ((!baseRendered || baseRendered.length === 0) && trayRendered.length === 0) {
      return null
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
      .filter((item): item is StudioRenderedItem => Boolean(item))
  }, [hiddenSlots, outfitData?.studioOutfit?.renderedItems, resolvedTrayItems])
  const isLoadingOverrides = slotsResolving && Boolean(requestedSlotIds.top || requestedSlotIds.bottom || requestedSlotIds.shoes)

  const outfitItems = useMemo(
    () => ({
      topId: hiddenSlots.top ? null : resolvedTrayItems.find((item) => item.slot === "top")?.productId ?? null,
      bottomId: hiddenSlots.bottom ? null : resolvedTrayItems.find((item) => item.slot === "bottom")?.productId ?? null,
      footwearId: hiddenSlots.shoes ? null : resolvedTrayItems.find((item) => item.slot === "shoes")?.productId ?? null,
    }),
    [hiddenSlots.bottom, hiddenSlots.shoes, hiddenSlots.top, resolvedTrayItems],
  )
  const baseSlotIds = useMemo(
    () => ({
      topId: studioAvatar?.items.find((item) => item.type === "top")?.id ?? null,
      bottomId: studioAvatar?.items.find((item) => item.type === "bottom")?.id ?? null,
      shoesId: studioAvatar?.items.find((item) => item.type === "shoes")?.id ?? null,
    }),
    [studioAvatar?.items],
  )
  const hasSlotOverrides = useMemo(
    () =>
      outfitItems.topId !== baseSlotIds.topId ||
      outfitItems.bottomId !== baseSlotIds.bottomId ||
      outfitItems.footwearId !== baseSlotIds.shoesId,
    [baseSlotIds.bottomId, baseSlotIds.shoesId, baseSlotIds.topId, outfitItems.bottomId, outfitItems.footwearId, outfitItems.topId],
  )

  const resolveTryOnSnapshot = useCallback(async () => {
    if (!studioAvatar || !user?.id) {
      return null
    }
    if (!hasSlotOverrides) {
      return {
        id: studioAvatar.id,
        name: studioAvatar.name ?? null,
        category: studioAvatar.category ?? null,
        occasionId: studioAvatar.occasion?.id ?? null,
        backgroundId: studioAvatar.backgroundId ?? null,
        gender: studioAvatar.gender ?? null,
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
      gender: studioAvatar.gender ?? null,
      backgroundId: studioAvatar.backgroundId ?? null,
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
    outfitItems.bottomId,
    outfitItems.footwearId,
    outfitItems.topId,
    profile?.name,
    studioAvatar,
    user?.id,
  ])

  const handleTryOn = useCallback(async () => {
    try {
      trackTryonFlowStarted(analytics, {
        slotIds: {
          topId: outfitItems.topId ?? null,
          bottomId: outfitItems.bottomId ?? null,
          shoesId: outfitItems.footwearId ?? null,
        },
      })
      const outfitSnapshot = await resolveTryOnSnapshot()
      await startLikenessFlow({ outfitItems, outfitSnapshot: outfitSnapshot ?? undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start try-on"
      toast({ title: "Try-on failed", description: message, variant: "destructive" })
    }
  }, [outfitItems, resolveTryOnSnapshot, startLikenessFlow, toast])

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
          gender: avatarGender,
          vibe: data.vibe,
          keywords: data.keywords,
          isPrivate: data.isPrivate,
          createdByName: profile?.name ?? null,
          userId: user.id,
          backgroundId: studioAvatar?.backgroundId ?? null,
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

        // Capture snapshot after save (non-blocking)
        console.log("[StudioScreen] Starting snapshot capture for outfit:", saved.id)
        captureSnapshot(saved.id)
          .then((url) => {
            console.log("[StudioScreen] Snapshot captured successfully:", url)
          })
          .catch((err) => {
            console.error("[StudioScreen] Failed to capture outfit snapshot:", err)
          })
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
      avatarGender,
      captureSnapshot,
      selectableMoodboards,
      outfitItems.bottomId,
      outfitItems.footwearId,
      outfitItems.topId,
      profile?.name,
      saveOutfitMutation,
      saveToCollectionMutation,
      studioAvatar?.backgroundId,
      toast,
      user?.id,
    ],
  )

  const handleRemix = useCallback(async () => {
    if (isViewOnly) {
      return
    }
    try {
      setPendingStudioComboChange({ change_type: "remix" })
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

  const currentSlotIds = useMemo(
    () => ({
      top: requestedSlotIds.top ?? null,
      bottom: requestedSlotIds.bottom ?? null,
      shoes: requestedSlotIds.shoes ?? null,
    }),
    [requestedSlotIds.bottom, requestedSlotIds.shoes, requestedSlotIds.top],
  )

  const handleRemoveSlot = useCallback(
    (slot: StudioProductTraySlot) => {
      if (isViewOnly || !syncOutfitId) {
        return
      }
      setPendingStudioComboChange({ change_type: "hide_slot", slot })
      const nextHidden = { ...hiddenSlots, [slot]: true }
      const nextSnapshot = {
        outfitId: syncOutfitId,
        slotIds: currentSlotIds,
        hiddenSlots: nextHidden,
      }
      recordChange(nextSnapshot)
      applySnapshot(nextSnapshot)
    },
    [applySnapshot, currentSlotIds, hiddenSlots, isViewOnly, recordChange, syncOutfitId],
  )

  const handleRestoreSlot = useCallback(
    (slot: StudioProductTraySlot) => {
      if (isViewOnly || !syncOutfitId) {
        return
      }
      setPendingStudioComboChange({ change_type: "restore_slot", slot })
      const nextHidden = { ...hiddenSlots, [slot]: false }
      const nextSnapshot = {
        outfitId: syncOutfitId,
        slotIds: currentSlotIds,
        hiddenSlots: nextHidden,
      }
      recordChange(nextSnapshot)
      applySnapshot(nextSnapshot)
    },
    [applySnapshot, currentSlotIds, hiddenSlots, isViewOnly, recordChange, syncOutfitId],
  )

  const handleAddSlot = useCallback(
    (slot: StudioProductTraySlot) => {
      if (isViewOnly) {
        return
      }
      const targetItem =
        resolvedAvatarItems?.find((item) => normalizeSlot(item.type) === slot) ??
        studioAvatar?.items.find((item) => normalizeSlot(item.type) === slot)
      if (targetItem) {
        openAlternatives(targetItem, { outfitId: syncOutfitId })
        return
      }
      openAlternativesSplit(slot)
    },
    [isViewOnly, normalizeSlot, openAlternatives, openAlternativesSplit, resolvedAvatarItems, studioAvatar, syncOutfitId],
  )

  const handleReorderSlots = useCallback((nextOrder: StudioProductTraySlot[]) => {
    setSlotOrder(nextOrder)
  }, [])

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

  return (
          <div
        className="relative flex flex-col overflow-hidden pt-4"
        style={{ height: "calc(100vh - 40px)" }}
      >
        {/* Split view button - top right */}
        <div className="absolute top-6 right-8 z-10">
          <IconButton
            tone="ghost"
            size="xs"
            aria-label="Open split view"
            className="rounded-lg bg-card/80 backdrop-blur-sm"
            onClick={() => openAlternativesSplit("top")}
            disabled={isViewOnly}
          >
            <Columns2 className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>

        <div
          className="flex items-end justify-between gap-4 px-5 pb-8 pt-4 overflow-hidden"
          style={{ height: "calc(100vh - 180px)" }}
        >
          <LeftActionRail
            className="h-[196px] justify-end"
            onInfo={() => tour.restartTour()}
            onRemix={isViewOnly ? undefined : handleRemix}
            remixDisabled={isViewOnly || !resolvedOutfitId || isRemixing}
            onShare={shareOutfitId ? handleShare : undefined}
            highlight={tour.isHighlighted("remix") || tour.isHighlighted("share-button")}
            highlightRemix={tour.isHighlighted("remix")}
            highlightShare={tour.isHighlighted("share-button")}
          />

          <div
            className={cn(
              "relative flex w-[240px] overflow-hidden items-end justify-center m-0",
              tour.isHighlighted("mannequin") ? "z-[75]" : "z-0"
            )}
            style={{ height: "min(calc(100vh - 260px), 580px)" }}
          >
          {studioAvatar || (isAdminMode && !outfitId) ? (
            <OutfitInspirationTile
              preset="heroCanonical"
              outfitId={studioAvatar?.id ?? "temp-admin"}
              renderedItems={displayRenderedItems ?? (studioAvatar ? mapLegacyOutfitItemsToStudioItems(displayAvatarItems) : [])}
              fallbackImageSrc={displayRenderedItems?.[0]?.imageUrl ?? displayAvatarItems[0]?.imageUrl}
              title={studioAvatar?.name ?? "New Outfit"}
              chips={studioAvatar ? [studioAvatar.fit, studioAvatar.feel].filter(Boolean) as string[] : []}
              // attribution={resolveOutfitAttribution(studioAvatar.created_by)}
              isSaved={false}
              avatarHeadSrc={avatarHeadSrc}
              avatarGender={adminGender ?? avatarGender}
              avatarHeightCm={avatarHeightCm}
              cardClassName="h-full w-full"
              onItemSelect={isViewOnly ? undefined : handleAvatarItemSelect}
              slotOrder={slotOrder}
              allowEmptyMannequin={isAdminMode}
              onSlotSelect={isAdminMode && !isViewOnly ? (slot) => openAlternativesSplit(slot) : undefined}
              onAvatarReady={setAvatarReady}
              avatarRef={snapshotRef}
            />
          ) : (
            <div className="flex h-full w-[200px] items-center justify-center rounded-[120px] bg-muted/40 text-xs text-muted-foreground">
              {isOutfitLoading || isLoadingOverrides ? "Loading outfit…" : "Select an outfit to begin"}
            </div>
          )}
        </div>
        <RightActionRail
          className="h-[196px] justify-end"
          canRedo={!isViewOnly && canRedo}
          canUndo={!isViewOnly && canUndo}
          isCheckpointActive={checkpointActive}
          onCheckpoint={
            isViewOnly
              ? undefined
              : () => {
                  setPendingStudioComboChange({ change_type: "checkpoint" })
                  toggleCheckpoint()
                }
          }
          onRedo={
            isViewOnly
              ? undefined
              : () => {
                  setPendingStudioComboChange({ change_type: "redo" })
                  redo()
                }
          }
          onUndo={
            isViewOnly
              ? undefined
              : () => {
                  setPendingStudioComboChange({ change_type: "undo" })
                  undo()
                }
          }
          highlight={tour.isHighlighted("undo-redo") || tour.isHighlighted("checkpoint")}
          highlightUndoRedo={tour.isHighlighted("undo-redo")}
          highlightCheckpoint={tour.isHighlighted("checkpoint")}
        />
      </div>
      
      {/* space gainer for the fixed product tray so that the OutfitInspirationCard is not covered by the product tray */}
      <div className="invisible z-20 flex justify-center bg-background pb-4">
        <ProductTray items={resolvedTrayItems} />
      </div>

      <div 
        className={cn(
          "fixed bottom-8 left-0 right-0 flex justify-center pb-4",
          (tour.isHighlighted("product-details") || tour.isHighlighted("product-interaction") || tour.isHighlighted("click-details") || tour.isHighlighted("save-button") || tour.isHighlighted("tryon-button")) ? "bg-transparent z-[75]" : "bg-background z-20"
        )}
      >
        <ProductTray
          items={resolvedTrayItems}
          isLoading={productTrayQuery.isLoading || isOutfitLoading || isLoadingOverrides}
          onProductPress={isViewOnly ? undefined : handleProductPress}
          onDetailsPress={isViewOnly ? undefined : handleDetailsPress}
          onTryOn={isViewOnly ? undefined : handleTryOn}
          onSaveOutfit={isViewOnly ? undefined : handleSaveOutfit}
          isReadOnly={isViewOnly}
          slotOrder={slotOrder}
          hiddenSlots={hiddenSlots}
          onRemoveSlot={handleRemoveSlot}
          onRestoreSlot={handleRestoreSlot}
          onAddSlot={handleAddSlot}
          onReorderSlots={handleReorderSlots}
          defaultOutfitName={studioAvatar?.name ?? ""}
          defaultCategoryId={studioAvatar?.category ?? undefined}
          defaultOccasionId={studioAvatar?.occasion?.id ?? undefined}
          moodboards={selectableMoodboards}
          moodboardsLoading={moodboardsLoading}
          onCreateMoodboard={(name) => createMoodboardMutation.mutateAsync(name).then((res) => res.slug)}
          highlightProducts={tour.isHighlighted("product-details") || tour.isHighlighted("product-interaction")}
          highlightDetails={tour.isHighlighted("click-details")}
          highlightSave={tour.isHighlighted("save-button")}
          highlightTryOn={tour.isHighlighted("tryon-button")}
        />
      </div>
    </div>
  )
}

export function StudioScreen() {
  return (
    <StudioLayout>
      <StudioScreenView />
    </StudioLayout>
  )
}
