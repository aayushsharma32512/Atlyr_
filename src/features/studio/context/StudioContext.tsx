import { useEffect, useRef, createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import type { OutfitItem } from "@/types"
import type { StudioProductDetail } from "@/services/studio/studioService"
import type { ProductSearchFilters } from "@/services/search/searchService"
import {
  buildStudioSearchParams,
  buildStudioUrl,
  parseStudioSearchParams,
  type SlotIdMap,
} from "@/features/studio/utils/studioUrlState"
import { studioKeys } from "@/features/studio/queryKeys"
import { studioService } from "@/services/studio/studioService"

type StudioSlot = "top" | "bottom" | "shoes"

// Search state for each slot - persisted in context across route changes
export interface SlotSearchState {
  // Draft state
  draftText: string
  draftImageUrl: string | null

  // Committed state
  committedText: string
  committedImageUrl: string | null

  // Filters
  activeFilters: ProductSearchFilters
  activeFilterIds: string[]
}

export const INITIAL_SLOT_SEARCH_STATE: SlotSearchState = {
  draftText: "",
  draftImageUrl: null,
  committedText: "",
  committedImageUrl: null,
  activeFilters: {},
  activeFilterIds: [],
}

export type SlotSearchStates = Record<string, SlotSearchState>

interface StudioContextValue {
  selectedOutfitId: string | null
  setSelectedOutfitId: (id: string | null) => void
  focusedItem: OutfitItem | null
  setFocusedItem: (item: OutfitItem | null) => void
  slotProductIds: SlotIdMap
  setSlotProductId: (slot: StudioSlot, productId: string | null) => void
  selectedProductId: string | null
  setSelectedProductId: (id: string | null) => void
  openStudio: () => void
  openScrollUp: () => void
  closeScrollUp: () => void
  openAlternatives: (item: OutfitItem, options?: { outfitId?: string | null }) => void
  openAlternativesSplit: (defaultSlot?: StudioSlot) => void
  openProduct: (productId: string, options?: { initialProduct?: StudioProductDetail | null }) => void
  openSimilarItems: (productId: string, options?: { initialProduct?: StudioProductDetail | null }) => void
  reset: () => void
  // Search state management - persisted across route changes
  slotSearchStates: SlotSearchStates
  setSlotSearchStates: React.Dispatch<React.SetStateAction<SlotSearchStates>>
  activeSearchSlot: StudioSlot | null
  setActiveSearchSlot: (slot: StudioSlot | null) => void
}

const StudioContext = createContext<StudioContextValue | undefined>(undefined)

// Helper to get initial state from URL on first mount
function getInitialStudioState() {
  if (typeof window === "undefined") {
    return { outfitId: null as string | null, slotIds: {} as SlotIdMap }
  }
  const params = new URLSearchParams(window.location.search)
  const parsed = parseStudioSearchParams(params)
  return {
    outfitId: parsed.outfitId ?? null,
    slotIds: parsed.slotIds ?? {},
  }
}

export function StudioContextProvider({ children }: { children: ReactNode }) {
  const initialState = getInitialStudioState()
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(initialState.outfitId)
  const [focusedItem, setFocusedItem] = useState<OutfitItem | null>(null)
  const [slotProductIds, setSlotProductIds] = useState<SlotIdMap>(initialState.slotIds)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  
  // Search state - persisted across route changes
  const [slotSearchStates, setSlotSearchStates] = useState<SlotSearchStates>({})
  const [activeSearchSlot, setActiveSearchSlot] = useState<StudioSlot | null>(null)
  
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  const basePath = useMemo(() => {
    const match = location.pathname.match(/(.*\/studio)(?:\/.*)?$/)
    if (match && match[1]) {
      return match[1]
    }

    return location.pathname.replace(/\/*$/, "") || "/studio"
  }, [location.pathname])
  const shareParam = useMemo(
    () => parseStudioSearchParams(new URLSearchParams(location.search)).share === true,
    [location.search],
  )
  const hiddenSlotsParam = useMemo(
    () => parseStudioSearchParams(new URLSearchParams(location.search)).hiddenSlots,
    [location.search],
  )

  const lastSyncedRef = useRef<string>("")

  useEffect(() => {
    if (location.search === lastSyncedRef.current) {
      return
    }
    lastSyncedRef.current = location.search
    const parsed = parseStudioSearchParams(new URLSearchParams(location.search))
    setSelectedOutfitId((prev) => (prev === parsed.outfitId ? prev : parsed.outfitId ?? prev))
    setSlotProductIds((prev) => {
      let changed = false
      const next: SlotIdMap = { ...prev }
      ;(["top", "bottom", "shoes"] as StudioSlot[]).forEach((slot) => {
        const incoming = parsed.slotIds[slot] ?? null
        if (incoming && incoming !== next[slot]) {
          next[slot] = incoming
          changed = true
        } else if (!incoming && next[slot]) {
          delete next[slot]
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [location.search])

  const openStudio = useCallback(() => {
    const url = buildStudioUrl(basePath, "studio", {
      outfitId: selectedOutfitId,
      slotIds: slotProductIds,
      share: shareParam,
      hiddenSlots: hiddenSlotsParam,
    })
    navigate(url)
  }, [basePath, hiddenSlotsParam, location.pathname, location.search, navigate, selectedOutfitId, shareParam, slotProductIds])

  const openScrollUp = useCallback(() => {
    const params = buildStudioSearchParams({
      outfitId: selectedOutfitId,
      slotIds: slotProductIds,
      share: shareParam,
      hiddenSlots: hiddenSlotsParam,
    })
    const originPath = `${location.pathname}${location.search}` || basePath
    params.set("returnTo", encodeURIComponent(originPath))
    const search = params.toString()
    navigate(`${basePath}/scroll-up${search ? `?${search}` : ""}`)
  }, [basePath, hiddenSlotsParam, navigate, selectedOutfitId, shareParam, slotProductIds])

  const closeScrollUp = useCallback(() => {
    openStudio()
  }, [openStudio])

  const openAlternatives = useCallback(
    (item: OutfitItem, options?: { outfitId?: string | null }) => {
      setFocusedItem(item)
      const slot = item.type === "top" || item.type === "bottom" || item.type === "shoes" ? item.type : null
      const parsed = parseStudioSearchParams(new URLSearchParams(location.search))
      const outfitParam = parsed.outfitId ?? options?.outfitId ?? selectedOutfitId
      const params = buildStudioSearchParams({
        outfitId: outfitParam ?? null,
        slotIds: slot
          ? {
              ...slotProductIds,
              [slot]: item.id ?? slotProductIds[slot],
            }
          : slotProductIds,
        slot,
        productId: item.id ?? null,
        share: parsed.share,
        hiddenSlots: parsed.hiddenSlots,
      })
      const originPath = `${location.pathname}${location.search}` || basePath
      params.set("returnTo", encodeURIComponent(originPath))
      const search = params.toString()
      navigate(`${basePath}/alternatives${search ? `?${search}` : ""}`)
    },
    [basePath, location.pathname, location.search, navigate, selectedOutfitId, slotProductIds],
  )

  // Navigate to alternatives in split view, using the last active slot or a fallback
  const openAlternativesSplit = useCallback(
    (fallbackSlot: StudioSlot = "top") => {
      // Use the stored active slot if available, otherwise fall back to the provided slot
      const slot = activeSearchSlot ?? fallbackSlot
      const parsed = parseStudioSearchParams(new URLSearchParams(location.search))
      const params = buildStudioSearchParams({
        outfitId: parsed.outfitId ?? selectedOutfitId,
        slotIds: slotProductIds,
        slot,
        productId: slotProductIds[slot] ?? null,
        share: parsed.share,
        hiddenSlots: parsed.hiddenSlots,
      })
      const originPath = `${location.pathname}${location.search}` || basePath
      params.set("returnTo", encodeURIComponent(originPath))
      const search = params.toString()
      navigate(`${basePath}/alternatives${search ? `?${search}` : ""}`)
    },
    [activeSearchSlot, basePath, location.pathname, location.search, navigate, selectedOutfitId, slotProductIds],
  )

  const setSlotProductId = useCallback((slot: StudioSlot, productId: string | null) => {
    setSlotProductIds((prev) => {
      if (!productId) {
        const next = { ...prev }
        delete next[slot]
        return next
      }
      return { ...prev, [slot]: productId }
    })
  }, [])

  const openProduct = useCallback(
    (productId: string, options?: { initialProduct?: StudioProductDetail | null }) => {
      setSelectedProductId(productId)
      // Invalidate cached product data to ensure fresh fetch with description_text
      // Don't cache incomplete initialProduct data - let useStudioProduct fetch full data
      queryClient.invalidateQueries({ queryKey: studioKeys.product(productId) })
      const params = buildStudioSearchParams({
        outfitId: selectedOutfitId,
        slotIds: slotProductIds,
        share: shareParam,
        hiddenSlots: hiddenSlotsParam,
      })
      if (productId) {
        params.set("productId", productId)
      }
      const originPath = `${location.pathname}${location.search}` || basePath
      params.set("returnTo", encodeURIComponent(originPath))
      const search = params.toString()
      navigate(`${basePath}/product/${encodeURIComponent(productId)}${search ? `?${search}` : ""}`)
      queryClient
        .prefetchQuery({
          queryKey: studioKeys.similarProducts(productId),
          queryFn: () => studioService.getSimilarProductsByProductId(productId),
          staleTime: 30 * 1000,
        })
        .catch(() => {
          // Prefetch failure should not block navigation
        })
    },
    [basePath, hiddenSlotsParam, location.pathname, location.search, navigate, queryClient, selectedOutfitId, shareParam, slotProductIds],
  )

  const openSimilarItems = useCallback(
    (productId: string, options?: { initialProduct?: StudioProductDetail | null }) => {
      if (!productId) {
        return
      }
      setSelectedProductId(productId)
      // Invalidate cached product data to ensure fresh fetch with description_text
      queryClient.invalidateQueries({ queryKey: studioKeys.product(productId) })
      const params = buildStudioSearchParams({
        outfitId: selectedOutfitId,
        slotIds: slotProductIds,
        share: shareParam,
        hiddenSlots: hiddenSlotsParam,
      })
      params.set("productId", productId)
      const originPath = `${location.pathname}${location.search}` || `${basePath}/product/${productId}`
      params.set("returnTo", encodeURIComponent(originPath))
      const search = params.toString()
      navigate(`${basePath}/similar${search ? `?${search}` : ""}`)
      queryClient
        .prefetchQuery({
          queryKey: studioKeys.similarProducts(productId),
          queryFn: () => studioService.getSimilarProductsByProductId(productId),
          staleTime: 30 * 1000,
        })
        .catch(() => {
          // Prefetch failure should not block navigation
        })
    },
    [
      basePath,
      hiddenSlotsParam,
      location.pathname,
      location.search,
      navigate,
      queryClient,
      selectedOutfitId,
      shareParam,
      slotProductIds,
      setSelectedProductId,
    ],
  )

  const reset = useCallback(() => {
    setSelectedOutfitId(null)
    setFocusedItem(null)
    setSelectedProductId(null)
    setSlotProductIds({})
    setSlotSearchStates({})
    setActiveSearchSlot(null)
  }, [])

  const value = useMemo<StudioContextValue>(
    () => ({
      selectedOutfitId,
      setSelectedOutfitId,
      focusedItem,
      setFocusedItem,
      slotProductIds,
      setSlotProductId,
      selectedProductId,
      setSelectedProductId,
      openStudio,
      openScrollUp,
      closeScrollUp,
      openAlternatives,
      openAlternativesSplit,
      openProduct,
      openSimilarItems,
      reset,
      slotSearchStates,
      setSlotSearchStates,
      activeSearchSlot,
      setActiveSearchSlot,
    }),
    [
      closeScrollUp,
      focusedItem,
      slotProductIds,
      openAlternatives,
      openAlternativesSplit,
      openSimilarItems,
      openProduct,
      openScrollUp,
      openStudio,
      setSlotProductId,
      reset,
      selectedOutfitId,
      selectedProductId,
      slotSearchStates,
      activeSearchSlot,
    ],
  )

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudioContext() {
  const ctx = useContext(StudioContext)
  if (!ctx) {
    throw new Error("useStudioContext must be used within a StudioContextProvider")
  }
  return ctx
}
