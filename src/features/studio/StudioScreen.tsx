import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  ChevronLeft,
  Columns2,
  Redo2,
  RotateCcw,
  Share,
  Shuffle,
  Sparkles,
  Undo2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { IconButton, OutfitInspirationTile, SaveOutfitDrawer } from "@/design-system/primitives"
import { CanvasControlCluster } from "./components/CanvasControlCluster"
import { StudioActionBar } from "./components/StudioActionBar"
import { StudioSlotRows } from "./components/StudioSlotRows"
import { TraySheet, type TraySheetMode } from "./components/TraySheet"
import { ProductPeekCard, type ProductPeekItem } from "./components/ProductPeekCard"
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
import { useStudioSwapActions } from "@/features/studio/hooks/useStudioSwapActions"
import { prefetchStudioSearchResults } from "@/features/studio/hooks/useStudioSearchResults"
import { useStudioResolvedSlots } from "@/features/studio/hooks/useStudioResolvedSlots"
import type { StudioAlternativeProduct, StudioProductTraySlot } from "@/services/studio/studioService"
import { buildStudioSearchParams, buildStudioUrl, parseStudioSearchParams, type SlotIdMap } from "@/features/studio/utils/studioUrlState"
import { mapLegacyOutfitItemsToStudioItems, mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import type { StudioRenderedItem } from "@/features/studio/types"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { useSaveOutfit } from "@/features/outfits/hooks/useSaveOutfit"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useFindOutfitByItems } from "@/features/outfits/hooks/useFindOutfitByItems"
import {
  useCollectionsOverview,
  useCreateMoodboard,
  useOutfitCollectionMembership,
  useRemoveFromCollection,
  useSaveToCollection,
} from "@/features/collections/hooks/useMoodboards"
import { useUpdateOutfit } from "@/features/outfits/hooks/useUpdateOutfit"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import { useStudioHistory } from "@/features/studio/hooks/useStudioHistory"
import { useLastStudioOutfit } from "@/features/studio/hooks/useLastStudioOutfit"
import { useStarterOutfit } from "@/features/outfits/hooks/useStarterOutfit"
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

/** Labels the 7e peek's "IN YOUR STUDIO · {SLOT}" line. */
const PEEK_SLOT_LABELS: Record<StudioProductTraySlot, string> = {
  top: "Topwear",
  bottom: "Bottomwear",
  shoes: "Footwear",
}

