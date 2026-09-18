import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, Redo2, RotateCcw, Share, Undo2 } from "lucide-react"

import { IconButton, OutfitInspirationTile } from "@/design-system/primitives"
import { StudioActionBar } from "./components/StudioActionBar"
import { StudioCanvas } from "./components/StudioCanvas"
import { StudioPieceRows } from "./components/StudioPieceRows"
import { StudioSaveCard } from "./components/StudioSaveCard"
import { StudioFocusSheet } from "./components/StudioFocusSheet"
import { useStagedPiece } from "./hooks/useStagedPiece"
import { useStudioFocus } from "./hooks/useStudioFocus"
import { useShareLook } from "@/features/share/hooks/useShareLink"
import { useStudioProductImages } from "./hooks/useStudioProductImages"
import { toDisplayImages } from "./utils/productImages"
import {
  CANVAS_SLOTS,
  stepCanvasSlot,
  toTraySlot,
  type StudioCanvasSlot,
} from "./constants/layering"
import type { OutfitItem } from "@/types"
import { getOutfitTagsFromItems, getTrayItemTags } from "@/utils/productTags"
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
import { useCurrentLookId } from "@/features/studio/hooks/useCurrentLookId"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"
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
import { useSavedTagsLookup } from "@/features/collections/hooks/useSavedTags"
import { useUpdateOutfit } from "@/features/outfits/hooks/useUpdateOutfit"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { useGoBack } from "@/hooks/useGoBack"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import { useStudioHistory } from "@/features/studio/hooks/useStudioHistory"
import { useLastStudioOutfit } from "@/features/studio/hooks/useLastStudioOutfit"
import { useStarterOutfit } from "@/features/outfits/hooks/useStarterOutfit"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { mergeOutfitItemsWithTray } from "@/features/studio/utils/mergeOutfitItemsWithTray"
import { useOutfitSnapshot } from "@/features/outfits/hooks/useOutfitSnapshot"
import { useFigureCapture } from "./hooks/useFigureCapture"
import { useOptionalAdminGender } from "@/features/admin/providers/AdminGenderContext"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { setPendingStudioComboChange, useStudioCombinationTracking } from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import { trackTryonFlowStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"
import { isDressTop, STUDIO_BASE_ITEMS_ENABLED, usePlaceholderItems } from "@/features/studio/hooks/usePlaceholderItems"

const DEFAULT_AVATAR_HEAD = "/avatars/Default.png"

/** Where back goes when there is no in-app entry behind Studio. */
const BACK_FALLBACK = "/collection"
/** A guest on a shared look has no home to go to. */
const GUEST_BACK_FALLBACK = "/"
const isHttpUrl = (value?: string | null) => Boolean(value && /^https?:\/\//i.test(value))

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
    openAlternativesSplit,
    openProduct,
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
  const { top: placeholderTop, bottom: placeholderBottom } = usePlaceholderItems(avatarGender)
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
  const { getSavedTags } = useSavedTagsLookup()
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
  // Find items opens over a still of the figure, so its scan runs on the look the user is seeing.
  const { captureRef, navigateWithFigure } = useFigureCapture()

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

  // Background prefetch of search-v3 after initial render (Option B: deferred)
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
  const { focus, openFocus, closeFocus } = useStudioFocus()

  /** Tapping a garment on the figure opens Alternates for it; the rows open Focus. */
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

      // Warm the rack and seed the hero, so Alternates opens already populated.
      if (syncOutfitId) {
        const trayMatch = resolvedTrayItems.find((trayItem) => trayItem.slot === slot)
        if (trayMatch) {
          queryClient.setQueryData(
            [...studioKeys.hero(syncOutfitId, slot), trayMatch.productId ?? "default"],
            trayMatch,
          )
        }
        prefetchStudioAlternatives(queryClient, { outfitId: syncOutfitId, slot, gender }).catch(() => {
          // Prefetch failures should not block the sheet.
        })
      }

      openAlternativesSplit(slot, { forceSlot: true, similar: true })
    },
    [
      gender,
      isViewOnly,
      normalizeSlot,
      openAlternativesSplit,
      queryClient,
      resolvedTrayItems,
      syncOutfitId,
      tour,
    ],
  )

  useEffect(() => {
    // 'full-screen' used to share this branch; it was a step with no consumer
    // and has been dropped, so only 'alternatives' drives the split view now.
    if (tour.isActive && tour.getCurrentStep()?.id === "alternatives") {
      openAlternativesSplit("top")
    }
  }, [tour.isActive, tour.currentStepIndex, openAlternativesSplit, tour])


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

    const topIsDress = isDressTop(resolvedTrayItems, hiddenSlots.top)

    return zones
      .map((zone) => {
        const trayItem = trayByZone.get(zone)
        const baseItem = baseByZone.get(zone)
        // hiddenSlots only tracks an explicit ×; a zone that never had an item (a saved
        // dress-only look has no bottom entry at all) is just as empty and needs the same
        // stand-in, or the bare mannequin's own baked-in underwear shows through instead.
        if (hiddenSlots[zone] || (!trayItem && !baseItem)) {
          return zone === "top" ? placeholderTop : zone === "bottom" && !topIsDress ? placeholderBottom : null
        }
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
  }, [hiddenSlots, outfitData?.studioOutfit?.renderedItems, placeholderBottom, placeholderTop, resolvedTrayItems])
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

  // Saved state (heart, boards, tags) keys on the combo on screen, not the URL's base look.
  const { currentLookId } = useCurrentLookId({
    outfitId: resolvedOutfitId,
    hasSlotOverrides,
    topId: outfitItems.topId,
    bottomId: outfitItems.bottomId,
    shoesId: outfitItems.footwearId,
  })

  // The save row's tags win; an owned, never-saved base look falls back to its public tags.
  const savedLookTags = currentLookId ? getSavedTags("look", currentLookId) : []
  const lookInitialTags = savedLookTags.length
    ? savedLookTags
    : isOwnOutfit && !hasSlotOverrides ? (studioAvatar?.tags ?? []) : []

  // The boards the current combo is really on right now, so the save
  // picker's default reflects truth instead of always assuming Favorites.
  const currentOutfitMoodboardSlugs = useMemo(() => {
    if (!currentLookId) return []
    return Object.entries(outfitMembershipQuery.data ?? {})
      .filter(([slug, ids]) => ids.has(currentLookId) && selectableMoodboards.some((m) => m.slug === slug))
      .map(([slug]) => slug)
  }, [currentLookId, outfitMembershipQuery.data, selectableMoodboards])

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
      tags: string[]
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
            tags: data.tags,
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
            tags: data.tags,
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
              await saveToCollectionMutation({ outfitId, slug, label: moodboardLabelBySlug.get(slug), tags: data.tags })
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
          // Boards may be unchanged while only the tags changed — piggyback the tag write on
          // one surviving board so every user_favorites row for this look still agrees.
          if (toAdd.length === 0 && selectedMoodboardSlugs.length > 0) {
            try {
              await saveToCollectionMutation({
                outfitId, slug: selectedMoodboardSlugs[0], label: moodboardLabelBySlug.get(selectedMoodboardSlugs[0]), tags: data.tags,
              })
            } catch {
              hadCollectionError = true
            }
          }
        } else {
          for (const slug of selectedMoodboardSlugs) {
            try {
              await saveToCollectionMutation({ outfitId, slug, label: moodboardLabelBySlug.get(slug), tags: data.tags })
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

  const handleSaveFromCard = useCallback(
    async (data: { name: string; tags: string[]; boardSlugs: string[] }) => {
      try {
        await handleSaveOutfit({
          outfitName: data.name,
          categoryId: studioAvatar?.category ?? "",
          occasionId: studioAvatar?.occasion?.id ?? "",
          tags: data.tags,
          isPrivate: false,
          moodboardIds: data.boardSlugs,
        })
        setIsSaveDrawerOpen(false)
      } catch {
        // handleSaveOutfit has already toasted; keep the card open to retry.
      }
    },
    [handleSaveOutfit, studioAvatar?.category, studioAvatar?.occasion?.id],
  )

  const currentSlotIds = useMemo(
    () => ({
      top: requestedSlotIds.top ?? null,
      bottom: requestedSlotIds.bottom ?? null,
      shoes: requestedSlotIds.shoes ?? null,
    }),
    [requestedSlotIds.bottom, requestedSlotIds.shoes, requestedSlotIds.top],
  )

  /** The row's × — hide the slot. Undoable, and it travels in share links. */
  const handleRemoveSlot = useCallback(
    (slot: StudioProductTraySlot) => {
      if (isViewOnly || !syncOutfitId) {
        return
      }
      setPendingStudioComboChange({ change_type: "hide_slot", slot })
      const nextSnapshot = {
        outfitId: syncOutfitId,
        slotIds: currentSlotIds,
        hiddenSlots: { ...hiddenSlots, [slot]: true },
      }
      recordChange(nextSnapshot)
      applySnapshot(nextSnapshot)
    },
    [applySnapshot, currentSlotIds, hiddenSlots, isViewOnly, recordChange, syncOutfitId],
  )

  /** The row's 4-square, the rail on an empty slot — both open Alternates. */
  const handleOpenAlternates = useCallback(
    (slot: StudioCanvasSlot) => {
      if (isViewOnly) {
        return
      }
      const traySlot = toTraySlot(slot)
      if (syncOutfitId) {
        prefetchStudioAlternatives(queryClient, { outfitId: syncOutfitId, slot: traySlot, gender }).catch(() => {
          // Prefetch failures should not block navigation.
        })
      }
      openAlternativesSplit(traySlot, { forceSlot: true })
    },
    [gender, isViewOnly, openAlternativesSplit, queryClient, syncOutfitId],
  )

  /**
   * Move a piece up or down the layer stack. `slotOrder` is the z-order —
   * AvatarRenderer gives the first zone the highest z-index — so this is the
   * whole layering control.
   */
  const handleReorderSlot = useCallback(
    (slot: StudioCanvasSlot, delta: number) => {
      if (isViewOnly) return
      const traySlot = toTraySlot(slot)
      setSlotOrder((prev) => {
        const from = prev.indexOf(traySlot)
        const to = from + delta
        if (from < 0 || to < 0 || to >= prev.length) return prev
        const next = [...prev]
        next.splice(to, 0, ...next.splice(from, 1))
        return next
      })
    },
    [isViewOnly],
  )

  /** The piece card's globe: the retailer listing when the piece has one. */
  /**
   * Product-level Find items: the import is seeded with this piece's cutout,
   * so the catalogue and web searches run on a clean garment rather than a
   * crop of a photo. Kicks are not a detector category, so they take the
   * blank import.
   */
  const { share: shareLook } = useShareLook()

  const handleShare = useCallback(async () => {
    if (!shareOutfitId) {
      return
    }
    await shareLook(
      buildStudioUrl(basePath, "studio", {
        outfitId: shareOutfitId,
        slotIds: shareSlotIds,
        hiddenSlots,
        share: true,
      }),
    )
  }, [basePath, hiddenSlots, shareLook, shareOutfitId, shareSlotIds])

  /** Worn pieces keyed by canvas slot. The layer entry is a second top. */
  const itemBySlot = useMemo(() => {
    const map: Partial<Record<StudioCanvasSlot, StudioProductTrayItem | null>> = {}
    CANVAS_SLOTS.forEach((slot) => {
      // A removed slot is empty: focus, the save count and the rows all read
      // this map, and the figure already leaves that piece off.
      map[slot] = hiddenSlots[toTraySlot(slot)]
        ? null
        : (resolvedTrayItems.find((item) => item.slot === toTraySlot(slot)) ?? null)
    })
    return map
  }, [hiddenSlots, resolvedTrayItems])

  /**
   * The same seeded import the globe on a piece opens, for the worn top and
   * bottom together (no shoes): both cutouts become the selected candidates
   * and the rack opens with a tab per slot. Nothing worn → the upload flow.
   */
  const handleFindItems = useCallback(() => {
    const params = new URLSearchParams()
    for (const traySlot of ["top", "bottom"] as const) {
      if (hiddenSlots[traySlot]) continue
      const item = itemBySlot[traySlot]
      const image = item?.imageUrl ?? item?.thumbnailUrl
      if (!image) continue
      params.append("source", image)
      params.append("slot", traySlot)
    }
    void navigateWithFigure(params.has("source") ? `/inspiration-import?${params.toString()}` : "/inspiration-import")
  }, [hiddenSlots, itemBySlot, navigateWithFigure])

  const handleFindItemsFor = useCallback(
    (slot: StudioCanvasSlot, item: StudioProductTrayItem) => {
      const traySlot = toTraySlot(slot)
      const image = item.imageUrl ?? item.thumbnailUrl
      if (traySlot === "shoes" || !image) {
        handleFindItems()
        return
      }
      void navigateWithFigure(`/inspiration-import?source=${encodeURIComponent(image)}&slot=${traySlot}`)
    },
    [handleFindItems, navigateWithFigure],
  )

  const focusItem = focus ? itemBySlot[focus] ?? null : null

  /**
   * Step to the next WORN piece, wrapping top -> bottom -> shoes -> top.
   * Empty slots are skipped: focusing one has nothing to show, and the guard
   * below would then drop out of focus entirely rather than carry on round.
   */
  const handleStepFocus = useCallback(
    (delta: number) => {
      if (!focus) return
      const step = delta < 0 ? -1 : 1
      let next = focus
      for (let i = 0; i < CANVAS_SLOTS.length; i++) {
        next = stepCanvasSlot(next, step)
        if (next === focus) return
        if (itemBySlot[next]) {
          openFocus(next)
          return
        }
      }
    },
    [focus, itemBySlot, openFocus],
  )
  const focusImagesQuery = useStudioProductImages(focusItem?.productId ?? null)

  // The piece's own thumbnail, already in the browser cache, stands in until the retailer photos land.
  const focusImages = useMemo(
    () => toDisplayImages(focusImagesQuery.data, focusItem?.thumbnailUrl ?? focusItem?.imageUrl),
    [focusImagesQuery.data, focusItem?.imageUrl, focusItem?.thumbnailUrl],
  )

  const focusAttributes = useMemo(() => getTrayItemTags(focusItem), [focusItem])

  // Stepping between pieces blanks the card and reveals the next one whole — see useStagedPiece.
  const { piece: focusPiece, isStaging: isFocusStaging } = useStagedPiece({
    productId: focusItem?.productId ?? null,
    title: focusItem?.title ?? "",
    images: focusImages,
    attributes: focusAttributes,
    saved: false,
    ready: Boolean(focusItem) && !focusImagesQuery.isPending,
  })

  // A slot emptied while focused has nothing to show — drop back to the canvas.
  // Not before the look and its slots have loaded: a deep link's focus must survive the fetch.
  useEffect(() => {
    if (focus && !focusItem && studioAvatar && !isOutfitLoading && !slotsResolving) {
      closeFocus()
    }
  }, [closeFocus, focus, focusItem, isOutfitLoading, slotsResolving, studioAvatar])

  /**
   * Back means up one level. Focus pushed its own history entry, so while
   * zoomed a press must exit the zoom or it reads as a dead button.
   */
  const goBack = useGoBack(user ? BACK_FALLBACK : GUEST_BACK_FALLBACK)
  const handleBack = useCallback(() => {
    if (focus) {
      closeFocus()
      return
    }
    goBack()
  }, [closeFocus, focus, goBack])

  // Design order for the left column: redo on top, undo below.
  const historyControls = [
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
  ]

  const lookControls = [
    {
      // The design's "reset". It is the existing checkpoint toggle: press once
      // for the look you started with, again to come back to your edits.
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
    {
      id: "share",
      label: "Share this look",
      icon: Share,
      disabled: !shareOutfitId,
      highlight: tour.isHighlighted("share-button"),
      onClick: shareOutfitId ? handleShare : undefined,
    },
  ]

  const showFocus = Boolean(focus && focusItem)

  // 390x844 frame. The canvas flexes so the card can grow with a fourth row.
  return (
    <div
      className="flex justify-center overflow-hidden bg-background"
      // Same signal the layout uses to drop the nav, so the two never disagree.
      style={{ height: focus ? "100dvh" : "calc(100dvh - 55px)" }}
    >
      {/* No 844 cap (unlike the artboard): a capped frame on a taller window left
          a blank band under the card once focus dropped the nav, and re-centred
          the header on the way in. The frame fills whatever height it is given. */}
      <div className="relative flex h-full w-full max-w-sm flex-col overflow-hidden">
        {/* 52h: back, then the screen names itself here and nowhere else.
            The design draws an Import pill on the right — deliberately not built.
            Stays through focus: the row never moves. */}
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-hairline px-2">
          <div className="flex min-w-0 items-center gap-1">
            <IconButton
              tone="ghost"
              size="xs"
              aria-label="Back"
              onClick={handleBack}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </IconButton>
            <h1 className="min-w-0 truncate font-display text-title font-medium text-ink">Studio</h1>
          </div>
          {/* No exit-focus button: the back chevron already leaves the zoom. */}
          <span className="size-8 shrink-0" aria-hidden="true" />
        </header>

        <StudioCanvas
          figure={
            studioAvatar || (isAdminMode && !outfitId) ? (
              <div className="absolute inset-0 flex items-end justify-center pb-4">
                <OutfitInspirationTile
                  preset="heroCanonical"
                  outfitId={studioAvatar?.id ?? "temp-admin"}
                  renderedItems={
                    displayRenderedItems ??
                    (studioAvatar ? mapLegacyOutfitItemsToStudioItems(displayAvatarItems) : [])
                  }
                  fallbackImageSrc={displayRenderedItems?.[0]?.imageUrl ?? displayAvatarItems[0]?.imageUrl}
                  title={studioAvatar?.name ?? "New Outfit"}
                  chips={[]}
                  isSaved={false}
                  avatarHeadSrc={avatarHeadSrc}
                  avatarGender={adminGender ?? avatarGender}
                  avatarHeightCm={avatarHeightCm}
                  cardClassName="h-full w-full"
                  onItemSelect={isViewOnly ? undefined : handleAvatarItemSelect}
                  slotOrder={slotOrder}
                  allowEmptyMannequin={isAdminMode || !STUDIO_BASE_ITEMS_ENABLED}
                  onSlotSelect={isAdminMode && !isViewOnly ? (slot) => openAlternativesSplit(slot) : undefined}
                  onAvatarReady={setAvatarReady}
                  avatarRef={snapshotRef}
                  captureRef={captureRef}
                />
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-body text-taupe">
                {isOutfitLoading || isLoadingOverrides ? "Loading outfit…" : "Select an outfit to begin"}
              </div>
            )
          }
          focus={focus}
          onStepFocus={handleStepFocus}
          historyControls={historyControls}
          lookControls={lookControls}
          highlight={tour.isHighlighted("mannequin")}
          className="border-y border-hairline"
        />

        {showFocus && focusItem ? (
          <StudioFocusSheet
            slot={focus as StudioCanvasSlot}
            title={focusPiece.title}
            images={focusPiece.images}
            attributes={focusPiece.attributes}
            isLoading={isFocusStaging}
            pieceKey={focusPiece.productId ?? "none"}
            isReadOnly={isViewOnly}
            onSave={() => setIsSaveDrawerOpen(true)}
            onTryOn={handleTryOn}
            onFindItems={() => handleFindItemsFor(focus as StudioCanvasSlot, focusItem)}
            onOpenAlternatives={() => handleOpenAlternates(focus as StudioCanvasSlot)}
            onStep={handleStepFocus}
          />
        ) : (
          <div className="box-border flex h-[170px] flex-none flex-col gap-1.5 px-4 py-2.5">
            {isSaveDrawerOpen ? (
              // Same 170 as the rows it replaces, so the canvas — and the figure — never move.
              <StudioSaveCard
                key={`look:${currentLookId ?? ""}:${getOutfitTagsFromItems(resolvedTrayItems).join("|")}:${lookInitialTags.join("|")}`}
                compact
                className="h-full"
                defaultName={
                  studioAvatar?.name?.startsWith("draft-look-")
                    ? `${profile?.name ?? "Your"}'s Look #${String(Date.now()).slice(-4)}`
                    : (studioAvatar?.name ?? "")
                }
                tagOptions={getOutfitTagsFromItems(resolvedTrayItems)}
                initialTags={lookInitialTags}
                boards={selectableMoodboards.map((m) => ({ slug: m.slug, label: m.label }))}
                defaultBoardSlugs={
                  currentOutfitMoodboardSlugs.length ? currentOutfitMoodboardSlugs : ["favorites"]
                }
                pieceCount={slotOrder.filter((s) => !hiddenSlots[s] && itemBySlot[s]).length}
                onSave={(data) => void handleSaveFromCard(data)}
                onCancel={() => setIsSaveDrawerOpen(false)}
                onCreateBoard={(name) =>
                  createMoodboardMutation.mutateAsync(name).then((res) => res.slug)
                }
              />
            ) : (
              <>
            <StudioPieceRows
              slots={slotOrder}
              onReorder={handleReorderSlot}
              itemBySlot={itemBySlot}
              hiddenSlots={hiddenSlots}
              isReadOnly={isViewOnly}
              onOpenFocus={openFocus}
              onFill={handleOpenAlternates}
              onRemove={(slot) => handleRemoveSlot(toTraySlot(slot))}
              highlight={tour.isHighlighted("slot-rows")}
            />
            <StudioActionBar
              isReadOnly={isViewOnly}
              saved={currentOutfitMoodboardSlugs.length > 0}
              onSave={() => setIsSaveDrawerOpen(true)}
              onTryOn={handleTryOn}
              onFindItems={handleFindItems}
              highlightSave={tour.isHighlighted("save-button")}
              highlightTryOn={tour.isHighlighted("tryon-button")}
              highlightFindItems={tour.isHighlighted("find-items")}
            />
              </>
            )}
          </div>
        )}

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
