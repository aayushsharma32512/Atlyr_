import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Redo2, RotateCcw, Undo2 } from "lucide-react"

import { Icons } from "@/design-system/icons"
import { useOutfitSnapshot } from "@/features/outfits/hooks/useOutfitSnapshot"

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
import { toDisplayImages } from "./utils/productImages"
import { CANVAS_SLOTS, toTraySlot, type StudioCanvasSlot } from "./constants/layering"
import { selectRackProducts } from "./utils/rackOrder"
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
import { isDressTop, STUDIO_BASE_ITEMS_ENABLED, usePlaceholderItems } from "@/features/studio/hooks/usePlaceholderItems"
import { mapTrayItemToProductDetail } from "@/services/studio/studioService"
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
  const studioHistory = useStudioHistory()
  const { recordChange } = studioHistory
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
  const { mutateAsync: updateOutfitMutation } = useUpdateOutfit()
  const { mutateAsync: createDraftOutfitMutation } = useCreateDraftOutfit()
  const { mutateAsync: findOutfitByItemsMutation } = useFindOutfitByItems()
  const { mutateAsync: saveToCollectionMutation } = useSaveToCollection()
  const { mutateAsync: removeFromCollectionMutation } = useRemoveFromCollection()
  const outfitMembershipQuery = useOutfitCollectionMembership()
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
  // A removed slot has no worn piece: the detail card must not keep showing
  // the one that was taken off. The figure and the rows already honour this.
  const heroProductId = hiddenSlots[slot] ? null : (parsedParams.productId ?? slotProductIds[slot] ?? null)
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
    // A typed query searches alone. The worn item joins only the similar-item search.
    productId: search.committedText ? null : searchProductId,
    filters: search.activeFilters,
    gender: adminGender ?? gender,
    allowEmptySearch: isAdminMode || isColdStart, // Allow fetching all items on cold start or in admin mode
  })

  /**
   * Whatever the search returned, in that order. No sort and no pinning the
   * worn piece to the front — it is marked in place instead.
   */
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

  const isLoading = search.hasActiveSearch
    ? searchResultsQuery.isLoading
    : fallbackAlternativesQuery.isLoading

  /** Source lives in the URL. wardrobe→yours, explore→alternates (brief §7). */
  const source: StudioSource = parsedParams.source ?? "explore"

  const rackProducts = useMemo(() => {
    if (source === "wardrobe") {
      return []
    }

    // Drop anything the photoreal mannequin cannot actually wear — see
    // isPlaceableOnMannequin. Applied to every slot.
    const mannequin = (outfitData?.avatarGender ?? adminGender ?? gender ?? "female") as "male" | "female"
    const placeable = shouldFilterSlotByPlacement(slot)
      ? filteredAlternativeProducts.filter((product) => isPlaceableOnMannequin(product, mannequin))
      : filteredAlternativeProducts

    if (source === "saves") {
      return placeable.filter((product) => productSaveActions.isSaved(product.id))
    }
    return placeable
  }, [
    adminGender,
    filteredAlternativeProducts,
    gender,
    outfitData?.avatarGender,
    productSaveActions,
    slot,
    source,
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
  
  // A removed slot has nothing to show. Gating the id is not enough: with no
  // id the hero hook falls back to the outfit's own piece for the slot, which
  // is exactly the one that was taken off.
  const heroProduct = hiddenSlots[slot] ? null : (heroProductQuery.data ?? null)
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
            gender: outfitData?.avatarGender ?? "female",
            vibe: data.vibe,
            keywords: data.keywords,
            isPrivate: data.isPrivate,
            createdByName: profile?.name ?? null,
            userId: user.id,
            backgroundId: outfitData?.outfit?.backgroundId ?? null,
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

  /** Same shape as the Studio card: tags come from the worn pieces. */
  const suggestedTags = useMemo(() => {
    const seen = new Set<string>()
    resolvedTrayItems.forEach((item) => {
      ;[...item.vibeTags, ...item.feelTags, ...item.fitTags]
        .filter(Boolean)
        .slice(0, 2)
        .forEach((tag) => seen.add(tag))
    })
    return [...seen].slice(0, 5)
  }, [resolvedTrayItems])

  /** The card has no category or occasion fields, so carry the outfit's own. */
  const handleSaveFromCard = useCallback(
    async (data: { name: string; tags: string[]; boardSlugs: string[] }) => {
      try {
        await handleSaveOutfit({
          outfitName: data.name,
          categoryId: outfitData?.outfit?.category ?? "",
          occasionId: outfitData?.outfit?.occasion?.id ?? "",
          vibe: "",
          keywords: data.tags.join(", "),
          isPrivate: false,
          moodboardIds: data.boardSlugs,
        })
        setIsSaveDrawerOpen(false)
      } catch {
        // handleSaveOutfit has already toasted; keep the card open to retry.
      }
    },
    [handleSaveOutfit, outfitData?.outfit?.category, outfitData?.outfit?.occasion?.id],
  )

  /** Product pins open the same card, boards only. */
  const handleSaveProduct = useCallback(
    async (boardSlugs: string[]) => {
      if (!productSaveId) return
      try {
        await productSaveActions.onSaveToBoards(productSaveId, boardSlugs)
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
      })
      // NOTE: Search does NOT update - grid stays static per spec (Passive Selection)
    },
    [
      activeSlotIds,
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
    const imageUrl = currentSlotImageUrl
    if (isViewOnly || !imageUrl || !currentSlotProductId) {
      return
    }
    // Search by the id of the item on screen. The image is still sent, because the
    // results panel opens only when a search has text or an image.
    setSearchProductId(currentSlotProductId)
    search.handleForceSearch(imageUrl)
  }, [currentSlotImageUrl, currentSlotProductId, isViewOnly, search])

  /**
   * Product-level Find items, seeded with the worn piece's cutout. The rack's
   * web-search row asks for web results directly. Kicks are not a detector
   * category, so they take the blank import.
   */
  const findItemsUrl = useCallback(
    (results: "inventory" | "web") => {
      const image = heroProduct?.imageUrl ?? heroProduct?.thumbnailUrl
      if (slot === "shoes" || !image) return "/inspiration-import"
      const params = new URLSearchParams({ source: image, slot })
      if (results === "web") params.set("results", "web")
      return `/inspiration-import?${params.toString()}`
    },
    [heroProduct?.imageUrl, heroProduct?.thumbnailUrl, slot],
  )
  const handleFindItems = useCallback(() => navigate(findItemsUrl("inventory")), [findItemsUrl, navigate])

  // A garment tap: zoom to that slot and show its rack state. Same slot → only
  // the zoom changes; a different slot → slot and zoom in one query write.
  const enterFocus = useCallback(
    (nextSlot: StudioCanvasSlot) => {
      if (toTraySlot(nextSlot) === slot) openFocus(nextSlot)
      else handleCategoryChange(nextSlot, { focus: nextSlot })
    },
    [handleCategoryChange, openFocus, slot],
  )
  const handleStepFocus = useCallback(
    (delta: number) => {
      const index = CANVAS_SLOTS.indexOf(slot)
      enterFocus(CANVAS_SLOTS[(index + delta + CANVAS_SLOTS.length) % CANVAS_SLOTS.length])
    },
    [enterFocus, slot],
  )
  const handleWebSearch = useCallback(() => navigate(findItemsUrl("web")), [findItemsUrl, navigate])

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
      onClick: () => {
        setProductSaveId(null)
        setIsSaveDrawerOpen(true)
      },
    },
  ]

  const heroTitle = hiddenSlots[slot]
    ? "Nothing worn here"
    : (heroProduct?.title ?? focusedItem?.product_name ?? focusedItem?.brand ?? "Selected piece")
  const heroPrice = heroProduct?.price ?? focusedItem?.price ?? 0

  /** fit · feel · vibe · colour · material. No brand, no price. */
  const heroAttributes = useMemo(() => {
    if (!heroProduct) return []
    return [
      ...(heroProduct.fitTags ?? []),
      ...(heroProduct.feelTags ?? []),
      ...(heroProduct.vibeTags ?? []),
      heroProduct.color,
      heroProduct.materialType,
    ].filter((value): value is string => Boolean(value)).slice(0, 5)
  }, [heroProduct])

  const heroImages = useMemo(
    () =>
      hiddenSlots[slot]
        ? []
        : toDisplayImages(heroImagesQuery.data, heroProduct?.imageUrl ?? heroProduct?.thumbnailUrl),
    [heroImagesQuery.data, heroProduct?.imageUrl, heroProduct?.thumbnailUrl, hiddenSlots, slot],
  )

  const queryLine = useMemo(() => {
    if (search.committedText) return `"${search.committedText}"`
    if (search.committedImageUrl) {
      return search.committedImageUrl === currentSlotImageUrl ? "Similar to this item" : "Similar to your photo"
    }
    return null
  }, [currentSlotImageUrl, search.committedImageUrl, search.committedText])

  const emptyLabel =
    source === "wardrobe"
      ? "Your wardrobe is empty"
      : source === "saves"
        ? "Nothing saved in this slot"
        : "No results found"

  // One figure for both layouts: the split (with the rack) and focus.
  const figureNode = (
      <div className="absolute inset-0 flex items-end justify-center pb-3">
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
          chips={[]}
          isSaved={false}
          avatarHeadSrc={outfitData?.avatarHeadSrc ?? undefined}
          avatarGender={outfitData?.avatarGender ?? "female"}
          avatarHeightCm={outfitData?.avatarHeightCm ?? 170}
          cardClassName="h-full w-full"
          allowEmptyMannequin={isAdminMode || !STUDIO_BASE_ITEMS_ENABLED}
          // A tap on a garment opens the focus view — Studio's, with the rack collapsed.
          onItemSelect={(item) => {
            if (isStudioSlot(item.type)) enterFocus(item.type)
          }}
          onAvatarReady={setAvatarReady}
          avatarRef={snapshotRef}
        />
      ) : (isAdminMode && !resolvedOutfitId) ? (
        <OutfitInspirationTile
          preset="heroCanonical"
          outfitId="temp-admin-outfit"
          renderedItems={heroRenderedItems || []}
          fallbackImageSrc={heroRenderedItems?.[0]?.imageUrl ?? undefined}
          title="New Outfit"
          chips={[]}
          isSaved={false}
          avatarGender={adminGender || "female"}
          avatarHeightCm={170}
          cardClassName="h-full w-full"
          allowEmptyMannequin
          onItemSelect={(item) => {
            if (isStudioSlot(item.type)) enterFocus(item.type)
          }}
          onSlotSelect={(nextSlot) => handleCategoryChange(nextSlot)}
          onAvatarReady={setAvatarReady}
          avatarRef={snapshotRef}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-3 text-center text-body text-taupe">
          {isOutfitLoading ? "Loading outfit…" : "Select an outfit to view alternatives"}
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
                    key={productSaveId}
                    kind="piece"
                    className="h-full"
                    defaultName={heroTitle}
                    defaultTags={heroAttributes}
                    boards={selectableMoodboards.map((m) => ({ slug: m.slug, label: m.label }))}
                    defaultBoardSlugs={
                      productSaveActions.getProductBoardSlugs(productSaveId).length
                        ? productSaveActions.getProductBoardSlugs(productSaveId)
                        : ["favorites"]
                    }
                    isSaving={productSaveActions.isSaving}
                    onSave={(data) => void handleSaveProduct(data.boardSlugs)}
                    onCancel={() => setProductSaveId(null)}
                    onCreateBoard={(name) =>
                      createMoodboardMutation.mutateAsync(name).then((res) => res.slug)
                    }
                  />
                </div>
              ) : (
                <StudioFocusSheet
                  slot={focus}
                  title={heroTitle}
                  images={heroImages}
                  attributes={heroAttributes}
                  saved={heroProduct ? productSaveActions.isSaved(heroProduct.productId) : false}
                  isLoading={heroProductQuery.isLoading}
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
                showWebSearch={source === "explore"}
                onWebSearch={handleWebSearch}
                onSelect={isViewOnly ? undefined : (product) => void handleAlternativeSelect(product)}
                isProductSaved={productSaveActions.isSaved}
                onToggleSave={isViewOnly ? undefined : openProductSave}
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
                onFilter={() => setIsFilterOpen(true)}
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
                className="h-full"
                defaultName={
                  outfitData?.outfit?.name?.startsWith("draft-look-")
                    ? `${profile?.name ?? "Your"}'s Look #${String(Date.now()).slice(-4)}`
                    : (outfitData?.outfit?.name ?? "")
                }
                defaultTags={suggestedTags}
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
                key={productSaveId}
                kind="piece"
                className="h-full"
                defaultName={heroTitle}
                defaultTags={heroAttributes}
                boards={selectableMoodboards.map((m) => ({ slug: m.slug, label: m.label }))}
                defaultBoardSlugs={
                  productSaveActions.getProductBoardSlugs(productSaveId!).length
                    ? productSaveActions.getProductBoardSlugs(productSaveId!)
                    : ["favorites"]
                }
                isSaving={productSaveActions.isSaving}
                onSave={(data) => void handleSaveProduct(data.boardSlugs)}
                onCancel={() => setProductSaveId(null)}
                onCreateBoard={(name) =>
                  createMoodboardMutation.mutateAsync(name).then((res) => res.slug)
                }
              />
              )
            ) : (
            <ProductSheet
              title={heroTitle}
              images={heroImages}
              slot={slot}
              attributes={heroAttributes}
              carousel="left"
              mediaSize={176}
              cropToContent
              corner="similar"
              onCorner={handleSimilarSearch}
              actions={isViewOnly ? "none" : "icons"}
              saved={heroProduct ? productSaveActions.isSaved(heroProduct.productId) : false}
              onSave={heroProduct ? () => openProductSave(heroProduct.productId) : undefined}
              onTryOn={handleTryOn}
              onFindItems={handleFindItems}
              isLoading={heroProductQuery.isLoading}
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
