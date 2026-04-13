import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { SquareUserRound, RefreshCw, Search, Maximize, Columns2, Maximize2, Shirt, Footprints, Grip, Minimize2 } from "lucide-react"
import { useOutfitSnapshot } from "@/features/outfits/hooks/useOutfitSnapshot"

import {
  CategoryFilterBar,
  FilterSearchBar,
  IconButton,
  MoodboardPickerDrawer,
  SaveOutfitDrawer,
  OutfitInspirationTile,
  ShortProductCard,
  ScreenHeader,
  type FilterCategory,
} from "@/design-system/primitives"
import { AlternativesGrid } from "./components/AlternativesGrid"
import { CategoryId } from "@/design-system/primitives/category-filter-bar"
import { Skeleton } from "@/components/ui/skeleton"
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
import { mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import { mapTrayItemToProductDetail } from "@/services/studio/studioService"
import { useSaveOutfit } from "@/features/outfits/hooks/useSaveOutfit"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useFindOutfitByItems } from "@/features/outfits/hooks/useFindOutfitByItems"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useMoodboards, useCreateMoodboard, useSaveToCollection } from "@/features/collections/hooks/useMoodboards"
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

    // If we are on Alternatives Screen, we expect step to be 'alternatives' or 'full-screen'.
    // If step is 'mannequin' (Back) or 'product-details' (Next after full-screen), we should return to Studio.
    if (stepId === "mannequin" || stepId === "product-details") {
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
  const createMoodboardMutation = useCreateMoodboard()
  const { user } = useAuth()
  const { profile, gender } = useProfileContext()
  const [isSaveDrawerOpen, setIsSaveDrawerOpen] = useState(false)
  
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
  
  // Use the old alternatives query as fallback when no active search
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

  // Get the current item's image URL for the active slot (for auto-search)
  const currentSlotImageUrl = useMemo(() => {
    if (hiddenSlots[slot]) {
      return null
    }
    const currentItem = resolvedTrayItems.find((item) => item.slot === slot)
    return currentItem?.imageUrl ?? null
  }, [hiddenSlots, resolvedTrayItems, slot])

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
    if (prevSlotRef.current !== slot) {
      // Tab changed - restore existing state or initialize with current slot's image
      // In admin mode, we initialize as draft (no auto-search) AND no auto-image (empty search bar).
      search.resetForSlot(slot, isAdminMode ? null : currentSlotImageUrl, isAdminMode)

      prevSlotRef.current = slot
    } else if (!isInitializedRef.current && currentSlotImageUrl) {
      // Initial load only
      isInitializedRef.current = true
      search.resetForSlot(slot, isAdminMode ? null : currentSlotImageUrl, isAdminMode) 
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, currentSlotImageUrl, isAdminMode])

  // --- SEARCH RESULTS QUERY ---
  const searchResultsQuery = useStudioSearchResults({
    slot,
    query: search.committedText,
    imageUrl: search.committedImageUrl,
    filters: search.activeFilters,
    gender: adminGender ?? gender,
    allowEmptySearch: isAdminMode, // In admin mode, allow fetching all items without search query
  })

  // Determine which products to show and apply sorting
  const alternativeProducts = useMemo(() => {
    // In admin mode, we always use search results (which supports empty query)
    // In normal mode, we use search results only if there is an active search
    const shouldUseSearchResults = (search.hasActiveSearch || isAdminMode) && searchResultsQuery.data
    
    const products = shouldUseSearchResults
      ? [...searchResultsQuery.data]
      : [...(fallbackAlternativesQuery.data ?? [])]

    // Apply client-side sorting
    switch (sortValue) {
      case 'price-low-to-high':
        return products.sort((a, b) => a.price - b.price)
      case 'price-high-to-low':
        return products.sort((a, b) => b.price - a.price)
      case 'similarity':
      default:
        // Default: sorted by similarity from backend
        return products
    }
  }, [search.hasActiveSearch, searchResultsQuery.data, fallbackAlternativesQuery.data, sortValue])

  const isLoading = search.hasActiveSearch
    ? searchResultsQuery.isLoading
    : fallbackAlternativesQuery.isLoading

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
    if (!filterOptions) return []
    
    // Build slot-aware filter categories (hide type since tabs control it)
    // Note: Gender filter is intentionally excluded - it's auto-applied from user profile
    const categories: FilterCategory[] = []
    
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
  }, [filterOptions])

  // --- FILTER HANDLERS ---
  const handleFilterApply = useCallback(
    (filterIds: string[]) => {
      if (isViewOnly) {
        return
      }
      console.log('[StudioSearch] Applying filters:', filterIds)
      search.setActiveFilterIds(filterIds)
      
      // Parse filter IDs to ProductSearchFilters format
      const filters: Record<string, string[]> = {}
      let minPrice: number | undefined
      let maxPrice: number | undefined
      
      filterIds.forEach((filterId) => {
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
      console.log('[StudioSearch] Parsed filters:', parsedFilters)
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

  const handleHeroDetails = useCallback(() => {
    if (isViewOnly) {
      return
    }
    const productId = heroProduct?.productId ?? focusedItem?.id
    if (!productId) {
      return
    }
    if (heroProduct) {
      openProduct(productId, { initialProduct: mapTrayItemToProductDetail(heroProduct) })
      return
    }
    openProduct(productId)
  }, [focusedItem?.id, heroProduct, isViewOnly, openProduct])

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
    (product: StudioAlternativeProduct) => {
      if (isViewOnly) {
        return
      }
      if (!resolvedOutfitId && !isAdminMode) {
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

      if (!resolvedOutfitId && !isAdminMode) {
        return
      }

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

  // Dynamic categories with "others" icon changing based on panel mode
  const categories = useMemo(() => {
    const BottomIcon = (props: { className?: string }) => (
      <svg width="21" height="18" viewBox="0 0 21 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#clip0_1_2625)">
          <path fillRule="evenodd" clipRule="evenodd" d="M1.71599 0.0343769C1.52044 0.095399 1.36568 0.238497 1.27195 0.445235C1.23115 0.535043 1.2271 0.601418 1.22675 1.20438C1.22627 1.77119 1.21949 1.90096 1.17881 2.11817C0.667436 4.84774 0.359233 7.47455 0.13953 10.9774C0.0674454 12.1263 0 14.0089 0 14.8721C0 15.5305 0.0176048 15.6081 0.209354 15.7999C0.40039 15.991 0.384213 15.9875 1.71207 16.1137C1.90929 16.1325 2.52343 16.1894 3.07691 16.2403C3.63051 16.2912 4.18744 16.3431 4.31472 16.3556C4.66753 16.3903 5.18854 16.4392 6.29264 16.5411C6.84612 16.5922 7.45516 16.6496 7.64607 16.6686C8.16803 16.7209 8.4057 16.7154 8.5507 16.6478C8.69035 16.5828 8.81846 16.4611 8.88554 16.3296C8.93384 16.2351 9.02186 15.9135 9.7295 13.2502C9.86725 12.7316 9.98692 12.3152 9.99536 12.3248C10.0037 12.3345 10.0487 12.4933 10.0952 12.6778C10.1416 12.8623 10.2153 13.1486 10.2588 13.314C10.3024 13.4794 10.4904 14.203 10.6767 14.9218C10.863 15.6408 11.0377 16.274 11.065 16.3289C11.1253 16.4506 11.2818 16.5988 11.4127 16.6583C11.5351 16.7139 11.8098 16.7171 12.3094 16.6688C12.5057 16.6499 13.1191 16.5929 13.6726 16.5422C14.2261 16.4915 14.7311 16.4448 14.7947 16.4384C14.8583 16.4319 15.587 16.364 16.4141 16.2875C17.9602 16.1445 18.4108 16.1026 19.0515 16.0419C19.255 16.0225 19.4708 15.991 19.5309 15.9717C19.6784 15.9243 19.855 15.7608 19.9352 15.5975L20 15.4656L19.9956 14.8293C19.9875 13.67 19.9144 12.0582 19.7899 10.295C19.6515 8.33278 19.4458 6.38733 19.1884 4.60377C19.1012 3.99974 18.8745 2.63323 18.8295 2.44076C18.8129 2.36963 18.7969 1.97745 18.7881 1.42278L18.7738 0.520531L18.706 0.398249C18.6155 0.234691 18.4748 0.109435 18.3142 0.0493648L18.1822 0L9.99917 0.00154637C3.19682 0.00285481 1.79926 0.00832659 1.71599 0.0343769ZM5.93317 1.52995C6.09685 1.72456 6.14883 1.98791 6.07187 2.23248C6.02096 2.39437 5.86097 2.57839 5.69955 2.66082L5.58702 2.71839L4.06837 2.72482L2.5496 2.73112L2.53699 2.78263C2.50856 2.8998 2.264 4.42083 2.19965 4.88141C1.95223 6.6514 1.77725 8.34646 1.64331 10.2718C1.56766 11.3588 1.45775 13.7918 1.45763 14.3818L1.45751 14.6167L1.56742 14.6311C1.66151 14.6434 3.15078 14.783 3.94455 14.854C4.08443 14.8665 4.3604 14.8922 4.55762 14.9113C4.99572 14.9533 6.76084 15.1186 7.29517 15.1677C7.5094 15.1873 7.68961 15.1984 7.69579 15.1921C7.70198 15.1859 7.7523 15.0107 7.80761 14.8027C7.86292 14.5947 8.05063 13.8935 8.22453 13.2446C8.63087 11.7297 8.97738 10.4355 9.17257 9.705C9.33185 9.10834 9.38419 8.98035 9.51373 8.87103C9.65742 8.7497 9.8023 8.69915 10.0058 8.69915C10.2371 8.69915 10.3766 8.75851 10.5283 8.92147C10.6585 9.06147 10.6714 9.09668 10.8633 9.84382C10.9484 10.1746 11.0885 10.716 11.1748 11.0469C11.2609 11.3777 11.4272 12.0179 11.5442 12.4697C11.6481 12.8708 11.7523 13.2718 11.8569 13.6726C12.0072 14.2453 12.1696 14.8697 12.2088 15.0261C12.2281 15.1023 12.2517 15.1735 12.2616 15.1843C12.2715 15.195 12.455 15.1872 12.6695 15.1671C12.8841 15.1471 13.5124 15.0887 14.066 15.0376C14.6195 14.9864 15.2336 14.9293 15.4308 14.9107C15.6281 14.8921 15.904 14.8667 16.0439 14.8542C16.9133 14.7766 18.3497 14.6428 18.4326 14.6316L18.531 14.6183V14.3353C18.531 13.8061 18.4453 12.0182 18.3562 10.6883C18.1932 8.25594 17.9264 5.86906 17.5803 3.7478C17.514 3.34146 17.421 2.81843 17.4065 2.77038C17.395 2.73243 17.3055 2.72993 15.9541 2.72993C14.3763 2.72993 14.3769 2.72993 14.1874 2.59266C13.9905 2.44992 13.8612 2.16265 13.8914 1.93439C13.9098 1.79521 13.9692 1.65223 14.0556 1.53887L14.1177 1.45751H5.87215L5.93317 1.52995Z" fill="#292524" />
        </g>
        <defs>
          <clipPath id="clip0_1_2625">
            <rect width="20" height="16.7037" fill="white" />
          </clipPath>
        </defs>
      </svg>
    )

    return [
      { id: "top" as const, label: "Top", icon: Shirt },
      { id: "bottom" as const, label: "Bottom", icon: BottomIcon },
      { id: "shoes" as const, label: "Shoes", icon: Footprints },
      { 
        id: "others" as const, 
        label: "Others", 
        icon: panelMode === "split" ? Maximize2 : Minimize2 
      },
    ]
  }, [panelMode])

  // --- FORCE SEARCH (Sparkles): Search for items similar to current avatar item ---
  const handleForceSearch = useCallback(() => {
    if (isViewOnly) {
      return
    }
    console.log('[StudioSearch] Force search triggered with image:', currentSlotImageUrl)
    // Auto-restore split view if right panel is full width
    if (panelMode === "right-full") {
      restoreSplit()
    }
    if (currentSlotImageUrl) {
      search.handleForceSearch(currentSlotImageUrl)
    }
  }, [currentSlotImageUrl, isViewOnly, panelMode, restoreSplit, search])

  const heroTitle = heroProduct?.title ?? focusedItem?.product_name ?? focusedItem?.brand ?? "Selected piece"
  const heroPrice = heroProduct?.price ?? focusedItem?.price ?? 0

  // Always show refresh icon for force search with current avatar item
  const trailingAction = useMemo(() => {
    return {
      id: "force-search",
      ariaLabel: "Reset to current item",
      icon: <RefreshCw className="h-4 w-4" />,
      onClick: handleForceSearch,
    }
  }, [handleForceSearch])

  return (
    <>
    <div className="h-full w-full relative">
      <ScreenHeader
        // title="Alternatives"
        onAction={handleBack}
        className="absolute left-3 top-3 z-20 px-0 pt-0 pb-0"
      />
      
      {/* Main content area - search bar overlays on top */}
      <div
        ref={containerRef}
        style={{
          height: "calc(100vh - 44px)",
        }}
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-stretch justify-start overflow-hidden px-1 pr-1 pb-0 pt-2"
      >
        {/* Left Panel - Outfit Preview */}
        {panelMode !== "right-full" && (
          /* Split view - left panel */
          <section 
            className="relative flex h-full min-h-0 flex-none flex-col justify-between gap-1 transition-all duration-200"
            style={{ 
              width: `${splitRatio}%`,
            }}
          >

            <div
              className="relative flex flex-1 h-full w-full items-center justify-center overflow-hidden rounded-1xl"
            >
              <div 
                className="flex flex-1 h-[90%] w-full items-center justify-center bg-transparent"
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
                  <div className="flex h-[400px] w-full items-center justify-center rounded-[120px] bg-muted/40 text-xs text-muted-foreground">
                    {isOutfitLoading ? "Loading outfit…" : "Select an outfit to view alternatives"}
                  </div>
                )}
              </div>

              <IconButton
                tone="ghost"
                size="sm"
                aria-label="Try-on"
                className="absolute bottom-2 left-0 z-10 rounded-xl bg-card h-9 w-9 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation()
                  handleTryOn()
                }}
              >
                <SquareUserRound className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                tone="ghost"
                size="md"
                aria-label="Open full studio view"
                className={cn(
                  "absolute bottom-2 right-[-6px] z-10 rounded-xl bg-card h-9 w-9 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  tour.isHighlighted("full-screen") && "z-[75] ring-2 ring-primary ring-offset-2"
                )}
                onClick={() => {
                  if (tour.isHighlighted("full-screen")) {
                    tour.nextStep()
                  }
                  openStudio()
                }}
              >
                <Maximize className="size-5" aria-hidden="true" />
              </IconButton>
            </div>

            <ShortProductCard
              className="w-full px-1 mb-14"
              title={heroTitle}
              price={heroPrice}
              discountPercent={null}
              rating={heroProduct?.rating ?? "—"}
              reviewCount={heroProduct?.reviewCount ?? "—"}
              onOpenDetails={handleHeroDetails}
              onSave={isViewOnly ? undefined : () => setIsSaveDrawerOpen(true)}
              onBuy={heroProduct?.productUrl ? handleBuyClick : undefined}
            />
          </section>
        )}


        {/* Right Panel - Product Grid */}
        {(
          <section 
            className={cn(
              "relative flex h-[calc(100% - 6rem)] min-h-0 mb-4 flex-1 flex-col gap-0 overflow-hidden rounded-1xl bg-card/90 p-0",
              tour.isHighlighted("alternatives") ? "z-[75] shadow-xl" : (tour.isActive ? "z-0" : "")
            )}
            style={{ 
              width: panelMode === "right-full" ? "100%" : undefined,
              height: panelMode === "right-full" ? "100%" : "calc(100% - 3.4rem)",
            }}
          >
            {/* Header Row with Category Icons */}
            <div className="flex items-center w-full border-l border-sidebar-border">
              <CategoryFilterBar
                activeCategory={panelMode === "right-full" ? "others" : slot}
                onCategoryChange={isViewOnly ? undefined : handleCategoryChange}
                categories={categories}
                className="flex-1 z-50 bg-card"
              />
            </div>
            
            {/* Products Grid - takes full remaining height */}
            <div
              className="flex flex-1 min-h-0 items-stretch w-full flex-col overflow-hidden border-l border-sidebar-border bg-card gap-0"
            >
              {/* Results Header - shows count and active search */}
              {!isLoading && (search.hasActiveSearch || search.activeFilterIds.length > 0) && (
                <div className="flex items-center px-2 py-0.5 border-none bg-muted/20">
                  <span className="text-xs text-muted-foreground">
                    {alternativeProducts.length} results
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

              {isLoading ? (
                /* Skeleton Grid Loader */
                <div className="grid h-full min-h-0 grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] sm:grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-[2px] overflow-y-auto p-1">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <Skeleton className="aspect-square w-full rounded-lg" />
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : alternativeProducts.length === 0 ? (
                /* Empty State */
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
                  <div className="rounded-full bg-muted/50 p-3">
                    <Search className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">No results found</p>
                    <p className="text-xs text-muted-foreground max-w-[200px]">
                      Try different keywords, adjust your filters, or search with an image
                    </p>
                  </div>
                </div>
              ) : (
                <AlternativesGrid
                  products={alternativeProducts}
                  onSelect={isViewOnly ? undefined : handleAlternativeSelect}
                  isProductSaved={productSaveActions.isSaved}
                  onToggleSave={
                    isViewOnly
                      ? undefined
                      : (productId, nextSaved) => productSaveActions.onToggleSave(productId, nextSaved)
                  }
                  onLongPressSave={
                    isViewOnly ? undefined : (productId) => productSaveActions.onLongPressSave(productId)
                  }
                  className="h-full"
                />
              )}
            </div>
          </section>
        )}
      </div>

      {/* Search Bar - Fixed at Bottom, Full Width */}
      {(
      <div className="pointer-events-none fixed inset-x-0 bottom-[44px] z-20">
        <div
          className={cn(
            "pointer-events-auto mx-auto w-full max-w-5xl px-0",
            isViewOnly ? "pointer-events-none opacity-60" : null,
          )}
        >
          <FilterSearchBar
            className="rounded-t-3xl"
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

      {/* Save Outfit Drawer */}
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