export function StudioScreenView() {
  const navigate = useNavigate()
  const tour = useStudioTourContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigationType = useNavigationType()
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
  const selectableMoodboards = useMemo(
    () => moodboards.filter((m) => !m.isSystem || m.slug === "favorites" || m.slug === "wardrobe"),
    [moodboards],
  )
  const moodboardsLoading = collectionsOverviewQuery.isLoading
  const createMoodboardMutation = useCreateMoodboard()
  const queryClient = useQueryClient()
  const { gender, profile } = useProfileContext()
  const startLikenessFlow = useStartLikenessFlow()
  const { mutateAsync: saveOutfitMutation } = useSaveOutfit()
  const { mutateAsync: updateOutfitMutation } = useUpdateOutfit()
  const { mutateAsync: createDraftOutfitMutation } = useCreateDraftOutfit()
  const { mutateAsync: findOutfitByItemsMutation } = useFindOutfitByItems()
  const { mutateAsync: saveToCollectionMutation } = useSaveToCollection()
  const { mutateAsync: removeFromCollectionMutation } = useRemoveFromCollection()
  const outfitMembershipQuery = useOutfitCollectionMembership()
  const { user } = useAuth()
  const { toast } = useToast()
  const { applySnapshot, canRedo, canUndo, checkpointActive, recordChange, redo, toggleCheckpoint, undo } =
    useStudioHistory()
  const { isShareLink, isViewOnly } = useStudioShareMode()
  const { swapSlot } = useStudioSwapActions(outfitId ?? selectedOutfitId ?? null)
  const adminGender = useOptionalAdminGender()
  const isAdminMode = adminGender !== null
  // The figure the studio should be dressing. Admin's toggle wins over the profile.
  const effectiveGender = adminGender ?? gender
  const lastOutfitQuery = useLastStudioOutfit({
    userId: user?.id ?? null,
    outfitId,
    gender: effectiveGender,
  })
  // Nothing of this gender saved yet (new profile, or a fresh switch) — open on a
  // starter look rather than an empty canvas.
  const starterOutfitQuery = useStarterOutfit({
    gender: effectiveGender === "male" ? "male" : "female",
    enabled:
      !outfitId &&
      Boolean(effectiveGender) &&
      !isShareLink &&
      (lastOutfitQuery.isSuccess ? lastOutfitQuery.data === null : !user?.id),
  })
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

  // Restore an outfit on cold start: when no outfitId is in the URL, take the
  // user's last look for this gender, else a starter one, and inject it so the
  // rest of the screen picks it up normally.
  useEffect(() => {
    const restoredId = lastOutfitQuery.data ?? starterOutfitQuery.data
    if (!restoredId || outfitId) return
    const params = new URLSearchParams(searchParams)
    params.set("outfitId", restoredId)
    setSearchParams(params, { replace: true })
  }, [lastOutfitQuery.data, starterOutfitQuery.data, outfitId])

  // Last line of defence for a gender switch. Gender-scoping the nav's path
  // memory and the cold-start resolver covers the routes we control, but the
  // browser's own back stack and a bookmarked URL can still hand back a look
  // built for the other figure. Drop it and let the resolver above pick again.
  //
  // Only on POP — a back/forward step or a cold load, i.e. the studio resuming
  // a position rather than being sent to one. Opening a saved cross-gender look
  // on purpose (from Collections, say) is a PUSH and stays exactly where it is;
  // the outfit's own gender picking the mannequin is the rule everywhere else
  // in the app. Share links are exempt too: a shared look is the sender's.
  const staleGenderOutfitRef = useRef<string | null>(null)
  useEffect(() => {
    if (!outfitId || isShareLink || isAdminMode || navigationType !== "POP") return
    const outfitGender = outfitData?.studioOutfit?.gender
    if (outfitGender !== "male" && outfitGender !== "female") return
    if (effectiveGender !== "male" && effectiveGender !== "female") return
    if (outfitGender === effectiveGender) return
    if (staleGenderOutfitRef.current === outfitId) return
    staleGenderOutfitRef.current = outfitId

    // Context has to let go too, or the URL-sync effect below writes the stale
    // outfit straight back into the params we just cleared.
    setSelectedOutfitId(null)
    setSlotProductId("top", null)
    setSlotProductId("bottom", null)
    setSlotProductId("shoes", null)

    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        ;["outfitId", "topId", "bottomId", "shoesId", "productId", "slot"].forEach((key) => params.delete(key))
        return params
      },
      { replace: true },
    )
  }, [
    effectiveGender,
    isAdminMode,
    isShareLink,
    navigationType,
    outfitData?.studioOutfit?.gender,
    outfitId,
    setSearchParams,
    setSelectedOutfitId,
    setSlotProductId,
  ])

  // Persist the current Studio state to sessionStorage so that the product page can read it
  // as the "previous snapshot" when pre-seeding the undo history.
  useEffect(() => {
    if (!outfitId) return
    try {
      const state = {
        outfitId,
        slotIds: {
          top: topIdParam ?? slotProductIds.top ?? null,
          bottom: bottomIdParam ?? slotProductIds.bottom ?? null,
          shoes: shoesIdParam ?? slotProductIds.shoes ?? null,
        },
        hiddenSlots: {
          top: Boolean(parsedParams.hiddenSlots?.top),
          bottom: Boolean(parsedParams.hiddenSlots?.bottom),
          shoes: Boolean(parsedParams.hiddenSlots?.shoes),
        },
      }
      window.sessionStorage.setItem("atlyr:studio:lastSession", JSON.stringify(state))
    } catch {
      // quota / private-mode — ignore
    }
  }, [outfitId, topIdParam, bottomIdParam, shoesIdParam, slotProductIds, parsedParams.hiddenSlots])

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

  // Persist the current Studio state to sessionStorage so the × button on ProductPage
  // can navigate back to exactly this outfit + slot configuration.
  useEffect(() => {
    if (!resolvedOutfitId) return
    try {
      const state = {
        outfitId: resolvedOutfitId,
        slotIds: {
          top: topIdParam ?? slotProductIds.top ?? null,
          bottom: bottomIdParam ?? slotProductIds.bottom ?? null,
          shoes: shoesIdParam ?? slotProductIds.shoes ?? null,
        },
        hiddenSlots: {
          top: Boolean(parsedParams.hiddenSlots?.top),
          bottom: Boolean(parsedParams.hiddenSlots?.bottom),
          shoes: Boolean(parsedParams.hiddenSlots?.shoes),
        },
      }
      window.sessionStorage.setItem("atlyr:studio:lastSession", JSON.stringify(state))
    } catch {
      // quota / private-mode — ignore, same as the sibling effect above
    }
  }, [resolvedOutfitId, topIdParam, bottomIdParam, shoesIdParam, slotProductIds, parsedParams.hiddenSlots])

  // Background prefetch of search-v2 after initial render (Option B: deferred)
  // Starts after page loads so it doesn't block initial paint, but data ready
  // if user opens alternatives panel and searches.
  useEffect(() => {
    if (!resolvedOutfitId || !studioAvatar || tour.isActive) return

    const slots: StudioProductTraySlot[] = ["top", "bottom", "shoes"]

    // Defer prefetch to after initial render via setTimeout
    const timeoutId = setTimeout(() => {
      slots.forEach((slot) => {
        const item = studioAvatar.items.find((i) => i.type === slot)
        const imageUrl = item?.thumbnailUrl ?? item?.imageUrl ?? null
        const productId = item?.id ?? null

        if (productId || isHttpUrl(imageUrl)) {
          // Fire-and-forget prefetch - don't await, just let it run in background
          prefetchStudioSearchResults(queryClient, {
            slot,
            query: "",
            imageUrl,
            productId,
            filters: {},
            gender: adminGender ?? gender,
          }).catch(() => {
            // Silently fail - non-critical background operation
          })
        }
      })
    }, 0) // Schedule after initial render

    return () => clearTimeout(timeoutId)
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

  const [isSaveDrawerOpen, setIsSaveDrawerOpen] = useState(false)
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

  // 7a's tray sheet. `slot` and `mode` are the handoff §8.1 props, held here
  // rather than in the URL: the sheet is a transient rack, and putting it in
  // the URL would mean a back-press dismissing it re-entered the studio as a
  // history step.
  //
  // Open-ness is its own flag rather than `slot !== null`, for both sheets. A
  // vaul drawer animates out *after* onOpenChange(false), so clearing the slot
  // to close would swap the sheet's contents — or unmount it outright —
  // mid-slide. Keeping the slot lets it animate away showing what you dismissed.
  const [traySheetOpen, setTraySheetOpen] = useState(false)
  const [traySheetSlot, setTraySheetSlot] = useState<StudioProductTraySlot>("top")
  const [traySheetMode, setTraySheetMode] = useState<TraySheetMode>("alternates")

  const openTraySheet = useCallback(
    (slot: StudioProductTraySlot, mode: TraySheetMode = "alternates") => {
      setTraySheetSlot(slot)
      setTraySheetMode(mode)
      setTraySheetOpen(true)
      if (syncOutfitId && mode === "alternates") {
        prefetchStudioAlternatives(queryClient, { outfitId: syncOutfitId, slot, gender }).catch(() => {
          // Prefetch failures should not block the sheet — it fetches on open.
        })
      }
    },
    [gender, queryClient, syncOutfitId],
  )

  /** Which worn slot the 7e peek is dived into. See the note on `traySheetOpen`. */
  const [peekOpen, setPeekOpen] = useState(false)
  const [peekSlot, setPeekSlot] = useState<StudioProductTraySlot>("top")

  /**
   * Tapping a garment on the model opens the 7c split view on that slot.
   *
   * The model is the spatial control — you poke a piece to go browsing what else
   * could go there. Details are the rows' job: they already carry name, brand
   * and price, so tapping one to get *more* is the natural next step. I had
   * these the other way round and it read backwards in use.
   *
   * `openAlternatives` rather than `openAlternativesSplit` because it carries
   * the tapped item through, so 7c lands with the right slot AND the right worn
   * hero instead of falling back to whatever slot was last active.
   */
  const handleAvatarItemSelect = useCallback(
    (item: OutfitItem) => {
      if (tour.isHighlighted("mannequin")) {
        tour.nextStep()
      }
      if (isViewOnly) {
        return
      }
      const slot = normalizeSlot(item.type)
      if (!slot) {
        return
      }

      // Seed the hero cache and warm the rack, so 7c opens populated rather than
      // on a spinner.
      if (syncOutfitId) {
        const trayMatch = resolvedTrayItems.find((trayItem) => trayItem.slot === slot)
        if (trayMatch) {
          queryClient.setQueryData(
            [...studioKeys.hero(syncOutfitId, slot), trayMatch.productId ?? "default"],
            trayMatch,
          )
        }
        prefetchStudioAlternatives(queryClient, { outfitId: syncOutfitId, slot, gender }).catch(() => {
          // Prefetch failures should not block navigation.
        })
      }

      openAlternatives(item, { outfitId: syncOutfitId })
    },
    [
      gender,
      isViewOnly,
      normalizeSlot,
      openAlternatives,
      queryClient,
      resolvedTrayItems,
      syncOutfitId,
      tour,
    ],
  )

  /** Slot row body — the 7e drawer for the piece already in that slot. */
  const handlePeekSlot = useCallback((slot: StudioProductTraySlot) => {
    setPeekSlot(slot)
    setPeekOpen(true)
  }, [])

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
    // 'full-screen' used to share this branch; it was a step with no consumer
    // and has been dropped, so only 'alternatives' drives the split view now.
    if (tour.isActive && tour.getCurrentStep()?.id === "alternatives") {
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

  // Only the owner's own outfit can be updated in place — updateOutfit's
  // WHERE clause matches on user_id, so trying this on someone else's (an
  // admin-curated look, another user's saved outfit) matches zero rows and
  // PostgREST throws "no rows returned". Viewing someone else's look and
  // hitting Save always makes a personal copy instead, same as before.
  const isOwnOutfit = Boolean(studioAvatar && user?.id && studioAvatar.user_id === user.id)

  // Re-saving an already-persisted outfit with no item changes updates it in
  // place instead of spinning off a new copy — swapping an item still makes
  // a fresh derived look, which is the existing/correct behavior.
  const isEditingExistingOutfit = Boolean(resolvedOutfitId && isOwnOutfit && !hasSlotOverrides)

  // The boards this exact outfit id is really on right now, so the save
  // picker's default reflects truth instead of always assuming Favorites.
  const currentOutfitMoodboardSlugs = useMemo(() => {
    if (!resolvedOutfitId) return []
    return Object.entries(outfitMembershipQuery.data ?? {})
      .filter(([slug, ids]) => ids.has(resolvedOutfitId) && selectableMoodboards.some((m) => m.slug === slug))
      .map(([slug]) => slug)
  }, [resolvedOutfitId, outfitMembershipQuery.data, selectableMoodboards])

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
        let outfitId: string
        if (isEditingExistingOutfit && resolvedOutfitId) {
          await updateOutfitMutation({
            outfitId: resolvedOutfitId,
            userId: user.id,
            name: data.outfitName,
            categoryId: data.categoryId,
            occasionId: data.occasionId,
            backgroundId: studioAvatar?.backgroundId ?? null,
            isPrivate: data.isPrivate,
            vibe: data.vibe,
            keywords: data.keywords,
            createdByName: profile?.name ?? null,
          })
          outfitId = resolvedOutfitId
        } else {
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
            sourceOutfitId: (resolvedOutfitId && !hasSlotOverrides) ? resolvedOutfitId : null,
          })
          outfitId = saved.id
        }

        const selectedMoodboardSlugs = data.moodboardIds ?? []
        const moodboardLabelBySlug = new Map(selectableMoodboards.map((m) => [m.slug, m.label] as const))

        let hadCollectionError = false
        if (isEditingExistingOutfit) {
          // Diff against real membership so an unchecked board actually gets
          // removed — this is an edit in place, not a fresh insert-only save.
          const currentSlugs = currentOutfitMoodboardSlugs
          const current = new Set(currentSlugs)
          const next = new Set(selectedMoodboardSlugs)
          const toAdd = selectedMoodboardSlugs.filter((slug) => !current.has(slug))
          const toRemove = currentSlugs.filter((slug) => !next.has(slug))

          for (const slug of toAdd) {
            try {
              await saveToCollectionMutation({ outfitId, slug, label: moodboardLabelBySlug.get(slug) })
            } catch {
              hadCollectionError = true
            }
          }
          for (const slug of toRemove) {
            try {
              await removeFromCollectionMutation({ outfitId, slug })
            } catch {
              hadCollectionError = true
            }
          }
        } else {
          for (const slug of selectedMoodboardSlugs) {
            try {
              await saveToCollectionMutation({ outfitId, slug, label: moodboardLabelBySlug.get(slug) })
            } catch {
              hadCollectionError = true
            }
          }
        }

        toast({
          title: "Outfit saved",
          description: hadCollectionError ? "Saved outfit, but could not add it to all collections." : undefined,
          // 6d: the save drawer's receipt. Falls back to the plain toast when a
          // collection write failed, since that is not a clean success.
          variant: hadCollectionError ? undefined : "success",
        })

        // Capture snapshot after save (non-blocking)
        console.log("[StudioScreen] Starting snapshot capture for outfit:", outfitId)
        captureSnapshot(outfitId)
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
      currentOutfitMoodboardSlugs,
      isEditingExistingOutfit,
      removeFromCollectionMutation,
      selectableMoodboards,
      outfitItems.bottomId,
      outfitItems.footwearId,
      outfitItems.topId,
      profile?.name,
      resolvedOutfitId,
      hasSlotOverrides,
      saveOutfitMutation,
      saveToCollectionMutation,
      studioAvatar?.backgroundId,
      toast,
      updateOutfitMutation,
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

  /**
   * The ⟳ on a slot row, or an empty slot's "Add …". Both ask "what else could
   * go here", so both open the tray sheet in place. Tapping the row *body* is a
   * different question and goes to the details drawer; tapping the garment on
   * the model escalates all the way to 7c.
   */
  const handleOpenAlternates = useCallback(
    (slot: StudioProductTraySlot) => {
      if (isViewOnly) {
        return
      }
      openTraySheet(slot)
    },
    [isViewOnly, openTraySheet],
  )

  /**
   * Wearing an alternate from the tray sheet. Mirrors 7c's swap contract
   * exactly — optimistic cache swap, URL slot ids, then a history entry — so a
   * swap made here is undoable and shareable on the same terms as one made in
   * the split view.
   */
  const handleTrayWear = useCallback(
    (slot: StudioProductTraySlot, product: StudioAlternativeProduct) => {
      if (isViewOnly || !syncOutfitId) {
        return
      }
      if (
        !Number.isFinite(product.placementX) ||
        !Number.isFinite(product.placementY) ||
        !Number.isFinite(product.imageLength)
      ) {
        toast({
          title: "Missing placement data",
          description: "This item can't be applied yet.",
          variant: "destructive",
        })
        return
      }

      setPendingStudioComboChange({
        change_type: "swap",
        slot,
        from_product_id: currentSlotIds[slot] ?? undefined,
        to_product_id: product.id,
        results_mode: "default",
      })

      swapSlot(slot, product)
      setSlotProductId(slot, product.id)

      const nextSlotIds: SlotIdMap = { ...currentSlotIds, [slot]: product.id }
      // Wearing something into a hidden slot must unhide it, or the swap lands
      // on a piece the model isn't showing.
      const nextHidden = { ...hiddenSlots, [slot]: false }

      setSearchParams(
        buildStudioSearchParams({
          outfitId: syncOutfitId,
          slotIds: nextSlotIds,
          hiddenSlots: nextHidden,
          share: parsedParams.share,
        }),
        { replace: true },
      )

      recordChange({
        outfitId: syncOutfitId,
        slotIds: {
          top: nextSlotIds.top ?? null,
          bottom: nextSlotIds.bottom ?? null,
          shoes: nextSlotIds.shoes ?? null,
        },
        hiddenSlots: nextHidden,
      })
    },
    [
      currentSlotIds,
      hiddenSlots,
      isViewOnly,
      parsedParams.share,
      recordChange,
      setSearchParams,
      setSlotProductId,
      swapSlot,
      syncOutfitId,
      toast,
    ],
  )

  /** The worn piece the 7e peek is showing, assembled from data already here. */
  const peekItem = useMemo((): ProductPeekItem | null => {
    const trayItem = resolvedTrayItems.find((item) => item.slot === peekSlot)
    if (!trayItem) {
      return null
    }
    return {
      id: trayItem.productId,
      title: trayItem.title,
      brand: trayItem.brand,
      price: trayItem.price,
      imageUrl: trayItem.imageUrl ?? null,
      slotLabel: PEEK_SLOT_LABELS[peekSlot],
      provenance: trayItem.materialType,
      specs: [trayItem.size, trayItem.color, ...trayItem.fitTags, ...trayItem.feelTags]
        .filter((value): value is string => Boolean(value))
        .slice(0, 4),
    }
  }, [peekSlot, resolvedTrayItems])

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

  // The receipt stub in the action bar. Hidden slots are excluded — the total
  // should describe the look you can see, not the one you removed a piece from.
  const { lookTotal, lookPieceCount } = useMemo(() => {
    const visible = resolvedTrayItems.filter((item) => !hiddenSlots[item.slot])
    return {
      lookTotal: visible.reduce((sum, item) => sum + (item.price ?? 0), 0),
      lookPieceCount: visible.length,
    }
  }, [hiddenSlots, resolvedTrayItems])

  const occasionLabel = (
    studioAvatar?.occasion?.name ??
    studioAvatar?.category ??
    "Your look"
  ).toString()

  const historyControls = [
    {
      id: "undo",
      label: "Undo",
      icon: Undo2,
      disabled: isViewOnly || !canUndo,
      highlight: tour.isHighlighted("undo-redo"),
      onClick: () => {
        setPendingStudioComboChange({ change_type: "undo" })
        undo()
      },
    },
    {
      id: "redo",
      label: "Redo",
      icon: Redo2,
      disabled: isViewOnly || !canRedo,
      onClick: () => {
        setPendingStudioComboChange({ change_type: "redo" })
        redo()
      },
    },
    {
      // Canvas 7a draws this as "reset". It is the existing checkpoint toggle:
      // press once for the outfit you started with, again to come back to your
      // edits — with the undo stack parked and restored either way.
      id: "checkpoint",
      label: checkpointActive ? "Back to your edits" : "Back to the original look",
      icon: RotateCcw,
      disabled: isViewOnly,
      active: checkpointActive,
      highlight: tour.isHighlighted("checkpoint"),
      onClick: () => {
        setPendingStudioComboChange({ change_type: "checkpoint" })
        toggleCheckpoint()
      },
    },
  ]

  const creativeControls = [
    {
      id: "remix",
      label: "Shuffle the look",
      icon: Shuffle,
      tone: "terracotta" as const,
      disabled: isViewOnly || !resolvedOutfitId || isRemixing,
      highlight: tour.isHighlighted("remix"),
      onClick: handleRemix,
    },
    {
      id: "share",
      label: "Share this look",
      icon: Share,
      disabled: !shareOutfitId,
      highlight: tour.isHighlighted("share-button"),
      onClick: shareOutfitId ? handleShare : undefined,
    },
  ]

  // The canvas is drawn at a 390 frame and the whole studio is a phone layout.
  // Without the max-w the card, the rows and the action bar all stretch to the
  // desktop viewport and nothing lines up with the design — the old ProductTray
  // carried `mx-auto w-full max-w-sm` for exactly this reason.
  return (
    <div
      className="flex justify-center overflow-hidden bg-background"
      // Two things this height is doing.
      //
      // The calc: AppShellLayout's wrapper is `min-h-screen` — a minimum, not a
      // height — so `flex-1`/`h-full` descendants have nothing definite to
      // resolve against, and the canvas card collapsed to its content while its
      // parent stretched, leaving a dead band above the rows. Pinning a real
      // height (2.5rem = main's pb, which clears the fixed nav) gives the column
      // something to divide, the same trick the old layout used with
      // calc(100vh - 40px).
      //
      // The cap: the studio is drawn at a 390x844 frame. Left uncapped, a 1080p
      // laptop stretches the canvas to ~776px tall and the model swims in a thin
      // ribbon. Capping at the frame height and centring with my-auto keeps the
      // design's proportions on a desktop while still filling a real phone.
      style={{ height: "calc(100dvh - 2.5rem)" }}
    >
    <div className="relative my-auto flex h-full max-h-[844px] w-full max-w-sm flex-col overflow-hidden">
      {/* Header — the wordmark's job is done by the app shell; here the label
          just says which look you're in. */}
      <header className="flex shrink-0 items-center px-5 pt-2">
        <IconButton
          tone="ghost"
          size="xs"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="-ml-1"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <span className="flex-1 truncate text-center text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {occasionLabel}
        </span>
        <IconButton
          tone="ghost"
          size="xs"
          aria-label="Open split view"
          onClick={() => openAlternativesSplit("top")}
          disabled={isViewOnly}
        >
          <Columns2 className="size-3.5" aria-hidden="true" />
        </IconButton>
      </header>

      {/* The model owns the frame: a white card on the warp/weft weave, with the
          controls floating on its own edges rather than on rails beside it. */}
      <div className="flex min-h-0 flex-1 px-3.5 pb-2 pt-2">
        <div
          className={cn(
            "relative flex min-h-0 w-full flex-1 overflow-hidden rounded-md border border-hairline bg-card",
            tour.isHighlighted("mannequin") ? "z-[75]" : "z-0",
          )}
        >
          <div className="bg-warp-grid pointer-events-none absolute inset-0" aria-hidden="true" />

          {/* Absolute rather than h-full so the model fills the card no matter
              how the flex chain above resolves.
              pb-4: the hero tile scales the figure to exactly fill the wrapper's
              height, so without padding the feet sit flush on the canvas edge.
              The padding shrinks the height the scale is computed from, lifting
              the figure off the bottom (same treatment as the alternates screen). */}
          <div className="absolute inset-0 flex items-end justify-center pb-4">
            {studioAvatar || (isAdminMode && !outfitId) ? (
              <OutfitInspirationTile
                preset="heroCanonical"
                outfitId={studioAvatar?.id ?? "temp-admin"}
                renderedItems={displayRenderedItems ?? (studioAvatar ? mapLegacyOutfitItemsToStudioItems(displayAvatarItems) : [])}
                fallbackImageSrc={displayRenderedItems?.[0]?.imageUrl ?? displayAvatarItems[0]?.imageUrl}
                title={studioAvatar?.name ?? "New Outfit"}
                chips={studioAvatar ? [studioAvatar.fit, studioAvatar.feel].filter(Boolean) as string[] : []}
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
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                {isOutfitLoading || isLoadingOverrides ? "Loading outfit…" : "Select an outfit to begin"}
              </div>
            )}
          </div>

          {/* ✦ YOURS — empty state until Wave 2 supplies wardrobe content, so it
              says what it will hold rather than pretending to hold it. Gold is
              allowed here: this is ownership, not an action. */}
          <button
            type="button"
            onClick={() => openTraySheet(traySheetSlot, "yours")}
            disabled={isViewOnly}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-gold bg-card/80 px-2.5 py-1 text-[8px] font-semibold tracking-[0.08em] text-gold-deep disabled:opacity-50"
          >
            <Sparkles className="size-2.5" aria-hidden="true" />
            YOURS
          </button>

          <CanvasControlCluster items={historyControls} className="absolute left-2 top-11" />
          <CanvasControlCluster items={creativeControls} className="absolute right-2 top-11" />
        </div>
      </div>

      {/* The three worn pieces, as rows. Tapping one opens its rack. */}
      <StudioSlotRows
        slotOrder={slotOrder}
        items={resolvedTrayItems}
        hiddenSlots={hiddenSlots}
        isReadOnly={isViewOnly}
        onOpenDetails={handlePeekSlot}
        onOpenAlternates={handleOpenAlternates}
        onRemoveSlot={handleRemoveSlot}
        highlight={tour.isHighlighted("slot-rows")}
        className="shrink-0"
      />

      <StudioActionBar
        className="shrink-0"
        total={lookTotal}
        pieceCount={lookPieceCount}
        isReadOnly={isViewOnly}
        onSave={() => setIsSaveDrawerOpen(true)}
        onTryOn={handleTryOn}
        onDetails={handleDetailsPress}
        highlightSave={tour.isHighlighted("save-button")}
        highlightTryOn={tour.isHighlighted("tryon-button")}
        highlightDetails={tour.isHighlighted("click-details")}
      />

      {/* 7e — the deep dive on a piece already on the model. Opened by tapping
          the garment itself; hands off to the tray sheet for alternates. */}
      <ProductPeekCard
        item={peekItem}
        open={peekOpen && peekItem !== null}
        onOpenChange={setPeekOpen}
        isWorn
        isReadOnly={isViewOnly}
        onWear={() => undefined}
        onDetails={(item) => {
          const trayItem = resolvedTrayItems.find((candidate) => candidate.productId === item.id)
          setPeekOpen(false)
          openProduct(item.id, {
            initialProduct: trayItem ? mapTrayItemToProductDetail(trayItem) : undefined,
          })
        }}
        onSeeAlternates={() => {
          setPeekOpen(false)
          openTraySheet(peekSlot)
        }}
      />

      {/* 7a's tray sheet — half height, so the model stays visible while you
          swap. §8.1 contract: slot + mode. */}
      <TraySheet
        open={traySheetOpen}
        onOpenChange={setTraySheetOpen}
        slot={traySheetSlot}
        mode={traySheetMode}
        onSlotChange={setTraySheetSlot}
        onModeChange={setTraySheetMode}
        outfitId={syncOutfitId}
        wornItems={resolvedTrayItems}
        hiddenSlots={hiddenSlots}
        isReadOnly={isViewOnly}
        mannequin={(adminGender ?? avatarGender ?? "female") as "male" | "female"}
        onWear={handleTrayWear}
        onOpenSplitView={(slot) => {
          setTraySheetOpen(false)
          openAlternativesSplit(slot, { forceSlot: true })
        }}
      />

      {/* Lifted out of ProductTray, which no longer renders on this screen. */}
      <SaveOutfitDrawer
        open={isSaveDrawerOpen}
        onOpenChange={setIsSaveDrawerOpen}
        defaultOutfitName={
          studioAvatar?.name?.startsWith("draft-look-")
            ? `${profile?.name ?? "Your"}'s Look #${String(Date.now()).slice(-4)}`
            : (studioAvatar?.name ?? "")
        }
        defaultCategoryId={studioAvatar?.category ?? undefined}
        defaultOccasionId={studioAvatar?.occasion?.id ?? undefined}
        defaultMoodboardIds={currentOutfitMoodboardSlugs.length ? currentOutfitMoodboardSlugs : ["favorites"]}
        isLoadingMoodboards={moodboardsLoading}
        moodboards={selectableMoodboards}
        onCreateMoodboard={(name) => createMoodboardMutation.mutateAsync(name).then((res) => res.slug)}
        onSave={handleSaveOutfit}
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
