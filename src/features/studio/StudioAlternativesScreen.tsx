import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ChevronLeft, RefreshCw, Search, Sparkles } from "lucide-react"
import { useOutfitSnapshot } from "@/features/outfits/hooks/useOutfitSnapshot"

import {
  FilterSearchBar,
  IconButton,
  MoodboardPickerDrawer,
  SaveOutfitDrawer,
  OutfitInspirationTile,
  type FilterCategory,
} from "@/design-system/primitives"
import { ProductPeekCard } from "./components/ProductPeekCard"
import { RackGrid } from "./components/RackGrid"
import { RackHeader, type RackMode } from "./components/RackHeader"
import { WearingCard } from "./components/WearingCard"
import { CategoryId } from "@/design-system/primitives/category-filter-bar"
import { cn } from "@/lib/utils"
import { useStudioContext } from "./context/StudioContext"
import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useStudioHeroProduct } from "@/features/studio/hooks/useStudioHeroProduct"
import { useStudioAlternatives } from "@/features/studio/hooks/useStudioAlternatives"
import { useStudioSwapActions } from "@/features/studio/hooks/useStudioSwapActions"
import { useStudioSearch } from "@/features/studio/hooks/useStudioSearch"
import { useStudioSearchResults } from "@/features/studio/hooks/useStudioSearchResults"
import { useProductFilterOptions } from "@/features/search/hooks/useProductFilterOptions"
import type { StudioAlternativeProduct, StudioProductTraySlot } from "@/services/studio/studioService"
import { useStudioResolvedSlots } from "@/features/studio/hooks/useStudioResolvedSlots"
import { isPlaceableOnMannequin, shouldFilterSlotByPlacement } from "@/features/studio/utils/placementSupport"
import { mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import { mapTrayItemToProductDetail } from "@/services/studio/studioService"
import { useSaveOutfit } from "@/features/outfits/hooks/useSaveOutfit"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useFindOutfitByItems } from "@/features/outfits/hooks/useFindOutfitByItems"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useMoodboards, useCreateMoodboard, useSaveToCollection, useProductCollectionMembership } from "@/features/collections/hooks/useMoodboards"
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
} from "@/features/studio/utils/studioUrlState"
import { useToast } from "@/hooks/use-toast"
import type { Database } from "@/integrations/supabase/types"
import { useStudioHistory } from "@/features/studio/hooks/useStudioHistory"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { mergeOutfitItemsWithTray } from "@/features/studio/utils/mergeOutfitItemsWithTray"
import { useOptionalAdminGender } from "@/features/admin/providers/AdminGenderContext"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackProductBuyClicked } from "@/integrations/posthog/engagementTracking/entityEvents"
import { canonicalizeProductSearchFilters } from "@/integrations/posthog/engagementTracking/searchCanonical"
import { setPendingStudioComboChange, useStudioCombinationTracking } from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import { trackTryonFlowStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"
import { useStudioTourContext } from "./context/StudioTourContext"

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
  const { recordChange } = useStudioHistory()
  const { isViewOnly } = useStudioShareMode()
  const productSaveActions = useProductSaveActions()
  const tour = useStudioTourContext()

  const { selectedOutfitId, focusedItem, openProduct, openStudio, slotProductIds, setSlotProductId } = useStudioContext()

  // Sync tour step
  useEffect(() => {
    if (!tour.isActive) return 
    const stepId = tour.getCurrentStep()?.id

    // On this screen the tour should be on 'alternatives'. Stepping back to
    // 'mannequin' means the user belongs in the studio again.
    // ('full-screen' and 'product-details' used to appear here — neither is a
    // real step id any more; 'product-details' never was one at all.)
    if (stepId === "mannequin") {
      openStudio()
    }
  }, [tour, openStudio])
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
  const { mutateAsync: createDraftOutfitMutation } = useCreateDraftOutfit()
  const { mutateAsync: findOutfitByItemsMutation } = useFindOutfitByItems()
  const { mutateAsync: saveToCollectionMutation } = useSaveToCollection()
  const { data: moodboards = [], isLoading: moodboardsLoading } = useMoodboards()
  const selectableMoodboards = useMemo(() => moodboards.filter((m) => !m.isSystem), [moodboards])
  const productCollectionMembership = useProductCollectionMembership()
  const [activeCollectionSlugs, setActiveCollectionSlugs] = useState<string[]>([])
  const createMoodboardMutation = useCreateMoodboard()
  const { user } = useAuth()
  const { profile, gender } = useProfileContext()
  const [isSaveDrawerOpen, setIsSaveDrawerOpen] = useState(false)
  // 7e — the peek sheet over the dimmed studio.
  const [isPeekOpen, setIsPeekOpen] = useState(false)
  
  // Detect admin mode for direct save
  const adminGender = useOptionalAdminGender()
  const isAdminMode = adminGender !== null

  // Sort state - default to similarity
  const [sortValue, setSortValue] = useState<string>("similarity")

  // Sort options - only 3 needed
  const sortOptions = useMemo(() => [
    { value: "similarity", label: "Similarity" },
    { value: "price-low-to-high", label: "Price: Low to High" },
    { value: "price-high-to-low", label: "Price: High to Low" },
  ], [])

  // --- PANEL RESIZE STATE ---
  type PanelMode = "split" | "right-full"
  const [panelMode, setPanelMode] = useState<PanelMode>("split")
  const containerRef = useRef<HTMLDivElement>(null)
  const splitRatio = 50 // Fixed 50-50 layout

  const restoreSplit = useCallback(() => {
    setPanelMode("split")
  }, [])
  const handleBack = useCallback(() => {
    if (decodedReturnTo) {
      navigate(decodedReturnTo)
      return
    }
    openStudio()
  }, [decodedReturnTo, navigate, openStudio])

  const { swapSlot } = useStudioSwapActions(resolvedOutfitId)
  const { data: outfitData, isLoading: isOutfitLoading } = useStudioOutfit(resolvedOutfitId)
  const heroProductId = parsedParams.productId ?? slotProductIds[slot] ?? null
  const heroProductQuery = useStudioHeroProduct(resolvedOutfitId, slot, heroProductId)
  
  // The rack's default source: the whole catalogue for this slot.
  const fallbackAlternativesQuery = useStudioAlternatives(resolvedOutfitId, slot)

  const requestedSlotIds = parsedParams.slotIds

  const { trayItems: resolvedTrayItems } = useStudioResolvedSlots({
    outfitId: resolvedOutfitId,
    baseOutfitItems: outfitData?.trayItems ?? [],
    requestedSlotIds,
  })

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

  // --- INITIALIZATION FLOW: Auto-search on mount or tab change ---
  useEffect(() => {
    // Auto image-similarity (embedding) search is disabled for now — we always seed with no image so
    // the grid shows all products for the slot (fallback query) instead of the "N results for image
    // search" set. Re-enable later by passing `currentSlotImageUrl` again. Manual text search still works.
    if (prevSlotRef.current !== slot) {
      search.resetForSlot(slot, null, isAdminMode)
      prevSlotRef.current = slot
    } else if (!isInitializedRef.current) {
      isInitializedRef.current = true
      search.resetForSlot(slot, null, isAdminMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, currentSlotImageUrl, isAdminMode])

  // --- SEARCH RESULTS QUERY ---
  const searchResultsQuery = useStudioSearchResults({
    slot,
    query: search.committedText,
    imageUrl: search.committedImageUrl,
    productId: searchProductId,
    filters: search.activeFilters,
    gender: adminGender ?? gender,
    allowEmptySearch: isAdminMode || isColdStart, // Allow fetching all items on cold start or in admin mode
  })

  // Determine which products to show and apply sorting
  const alternativeProducts = useMemo(() => {
    // In admin mode, we always use search results (which supports empty query)
    // In normal mode, we use search results only if there is an active search
    const shouldUseSearchResults = (search.hasActiveSearch || isAdminMode || isColdStart) && searchResultsQuery.data

    const products = shouldUseSearchResults
      ? [...searchResultsQuery.data]
      : [...(fallbackAlternativesQuery.data ?? [])]

    // Apply client-side sorting
    switch (sortValue) {
      case 'price-low-to-high':
        products.sort((a, b) => a.price - b.price)
        break
      case 'price-high-to-low':
        products.sort((a, b) => b.price - a.price)
        break
      case 'similarity':
      default:
        break
    }

    // Pin the currently selected product to the front so it's always visible as first item
    const selectedId = activeSlotIds[slot]
    if (selectedId) {
      const selectedIdx = products.findIndex((p) => p.id === selectedId)
      if (selectedIdx > 0) {
        const [selected] = products.splice(selectedIdx, 1)
        products.unshift(selected)
      }
    }

    return products
  }, [search.hasActiveSearch, searchResultsQuery.data, fallbackAlternativesQuery.data, sortValue, activeSlotIds, slot])

  // Client-side collection/moodboard filter. Kept live: activeCollectionSlugs
  // only fills from the ≡ chips, so it narrows nothing unless asked.
  const filteredAlternativeProducts = useMemo(() => {
    if (activeCollectionSlugs.length === 0) return alternativeProducts
    const memberMap = productCollectionMembership.data ?? {}
    return alternativeProducts.filter((p) =>
      activeCollectionSlugs.some((slug) => memberMap[slug]?.has(p.id))
    )
  }, [alternativeProducts, activeCollectionSlugs, productCollectionMembership.data])

  const isLoading = search.hasActiveSearch
    ? searchResultsQuery.isLoading
    : fallbackAlternativesQuery.isLoading

  // 7c's rack modes. Each is a different question about the same slot, so they
  // share one product list rather than four query paths.
  const [rackMode, setRackMode] = useState<RackMode>("alternates")

  const rackProducts = useMemo(() => {
    if (rackMode === "yours") {
      return []
    }

    // Drop anything the photoreal mannequin cannot actually wear — see
    // isPlaceableOnMannequin. Applied to footwear only for now.
    const mannequin = (outfitData?.avatarGender ?? adminGender ?? gender ?? "female") as "male" | "female"
    const placeable = shouldFilterSlotByPlacement(slot)
      ? filteredAlternativeProducts.filter((product) => isPlaceableOnMannequin(product, mannequin))
      : filteredAlternativeProducts

    if (rackMode === "saves") {
      return placeable.filter((product) => productSaveActions.isSaved(product.id))
    }
    return placeable
  }, [
    adminGender,
    filteredAlternativeProducts,
    gender,
    outfitData?.avatarGender,
    productSaveActions,
    rackMode,
    slot,
  ])

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

  // --- SORT HANDLER ---
  const handleSortChange = useCallback((value: string) => {
    if (isViewOnly) {
      return
    }
    console.log('[StudioSearch] Sort changed to:', value)
    setSortValue(value)
  }, [isViewOnly])

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
  
  const heroProduct = heroProductQuery.data ?? null
  
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

  /**
   * Canvas 7e. This used to jump straight to /studio/product/:id — a route
   * change out of the studio just to read a fabric line. The peek is the
   * halfway stop; its own "Full details" still escalates to the page.
   */
  const handleHeroDetails = useCallback(() => {
    if (!heroProduct && !focusedItem?.id) {
      return
    }
    setIsPeekOpen(true)
  }, [focusedItem?.id, heroProduct])

  const handlePeekDetails = useCallback(() => {
    setIsPeekOpen(false)
    const productId = heroProduct?.productId ?? focusedItem?.id
    if (!productId) {
      return
    }
    if (heroProduct) {
      openProduct(productId, { initialProduct: mapTrayItemToProductDetail(heroProduct) })
      return
    }
    openProduct(productId)
  }, [focusedItem?.id, heroProduct, openProduct])

  const handleBuyClick = useCallback(() => {
    if (isViewOnly) {
      return
    }
    if (heroProduct?.productUrl) {
      trackProductBuyClicked(analytics, { entity_id: heroProduct.productId })
      window.open(heroProduct.productUrl, "_blank", "noopener,noreferrer")
    }
  }, [analytics, heroProduct?.productId, heroProduct?.productUrl, isViewOnly])

  /* -------------------------------------------------------------------------
   * Snapshot Hook
   * ----------------------------------------------------------------------- */
  const { snapshotRef, setAvatarReady, captureSnapshot } = useOutfitSnapshot({
    userId: user?.id ?? null,
  })

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
          sourceOutfitId: (resolvedOutfitId && !hasSlotOverrides) ? resolvedOutfitId : null,
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
          variant: hadCollectionError ? undefined : "success",
        })

        // Capture snapshot after save (non-blocking)
        console.log("[StudioAlternativesScreen] Starting snapshot capture for outfit:", saved.id)
        captureSnapshot(saved.id)
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
      user?.id,
    ],
  )

  // --- PASSIVE SELECTION: Grid item click updates avatar but NOT search ---
  const handleAlternativeSelect = useCallback(
    async (product: StudioAlternativeProduct) => {
      if (isViewOnly) {
        return
      }

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
            hiddenSlots: parsedParams.hiddenSlots,
          })
          setSearchParams(params, { replace: true })
        } catch {
          toast({ title: "Could not start outfit", description: "Please try again.", variant: "destructive" })
        }
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
      // If right panel is full, restore to split view
      if (panelMode === "right-full") {
        restoreSplit()
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
        pending.sort = sortValue || "default"
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
        hiddenSlots: nextHiddenSlots,
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
      })
      // NOTE: Search does NOT update - grid stays static per spec (Passive Selection)
    },
    [
      activeSlotIds,
      isViewOnly,
      isAdminMode,
      panelMode,
      recordChange,
      resolvedOutfitId,
      restoreSplit,
      setSearchParams,
      setSlotProductId,
      search.activeFilters,
      search.committedText,
      search.hasActiveSearch,
      searchResultsQuery.data,
      slot,
      sortValue,
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

  // --- TAB CHANGE: Reset search and trigger initialization flow ---
  const handleCategoryChange = useCallback(
    (category: CategoryId) => {
      if (isViewOnly) {
        return
      }
      if (category === "others") {
        // Toggle between split and right-full panel modes
        if (panelMode === "split") {
          setPanelMode("right-full")
        } else {
          restoreSplit()
        }
        return
      }

      // Tab switching always works, even on cold start (no outfit yet)

      const nextSlot = category
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
        hiddenSlots: parsedParams.hiddenSlots,
      })
      setSearchParams(params, { replace: true })
      // Search reset will happen via useEffect when slot changes
    },
    [
      activeSlotIds,
      isViewOnly,
      panelMode,
      resolvedOutfitId,
      resolvedTrayItems,
      restoreSplit,
      setSearchParams,
      slot,
      parsedParams.share,
      parsedParams.hiddenSlots,
    ],
  )

  /**
   * Alternates means the whole slot, so returning to it clears any committed
   * text/image search. Without this a search you ran earlier stayed committed
   * and the tab quietly showed a filtered subset of the catalogue.
   */
  const handleRackModeChange = useCallback(
    (next: RackMode) => {
      setRackMode(next)
      if (next === "alternates" && search.hasActiveSearch) {
        search.resetForSlot(slot, null, isAdminMode)
      }
    },
    [isAdminMode, search, slot],
  )


  /**
   * ⟳ — back to the full catalogue for this slot.
   *
   * This used to fire an image-embedding search against the worn piece, so the
   * one "reset"-looking control on the screen actually *narrowed* the rack to a
   * few dozen lookalikes, and nothing put it back. Image similarity can return
   * when it earns its place; until then this clears text, image and filters.
   */
  const handleForceSearch = useCallback(() => {
    if (isViewOnly) {
      return
    }
    if (panelMode === "right-full") {
      restoreSplit()
    }
    setRackMode("alternates")
    search.resetForSlot(slot, null, isAdminMode)
  }, [isAdminMode, isViewOnly, panelMode, restoreSplit, search, slot])

  const heroTitle = heroProduct?.title ?? focusedItem?.product_name ?? focusedItem?.brand ?? "Selected piece"
  const heroPrice = heroProduct?.price ?? focusedItem?.price ?? 0

  // Always show refresh icon for force search with current avatar item
  const trailingAction = useMemo(() => {
    return {
      id: "force-search",
      ariaLabel: "Show everything in this slot",
      icon: <RefreshCw className="h-4 w-4" />,
      onClick: handleForceSearch,
    }
  }, [handleForceSearch])

  return (
    <>
    {/* Both columns and the search bar live inside one centred frame, which is
        what lets the bar dock "under both columns" rather than being pinned to
        the viewport.
        Unlike 7a, the frame is NOT held at the 390px phone width. 7a has one
        column; this has two side by side, so a phone-width frame gives each
        pane ~190px and the rack collapses to two cramped cards. It grows with
        the viewport instead — the cards stay a readable size and the rack simply
        fits more of them per row. */}
    <div
      className="flex justify-center overflow-hidden bg-background"
      style={{ height: "calc(100dvh - 2.5rem)" }}
    >
      <div className="relative my-auto flex h-full max-h-[844px] w-full max-w-sm flex-col overflow-hidden px-2.5 md:max-h-[900px] md:max-w-3xl md:px-4 lg:max-w-5xl">
        <header className="flex shrink-0 items-center pt-2">
          <IconButton
            tone="ghost"
            size="xs"
            aria-label="Back"
            onClick={handleBack}
            className="-ml-1"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </IconButton>
          <span className="flex-1 truncate text-center text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:text-[11px]">
            Alternates · Split
          </span>
          {/* Spacer keeps the label optically centred; ⤢ lives on the rack. */}
          <span className="size-7 shrink-0" aria-hidden="true" />
        </header>

        <div ref={containerRef} className="flex min-h-0 flex-1 gap-2 pt-2 md:gap-3 md:pt-3">
        {/* Left Panel - Outfit Preview */}
        {panelMode !== "right-full" && (
          /* Split view - left panel */
          <section
            className="flex h-full min-h-0 flex-none flex-col gap-2 transition-all duration-200"
            style={{
              width: `${splitRatio}%`,
            }}
          >

            <div
              className="bg-warp-grid relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-hairline bg-card"
            >
              <div
                className="absolute inset-0 flex items-end justify-center bg-transparent"
              >
                {heroAvatar ? (
                  <OutfitInspirationTile
                    preset="heroCanonical"
                    outfitId={outfitData?.studioOutfit?.id ?? heroAvatar.id}
                    renderedItems={heroRenderedItems ?? outfitData?.studioOutfit?.renderedItems}
                    fallbackImageSrc={
                      hiddenSlots.top || hiddenSlots.bottom || hiddenSlots.shoes
                        ? heroRenderedItems?.[0]?.imageUrl ?? heroAvatar.items[0]?.imageUrl
                        : outfitData?.studioOutfit?.imageSrcFallback ??
                          heroRenderedItems?.[0]?.imageUrl ??
                          heroAvatar.items[0]?.imageUrl
                    }
                    title={outfitData?.studioOutfit?.name ?? heroAvatar.name ?? ""}
                    chips={[
                      outfitData?.studioOutfit?.fit ?? heroAvatar.fit,
                      outfitData?.studioOutfit?.feel ?? heroAvatar.feel,
                    ].filter(Boolean) as string[]}
                    // attribution={resolveOutfitAttribution(heroAvatar.created_by)}
                    isSaved={false}
                    avatarHeadSrc={outfitData?.avatarHeadSrc ?? undefined}
                    avatarGender={outfitData?.avatarGender ?? "female"}
                    avatarHeightCm={outfitData?.avatarHeightCm ?? 170}
                    cardClassName="h-full w-full"
                    onItemSelect={(item) => {
                      const zoneToSlot: Record<string, StudioProductTraySlot> = {
                        top: "top",
                        bottom: "bottom",
                        shoes: "shoes",
                      }
                      const clickedSlot = zoneToSlot[item.type as keyof typeof zoneToSlot]
                      if (!clickedSlot) return
                      
                      if (clickedSlot !== slot) {
                        const clickedProductId = activeSlotIds[clickedSlot] ?? null
                        const params = buildStudioSearchParams({
                          outfitId: resolvedOutfitId,
                          slot: clickedSlot,
                          slotIds: activeSlotIds,
                          productId: clickedProductId,
                          share: parsedParams.share,
                          hiddenSlots: parsedParams.hiddenSlots,
                        })
                        setSearchParams(params, { replace: true })
                      }
                      // Note: DO NOT call handleForceSearch here - search should persist when switching tabs
                      // User must explicitly click refresh button to update search
                    }}
                    onAvatarReady={setAvatarReady}
                    avatarRef={snapshotRef}
                  />
                ) : (isAdminMode && !resolvedOutfitId) ? (
                  /* Admin Fallback: Render Empty Mannequin if outfit is missing */
                   <OutfitInspirationTile
                    preset="heroCanonical"
                    outfitId={"temp-admin-outfit"} // Dummy ID
                    renderedItems={heroRenderedItems || []} 
                    fallbackImageSrc={heroRenderedItems?.[0]?.imageUrl ?? undefined} 
                    title={"New Outfit"}
                    chips={[]}
                    isSaved={false}
                    avatarHeadSrc={undefined} // Will use default based on gender
                    avatarGender={adminGender || "female"}
                    avatarHeightCm={170}
                    cardClassName="h-full w-full"
                    allowEmptyMannequin={true}
                    onItemSelect={(item) => {
                      // Enable slot switching when clicking items in Admin Mode too
                      const zoneToSlot: Record<string, "top" | "bottom" | "shoes"> = {
                        top: "top",
                        bottom: "bottom",
                        shoes: "shoes",
                      }
                      const clickedSlot = zoneToSlot[item.type as keyof typeof zoneToSlot]
                      if (clickedSlot && clickedSlot !== slot) {
                        handleCategoryChange(clickedSlot)
                      }
                    }} 
                    onSlotSelect={(slot) => handleCategoryChange(slot)}
                    onAvatarReady={setAvatarReady}
                    avatarRef={snapshotRef}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-center text-[10px] text-muted-foreground">
                    {isOutfitLoading ? "Loading outfit…" : "Select an outfit to view alternatives"}
                  </div>
                )}
              </div>
            </div>

            {/* The canvas drops the old floating TryOn pill and the separate
                "this look" bar — both fold into this one card. */}
            <WearingCard
              className="shrink-0"
              slotLabel={SLOT_DISPLAY_LABELS[slot]}
              title={heroTitle}
              brand={heroProduct?.brand ?? null}
              price={heroPrice}
              isReadOnly={isViewOnly}
              onOpenDetails={handleHeroDetails}
              onTryOn={handleTryOn}
              onSave={isViewOnly ? undefined : () => setIsSaveDrawerOpen(true)}
            />
          </section>
        )}


        {/* Right Panel — the rack, as a panel card */}
        {(
          <section
            className={cn(
              "relative flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-md border border-hairline bg-card p-0",
              tour.isHighlighted("alternatives") ? "z-[75] shadow-xl" : (tour.isActive ? "z-0" : "")
            )}
          >
            <RackHeader
              mode={rackMode}
              onModeChange={handleRackModeChange}
              slot={slot}
              onSlotChange={handleCategoryChange}
              isExpanded={panelMode === "right-full"}
              onToggleExpanded={() =>
                panelMode === "split" ? setPanelMode("right-full") : restoreSplit()
              }
              isReadOnly={isViewOnly}
            />

            {/* Products Grid - takes full remaining height */}
            <div
              className="flex flex-1 min-h-0 items-stretch w-full flex-col overflow-hidden bg-card gap-0"
            >
              {/* Results Header - shows count and active search */}
              {!isLoading && rackMode !== "yours" && (search.hasActiveSearch || search.activeFilterIds.length > 0) && (
                <div className="flex shrink-0 items-center border-b border-hairline px-2.5 py-1.5">
                  <span className="truncate text-[8px] text-muted-foreground md:text-[10px]">
                    {rackProducts.length} results
                    {search.committedText && (
                      <span> for &ldquo;{search.committedText}&rdquo;</span>
                    )}
                    {search.committedImageUrl && !search.committedText && (
                      <span> for image search</span>
                    )}
                    {search.activeFilterIds.length > 0 && (
                      <span> ({search.activeFilterIds.length} filter{search.activeFilterIds.length > 1 ? 's' : ''})</span>
                    )}
                  </span>
                </div>
              )}

              {rackMode === "yours" ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center">
                  <Sparkles className="size-4 text-gold" aria-hidden="true" />
                  <p className="text-[9.5px] font-semibold text-foreground md:text-[12px]">
                    Your own pieces
                  </p>
                  <p className="max-w-[160px] text-[8px] text-muted-foreground md:max-w-[220px] md:text-[10px]">
                    Wardrobe items you upload will appear here, ready to style into any look.
                  </p>
                </div>
              ) : (
                <RackGrid
                  products={rackProducts}
                  isLoading={isLoading}
                  wornProductId={activeSlotIds[slot] ?? null}
                  // Expanded, the rack has the model's half too, so it earns
                  // more columns at the same card size.
                  columnsClassName={
                    panelMode === "right-full"
                      ? "grid-cols-3 md:grid-cols-5 lg:grid-cols-6"
                      : undefined
                  }
                  className="min-h-0 flex-1"
                  onSelect={
                    isViewOnly
                      ? undefined
                      : (product) => {
                          // RackGrid only carries what it renders; the swap needs
                          // the full record (placement, itemType, gender).
                          const full = rackProducts.find((candidate) => candidate.id === product.id)
                          if (full) {
                            void handleAlternativeSelect(full)
                          }
                        }
                  }
                  isProductSaved={productSaveActions.isSaved}
                  onToggleSave={
                    isViewOnly
                      ? undefined
                      : (productId, nextSaved) => productSaveActions.onToggleSave(productId, nextSaved)
                  }
                  onLongPressSave={
                    isViewOnly ? undefined : (productId) => productSaveActions.onLongPressSave(productId)
                  }
                  emptyState={
                    <div className="flex flex-col items-center gap-2 text-center">
                      <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                      <p className="text-[9.5px] font-semibold text-foreground md:text-[12px]">
                        {rackMode === "saves" ? "Nothing saved in this slot" : "No results found"}
                      </p>
                      <p className="max-w-[160px] text-[8px] text-muted-foreground md:max-w-[220px] md:text-[10px]">
                        {rackMode === "saves"
                          ? "Tap ♡ on a piece to keep it here."
                          : "Try different keywords, adjust your filters, or tap ⟳ to see everything."}
                      </p>
                    </div>
                  }
                />
              )}
            </div>
          </section>
        )}
      </div>

      {/* Search bar — docked full width under BOTH columns, inside the frame.
          It used to be `fixed` to the viewport, which on a laptop parked it far
          below a rack that had already ended. */}
      {(
      <div className="shrink-0 pb-2 pt-2">
        <div
          className={cn(
            "w-full",
            isViewOnly ? "pointer-events-none opacity-60" : null,
          )}
        >
          <FilterSearchBar
            className="rounded-[5px] border border-hairline"
            variant="elevated"
            value={search.draftText}
            onValueChange={search.setDraftText}
            placeholder={`Search ${slot === 'top' ? 'topwear' : slot === 'bottom' ? 'bottomwear' : 'footwear'}...`}
            onSubmit={() => {
              search.handleSubmit()
            }}
            onClear={search.handleClearDraftText}
            onImageUpload={search.handleImageUpload}
            isUploadingImage={search.isUploadingImage}
            previewImageUrl={search.draftImageUrl ?? undefined}
            onClearImage={search.handleClearImage}
            showCompactPreview
            trailingAction={trailingAction}
            filterCategories={filterCategories}
            activeFilters={search.activeFilterIds}
            onFilterApply={handleFilterApply}
            onFilterClearAll={handleFilterClearAll}
            sortOptions={sortOptions}
            sortValue={sortValue}
            onSortChange={handleSortChange}
          />
        </div>
      </div>
      )}
      </div>
    </div>

      {/* Save Outfit Drawer */}
      {/* 7e — details without leaving the studio. The hero is the piece already
          on the model, so the sheet promotes "Full details" rather than
          offering a Wear action that would do nothing. */}
      <ProductPeekCard
        open={isPeekOpen}
        onOpenChange={setIsPeekOpen}
        isWorn
        isReadOnly={isViewOnly}
        item={
          heroProduct
            ? {
                id: heroProduct.productId,
                title: heroProduct.title,
                brand: heroProduct.brand,
                price: heroProduct.price,
                imageUrl: heroProduct.imageUrl ?? null,
                slotLabel: SLOT_DISPLAY_LABELS[slot],
                specs: [heroProduct.color, heroProduct.size].filter(Boolean) as string[],
              }
            : null
        }
        onWear={handlePeekDetails}
        onDetails={handlePeekDetails}
        onSave={isViewOnly ? undefined : () => setIsSaveDrawerOpen(true)}
      />

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
    </>
  )
}

export function StudioAlternativesScreen() {
  return <StudioAlternativesView />
}

export default StudioAlternativesScreen
