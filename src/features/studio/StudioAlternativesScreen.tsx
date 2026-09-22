import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Redo2, RotateCcw, Undo2 } from "lucide-react"

import { Icons } from "@/design-system/icons"
import { useOutfitSnapshot } from "@/features/outfits/hooks/useOutfitSnapshot"
import { useFigureCapture } from "./hooks/useFigureCapture"

import {
  FilterDrawer,
  ProductSheet,
  OutfitInspirationTile,
  type FilterCategory,
} from "@/design-system/primitives"
import { AlternatesHeader } from "./components/AlternatesHeader"
import { StudioSaveCard } from "./components/StudioSaveCard"
import { StudioFocusSheet } from "./components/StudioFocusSheet"
import { useStudioFocus } from "./hooks/useStudioFocus"
import { AlternatesRack } from "./components/AlternatesRack"
import { SlotIconRow } from "./components/SlotIconRow"
import { StudioCanvas } from "./components/StudioCanvas"
import { AlternatesSearchBar, AlternatesSearchButton } from "./components/AlternatesSearchDock"
import { ReferenceImageDialog } from "./components/ReferenceImageDialog"
import { useStudioProductImages } from "./hooks/useStudioProductImages"
import { useStagedPiece } from "./hooks/useStagedPiece"
import { toDisplayImages } from "./utils/productImages"
import { CANVAS_SLOTS, toTraySlot, type StudioCanvasSlot } from "./constants/layering"
import { selectRackProducts } from "./utils/rackOrder"
import { toTrayItem } from "./utils/trayMutations"
import { useStudioContext } from "./context/StudioContext"
import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useStudioHeroProduct } from "@/features/studio/hooks/useStudioHeroProduct"
import { useStudioAlternatives, useStudioCollectionAlternatives } from "@/features/studio/hooks/useStudioAlternatives"
import { useStudioSwapActions } from "@/features/studio/hooks/useStudioSwapActions"
import { useStudioSearch } from "@/features/studio/hooks/useStudioSearch"
import { useStudioSearchResults } from "@/features/studio/hooks/useStudioSearchResults"
import { useProductFilterOptions } from "@/features/search/hooks/useProductFilterOptions"
import type { StudioAlternativeProduct, StudioProductTraySlot } from "@/services/studio/studioService"
import { useStudioResolvedSlots } from "@/features/studio/hooks/useStudioResolvedSlots"
import { useCurrentLookId } from "@/features/studio/hooks/useCurrentLookId"
import { isPlaceableOnMannequin, shouldFilterSlotByPlacement } from "@/features/studio/utils/placementSupport"
import { mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import { isDressTop, STUDIO_BASE_ITEMS_ENABLED, usePlaceholderItems } from "@/features/studio/hooks/usePlaceholderItems"
import { defaultLayerOrder } from "@/features/studio/utils/layerOrder"
import { LAYER_ORDER_ENABLED } from "@/features/studio/constants/layering"
import { mapTrayItemToAlternative, mapTrayItemToProductDetail } from "@/services/studio/studioService"
import { getOutfitTagsFromItems, getTrayItemTags } from "@/utils/productTags"
import { useSaveOutfit } from "@/features/outfits/hooks/useSaveOutfit"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useFindOutfitByItems } from "@/features/outfits/hooks/useFindOutfitByItems"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import {
  useMoodboards,
  useCreateMoodboard,
  useOutfitCollectionMembership,
  useRemoveFromCollection,
  useSaveToCollection,
  useProductCollectionMembership,
} from "@/features/collections/hooks/useMoodboards"
import { useSavedTagsLookup } from "@/features/collections/hooks/useSavedTags"
import { useUpdateOutfit } from "@/features/outfits/hooks/useUpdateOutfit"
import { useAuth } from "@/contexts/AuthContext"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import type { StudioRenderedItem } from "@/features/studio/types"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import {
  buildStudioSearchParams,
  isStudioSlot,
  parseStudioSearchParams,
  type SlotIdMap,
  type StudioSource,
} from "@/features/studio/utils/studioUrlState"
import { useToast } from "@/hooks/use-toast"
import type { Database } from "@/integrations/supabase/types"
import { useStudioHistory } from "@/features/studio/hooks/useStudioHistory"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { mergeOutfitItemsWithTray } from "@/features/studio/utils/mergeOutfitItemsWithTray"
import { useOptionalAdminGender } from "@/features/admin/providers/AdminGenderContext"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { canonicalizeProductSearchFilters } from "@/integrations/posthog/engagementTracking/searchCanonical"
import { setPendingStudioComboChange, useStudioCombinationTracking } from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import { trackTryonFlowStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

/** WEARING · {SLOT} on the 7c worn-piece card. */
const SLOT_DISPLAY_LABELS: Record<StudioProductTraySlot, string> = {
  top: "Tops",
  bottom: "Bottoms",
  shoes: "Shoes",
}

export function StudioAlternativesView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const parsedParams = useMemo(() => parseStudioSearchParams(searchParams), [searchParams])
  const routeOutfitId = parsedParams.outfitId
  const slot: StudioProductTraySlot = parsedParams.slot ?? "top"
  const hiddenSlots = useMemo(
    () => ({
      top: Boolean(parsedParams.hiddenSlots?.top),
      bottom: Boolean(parsedParams.hiddenSlots?.bottom),
      shoes: Boolean(parsedParams.hiddenSlots?.shoes),
    }),
    [parsedParams.hiddenSlots?.bottom, parsedParams.hiddenSlots?.shoes, parsedParams.hiddenSlots?.top],
  )
  const { toast } = useToast()
  const analytics = useEngagementAnalytics()
  const studioHistory = useStudioHistory()
  const { recordChange } = studioHistory
  const { isViewOnly } = useStudioShareMode()
  const productSaveActions = useProductSaveActions()

  const { selectedOutfitId, focusedItem, openProduct, openStudio, slotProductIds, setSlotProductId } = useStudioContext()

  const startLikenessFlow = useStartLikenessFlow()
  const resolvedOutfitId = routeOutfitId ?? selectedOutfitId
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

  // Save outfit hooks
  const { mutateAsync: saveOutfitMutation } = useSaveOutfit()
  const { mutateAsync: updateOutfitMutation } = useUpdateOutfit()
  const { mutateAsync: createDraftOutfitMutation } = useCreateDraftOutfit()
  const { mutateAsync: findOutfitByItemsMutation } = useFindOutfitByItems()
  const { mutateAsync: saveToCollectionMutation } = useSaveToCollection()
  const { mutateAsync: removeFromCollectionMutation } = useRemoveFromCollection()
  const outfitMembershipQuery = useOutfitCollectionMembership()
  const { getSavedTags } = useSavedTagsLookup()
  const { data: moodboards = [], isLoading: moodboardsLoading } = useMoodboards()
  const selectableMoodboards = useMemo(
    () => moodboards.filter((m) => !m.isSystem || m.slug === "favorites" || m.slug === "wardrobe"),
    [moodboards],
  )
  const productCollectionMembership = useProductCollectionMembership()
  const [activeCollectionSlugs, setActiveCollectionSlugs] = useState<string[]>([])
  const createMoodboardMutation = useCreateMoodboard()
  const { user } = useAuth()
  const { profile, gender } = useProfileContext()
  const [isSaveDrawerOpen, setIsSaveDrawerOpen] = useState(false)
  // Bumped on open: the card mounts fresh for each look and stays put while a save is in flight.
  const [saveCardKey, setSaveCardKey] = useState(0)
  const [isSavingLook, setIsSavingLook] = useState(false)
  /** The product a pin opened the save card for; null when the card isn't up. */
  const [productSaveId, setProductSaveId] = useState<string | null>(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isReferenceDialogOpen, setIsReferenceDialogOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  
  // Detect admin mode for direct save
  const adminGender = useOptionalAdminGender()
  const isAdminMode = adminGender !== null

  /**
   * Never pop. A swap here is client-only state: `swapSlot` writes the query
   * cache and StudioContext, and nothing reaches the server. Popping restores
   * the older Studio URL, and StudioContext re-syncs itself FROM that URL, so
   * the swap is thrown away. Going forward to a URL built from the live context
   * is what carries it. The cost is a duplicate Studio entry in the stack.
   */
  // Focus view, as on Studio: `?focus=` in the URL, so back leaves the zoom first.
  const { focus, openFocus, closeFocus } = useStudioFocus()

  const handleBack = useCallback(() => {
    if (focus) {
      closeFocus()
      return
    }
    if (decodedReturnTo) {
      navigate(decodedReturnTo)
      return
    }
    openStudio()
  }, [closeFocus, decodedReturnTo, focus, navigate, openStudio])

  const { swapSlot } = useStudioSwapActions(resolvedOutfitId)
  const { data: outfitData, isLoading: isOutfitLoading } = useStudioOutfit(resolvedOutfitId)
  // The rack's default source: the whole catalogue for this slot.
  const fallbackAlternativesQuery = useStudioAlternatives(resolvedOutfitId, slot)

  const requestedSlotIds = parsedParams.slotIds

  const { trayItems: resolvedTrayItems, isResolving: slotsResolving } = useStudioResolvedSlots({
    outfitId: resolvedOutfitId,
    baseOutfitItems: outfitData?.trayItems ?? [],
    requestedSlotIds,
  })
  // Same rule as Studio: never draw the saved pieces while the URL's pieces are still loading.
  const isLoadingOverrides = slotsResolving && Boolean(requestedSlotIds.top || requestedSlotIds.bottom || requestedSlotIds.shoes)
  // The stacking stored on the row; `layers` in the URL is present only when it differs from that.
  const rowLayerOrder = LAYER_ORDER_ENABLED ? outfitData?.studioOutfit?.layerOrder ?? null : null
  const orderChanged = parsedParams.layerOrder != null
  const layerOrderToSave = parsedParams.layerOrder ?? rowLayerOrder

  const activeSlotIds: SlotIdMap = useMemo(() => {
    const map: SlotIdMap = {}
    resolvedTrayItems.forEach((item) => {
      map[item.slot] = item.productId
    })
    ;(["top", "bottom", "shoes"] as StudioProductTraySlot[]).forEach((slotKey) => {
      map[slotKey] = requestedSlotIds[slotKey] ?? slotProductIds[slotKey] ?? map[slotKey] ?? null
    })
    return map
  }, [requestedSlotIds, resolvedTrayItems, slotProductIds])

  // Get the current item's image URL and product ID for the active slot (for auto-search)
  const { currentSlotImageUrl, currentSlotProductId } = useMemo(() => {
    if (hiddenSlots[slot]) {
      return { currentSlotImageUrl: null, currentSlotProductId: null }
    }
    const currentItem = resolvedTrayItems.find((item) => item.slot === slot)
    return {
      currentSlotImageUrl: currentItem?.imageUrl ?? null,
      currentSlotProductId: currentItem?.productId ?? null,
    }
  }, [hiddenSlots, resolvedTrayItems, slot])

  // Lock the product ID used for search at slot initialization time.
  // currentSlotProductId changes on every alternative selection (Passive Selection pattern),
  // but the search query must NOT re-fire just because the user picked a different item.
  const [searchProductId, setSearchProductId] = useState<string | null>(currentSlotProductId)
  useEffect(() => {
    setSearchProductId(currentSlotProductId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]) // Intentionally NOT including currentSlotProductId — only re-lock on slot change
  // The piece card's ⟳ seeds the rack with the piece worn at that moment; a rack tap never does.
  const seedRef = useRef<
    Partial<Record<StudioProductTraySlot, { imageUrl: string; productId: string; product: StudioAlternativeProduct | null }>>
  >({})
  const pendingSimilarSlotRef = useRef<StudioProductTraySlot | null>(null)

  // Cold start: no outfit exists yet in this session — show product tray immediately
  // so the user can browse and add items to create their first outfit.
  const isColdStart = !resolvedOutfitId

  // --- SEARCH STATE ---
  const search = useStudioSearch({
    onUploadError: (error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // Track previous slot to detect tab changes
  const prevSlotRef = useRef<StudioProductTraySlot>(slot)
  const isInitializedRef = useRef(false)

  /** Runs the pending similarity seed once the worn piece for this slot is known. */
  const seedPendingSimilar = useCallback(() => {
    if (pendingSimilarSlotRef.current !== slot) return
    if (hiddenSlots[slot] || isViewOnly) {
      pendingSimilarSlotRef.current = null
      return
    }
    if (!currentSlotImageUrl || !currentSlotProductId) return
    pendingSimilarSlotRef.current = null
    const wornTrayItem = resolvedTrayItems.find((item) => item.slot === slot && item.productId === currentSlotProductId)
    seedRef.current[slot] = {
      imageUrl: currentSlotImageUrl,
      productId: currentSlotProductId,
      product: wornTrayItem ? mapTrayItemToAlternative(wornTrayItem) : null,
    }
    setSearchProductId(currentSlotProductId)
    search.forceSearchForSlot(slot, currentSlotImageUrl)
  }, [currentSlotImageUrl, currentSlotProductId, hiddenSlots, isViewOnly, resolvedTrayItems, search, slot])

  // --- INITIALIZATION FLOW: resume or initialise the slot's search; only the piece card's ⟳ seeds it ---
  useEffect(() => {
    if (prevSlotRef.current !== slot) {
      search.resetForSlot(slot, null, isAdminMode)
      prevSlotRef.current = slot
    } else if (!isInitializedRef.current) {
      isInitializedRef.current = true
      search.resetForSlot(slot, null, isAdminMode)
    }
    seedPendingSimilar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, currentSlotImageUrl, currentSlotProductId, isAdminMode])

  // --- SEARCH RESULTS QUERY ---
  const searchResultsQuery = useStudioSearchResults({
    slot,
    query: search.committedText,
    imageUrl: search.committedImageUrl,
    // A typed query searches alone. The worn item joins only the similar-item search.
    productId: search.committedText ? null : searchProductId,
    filters: search.activeFilters,
    gender: adminGender ?? gender,
    allowEmptySearch: isAdminMode || isColdStart, // Allow fetching all items on cold start or in admin mode
  })

  /** Whatever the search returned, in that order; the worn piece is pinned to the front below. */
  const alternativeProducts = useMemo(
    () =>
      selectRackProducts({
        searchResults: searchResultsQuery.data,
        fallback: fallbackAlternativesQuery.data,
        useSearchResults: search.hasActiveSearch || isAdminMode || isColdStart,
      }),
    [search.hasActiveSearch, searchResultsQuery.data, fallbackAlternativesQuery.data, isAdminMode, isColdStart],
  )

  // Client-side collection/moodboard filter. Kept live: activeCollectionSlugs
  // only fills from the ≡ chips, so it narrows nothing unless asked.
  const filteredAlternativeProducts = useMemo(() => {
    if (activeCollectionSlugs.length === 0) return alternativeProducts
    const memberMap = productCollectionMembership.data ?? {}
    return alternativeProducts.filter((p) =>
      activeCollectionSlugs.some((slug) => memberMap[slug]?.has(p.id))
    )
  }, [alternativeProducts, activeCollectionSlugs, productCollectionMembership.data])

  /** Source lives in the URL. wardrobe→yours, explore→alternates (brief §7). */
  const source: StudioSource = parsedParams.source ?? "explore"

  // Wardrobe and favorites both hold standalone products and whole outfits.
  // The rack shows this slot's garment either way — a saved outfit is not a
  // rack candidate itself, its top/bottom/shoes are.
  const wardrobeProductIds = useMemo(
    () => Array.from(productCollectionMembership.data?.wardrobe ?? []),
    [productCollectionMembership.data],
  )
  const wardrobeOutfitIds = useMemo(
    () => Array.from(outfitMembershipQuery.data?.wardrobe ?? []),
    [outfitMembershipQuery.data],
  )
  const wardrobeAlternativesQuery = useStudioCollectionAlternatives(slot, wardrobeProductIds, wardrobeOutfitIds, {
    enabled: source === "wardrobe",
  })

  const savesProductIds = useMemo(
    () => Array.from(productCollectionMembership.data?.favorites ?? []),
    [productCollectionMembership.data],
  )
  const savesOutfitIds = useMemo(
    () => Array.from(outfitMembershipQuery.data?.favorites ?? []),
    [outfitMembershipQuery.data],
  )
  const savesAlternativesQuery = useStudioCollectionAlternatives(slot, savesProductIds, savesOutfitIds, {
    enabled: source === "saves",
  })

  const isLoading =
    source === "wardrobe"
      ? wardrobeAlternativesQuery.isLoading
      : source === "saves"
        ? savesAlternativesQuery.isLoading
        : search.hasActiveSearch
          ? searchResultsQuery.isLoading
          : fallbackAlternativesQuery.isLoading

  const rackProducts = useMemo(() => {
    // Drop anything the photoreal mannequin cannot actually wear — see
    // isPlaceableOnMannequin. Applied to every slot.
    const mannequin = (outfitData?.avatarGender ?? adminGender ?? gender ?? "female") as "male" | "female"

    if (source === "wardrobe" || source === "saves") {
      const items = (source === "wardrobe" ? wardrobeAlternativesQuery.data : savesAlternativesQuery.data) ?? []
      return shouldFilterSlotByPlacement(slot)
        ? items.filter((product) => isPlaceableOnMannequin(product, mannequin))
        : items
    }

    const products = shouldFilterSlotByPlacement(slot)
      ? filteredAlternativeProducts.filter((product) => isPlaceableOnMannequin(product, mannequin))
      : filteredAlternativeProducts

    // The seeding piece leads its similarity results; a later pick keeps its own place.
    const seed = seedRef.current[slot]
    if (!seed || search.committedImageUrl !== seed.imageUrl) return products
    const seedProduct = products.find((product) => product.id === seed.productId) ?? seed.product
    return seedProduct ? [seedProduct, ...products.filter((product) => product.id !== seed.productId)] : products
  }, [
    adminGender,
    filteredAlternativeProducts,
    gender,
    outfitData?.avatarGender,
    savesAlternativesQuery.data,
    search.committedImageUrl,
    slot,
    source,
    wardrobeAlternativesQuery.data,
  ])

  // The worn piece is already in memory — the tray item the swap wrote, or the rack tile that
  // was tapped — so the card changes in the same render as the figure. Only a deep link with
  // neither goes to the network. A removed slot has no worn piece: the card must not keep
  // showing the one that was taken off.
  const heroProductId = hiddenSlots[slot] ? null : (parsedParams.productId ?? slotProductIds[slot] ?? null)
  const localHero = useMemo(() => {
    if (!heroProductId) return null
    const worn = resolvedTrayItems.find((item) => item.slot === slot && item.productId === heroProductId)
    if (worn) return worn
    const tile = rackProducts.find((product) => product.id === heroProductId)
    return tile ? toTrayItem(slot, tile) : null
  }, [heroProductId, rackProducts, resolvedTrayItems, slot])
  const heroProductQuery = useStudioHeroProduct(resolvedOutfitId, slot, heroProductId, { enabled: !localHero })

  // --- FILTER OPTIONS ---
  const { data: filterOptions, isLoading: isFilterOptionsLoading, error: filterOptionsError } = useProductFilterOptions({
    typeFilters: [slot] as Database["public"]["Enums"]["item_type"][],
  })

  useEffect(() => {
    console.log('[StudioSearch] Filter options:', { 
      slot, 
      filterOptions, 
      isFilterOptionsLoading, 
      filterOptionsError,
    })
  }, [slot, filterOptions, isFilterOptionsLoading, filterOptionsError])

  const filterCategories = useMemo<FilterCategory[]>(() => {
    // Build slot-aware filter categories (hide type since tabs control it)
    // Note: Gender filter is intentionally excluded - it's auto-applied from user profile
    // Favorites/Wardrobe are inline — only custom moodboards in the dropdown
    const collectionOptions = [
      ...selectableMoodboards.map((m) => ({ id: `collection:${m.slug}`, label: m.label })),
    ]
    const categories: FilterCategory[] = [
      { id: "collection", label: "User Collections", options: collectionOptions },
    ]

    if (!filterOptions) return categories
    
    if (filterOptions.typeSubCategories.length > 0) {
      categories.push({
        id: "category",
        label: "Category",
        options: filterOptions.typeSubCategories.map((cat) => ({ id: `category:${cat}`, label: cat.charAt(0).toUpperCase() + cat.slice(1) })),
      })
    }
    
    if (filterOptions.brands.length > 0) {
      categories.push({
        id: "brand",
        label: "Brand",
        options: filterOptions.brands.map((brand) => ({ id: `brand:${brand}`, label: brand })),
      })
    }
    
    if (filterOptions.fits.length > 0) {
      categories.push({
        id: "fit",
        label: "Fit",
        options: filterOptions.fits.map((fit) => ({ id: `fit:${fit}`, label: fit })),
      })
    }
    
    if (filterOptions.feels.length > 0) {
      categories.push({
        id: "feel",
        label: "Feel",
        options: filterOptions.feels.map((feel) => ({ id: `feel:${feel}`, label: feel })),
      })
    }
    
    if (filterOptions.vibes.length > 0) {
      categories.push({
        id: "vibe",
        label: "Vibe",
        options: filterOptions.vibes.map((vibe) => ({ id: `vibe:${vibe}`, label: vibe })),
      })
    }
    
    return categories
  }, [filterOptions, selectableMoodboards])

  // --- FILTER HANDLERS ---
  const handleFilterApply = useCallback(
    (filterIds: string[]) => {
      if (isViewOnly) {
        return
      }
      search.setActiveFilterIds(filterIds)

      // Split out collection slugs — applied client-side, not sent to backend
      const collectionIds = filterIds.filter((id) => id.startsWith("collection:"))
      setActiveCollectionSlugs(collectionIds.map((id) => id.replace("collection:", "")))
      const backendIds = filterIds.filter((id) => !id.startsWith("collection:"))

      // Parse filter IDs to ProductSearchFilters format
      const filters: Record<string, string[]> = {}
      let minPrice: number | undefined
      let maxPrice: number | undefined

      backendIds.forEach((filterId) => {
        // Handle price filter specially: format is "price:min-max"
        if (filterId.startsWith('price:')) {
          const priceRange = filterId.split(':')[1]
          const [min, max] = priceRange.split('-')
          if (min) minPrice = parseInt(min, 10)
          if (max) maxPrice = parseInt(max, 10)
          return
        }

        const [category, value] = filterId.split(":")
        if (category && value) {
          if (!filters[category]) filters[category] = []
          filters[category].push(value)
        }
      })

      const parsedFilters = {
        genders: filters.gender,
        brands: filters.brand,
        typeSubCategories: filters.category,
        fits: filters.fit,
        feels: filters.feel,
        vibes: filters.vibe,
        minPrice,
        maxPrice,
      }
      search.setActiveFilters(parsedFilters)
    },
    [isViewOnly, search],
  )

  const handleFilterClearAll = useCallback(() => {
    if (isViewOnly) {
      return
    }
    search.setActiveFilterIds([])
    search.setActiveFilters({})
    setActiveCollectionSlugs([])
  }, [isViewOnly, search])

  const heroAvatarItems = useMemo(() => {
    if (!outfitData?.outfit) {
      return null
    }
    const mergedItems = mergeOutfitItemsWithTray(outfitData.outfit, resolvedTrayItems)
    return mergedItems.filter((item) => {
      const itemSlot = item.type === "top" || item.type === "bottom" || item.type === "shoes" ? item.type : null
      if (!itemSlot) {
        return true
      }
      return !hiddenSlots[itemSlot]
    })
  }, [hiddenSlots, outfitData?.outfit, resolvedTrayItems])

  const heroAvatar = outfitData?.outfit ? { ...outfitData.outfit, items: heroAvatarItems ?? outfitData.outfit.items } : null
  const { top: placeholderTop, bottom: placeholderBottom } = usePlaceholderItems(outfitData?.avatarGender ?? "female")
  const heroRenderedItems = useMemo<StudioRenderedItem[] | null>(() => {
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
        // stand-in, or the figure is bare there.
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
  
  // A removed slot has nothing to show. Gating the id is not enough: with no
  // id the hero hook falls back to the outfit's own piece for the slot, which
  // is exactly the one that was taken off.
  const heroProduct = hiddenSlots[slot] ? null : (localHero ?? heroProductQuery.data ?? null)
  const isHeroLoading = !heroProduct && heroProductQuery.isLoading
  const heroImagesQuery = useStudioProductImages(heroProduct?.productId ?? null)
  
  const outfitItems = useMemo(
    () => ({
      topId: hiddenSlots.top ? null : activeSlotIds.top ?? null,
      bottomId: hiddenSlots.bottom ? null : activeSlotIds.bottom ?? null,
      footwearId: hiddenSlots.shoes ? null : activeSlotIds.shoes ?? null,
    }),
    [activeSlotIds, hiddenSlots.bottom, hiddenSlots.shoes, hiddenSlots.top],
  )

  useStudioCombinationTracking({
    analytics,
    surface: analytics.state.surface,
    outfitId: resolvedOutfitId ?? null,
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

  // Only the owner's own outfit can be updated in place — updateOutfit's
  // WHERE clause matches on user_id, so trying this on someone else's (an
  // admin-curated look, another user's saved outfit) matches zero rows and
  // PostgREST throws "no rows returned". Viewing someone else's look and
  // hitting Save always makes a personal copy instead, same as before.
  const isOwnOutfit = Boolean(outfitData?.outfit && user?.id && outfitData.outfit.user_id === user.id)

  // Re-saving an already-persisted outfit with no item changes updates it in
  // place instead of spinning off a new copy — swapping an item, or changing
  // the stacking, makes a fresh derived look: a different picture is a different outfit.
  const isEditingExistingOutfit = Boolean(resolvedOutfitId && isOwnOutfit && !hasSlotOverrides && !orderChanged)

  // Saved state (heart, boards, tags) keys on the combo on screen, not the URL's base look.
  const { currentLookId } = useCurrentLookId({
    outfitId: resolvedOutfitId,
    hasSlotOverrides,
    orderChanged,
    topId: outfitItems.topId,
    bottomId: outfitItems.bottomId,
    shoesId: outfitItems.footwearId,
    layerOrder: parsedParams.layerOrder ?? null,
  })

  // The save row's tags win; an owned, never-saved base look falls back to its public tags.
  const savedLookTags = currentLookId ? getSavedTags("look", currentLookId) : []
  const lookInitialTags = savedLookTags.length
    ? savedLookTags
    : isOwnOutfit && !hasSlotOverrides ? (outfitData?.outfit?.tags ?? []) : []

  // The boards the current combo is really on right now, so the save
  // picker's default reflects truth instead of always assuming Favorites.
  const currentOutfitMoodboardSlugs = useMemo(() => {
    if (!currentLookId) return []
    return Object.entries(outfitMembershipQuery.data ?? {})
      .filter(([slug, ids]) => ids.has(currentLookId) && selectableMoodboards.some((m) => m.slug === slug))
      .map(([slug]) => slug)
  }, [currentLookId, outfitMembershipQuery.data, selectableMoodboards])

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
      layerOrder: parsedParams.layerOrder ?? null,
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
          topId: outfitItems.topId,
          bottomId: outfitItems.bottomId,
          shoesId: outfitItems.footwearId,
        },
      })
      await startLikenessFlow({ outfitItems, outfitSnapshot: outfitSnapshot ?? undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start try-on"
      toast({ title: "Try-on failed", description: message, variant: "destructive" })
    }
  }, [analytics, outfitItems, resolveTryOnSnapshot, startLikenessFlow, toast])

  const handleAvatarAreaClick = useCallback(() => {
    openStudio()
  }, [openStudio])


  /* -------------------------------------------------------------------------
   * Snapshot Hook
   * ----------------------------------------------------------------------- */
  const { snapshotRef, setAvatarReady, captureSnapshot } = useOutfitSnapshot({
    userId: user?.id ?? null,
  })
  // Find items opens over a still of the figure, so its scan runs on the look the user is seeing.
  const { captureRef, navigateWithFigure } = useFigureCapture()

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
            backgroundId: outfitData?.outfit?.backgroundId ?? null,
            isPrivate: data.isPrivate,
            tags: data.tags,
            createdByName: profile?.name ?? null,
            layerOrder: layerOrderToSave,
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
            gender: outfitData?.avatarGender ?? "female",
            tags: data.tags,
            isPrivate: data.isPrivate,
            createdByName: profile?.name ?? null,
            userId: user.id,
            backgroundId: outfitData?.outfit?.backgroundId ?? null,
            sourceOutfitId: (resolvedOutfitId && !hasSlotOverrides) ? resolvedOutfitId : null,
            layerOrder: layerOrderToSave,
          })
          outfitId = saved.id
          // Stand on the saved look from now on; the row holds the pieces and the stacking.
          if (saved.id !== resolvedOutfitId) {
            setSearchParams(buildStudioSearchParams({ outfitId: saved.id, slot, source, share: parsedParams.share }), { replace: true })
          }
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
          variant: hadCollectionError ? undefined : "success",
        })

        // Capture snapshot after save (non-blocking)
        console.log("[StudioAlternativesScreen] Starting snapshot capture for outfit:", outfitId)
        captureSnapshot(outfitId)
          .then((url) => {
            console.log("[StudioAlternativesScreen] Snapshot captured successfully:", url)
          })
          .catch((err) => {
            console.error("[StudioAlternativesScreen] Failed to capture outfit snapshot:", err)
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
      captureSnapshot,
      currentOutfitMoodboardSlugs,
      isEditingExistingOutfit,
      removeFromCollectionMutation,
      resolvedOutfitId,
      hasSlotOverrides,
      layerOrderToSave,
      parsedParams.share,
      setSearchParams,
      slot,
      source,
      selectableMoodboards,
      outfitData?.avatarGender,
      outfitData?.outfit?.backgroundId,
      outfitItems.bottomId,
      outfitItems.footwearId,
      outfitItems.topId,
      profile?.name,
      saveOutfitMutation,
      saveToCollectionMutation,
      toast,
      updateOutfitMutation,
      user?.id,
    ],
  )

  /** The card has no category or occasion fields, so carry the outfit's own. */
  const handleSaveFromCard = useCallback(
    async (data: { name: string; tags: string[]; boardSlugs: string[] }) => {
      if (isSavingLook) return
      setIsSavingLook(true)
      try {
        await handleSaveOutfit({
          outfitName: data.name,
          categoryId: outfitData?.outfit?.category ?? "",
          occasionId: outfitData?.outfit?.occasion?.id ?? "",
          tags: data.tags,
          isPrivate: false,
          moodboardIds: data.boardSlugs,
        })
        setIsSaveDrawerOpen(false)
      } catch {
        // handleSaveOutfit has already toasted; keep the card open to retry.
      } finally {
        setIsSavingLook(false)
      }
    },
    [handleSaveOutfit, isSavingLook, outfitData?.outfit?.category, outfitData?.outfit?.occasion?.id],
  )

  /** Product pins open the same card, boards and tags both. */
  const handleSaveProduct = useCallback(
    async (boardSlugs: string[], tags: string[] = []) => {
      if (!productSaveId) return
      try {
        await productSaveActions.onSaveToBoards(productSaveId, boardSlugs, tags)
        setProductSaveId(null)
        toast({ title: boardSlugs.length ? "Saved" : "Removed from boards" })
      } catch {
        // onSaveToBoards has already toasted; keep the card open to retry.
      }
    },
    [productSaveActions, productSaveId, toast],
  )

  const openProductSave = useCallback((productId: string) => {
    setIsSaveDrawerOpen(false)
    setProductSaveId(productId)
  }, [])

  // --- PASSIVE SELECTION: Grid item click updates avatar but NOT search ---
  const handleAlternativeSelect = useCallback(
    async (product: StudioAlternativeProduct) => {
      if (isViewOnly) {
        return
      }
      pendingSimilarSlotRef.current = null

      // Cold start: no outfit exists yet — create a draft outfit with this product then navigate into it
      if (!resolvedOutfitId && !isAdminMode) {
        if (!user?.id) return
        try {
          const draft = await createDraftOutfitMutation({
            userId: user.id,
            topId: slot === "top" ? product.id : null,
            bottomId: slot === "bottom" ? product.id : null,
            shoesId: slot === "shoes" ? product.id : null,
            gender: gender ?? "female",
            backgroundId: null,
            createdByName: profile?.name ?? null,
          })
          setSlotProductId(slot, product.id)
          const nextSlotIds: SlotIdMap = { top: null, bottom: null, shoes: null, [slot]: product.id }
          const params = buildStudioSearchParams({
            outfitId: draft.id,
            slot,
            slotIds: nextSlotIds,
            productId: product.id,
            share: parsedParams.share,
            layerOrder: parsedParams.layerOrder,
            // Wearing a piece un-hides its slot, as the normal branch does below.
            hiddenSlots: { ...parsedParams.hiddenSlots, [slot]: false },
            source,
          })
          setSearchParams(params, { replace: true })
        } catch {
          toast({ title: "Could not start outfit", description: "Please try again.", variant: "destructive" })
        }
        return
      }

      // Tapping the worn tile takes the piece off — the same hide as the × on the Studio row.
      if (resolvedOutfitId && !hiddenSlots[slot] && product.id === activeSlotIds[slot]) {
        const nextHiddenSlots = { ...parsedParams.hiddenSlots, [slot]: true }
        setPendingStudioComboChange({ change_type: "hide_slot", slot })
        setSearchParams(
          buildStudioSearchParams({
            outfitId: resolvedOutfitId,
            slot,
            slotIds: activeSlotIds,
            productId: product.id,
            share: parsedParams.share,
            layerOrder: parsedParams.layerOrder,
            hiddenSlots: nextHiddenSlots,
            source,
          }),
          { replace: true },
        )
        recordChange({
          outfitId: resolvedOutfitId,
          slotIds: {
            top: activeSlotIds.top ?? null,
            bottom: activeSlotIds.bottom ?? null,
            shoes: activeSlotIds.shoes ?? null,
          },
          hiddenSlots: {
            top: Boolean(nextHiddenSlots.top),
            bottom: Boolean(nextHiddenSlots.bottom),
            shoes: Boolean(nextHiddenSlots.shoes),
          },
          layerOrder: parsedParams.layerOrder ?? null,
        })
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
      const nextHiddenSlots = {
        ...parsedParams.hiddenSlots,
        [slot]: false,
      }

      const fromProductId = activeSlotIds[slot] ?? null
      const isUsingSearchResults = Boolean((search.hasActiveSearch || isAdminMode) && searchResultsQuery.data)
      const pending: Parameters<typeof setPendingStudioComboChange>[0] = {
        change_type: "swap",
        slot,
        from_product_id: fromProductId ?? undefined,
        to_product_id: product.id,
        results_mode: isUsingSearchResults ? "search" : "default",
      }

      if (pending.results_mode === "search") {
        pending.query_raw = search.committedText
        pending.filters = canonicalizeProductSearchFilters(search.activeFilters)
        pending.sort = "default"
      }

      setPendingStudioComboChange(pending)

      swapSlot(slot, product)
      setSlotProductId(slot, product.id)
      const nextSlotIds: SlotIdMap = {
        ...activeSlotIds,
        [slot]: product.id,
      }
      const params = buildStudioSearchParams({
        outfitId: resolvedOutfitId,
        slot: slot,
        slotIds: nextSlotIds,
        productId: product.id,
        share: parsedParams.share,
        layerOrder: parsedParams.layerOrder,
        hiddenSlots: nextHiddenSlots,
        source,
      })
      setSearchParams(params, { replace: true })
      recordChange({
        outfitId: resolvedOutfitId,
        slotIds: {
          top: nextSlotIds.top ?? null,
          bottom: nextSlotIds.bottom ?? null,
          shoes: nextSlotIds.shoes ?? null,
        },
        hiddenSlots: {
          top: Boolean(nextHiddenSlots?.top),
          bottom: Boolean(nextHiddenSlots?.bottom),
          shoes: Boolean(nextHiddenSlots?.shoes),
        },
        layerOrder: parsedParams.layerOrder ?? null,
      })
      // NOTE: Search does NOT update - grid stays static per spec (Passive Selection)
    },
    [
      activeSlotIds,
      hiddenSlots,
      isViewOnly,
      isAdminMode,
      recordChange,
      resolvedOutfitId,
      setSearchParams,
      setSlotProductId,
      search.activeFilters,
      search.committedText,
      search.hasActiveSearch,
      searchResultsQuery.data,
      slot,
      source,
      swapSlot,
      toast,
      parsedParams.hiddenSlots,
      parsedParams.share,
      createDraftOutfitMutation,
      user?.id,
      gender,
      profile?.name,
    ],
  )

  /**
   * Slot icon row. Search state per slot is resumed by the effect below.
   * `focus` rides along: the rebuilt query must keep (or, from a garment tap,
   * set) the zoom, and it has to be ONE write — a second setSearchParams in the
   * same tick starts from a stale copy and one of the two changes is lost.
   */
  const handleCategoryChange = useCallback(
    (category: StudioCanvasSlot, options: { focus?: StudioCanvasSlot | null } = {}) => {
      if (isViewOnly) {
        return
      }
      const nextSlot = toTraySlot(category)
      if (!isStudioSlot(nextSlot) || nextSlot === slot) {
        return
      }

      const nextSlotItem = resolvedTrayItems.find((item) => item.slot === nextSlot)
      const nextProductId = nextSlotItem?.productId ?? activeSlotIds[nextSlot] ?? null
      const nextSlotIds: SlotIdMap = {
        ...activeSlotIds,
        [nextSlot]: nextProductId,
      }

      const params = buildStudioSearchParams({
        outfitId: resolvedOutfitId,
        slot: nextSlot,
        productId: nextProductId,
        slotIds: nextSlotIds,
        share: parsedParams.share,
        layerOrder: parsedParams.layerOrder,
        hiddenSlots: parsedParams.hiddenSlots,
        source,
        focus: "focus" in options ? options.focus : parsedParams.focus,
      })
      // Entering focus pushes, so the back gesture returns to the rack.
      setSearchParams(params, { replace: !(options.focus && !parsedParams.focus) })
      // Search reset will happen via useEffect when slot changes
    },
    [
      activeSlotIds,
      isViewOnly,
      resolvedOutfitId,
      resolvedTrayItems,
      setSearchParams,
      slot,
      source,
      parsedParams.share,
      parsedParams.hiddenSlots,
      parsedParams.focus,
    ],
  )

  /**
   * Alternates means the whole slot, so returning to it clears any committed
   * text/image search. Without this a search you ran earlier stayed committed
   * and the tab quietly showed a filtered subset of the catalogue.
   */
  const handleSourceChange = useCallback(
    (next: StudioSource) => {
      if (isViewOnly) {
        return
      }
      // Explore means the whole slot again, so a committed search is dropped.
      if (next === "explore" && search.hasActiveSearch) {
        search.handleClearAll()
      }
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set("source", next)
          return params
        },
        { replace: true },
      )
    },
    [isViewOnly, search, setSearchParams],
  )


  /**
   * The piece card's ⟳ — more like this piece. Runs an image-embedding search
   * off the worn image and shows a clearable line above the rack.
   */
  const handleSimilarSearch = useCallback(() => {
    pendingSimilarSlotRef.current = slot
    seedPendingSimilar()
  }, [seedPendingSimilar, slot])

  /**
   * Product-level Find items, seeded with the worn piece's cutout; it opens on
   * web results, so the rack's web-search row shares it. Kicks are not a
   * detector category, so they take the blank import.
   */
  const handleFindItems = useCallback(() => {
    const image = heroProduct?.imageUrl ?? heroProduct?.thumbnailUrl
    const url = slot === "shoes" || !image
      ? "/inspiration-import"
      : `/inspiration-import?${new URLSearchParams({ source: image, slot }).toString()}`
    void navigateWithFigure(url)
  }, [heroProduct?.imageUrl, heroProduct?.thumbnailUrl, navigateWithFigure, slot])

  // A garment tap: zoom to that slot and show its rack state. Same slot → only
  // the zoom changes; a different slot → slot and zoom in one query write.
  const enterFocus = useCallback(
    (nextSlot: StudioCanvasSlot) => {
      if (toTraySlot(nextSlot) === slot) openFocus(nextSlot)
      else handleCategoryChange(nextSlot, { focus: nextSlot })
    },
    [handleCategoryChange, openFocus, slot],
  )
  // A garment tap only selects its slot; similarity stays behind the piece card's ⟳.
  const handleMannequinTap = useCallback(
    (tapped: StudioProductTraySlot) => {
      if (isViewOnly) return
      if (tapped !== slot) handleCategoryChange(tapped)
    },
    [handleCategoryChange, isViewOnly, slot],
  )
  const handleStepFocus = useCallback(
    (delta: number) => {
      const index = CANVAS_SLOTS.indexOf(slot)
      enterFocus(CANVAS_SLOTS[(index + delta + CANVAS_SLOTS.length) % CANVAS_SLOTS.length])
    },
    [enterFocus, slot],
  )

  /** The query line's × — back to the whole slot. */
  const handleClearQuery = useCallback(() => {
    if (isViewOnly) {
      return
    }
    search.handleClearAll()
  }, [isViewOnly, search])

  const { canRedo, canUndo, checkpointActive, redo, toggleCheckpoint, undo } = studioHistory

  const historyControls = [
    {
      id: "undo",
      label: "Undo",
      icon: Undo2,
      disabled: isViewOnly || !canUndo,
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
  ]

  const lookControls = [
    {
      id: "checkpoint",
      label: checkpointActive ? "Back to your edits" : "Back to the original look",
      icon: RotateCcw,
      disabled: isViewOnly,
      active: checkpointActive,
      onClick: () => {
        setPendingStudioComboChange({ change_type: "checkpoint" })
        toggleCheckpoint()
      },
    },
    {
      // The redesign dropped the hero panel and the peek card, which were the
      // only two things that opened the save UI. It lives here now, and opens
      // the same card Studio uses, in place of the piece card below.
      id: "save",
      label: "Save this look",
      icon: Icons.save,
      disabled: isViewOnly,
      active: currentOutfitMoodboardSlugs.length > 0,
      filled: currentOutfitMoodboardSlugs.length > 0,
      onClick: () => {
        setProductSaveId(null)
        setSaveCardKey((key) => key + 1)
        setIsSaveDrawerOpen(true)
      },
    },
  ]

  const heroTitle = hiddenSlots[slot]
    ? "Nothing worn here"
    : (heroProduct?.title ?? focusedItem?.product_name ?? focusedItem?.brand ?? "Selected piece")
  const heroPrice = heroProduct?.price ?? focusedItem?.price ?? 0

  const heroAttributes = useMemo(() => getTrayItemTags(heroProduct), [heroProduct])

  // The tile's own thumbnail, already in the browser cache, stands in until the retailer photos land.
  const heroImages = useMemo(
    () =>
      hiddenSlots[slot]
        ? []
        : toDisplayImages(heroImagesQuery.data, heroProduct?.thumbnailUrl ?? heroProduct?.imageUrl),
    [heroImagesQuery.data, heroProduct?.imageUrl, heroProduct?.thumbnailUrl, hiddenSlots, slot],
  )

  // The figure changes at once; the card blanks and reveals the new piece whole — see useStagedPiece.
  const { piece, isStaging } = useStagedPiece({
    productId: heroProduct?.productId ?? null,
    title: heroTitle,
    images: heroImages,
    attributes: heroAttributes,
    saved: heroProduct ? productSaveActions.isSaved(heroProduct.productId) : false,
    ready: Boolean(heroProduct) && !heroImagesQuery.isPending,
  })
  const isCardLoading = isStaging || isHeroLoading

  const queryLine = useMemo(() => {
    if (search.committedText) return `"${search.committedText}"`
    if (search.committedImageUrl) {
      const isSeededByWornPiece =
        search.committedImageUrl === currentSlotImageUrl || search.committedImageUrl === seedRef.current[slot]?.imageUrl
      return isSeededByWornPiece ? "Similar to this item" : "Similar to your photo"
    }
    return null
  }, [currentSlotImageUrl, search.committedImageUrl, search.committedText, slot])

  const emptyLabel =
    source === "wardrobe"
      ? "Your wardrobe is empty"
      : source === "saves"
        ? "Nothing saved in this slot"
        : "No results found"

  // The URL's `layers` when the user dragged the rows in Studio, else the row's stored order, else
  // the worn top's kind decides.
  const heroSlotOrder = useMemo(() => {
    if (parsedParams.layerOrder) return parsedParams.layerOrder
    if (rowLayerOrder) return rowLayerOrder
    const wornTop = hiddenSlots.top ? null : resolvedTrayItems.find((item) => item.slot === "top")
    return defaultLayerOrder({ typeCategory: wornTop?.typeCategory, productName: wornTop?.title })
  }, [hiddenSlots.top, parsedParams.layerOrder, resolvedTrayItems, rowLayerOrder])

  // One figure for both layouts: the split (with the rack) and focus.
  const figureNode = (
      <div className="absolute inset-0 flex items-end justify-center pb-3">
      {heroAvatar && !isLoadingOverrides ? (
        <OutfitInspirationTile
          preset="heroCanonical"
          outfitId={outfitData?.studioOutfit?.id ?? heroAvatar.id}
          renderedItems={heroRenderedItems ?? outfitData?.studioOutfit?.renderedItems}
          slotOrder={heroSlotOrder}
          fallbackImageSrc={
            hiddenSlots.top || hiddenSlots.bottom || hiddenSlots.shoes
              ? heroRenderedItems?.[0]?.imageUrl ?? heroAvatar.items[0]?.imageUrl
              : outfitData?.studioOutfit?.imageSrcFallback ??
                heroRenderedItems?.[0]?.imageUrl ??
                heroAvatar.items[0]?.imageUrl
          }
          title={outfitData?.studioOutfit?.name ?? heroAvatar.name ?? ""}
          chips={[]}
          isSaved={false}
          avatarHeadSrc={outfitData?.avatarHeadSrc ?? undefined}
          avatarGender={outfitData?.avatarGender ?? "female"}
          avatarHeightCm={outfitData?.avatarHeightCm ?? 170}
          cardClassName="h-full w-full"
          allowEmptyMannequin={isAdminMode || !STUDIO_BASE_ITEMS_ENABLED}
          // A garment tap seeds the rack with that piece; inside the focus view it only moves the zoom.
          onItemSelect={(item) => {
            if (!isStudioSlot(item.type)) return
            if (focus) enterFocus(item.type)
            else handleMannequinTap(item.type)
          }}
          onAvatarReady={setAvatarReady}
          avatarRef={snapshotRef}
          captureRef={captureRef}
        />
      ) : (isAdminMode && !resolvedOutfitId) ? (
        <OutfitInspirationTile
          preset="heroCanonical"
          outfitId="temp-admin-outfit"
          renderedItems={heroRenderedItems || []}
          slotOrder={heroSlotOrder}
          fallbackImageSrc={heroRenderedItems?.[0]?.imageUrl ?? undefined}
          title="New Outfit"
          chips={[]}
          isSaved={false}
          avatarGender={adminGender || "female"}
          avatarHeightCm={170}
          cardClassName="h-full w-full"
          allowEmptyMannequin
          onItemSelect={(item) => {
            if (!isStudioSlot(item.type)) return
            if (focus) enterFocus(item.type)
            else handleMannequinTap(item.type)
          }}
          onSlotSelect={(nextSlot) => handleCategoryChange(nextSlot)}
          onAvatarReady={setAvatarReady}
          avatarRef={snapshotRef}
          captureRef={captureRef}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-3 text-center text-body text-taupe">
          {isOutfitLoading || isLoadingOverrides ? "Loading outfit…" : "Select an outfit to view alternatives"}
        </div>
      )}
      </div>
  )

  return (
    <>
      {/* header 52 · (figure | rack) · piece card 225. No tab bar here, so the
          frame takes the full height; the tray is Studio's 170 plus the 55 the
          bar would take, so its top edge sits exactly where it does on Studio
          and it runs to the bottom of the screen with nothing under it. */}
      <div className="flex justify-center overflow-hidden bg-background" style={{ height: "100dvh" }}>
        {/* No 844 cap here, unlike the other frames: with the tab bar gone this
            screen owns the height, and capping it would centre the frame and
            leave the freed strip as empty margin. The figure/rack row is
            `flex-1`, so the extra goes to the rack instead. */}
        <div className="relative flex h-full w-full max-w-sm flex-col overflow-hidden">
          <AlternatesHeader
            source={source}
            onSourceChange={handleSourceChange}
            onBack={handleBack}
            isReadOnly={isViewOnly}
          />

          {focus ? (
            <>
              {/* Focus: Studio's own view — full-width zoomed figure, then the piece
                  card. The rack is collapsed; back returns to it. */}
              <StudioCanvas
                figure={figureNode}
                focus={focus}
                onStepFocus={handleStepFocus}
                historyControls={historyControls}
                lookControls={lookControls}
                className="border-b border-hairline"
              />
              {productSaveId ? (
                <div className="box-border flex h-[225px] flex-none flex-col px-4 py-2.5">
                  <StudioSaveCard
                    key={`${productSaveId}:${getTrayItemTags(heroProduct).join("|")}:${productSaveActions.getSavedProductTags(productSaveId).join("|")}`}
                    kind="piece"
                    className="h-full"
                    defaultName={heroTitle}
                    tagOptions={getTrayItemTags(heroProduct)}
                    initialTags={productSaveActions.getSavedProductTags(productSaveId)}
                    boards={selectableMoodboards.map((m) => ({ slug: m.slug, label: m.label }))}
                    defaultBoardSlugs={
                      productSaveActions.getProductBoardSlugs(productSaveId).length
                        ? productSaveActions.getProductBoardSlugs(productSaveId)
                        : ["favorites"]
                    }
                    isSaving={productSaveActions.isSaving}
                    onSave={(data) => void handleSaveProduct(data.boardSlugs, data.tags)}
                    onCancel={() => setProductSaveId(null)}
                    onCreateBoard={(name) =>
                      createMoodboardMutation.mutateAsync(name).then((res) => res.slug)
                    }
                  />
                </div>
              ) : (
                <StudioFocusSheet
                  slot={focus}
                  title={piece.title}
                  images={piece.images}
                  attributes={piece.attributes}
                  saved={piece.saved}
                  isLoading={isCardLoading}
                  pieceKey={piece.productId ?? "none"}
                  isReadOnly={isViewOnly}
                  onSave={heroProduct ? () => openProductSave(heroProduct.productId) : undefined}
                  onTryOn={handleTryOn}
                  onFindItems={handleFindItems}
                  onOpenAlternatives={closeFocus}
                  onStep={handleStepFocus}
                />
              )}
            </>
          ) : (
            <>
          {/* `relative`: the search button and its open bar both anchor here, so
              expanding keeps the field on the line the button sat on. */}
          <div className="relative flex min-h-0 flex-1 border-b border-hairline">
            {/* Figure half. Same rail and control stacks as the canvas — the
                category icons live here, not in a second horizontal rail. */}
            <StudioCanvas
              compact
              className="w-1/2 flex-none border-r border-hairline"
              focus={null}
              historyControls={historyControls}
              lookControls={lookControls}
              figure={figureNode}
            />

            {/* Rack half. */}
            <div className="relative flex w-1/2 min-w-0 flex-none flex-col border-l border-hairline">
              <SlotIconRow
                slots={CANVAS_SLOTS}
                active={slot}
                onSelect={handleCategoryChange}
                isReadOnly={isViewOnly}
              />

              <AlternatesRack
                products={rackProducts}
                isLoading={isLoading}
                wornProductId={hiddenSlots[slot] ? null : activeSlotIds[slot] ?? null}
                queryLine={queryLine}
                onClearQuery={handleClearQuery}
                emptyLabel={emptyLabel}
                onAddToWardrobe={source === "wardrobe" ? () => navigate("/inspiration-import?intent=wardrobe") : undefined}
                showWebSearch={source === "explore"}
                onWebSearch={handleFindItems}
                onSelect={isViewOnly ? undefined : (product) => void handleAlternativeSelect(product)}
              />

              {isSearchOpen ? null : (
                <AlternatesSearchButton onOpen={() => setIsSearchOpen(true)} isReadOnly={isViewOnly} />
              )}
            </div>

            {isSearchOpen ? (
              <AlternatesSearchBar
                value={search.draftText}
                onValueChange={search.setDraftText}
                onSubmit={search.handleSubmit}
                onClose={() => setIsSearchOpen(false)}
                onClear={search.handleClearDraftText}
                placeholder={`Search ${SLOT_DISPLAY_LABELS[slot].toLowerCase()}`}
                thumbSrc={search.draftImageUrl}
                onClearThumb={search.handleClearImage}
                onOpenImagePicker={() => setIsReferenceDialogOpen(true)}
              />
            ) : null}
          </div>

          {/* The piece card, with the similarity corner in place of the 4-square.
              225 — Studio's focus card, sized as above. Both save cards take its
              place at the same height, so the figure never moves. */}
          <div className="box-border flex h-[225px] flex-none flex-col px-4 py-2.5">
            {isSaveDrawerOpen || productSaveId ? (
              isSaveDrawerOpen ? (
              <StudioSaveCard
                key={saveCardKey}
                isSaving={isSavingLook}
                className="h-full"
                defaultName={
                  outfitData?.outfit?.name?.startsWith("draft-look-")
                    ? `${profile?.name ?? "Your"}'s Look #${String(Date.now()).slice(-4)}`
                    : (outfitData?.outfit?.name ?? "")
                }
                tagOptions={getOutfitTagsFromItems(resolvedTrayItems)}
                initialTags={lookInitialTags}
                boards={selectableMoodboards.map((m) => ({ slug: m.slug, label: m.label }))}
                defaultBoardSlugs={
                  currentOutfitMoodboardSlugs.length ? currentOutfitMoodboardSlugs : ["favorites"]
                }
                pieceCount={Object.values(activeSlotIds).filter(Boolean).length}
                onSave={(data) => void handleSaveFromCard(data)}
                onCancel={() => setIsSaveDrawerOpen(false)}
                onCreateBoard={(name) =>
                  createMoodboardMutation.mutateAsync(name).then((res) => res.slug)
                }
              />
              ) : (
              <StudioSaveCard
                key={`${productSaveId}:${getTrayItemTags(heroProduct).join("|")}:${productSaveActions.getSavedProductTags(productSaveId).join("|")}`}
                kind="piece"
                className="h-full"
                defaultName={heroTitle}
                tagOptions={getTrayItemTags(heroProduct)}
                initialTags={productSaveActions.getSavedProductTags(productSaveId!)}
                boards={selectableMoodboards.map((m) => ({ slug: m.slug, label: m.label }))}
                defaultBoardSlugs={
                  productSaveActions.getProductBoardSlugs(productSaveId!).length
                    ? productSaveActions.getProductBoardSlugs(productSaveId!)
                    : ["favorites"]
                }
                isSaving={productSaveActions.isSaving}
                onSave={(data) => void handleSaveProduct(data.boardSlugs, data.tags)}
                onCancel={() => setProductSaveId(null)}
                onCreateBoard={(name) =>
                  createMoodboardMutation.mutateAsync(name).then((res) => res.slug)
                }
              />
              )
            ) : (
            <ProductSheet
              title={piece.title}
              images={piece.images}
              slot={slot}
              attributes={piece.attributes}
              carousel="left"
              mediaSize={176}
              cropToContent
              corner="similar"
              onCorner={handleSimilarSearch}
              actions={isViewOnly ? "none" : "icons"}
              saved={piece.saved}
              onSave={heroProduct ? () => openProductSave(heroProduct.productId) : undefined}
              onTryOn={handleTryOn}
              onFindItems={handleFindItems}
              isLoading={isCardLoading}
              revealKey={piece.productId ?? "none"}
              className="h-[205px]"
            />
            )}
          </div>
            </>
          )}


          <ReferenceImageDialog
            open={isReferenceDialogOpen}
            onOpenChange={setIsReferenceDialogOpen}
            wornImageUrl={currentSlotImageUrl}
            attachedImageUrl={search.draftImageUrl}
            isUploading={search.isUploadingImage}
            onPickFile={(file) => void search.handleImageUpload(file)}
            onApply={(imageUrl) => {
              if (imageUrl) search.seedDraftImage(imageUrl)
            }}
          />
        </div>
      </div>

      <FilterDrawer
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        categories={filterCategories}
        activeFilters={search.activeFilterIds}
        onApply={handleFilterApply}
        onClearAll={handleFilterClearAll}
      />
    </>
  )

}

export function StudioAlternativesScreen() {
  return <StudioAlternativesView />
}

export default StudioAlternativesScreen
