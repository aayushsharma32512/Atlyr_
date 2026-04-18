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
  openAlternativesSplit: (defaultSlot?: StudioSlot, options?: { forceSlot?: boolean }) => void
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

// ---------- Studio search session persistence ----------
const STUDIO_SEARCH_SESSION_PREFIX = "atlyr:studio:search:"

/**
 * Called as a lazy useState initializer (runs synchronously during the first render).
 * Reads the outfitId from the current URL and loads any saved per-slot search states for it.
 * Sets draftText = committedText so the search bar shows the last committed query on restore.
 */
function loadSlotSearchStates(): SlotSearchStates {
  if (typeof window === "undefined") return {}
  try {
    const params = new URLSearchParams(window.location.search)
    const parsed = parseStudioSearchParams(params)
    const outfitId = parsed.outfitId ?? null
    if (!outfitId) return {}

    const raw = window.sessionStorage.getItem(`${STUDIO_SEARCH_SESSION_PREFIX}${outfitId}`)
    if (!raw) return {}

    const stored: SlotSearchStates = JSON.parse(raw)
    const result: SlotSearchStates = {}
    for (const [slot, state] of Object.entries(stored)) {
      if (state.committedText) {
        // Mirror committedText → draftText so the search bar shows the restored query
        result[slot] = { ...state, draftText: state.committedText }
      }
    }
    return result
  } catch {
    return {}
  }
}

// ---------- End persistence helpers ----------

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
  
  // Search state - persisted across route changes; lazily initialised from sessionStorage
  const [slotSearchStates, setSlotSearchStates] = useState<SlotSearchStates>(loadSlotSearchStates)
  const [activeSearchSlot, setActiveSearchSlot] = useState<StudioSlot | null>(null)

  // Tracks the outfitId that was in use when we last wrote to sessionStorage.
  // Kept in a ref so the save/clear effect can compare without creating circular deps.
  const savedOutfitIdRef = useRef<string | null>(initialState.outfitId)

  // Refs that always hold the latest state — used for the unmount-flush below.
  const latestSlotSearchStatesRef = useRef<SlotSearchStates>(slotSearchStates)
  const latestSelectedOutfitIdRef = useRef<string | null>(selectedOutfitId)

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

  // ----- Keep "latest" refs in sync (used for unmount flush) -----
  useEffect(() => {
    latestSlotSearchStatesRef.current = slotSearchStates
    latestSelectedOutfitIdRef.current = selectedOutfitId
  }, [slotSearchStates, selectedOutfitId])

  // ----- Save slot search states to sessionStorage, scoped per outfitId -----
  // Also handles outfit-change transitions:
  //   • outfit changed  → save current states under the *previous* outfit's key,
  //                        then load (or clear) states for the *new* outfit.
  //   • same outfit     → write current states under the current outfit's key.
  //
  // Race-condition guard: savedOutfitIdRef stores the ID we last committed to storage.
  // When the effect detects a mismatch with selectedOutfitId it means the outfit just
  // changed; we save-then-load atomically before updating the ref so a re-render
  // triggered by setSlotSearchStates() enters the "same outfit" branch.
  useEffect(() => {
    if (typeof window === "undefined") return

    const currentOutfitId = selectedOutfitId
    const prevOutfitId = savedOutfitIdRef.current

    const saveStates = (outfitId: string, states: SlotSearchStates) => {
      const toSave: SlotSearchStates = {}
      for (const [slot, state] of Object.entries(states)) {
        if (state.committedText) toSave[slot] = state
      }
      if (Object.keys(toSave).length === 0) return
      try {
        window.sessionStorage.setItem(
          `${STUDIO_SEARCH_SESSION_PREFIX}${outfitId}`,
          JSON.stringify(toSave),
        )
      } catch {
        // Quota / private-mode — ignore
      }
    }

    const loadStates = (outfitId: string): SlotSearchStates | null => {
      try {
        const raw = window.sessionStorage.getItem(`${STUDIO_SEARCH_SESSION_PREFIX}${outfitId}`)
        if (!raw) return null
        const stored: SlotSearchStates = JSON.parse(raw)
        const result: SlotSearchStates = {}
        for (const [slot, state] of Object.entries(stored)) {
          if (state.committedText) {
            result[slot] = { ...state, draftText: state.committedText }
          }
        }
        return Object.keys(result).length > 0 ? result : null
      } catch {
        return null
      }
    }

    if (prevOutfitId !== currentOutfitId) {
      // Outfit changed — flush current states under the OLD outfit's key first.
      if (prevOutfitId) {
        saveStates(prevOutfitId, slotSearchStates)
      }
      // Update the guard ref before any setState to prevent re-entry.
      savedOutfitIdRef.current = currentOutfitId

      // Load saved states for the new outfit (or reset to empty).
      if (currentOutfitId) {
        const loaded = loadStates(currentOutfitId)
        if (loaded) {
          setSlotSearchStates(loaded)
        } else {
          setSlotSearchStates({})
        }
      } else {
        setSlotSearchStates({})
      }
    } else if (currentOutfitId) {
      // Same outfit — just keep sessionStorage up to date.
      saveStates(currentOutfitId, slotSearchStates)
    }
  }, [selectedOutfitId, slotSearchStates])

  // ----- Flush on unmount (user navigates away from /studio/*) -----
  // The save effect above is continuous, but an unmount may race a final state update.
  // This effect captures the very last state via refs and ensures it is persisted.
  useEffect(() => {
    return () => {
      const outfitId = latestSelectedOutfitIdRef.current
      const states = latestSlotSearchStatesRef.current
      if (!outfitId || typeof window === "undefined") return
      const toSave: SlotSearchStates = {}
      for (const [slot, state] of Object.entries(states)) {
        if (state.committedText) toSave[slot] = state
      }
      if (Object.keys(toSave).length === 0) return
      try {
        window.sessionStorage.setItem(
          `${STUDIO_SEARCH_SESSION_PREFIX}${outfitId}`,
          JSON.stringify(toSave),
        )
      } catch {
        // ignore
      }
    }
  }, []) // empty deps — runs exactly once on unmount

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
    (fallbackSlot: StudioSlot = "top", options?: { forceSlot?: boolean }) => {
      // Use the stored active slot if available, unless the caller explicitly requests a specific slot
      const slot = (!options?.forceSlot && activeSearchSlot) ? activeSearchSlot : fallbackSlot
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
