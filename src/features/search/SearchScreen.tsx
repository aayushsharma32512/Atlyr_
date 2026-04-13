import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import {
  FilterSearchBar,
  IconButton,
  OutfitInspirationGrid,
  ProductResultsGrid,
  RecentStylesRail,
  SectionHeader,
  MoodboardPickerDrawer,
  type FilterSearchBarChip,
  type FilterCategory,
} from "@/design-system/primitives"
import { ChevronRight } from "lucide-react"

import type { InspirationItem } from "@/features/studio/types"
import { mapLegacyOutfitItemsToStudioItems } from "@/features/studio/mappers/renderedItemMapper"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { cn } from "@/lib/utils"
import { getOutfitChips } from "@/utils/outfitChips"
import { useSearchBrowseCollections } from "@/features/search/hooks/useSearchBrowseCollections"
import { useSearchOutfitResults } from "@/features/search/hooks/useSearchOutfitResults"
import { useSearchProductResults } from "@/features/search/hooks/useSearchProductResults"
import { useProductFilterOptions } from "@/features/search/hooks/useProductFilterOptions"
import { useSearchImageUpload } from "@/features/search/hooks/useSearchImageUpload"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import {
  useCreateMoodboard,
  useFavorites,
  useCollectionsOverview,
  useRemoveOutfitFromLibrary,
  useSaveToCollection,
} from "@/features/collections/hooks/useMoodboards"
import { useLaunchStudio } from "@/features/studio/hooks/useLaunchStudio"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import type { Database } from "@/integrations/supabase/types"
import type {
  ProductSearchFilters,
  OutfitSearchFilters,
  SearchBrowseCollection,
  SearchBrowseOutfit,
} from "@/services/search/searchService"
import { useToast } from "@/hooks/use-toast"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import {
  canonicalizeOutfitSearchFilters,
  canonicalizeProductSearchFilters,
  computeSearchContextSignature,
  computeSearchType,
  type SearchMode,
  type SearchTrigger,
} from "@/integrations/posthog/engagementTracking/searchCanonical"
import {
  computeBucketedRowMajorPositions,
  type EntityUiContext,
  trackItemClicked,
  trackSavedToCollection,
  trackSaveToggled,
} from "@/integrations/posthog/engagementTracking/entityEvents"
import {
  observeSearchResultsCard,
  unobserveSearchResultsCard,
} from "@/integrations/posthog/engagementTracking/browseDepth/searchResultsBrowseDepth"

const CARD_MAX_WIDTH = "24rem"
const DEFAULT_RESULTS_PADDING_BOTTOM = "5.5rem"
type BrowseCollectionWithInspiration = SearchBrowseCollection & { inspirationItems: InspirationItem[] }

function generateSearchId(): string {
  const cryptoId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null
  if (cryptoId) return cryptoId
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// --- UI Components ---
const ProductResultsSkeleton = () => (
  <div className="grid grid-cols-3 gap-x-2 gap-y-4 px-1">
    {Array.from({ length: 9 }).map((_, i) => (
      <div key={i} className="flex flex-col gap-2">
        <div className="aspect-[3/4] w-full animate-pulse rounded-xl bg-muted/20" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted/20" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted/20" />
      </div>
    ))}
  </div>
)

const OutfitResultsSkeleton = () => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-1">
    {Array.from({ length: 6 }).map((_, i) => (
       <div key={i} className="flex flex-col gap-2">
        <div className="aspect-[3/4] w-full animate-pulse rounded-2xl bg-muted/20" />
      </div>
    ))}
  </div>
)

export function SearchScreenView() {
  useScrollRestoration("scroll:search")
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchParamValue = searchParams.get("search") ?? ""
  const { toast } = useToast()
  const analytics = useEngagementAnalytics()
  
  // Read imageUrl from params if coming from Home
  const imageUrlParam = searchParams.get("imageUrl") ? decodeURIComponent(searchParams.get("imageUrl")!) : undefined
  
  const modeParamValue = searchParams.get("mode") === "products" ? "products" : "outfits"

  const committedSearchTerm = searchParamValue
  
  // --- STATE ---
  const [searchTerm, setSearchTerm] = useState(searchParamValue)
  // Initialize with URL param
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | undefined>(imageUrlParam)
  // appliedImageUrl is the image used for the active search results; it only updates on explicit submit or deep-link
  const [appliedImageUrl, setAppliedImageUrl] = useState<string | undefined>(imageUrlParam)
  const [sortValue, setSortValue] = useState("similarity")
  const [imageSearchTriggered, setImageSearchTriggered] = useState(false)
  const [explicitSearchTriggered, setExplicitSearchTriggered] = useState<boolean>(
    Boolean(committedSearchTerm.trim().length > 0 || imageUrlParam),
  )
  const [suppressUrlSync, setSuppressUrlSync] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  // Logic: Results mode active if text exists OR user explicitly triggered a search OR we have an applied image
  const hasTextSearch = searchParamValue.trim().length > 0
  const isResultsMode = hasTextSearch || explicitSearchTriggered || Boolean(appliedImageUrl)

  const [activeFilter, setActiveFilter] = useState<"products" | "outfits">(
    // Respect URL mode param, defaulting to outfits if no mode is specified
    modeParamValue,
  )

  const [outfitFilters] = useState<OutfitSearchFilters>({})
  const [productFilters, setProductFilters] = useState<ProductSearchFilters>({})
  const [activeFilterIds, setActiveFilterIds] = useState<string[]>([])
  const [draftTypeFilters, setDraftTypeFilters] = useState<string[]>([])
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const searchImageUpload = useSearchImageUpload()
  const { gender: profileGender, heightCm } = useProfileContext()
  const productSaveActions = useProductSaveActions()
  const favoritesQuery = useFavorites()
  const favoriteIds = favoritesQuery.data ?? []
  const saveToCollectionMutation = useSaveToCollection()
  const removeOutfitFromLibraryMutation = useRemoveOutfitFromLibrary()
  const createMoodboardMutation = useCreateMoodboard()
  const collectionsOverviewQuery = useCollectionsOverview()
  const moodboards = collectionsOverviewQuery.data?.moodboards ?? []
  const selectableMoodboards = useMemo(
    () => moodboards.filter((m) => !m.isSystem),
    [moodboards],
  )
  const [pendingOutfitId, setPendingOutfitId] = useState<string | null>(null)
  const [isOutfitPickerOpen, setIsOutfitPickerOpen] = useState(false)
  const launchStudio = useLaunchStudio()
  const isUploading = searchImageUpload.isPending

  const lastEmittedSearchSigRef = useRef<string | null>(null)
  const currentSearchSigRef = useRef<string | null>(null)
  const currentSearchIdRef = useRef<string | null>(null)

  const currentSearchContext = useMemo(() => {
    const queryRaw = committedSearchTerm
    const imageUrl = appliedImageUrl
    const mode = activeFilter as SearchMode
    const sort = sortValue || "similarity"
    const searchType = computeSearchType({ queryRaw, imageUrl })
    const filters =
      mode === "products"
        ? canonicalizeProductSearchFilters(productFilters)
        : canonicalizeOutfitSearchFilters(outfitFilters)

    const sig = computeSearchContextSignature({
      query_raw: queryRaw,
      search_type: searchType,
      mode,
      filters,
      sort,
    })

    return { queryRaw, imageUrl, mode, sort, searchType, filters, sig }
  }, [activeFilter, appliedImageUrl, committedSearchTerm, outfitFilters, productFilters, sortValue])

  useEffect(() => {
    currentSearchSigRef.current = currentSearchContext.sig
  }, [currentSearchContext.sig])

  const emitSearchSubmitted = useCallback(
    (trigger: SearchTrigger, context: {
      queryRaw: string
      imageUrl?: string
      mode: SearchMode
      sort: string
      productFilters: ProductSearchFilters
      outfitFilters: OutfitSearchFilters
    }) => {
      if (analytics.state.surface !== "search_results") return

      const searchType = computeSearchType({ queryRaw: context.queryRaw, imageUrl: context.imageUrl })
      const filters =
        context.mode === "products"
          ? canonicalizeProductSearchFilters(context.productFilters)
          : canonicalizeOutfitSearchFilters(context.outfitFilters)

      const sig = computeSearchContextSignature({
        query_raw: context.queryRaw,
        search_type: searchType,
        mode: context.mode,
        filters,
        sort: context.sort,
      })

      const searchId = generateSearchId()
      currentSearchIdRef.current = searchId
      lastEmittedSearchSigRef.current = sig

      analytics.capture("search_submitted", {
        search_id: searchId,
        search_trigger: trigger,
        query_raw: context.queryRaw,
        search_type: searchType,
        mode: context.mode,
        filters,
        sort: context.sort,
      })
    },
    [analytics],
  )

  // Deep-link / initial results-set emission: emit once per committed context signature.
  useEffect(() => {
    if (!explicitSearchTriggered) return
    if (!isResultsMode) return

    const hasCommittedQuery = committedSearchTerm.trim().length > 0
    const hasAppliedImage = Boolean(appliedImageUrl && appliedImageUrl.trim().length > 0)
    if (!hasCommittedQuery && !hasAppliedImage) return

    const currentSig = currentSearchContext.sig
    if (!currentSig) return
    if (lastEmittedSearchSigRef.current === currentSig) return

    emitSearchSubmitted("query_submit", {
      queryRaw: committedSearchTerm,
      imageUrl: appliedImageUrl,
      mode: activeFilter as SearchMode,
      sort: sortValue || "similarity",
      productFilters,
      outfitFilters,
    })
  }, [
    activeFilter,
    appliedImageUrl,
    committedSearchTerm,
    emitSearchSubmitted,
    explicitSearchTriggered,
    isResultsMode,
    currentSearchContext.sig,
    outfitFilters,
    productFilters,
    sortValue,
  ])
  // Sync state if URL changes (e.g. back button navigation or fresh nav)
  useEffect(() => {
    const nextImageParam = searchParams.get("imageUrl") ? decodeURIComponent(searchParams.get("imageUrl")!) : undefined
    const nextSearchParam = searchParams.get("search") ?? ""
    
    // Sync uploaded and applied image URL with URL params
    setUploadedImageUrl(nextImageParam)
    setAppliedImageUrl(nextImageParam)
    
    // Also sync search term state
    setSearchTerm(nextSearchParam)
    
    if (suppressUrlSync) {
      // Skip sync this time, but clear flag for next time
      setSuppressUrlSync(false)
      return
    }
    
    // Set imageSearchTriggered if we have an imageUrl param
    if (nextImageParam) {
      setImageSearchTriggered(true)
    } else {
      setImageSearchTriggered(false)
    }
    
    // If URL contains search text OR image, treat it as an explicit search (deep link)
    setExplicitSearchTriggered(Boolean(nextSearchParam.trim().length > 0 || nextImageParam))
  }, [searchParams, suppressUrlSync])

  // --- POPSTATE SYNC: synchronize state when the browser history changes (back/forward)
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search)
      const imageParam = params.get("imageUrl") ? decodeURIComponent(params.get("imageUrl")!) : undefined
      const searchParam = params.get("search") ?? ""

      setUploadedImageUrl(imageParam)
      setAppliedImageUrl(imageParam)

      // If there's either search text or an image param, treat as explicit search
      const explicit = Boolean(searchParam.trim().length > 0 || imageParam)
      setExplicitSearchTriggered(explicit)

      // Adjust active filter according to mode or presence of image
      const mode = params.get("mode") === "products" ? "products" : "outfits"
      if (searchParam.trim().length > 0) {
        setActiveFilter(mode)
      } else if (imageParam) {
        setActiveFilter("products")
      } else {
        setActiveFilter("outfits")
      }
    }

    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  // --- HANDLERS ---
  const parseFiltersFromIds = useCallback((filterIds: string[]): ProductSearchFilters => {
    const filters: ProductSearchFilters = {}
    filterIds.forEach((filterId) => {
      const [category, value] = filterId.split(":")
      if (!category || !value) return

      switch (category) {
        case "type":
          if (!filters.typeCategories) filters.typeCategories = []
          filters.typeCategories.push(value)
          break
        case "gender":
          if (!filters.genders) filters.genders = []
          filters.genders.push(value)
          break
        case "category":
          if (!filters.categoryIds) filters.categoryIds = []
          filters.categoryIds.push(value)
          break
        case "brand":
          if (!filters.brands) filters.brands = []
          filters.brands.push(value)
          break
        case "fit":
          if (!filters.fits) filters.fits = []
          filters.fits.push(value)
          break
        case "feel":
          if (!filters.feels) filters.feels = []
          filters.feels.push(value)
          break
        case "vibe":
          if (!filters.vibes) filters.vibes = []
          filters.vibes.push(value)
          break
        case "price": {
          const [minStr, maxStr] = value.split("-")
          if (minStr) filters.minPrice = parseFloat(minStr)
          if (maxStr) filters.maxPrice = parseFloat(maxStr)
          break
        }
        case "subcategory":
          if (!filters.typeSubCategories) filters.typeSubCategories = []
          filters.typeSubCategories.push(value)
          break
      }
    })
    return filters
  }, [])

  const handleFilterApply = useCallback(
    (filterIds: string[]) => {
      setActiveFilterIds(filterIds)
      const filters = parseFiltersFromIds(filterIds)
      setProductFilters(filters)
      
      const typeFilters = filterIds
        .filter((id) => id.startsWith("type:"))
        .map((id) => id.replace("type:", ""))
      setDraftTypeFilters(typeFilters)

      // Commit point: filters_apply (products).
      if (
        explicitSearchTriggered &&
        isResultsMode &&
        (committedSearchTerm.trim().length > 0 || Boolean(appliedImageUrl))
      ) {
        const nextMode: SearchMode = "products"
        const nextSort = sortValue || "similarity"

        const nextSearchType = computeSearchType({ queryRaw: committedSearchTerm, imageUrl: appliedImageUrl })
        const nextFilters = canonicalizeProductSearchFilters(filters)
        const nextSig = computeSearchContextSignature({
          query_raw: committedSearchTerm,
          search_type: nextSearchType,
          mode: nextMode,
          filters: nextFilters,
          sort: nextSort,
        })

        const currentSig = currentSearchSigRef.current
        if (!currentSig || nextSig !== currentSig) {
          emitSearchSubmitted("filters_apply", {
            queryRaw: committedSearchTerm,
            imageUrl: appliedImageUrl,
            mode: nextMode,
            sort: nextSort,
            productFilters: filters,
            outfitFilters,
          })
        }
      }
    },
    [
      appliedImageUrl,
      committedSearchTerm,
      emitSearchSubmitted,
      explicitSearchTriggered,
      isResultsMode,
      outfitFilters,
      parseFiltersFromIds,
      sortValue,
    ],
  )

  const handleFilterOptionsChange = useCallback((filterIds: string[]) => {
    const typeFilters = filterIds
      .filter((id) => id.startsWith("type:"))
      .map((id) => id.replace("type:", ""))
    
    setDraftTypeFilters((prev) => {
      const sortedPrev = [...prev].sort()
      const sortedNext = [...typeFilters].sort()

      if (JSON.stringify(sortedPrev) === JSON.stringify(sortedNext)) {
        return prev
      }
      return typeFilters
    })
  }, [])

  useEffect(() => {
    if (!draftTypeFilters) return
    setActiveFilterIds((prev) => {
      const nonType = prev.filter((id) => !id.startsWith("type:"))
      const typeIds = draftTypeFilters.map((t) => `type:${t}`)
      const merged = [...nonType, ...typeIds]
      return merged
    })
  }, [draftTypeFilters])

  const handleFilterClearAll = useCallback(() => {
    setActiveFilterIds([])
    setProductFilters({})
    setDraftTypeFilters([])
  }, [])

  useEffect(() => {
    // Reset filters and sort when the search query changes from the URL
    setActiveFilterIds([])
    setProductFilters({})
    setDraftTypeFilters([])
    setSortValue("similarity")
  }, [committedSearchTerm])

  // --- QUERIES ---
  const {
    data: browseCollections,
    isLoading: isBrowseLoading,
    isError: isBrowseError,
  } = useSearchBrowseCollections({ enabled: !isResultsMode })

  const outfitResultsQuery = useSearchOutfitResults({
    query: committedSearchTerm,
    imageUrl: appliedImageUrl,
    filters: outfitFilters,
    enabled: explicitSearchTriggered && isResultsMode && activeFilter === "outfits",
  })

  // Hook uses uploadedImageUrl state
  const productResultsQuery = useSearchProductResults({
    query: committedSearchTerm,
    imageUrl: appliedImageUrl,
    enabled: explicitSearchTriggered && isResultsMode && activeFilter === "products",
    filters: productFilters,
  })

  // --- FILTER OPTIONS ---
  const activeTypeFilters = useMemo(() => {
    return activeFilterIds
      .filter((id) => id.startsWith("type:"))
      .map((id) => id.replace("type:", ""))
  }, [activeFilterIds])

  const effectiveTypeFilters = draftTypeFilters.length > 0 ? draftTypeFilters : activeTypeFilters

  const { data: filterOptions } = useProductFilterOptions({
    typeFilters: effectiveTypeFilters.length > 0 ? effectiveTypeFilters as Database["public"]["Enums"]["item_type"][] : undefined,
    enabled: isResultsMode && activeFilter === "products",
  })

  // --- AUTO-REMOVE INVALID FILTERS ---
  // If user selects a type (e.g. "Top"), we check if currently selected brands/fits are still valid.
  // If not, we remove them from activeFilterIds so the search query is accurate.
  useEffect(() => {
    if (!filterOptions) return

    setActiveFilterIds((prev) => {
      const next = prev.filter((filterId) => {
        // 1. Always keep Type, Price, and maybe specific system filters
        if (filterId.startsWith("type:") || filterId.startsWith("price:")) return true

        // 2. For dependent categories, check if the ID exists in the new filterOptions
        if (filterId.startsWith("brand:")) {
           const val = filterId.replace("brand:", "")
           return filterOptions.brands.includes(val)
        }
        if (filterId.startsWith("gender:")) {
           const val = filterId.replace("gender:", "")
           return filterOptions.genders.includes(val)
        }
        if (filterId.startsWith("category:")) {
           const val = filterId.replace("category:", "")
           return filterOptions.categoryIds.includes(val)
        }
        if (filterId.startsWith("fit:")) {
           const val = filterId.replace("fit:", "")
           return filterOptions.fits.includes(val)
        }
        if (filterId.startsWith("feel:")) {
           const val = filterId.replace("feel:", "")
           return filterOptions.feels.includes(val)
        }
        if (filterId.startsWith("vibe:")) {
           const val = filterId.replace("vibe:", "")
           return filterOptions.vibes.includes(val)
        }
        
        // Default keep if we don't know the category (safe fallback)
        return true
      })

      // Only update state if something was actually removed
      if (next.length !== prev.length) {
        return next
      }
      return prev
    })
  }, [filterOptions])

  // --- GLITCH FIX: PRESERVE OPTIONS DURING RELOAD ---
  const prevFilterOptionsRef = useRef<typeof filterOptions>(undefined)
  if (filterOptions) {
    prevFilterOptionsRef.current = filterOptions
  }
  const activeOptions = filterOptions ?? prevFilterOptionsRef.current

  const productFilterCategories = useMemo<FilterCategory[]>(() => {
    if (!activeOptions) return []
    const categories: FilterCategory[] = [
      {
        id: "type",
        label: "Type",
        options: activeOptions.types.length > 0 
          ? activeOptions.types.map((type) => ({ id: `type:${type}`, label: type.charAt(0).toUpperCase() + type.slice(1) }))
          : [{ id: "type:none", label: "No options available" }],
      },
      {
        id: "gender",
        label: "Gender",
        options: activeOptions.genders.length > 0 
          ? activeOptions.genders.map((gender) => ({ id: `gender:${gender}`, label: gender.charAt(0).toUpperCase() + gender.slice(1) }))
          : [{ id: "gender:none", label: "No options available" }],
      },
      {
        id: "brand",
        label: "Brand",
        options: activeOptions.brands.length > 0
          ? activeOptions.brands.map((brand) => ({ id: `brand:${brand}`, label: brand }))
          : [{ id: "brand:none", label: "No options available" }],
      },
      {
        id: "category",
        label: "Category",
        options: activeOptions.categoryIds.length > 0
          ? activeOptions.categoryIds.map((categoryId) => ({ id: `category:${categoryId}`, label: categoryId }))
          : [{ id: "category:none", label: "No options available" }],
      },
      {
        id: "subcategory",
        label: "Type Category",
        options: activeOptions.typeSubCategories.length > 0
          ? activeOptions.typeSubCategories.map((cat) => ({ id: `subcategory:${cat}`, label: cat.charAt(0).toUpperCase() + cat.slice(1) }))
          : [{ id: "subcategory:none", label: "No options available" }],
      },
      {
        id: "fit",
        label: "Fit",
        options: activeOptions.fits.length > 0
          ? activeOptions.fits.map((fit) => ({ id: `fit:${fit}`, label: fit.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") }))
          : [{ id: "fit:none", label: "No options available" }],
      },
      {
        id: "feel",
        label: "Feel",
        options: activeOptions.feels.length > 0
          ? activeOptions.feels.map((feel) => ({ id: `feel:${feel}`, label: feel.charAt(0).toUpperCase() + feel.slice(1) }))
          : [{ id: "feel:none", label: "No options available" }],
      },
      {
        id: "vibe",
        label: "Vibe",
        options: activeOptions.vibes.length > 0
          ? activeOptions.vibes.map((vibe) => ({ id: `vibe:${vibe}`, label: vibe.charAt(0).toUpperCase() + vibe.slice(1) }))
          : [{ id: "vibe:none", label: "No options available" }],
      },
    ]
    return categories
  }, [activeOptions])

  // --- RESULT MAPPING ---
  const mapOutfitToInspirationItem = useCallback(
    (entry: SearchBrowseOutfit): InspirationItem => ({
      id: entry.id,
      variant: "narrow",
      title: entry.title,
      chips: entry.chips,
      attribution: resolveOutfitAttribution(entry.outfit.created_by),
      outfitId: entry.outfit.id,
      renderedItems: entry.studioOutfit?.renderedItems ?? mapLegacyOutfitItemsToStudioItems(entry.outfit.items),
      gender: entry.avatarGender ?? "female",
      heightCm: entry.avatarHeightCm ?? 170,
      showTitle: false,
      showChips: false,
      showSaveButton: false,
    }),
    [],
  )

  const visibleCollections = useMemo<BrowseCollectionWithInspiration[]>(
    () => (browseCollections ?? []).map((collection) => ({
      ...collection,
      inspirationItems: collection.outfits.map(mapOutfitToInspirationItem),
    })),
    [browseCollections, mapOutfitToInspirationItem],
  )

  const outfitResultItems = useMemo<InspirationItem[]>(() => {
    const resolvedHeight = heightCm ?? 170
    const pages = outfitResultsQuery.data?.pages ?? []

    return pages
      .flatMap((page) => page.results)
      .map((result) => {
        // Use outfit's gender for mannequin, fallback to profile gender, then "female"
        const outfitGender = result.outfit.gender
        const resolvedGender = (outfitGender === 'male' || outfitGender === 'female') 
          ? outfitGender 
          : (profileGender ?? "female")
        
        return {
          id: result.outfit.id,
          variant: "narrow",
          title: result.outfit.name,
          chips: getOutfitChips(result.outfit),
          outfitId: result.outfit.id,
          renderedItems: result.studioOutfit?.renderedItems ?? mapLegacyOutfitItemsToStudioItems(result.outfit.items),
          gender: resolvedGender,
          heightCm: resolvedHeight,
          attribution: resolveOutfitAttribution(result.outfit.created_by),
          showTitle: true,
          showChips: true,
          showSaveButton: true,
          isSaved: favoriteIds.includes(result.outfit.id),
          outfit: result.outfit,
        }
      })
  }, [favoriteIds, heightCm, outfitResultsQuery.data?.pages, profileGender])

  const productResultItems = useMemo(() => {
    const items = (productResultsQuery.data?.pages ?? [])
      .flatMap((page) => page.results)
      .map((result) => {
        const saved = productSaveActions.isSaved(result.id)
        return {
          id: result.id,
          imageSrc: result.imageSrc,
          title: result.title,
          brand: result.brand,
          price: result.priceLabel,
          rawPrice: result.price,
          similarity: result.similarity ?? 0,
          isSaved: saved,
          _saved: saved,
        }
      })

    // Apply frontend sorting based on sortValue
    if (sortValue === "price-low-high") {
      items.sort((a, b) => a.rawPrice - b.rawPrice)
    } else if (sortValue === "price-high-low") {
      items.sort((a, b) => b.rawPrice - a.rawPrice)
    }
    // "similarity" is the default from backend, no additional sorting needed

    const positionById = computeBucketedRowMajorPositions(
      items.map((item) => item.id),
      2,
    )

    return items.map((item) => {
      const position = positionById.get(item.id)
      const uiContext: EntityUiContext = { layout: "vertical_grid", position }
      const saved = item._saved

      return {
        id: item.id,
        imageSrc: item.imageSrc,
        title: item.title,
        brand: item.brand,
        price: item.price,
        rawPrice: item.rawPrice,
        similarity: item.similarity,
        isSaved: saved,
        onToggleSave: () => productSaveActions.onToggleSave(item.id, !saved, uiContext),
        onLongPressSave: () => productSaveActions.onLongPressSave(item.id, uiContext),
      }
    })
  }, [productResultsQuery.data?.pages, productSaveActions, sortValue])

  const originPath = useMemo(
    () => `${location.pathname}${location.search}` || "/search",
    [location.pathname, location.search],
  )

  const handleProductSelect = useCallback(
    (productId: string) => {
      const params = new URLSearchParams()
      params.set("returnTo", encodeURIComponent(originPath))
      const search = params.toString()
      navigate(`/studio/product/${encodeURIComponent(productId)}${search ? `?${search}` : ""}`)
    },
    [navigate, originPath],
  )

  const productPositionById = useMemo(() => {
    return computeBucketedRowMajorPositions(
      productResultItems.map((item) => item.id),
      2,
    )
  }, [productResultItems])

  const productImpressionRefById = useMemo(() => {
    const map = new Map<string, (el: HTMLDivElement | null) => void>()
    for (const item of productResultItems) {
      const position = productPositionById.get(item.id)
      if (typeof position !== "number") continue

      let lastEl: Element | null = null
      map.set(item.id, (el) => {
        if (!el) {
          if (lastEl) unobserveSearchResultsCard(lastEl)
          lastEl = null
          return
        }

        if (lastEl && lastEl !== el) {
          unobserveSearchResultsCard(lastEl)
        }

        observeSearchResultsCard({
          element: el,
          entityType: "product",
          entityId: item.id,
          position,
        })
        lastEl = el
      })
    }

    return map
  }, [productPositionById, productResultItems])

  const outfitPositionById = useMemo(() => {
    const ids = outfitResultItems
      .map((item) => item.outfitId ?? item.outfit?.id ?? null)
      .filter((id): id is string => Boolean(id))
    return computeBucketedRowMajorPositions(ids, 2)
  }, [outfitResultItems])

  const outfitImpressionRefByOutfitId = useMemo(() => {
    const map = new Map<string, (el: HTMLDivElement | null) => void>()

    for (const item of outfitResultItems) {
      const outfitId = item.outfitId ?? item.outfit?.id ?? null
      if (!outfitId) continue
      const position = outfitPositionById.get(outfitId)
      if (typeof position !== "number") continue

      let lastEl: Element | null = null
      map.set(outfitId, (el) => {
        if (!el) {
          if (lastEl) unobserveSearchResultsCard(lastEl)
          lastEl = null
          return
        }

        if (lastEl && lastEl !== el) {
          unobserveSearchResultsCard(lastEl)
        }

        observeSearchResultsCard({
          element: el,
          entityType: "outfit",
          entityId: outfitId,
          position,
        })
        lastEl = el
      })
    }

    return map
  }, [outfitPositionById, outfitResultItems])

  const handleProductGridSelect = useCallback(
    (item: { id: string }) => {
      const position = productPositionById.get(item.id)
      trackItemClicked(analytics, {
        entity_type: "product",
        entity_id: item.id,
        layout: "vertical_grid",
        position,
      })
      handleProductSelect(item.id)
    },
    [analytics, handleProductSelect, productPositionById],
  )

  const handleInspirationSelect = useCallback(
    (item: InspirationItem) => {
      if (!item.outfit) {
        return
      }
      const outfitId = item.outfitId ?? item.outfit.id
      const position = outfitPositionById.get(outfitId)
      trackItemClicked(analytics, {
        entity_type: "outfit",
        entity_id: outfitId,
        layout: "vertical_grid",
        position,
      })
      launchStudio(item.outfit)
    },
    [analytics, launchStudio, outfitPositionById],
  )

  const pendingOutfitContextRef = useRef<EntityUiContext | null>(null)

  const handleToggleOutfitById = useCallback(
    async (outfitId: string, nextSaved: boolean, uiContext: EntityUiContext, saveMethod: "click" | "long_press") => {
      try {
        if (nextSaved) {
          await saveToCollectionMutation.mutateAsync({ outfitId, slug: "favorites", label: "Favorites" })
          trackSaveToggled(analytics, {
            entity_type: "outfit",
            entity_id: outfitId,
            new_state: true,
            save_method: saveMethod,
            ...uiContext,
          })
          trackSavedToCollection(analytics, {
            entity_type: "outfit",
            entity_id: outfitId,
            collection_slug: "favorites",
            save_method: saveMethod,
            ...uiContext,
          })
        } else {
          await removeOutfitFromLibraryMutation.mutateAsync({ outfitId })
          trackSaveToggled(analytics, {
            entity_type: "outfit",
            entity_id: outfitId,
            new_state: false,
            save_method: saveMethod,
            ...uiContext,
          })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update favorite"
        toast({ title: "Save failed", description: message, variant: "destructive" })
        favoritesQuery.refetch()
      }
    },
    [analytics, favoritesQuery, removeOutfitFromLibraryMutation, saveToCollectionMutation, toast],
  )

  const handleLongPressOutfitById = useCallback(
    async (outfitId: string, uiContext: EntityUiContext) => {
      try {
        await saveToCollectionMutation.mutateAsync({ outfitId, slug: "favorites", label: "Favorites" })
        trackSaveToggled(analytics, {
          entity_type: "outfit",
          entity_id: outfitId,
          new_state: true,
          save_method: "long_press",
          ...uiContext,
        })
        trackSavedToCollection(analytics, {
          entity_type: "outfit",
          entity_id: outfitId,
          collection_slug: "favorites",
          save_method: "long_press",
          ...uiContext,
        })
        pendingOutfitContextRef.current = uiContext
        setPendingOutfitId(outfitId)
        setIsOutfitPickerOpen(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save outfit"
        toast({ title: "Save failed", description: message, variant: "destructive" })
      }
    },
    [analytics, saveToCollectionMutation, toast],
  )

  const handleToggleFavorite = useCallback(
    (item: InspirationItem, nextSaved: boolean) => {
      const outfitId = item.outfitId ?? item.outfit?.id ?? null
      if (!outfitId) return
      const position = outfitPositionById.get(outfitId)
      handleToggleOutfitById(outfitId, nextSaved, { layout: "vertical_grid", position }, "click")
    },
    [handleToggleOutfitById, outfitPositionById],
  )

  const handleLongPressSave = useCallback(
    (item: InspirationItem) => {
      const outfitId = item.outfitId ?? item.outfit?.id ?? null
      if (!outfitId) return
      const position = outfitPositionById.get(outfitId)
      handleLongPressOutfitById(outfitId, { layout: "vertical_grid", position })
    },
    [handleLongPressOutfitById, outfitPositionById],
  )

  const handleMoodboardPickerSelect = useCallback(
    async (slug: string) => {
      if (!pendingOutfitId) return
      const label = selectableMoodboards.find((board) => board.slug === slug)?.label ?? slug
      try {
        await saveToCollectionMutation.mutateAsync({ outfitId: pendingOutfitId, slug, label })
        const uiContext = pendingOutfitContextRef.current ?? {}
        trackSavedToCollection(analytics, {
          entity_type: "outfit",
          entity_id: pendingOutfitId,
          collection_slug: slug,
          save_method: "long_press",
          ...uiContext,
        })
        setPendingOutfitId(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to add to moodboard"
        toast({ title: "Add failed", description: message, variant: "destructive" })
      }
    },
    [analytics, pendingOutfitId, saveToCollectionMutation, selectableMoodboards, toast],
  )

  const handleMoodboardPickerApply = useCallback(
    async (slugs: string[]) => {
      if (!pendingOutfitId) return
      try {
        for (const slug of slugs) {
          const label = selectableMoodboards.find((board) => board.slug === slug)?.label ?? slug
          await saveToCollectionMutation.mutateAsync({ outfitId: pendingOutfitId, slug, label })
          const uiContext = pendingOutfitContextRef.current ?? {}
          trackSavedToCollection(analytics, {
            entity_type: "outfit",
            entity_id: pendingOutfitId,
            collection_slug: slug,
            save_method: "long_press",
            ...uiContext,
          })
        }
        setPendingOutfitId(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to add to moodboards"
        toast({ title: "Add failed", description: message, variant: "destructive" })
      }
    },
    [analytics, pendingOutfitId, saveToCollectionMutation, selectableMoodboards, toast],
  )

  const handleCreateMoodboard = useCallback(
    async (name: string) => {
      const result = await createMoodboardMutation.mutateAsync(name)
      return result.slug
    },
    [createMoodboardMutation],
  )

  const isOutfitResultsLoading = outfitResultsQuery.isLoading
  const isOutfitResultsError = outfitResultsQuery.isError
  const isProductResultsLoading = productResultsQuery.isLoading
  const isProductResultsError = productResultsQuery.isError

  // --- RENDER HELPERS ---
  const renderResultPlaceholder = (message: string) => (
    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-muted-foreground/30 bg-muted/10 p-6 text-sm text-muted-foreground">
      {message}
    </div>
  )

  const renderOutfitResultsContent = () => {
    if (isOutfitResultsLoading) {
      return <OutfitResultsSkeleton />
    }
    if (isOutfitResultsError) {
      return renderResultPlaceholder("Unable to fetch outfits right now.")
    }
    if (outfitResultItems.length === 0) {
      return renderResultPlaceholder("No outfits match this query yet.")
    }

    return (
      <OutfitInspirationGrid
        items={outfitResultItems}
        columns={2}
        rows={8}
        layoutMode="balanced"
        cardTotalHeight={290}
        cardVerticalGap={4}
        cardMinAvatarHeight={128}
        fixedAvatarHeight={156}
        cardPreset="homeCurated"
        onCardSelect={handleInspirationSelect}
        onToggleSave={handleToggleFavorite}
        onLongPressSave={handleLongPressSave}
        getItemWrapperRef={(item) => {
          const outfitId = item.outfitId ?? item.outfit?.id ?? null
          if (!outfitId) return undefined
          return outfitImpressionRefByOutfitId.get(outfitId)
        }}
      />
    )
  }

  const renderProductResultsContent = () => {
    if (isProductResultsLoading) {
      return <ProductResultsSkeleton />
    }
    if (isProductResultsError) {
      return renderResultPlaceholder("Unable to fetch products right now.")
    }
    if (productResultItems.length === 0) {
      return renderResultPlaceholder("No products match this query yet.")
    }

    return (
      <div className="flex flex-col gap-2 [&_img]:aspect-[3/4] [&_img]:object-contain">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          Found {productResultItems.length} items
        </p>
        <ProductResultsGrid
          items={productResultItems}
          columns={2}
          rows={8}
          onItemSelect={handleProductGridSelect}
          getItemWrapperRef={(item) => productImpressionRefById.get(item.id)}
        />
      </div>
    )
  }

  // --- URL & INTERACTION LOGIC ---
  const isFetchingMore =
    activeFilter === "outfits" ? outfitResultsQuery.isFetchingNextPage : productResultsQuery.isFetchingNextPage

  const updateUrlState = useCallback(
    (nextSearch: string, nextMode: "products" | "outfits") => {
      const trimmed = nextSearch.trim()
      const params = new URLSearchParams()
      if (trimmed.length > 0) {
        params.set("search", nextSearch)
        params.set("mode", nextMode)
        // Persist image URL if it exists
        if (uploadedImageUrl) params.set("imageUrl", encodeURIComponent(uploadedImageUrl))
        setSearchParams(params, { replace: false })
      } else {
        // If searching with just image, keep that
        if (uploadedImageUrl) {
           params.set("mode", nextMode)
           params.set("imageUrl", encodeURIComponent(uploadedImageUrl))
           setSearchParams(params, { replace: false })
        } else {
           setSearchParams(new URLSearchParams(), { replace: false })
        }
      }
    },
    [setSearchParams, uploadedImageUrl],
  )

  const prevSearchParamRef = useRef(searchParamValue)

  useEffect(() => {
    // Only update searchTerm if the URL's search param has actually changed.
    // This prevents other dependencies (like uploadedImageUrl) from resetting
    // the local searchTerm when the user has cleared it but not submitted.
    if (prevSearchParamRef.current !== searchParamValue) {
      setSearchTerm(searchParamValue)
      prevSearchParamRef.current = searchParamValue
    }

    if (searchParamValue.trim().length > 0) {
      // If a text search exists in the URL, ensure we clear manual image trigger
      setImageSearchTriggered(false)
      setActiveFilter((prev) => {
        const target = modeParamValue
        return prev === target ? prev : target
      })
    }
    // Don't force products mode for image-only search - respect user's mode choice
    // Both outfit and product search support image search
  }, [modeParamValue, searchParamValue])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || !isResultsMode) return

      if (activeFilter === "outfits") {
        if (outfitResultsQuery.hasNextPage && !outfitResultsQuery.isFetchingNextPage) {
          outfitResultsQuery.fetchNextPage()
        }
      } else {
        if (productResultsQuery.hasNextPage && !productResultsQuery.isFetchingNextPage) {
          productResultsQuery.fetchNextPage()
        }
      }
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [
    activeFilter,
    isResultsMode,
    outfitResultsQuery.fetchNextPage,
    outfitResultsQuery.hasNextPage,
    outfitResultsQuery.isFetchingNextPage,
    productResultsQuery.fetchNextPage,
    productResultsQuery.hasNextPage,
    productResultsQuery.isFetchingNextPage,
  ])

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value)
      // typing does NOT reset explicit search; we keep the previous results visible/active
      // until the user submits a new query.
    },
    [],
  )

  const handleSubmit = useCallback(() => {
    const trimmed = searchTerm.trim()
    if (trimmed.length === 0 && !uploadedImageUrl) {
      return
    }
    // Keep user's current mode - both outfit and product search support image search
    const nextMode = activeFilter
    // If user is submitting with only an image, treat that as an explicit image search
    if (trimmed.length === 0 && uploadedImageUrl) {
      setImageSearchTriggered(true)
      setExplicitSearchTriggered(true)
    } else {
      setImageSearchTriggered(false)
      setExplicitSearchTriggered(true)
    }
    // Apply image for the search results
    setAppliedImageUrl(uploadedImageUrl)

    // `search_submitted(search_trigger=query_submit)` is emitted from the committed URL/deep-link effect only.
    // This prevents duplicate submissions when local state updates race the URL commit.

    // If we are including an image, suppress the URL sync so it doesn't duplicate the query
    if (uploadedImageUrl) {
      setSuppressUrlSync(true)
    }

    // Update URL with image if present
    const params = new URLSearchParams()
    if (trimmed.length > 0) {
      params.set("search", trimmed)
    }
    if (uploadedImageUrl) {
      params.set("imageUrl", encodeURIComponent(uploadedImageUrl))
    }
    params.set("mode", nextMode)
    setSearchParams(params, { replace: false })
  }, [
    activeFilter,
    emitSearchSubmitted,
    outfitFilters,
    productFilters,
    searchTerm,
    setSearchParams,
    sortValue,
    uploadedImageUrl,
  ])

  const handleClear = useCallback(() => {
    setSearchTerm("")
    // Don't update URL or reset triggers immediately.
    // This prevents the UI from jumping back to "Browse" mode while the user is just clearing input.
  }, [])

  const handleClearImage = useCallback(() => {
    // Hide the uploaded image preview in the UI but do NOT change the URL or applied search state.
    // Keeping the URL unchanged ensures back/forward semantics remain consistent and
    // prevents an implicit re-render or duplicate search invocation.
    setUploadedImageUrl(undefined)

    // Turn off image-specific trigger but preserve results mode
    setImageSearchTriggered(false)
    // explicitSearchTriggered stays true to keep showing results
  }, [])
  
  // --- IMAGE UPLOAD LOGIC ---
  const handleImageUpload = async (file: File) => {
    try {
      const publicUrl = await searchImageUpload.mutateAsync(file)
      setUploadedImageUrl(publicUrl)
      // Don't change mode here - let user stay in their current mode (outfits or products)
      // Both modes support image search
    } catch (error) {
      console.error("Image upload failed:", error)
      const message = error instanceof Error ? error.message : "Unknown error"
      toast({ 
        title: "Upload failed", 
        description: `Could not upload image. Ensure 'public-files' bucket exists. Error: ${message}`, 
        variant: "destructive" 
      })
    }
  }

  const handleFilterChange = useCallback(
    (next: "products" | "outfits") => {
      // Commit point: mode_change (only when results are active).
      if (
        next !== activeFilter &&
        explicitSearchTriggered &&
        isResultsMode &&
        (committedSearchTerm.trim().length > 0 || Boolean(appliedImageUrl))
      ) {
        const nextModeTyped = next as SearchMode
        const nextSort = sortValue || "similarity"
        const nextSearchType = computeSearchType({ queryRaw: committedSearchTerm, imageUrl: appliedImageUrl })
        const nextFilters =
          nextModeTyped === "products"
            ? canonicalizeProductSearchFilters(productFilters)
            : canonicalizeOutfitSearchFilters(outfitFilters)
        const nextSig = computeSearchContextSignature({
          query_raw: committedSearchTerm,
          search_type: nextSearchType,
          mode: nextModeTyped,
          filters: nextFilters,
          sort: nextSort,
        })

        const currentSig = currentSearchSigRef.current
        if (!currentSig || nextSig !== currentSig) {
          emitSearchSubmitted("mode_change", {
            queryRaw: committedSearchTerm,
            imageUrl: appliedImageUrl,
            mode: nextModeTyped,
            sort: nextSort,
            productFilters,
            outfitFilters,
          })
        }
      }

      setActiveFilter(next)
      // Also sync to URL if we're in results mode
      if (explicitSearchTriggered) {
        const params = new URLSearchParams(searchParams)
        params.set("mode", next)
        setSearchParams(params, { replace: true })
      }
    },
    [
      activeFilter,
      appliedImageUrl,
      committedSearchTerm,
      emitSearchSubmitted,
      explicitSearchTriggered,
      isResultsMode,
      outfitFilters,
      productFilters,
      searchParams,
      setSearchParams,
      sortValue,
    ],
  )

  const handleFilterToggle = useCallback(() => {
    const next = activeFilter === "products" ? "outfits" : "products"
    handleFilterChange(next)
  }, [activeFilter, handleFilterChange])

  const handleOpenCuratedSection = useCallback(
    (categoryId: string, title: string) => {
      const params = new URLSearchParams()
      params.set("categoryId", categoryId)
      params.set("title", title)
      const returnTo = `${location.pathname}${location.search}` || "/search"
      params.set("returnTo", encodeURIComponent(returnTo))
      navigate(`/studio/outfit-suggestions?${params.toString()}`, { replace: false })
    },
    [location.pathname, location.search, navigate],
  )

  const filterChips = useMemo<FilterSearchBarChip[]>(
    () => [
      {
        id: "products",
        label: "Products",
        isActive: activeFilter === "products",
        onActivate: () => handleFilterChange("products"),
        onDeactivate: () => handleFilterToggle(),
      },
      {
        id: "outfits",
        label: "Outfits",
        isActive: activeFilter === "outfits",
        onActivate: () => handleFilterChange("outfits"),
        onDeactivate: () => handleFilterToggle(),
      },
    ],
    [activeFilter, handleFilterChange, handleFilterToggle],
  )

  return (
    <div className="flex flex-1 flex-col items-center justify-start px-1 pt-6">
      <div
        className={cn(
          `flex w-full max-w-[${CARD_MAX_WIDTH}] flex-1 flex-col rounded-xl bg-card shadow-sm`,
          isResultsMode ? "pt-[4.5rem]" : "",
        )}
      >
        {isResultsMode ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 overflow-hidden">
              <div 
                className="flex flex-1 flex-col overflow-y-auto px-2 pb-20 pt-3 scrollbar-hide"
              >
                {activeFilter === "products" ? renderProductResultsContent() : renderOutfitResultsContent()}
                <div ref={loadMoreRef} className="h-6 w-full" />
                {isFetchingMore ? renderResultPlaceholder("Loading more...") : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3 scrollbar-hide"
              style={{ paddingBottom: DEFAULT_RESULTS_PADDING_BOTTOM }}
            >
              {isBrowseLoading ? (
                 <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex flex-col gap-2">
                        <div className="aspect-[3/4] w-full animate-pulse rounded-xl bg-muted/20" />
                      </div>
                    ))}
                 </div>
              ) : isBrowseError ? (
                <div className="flex flex-1 items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                  Unable to load collections right now.
                </div>
              ) : visibleCollections.length > 0 ? (
                visibleCollections.map((collection) => (
                  <section key={collection.categoryId} className="flex flex-col gap-2">
                    <SectionHeader
                      title={collection.title}
                      actionSlot={
                        <IconButton
                          aria-label={`See more ${collection.subtitle ?? "items"}`}
                          tone="ghost"
                          size="xxs"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => handleOpenCuratedSection(collection.categoryId, collection.title)}
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </IconButton>
                      }
                    />
                    <RecentStylesRail
                      items={collection.inspirationItems}
                      className="px-0"
                      railClassName="gap-1"
                      itemClassName="flex h-40 w-[7.5rem] flex-shrink-0 flex-col cursor-pointer"
                      onCardSelect={() => handleOpenCuratedSection(collection.categoryId, collection.title)}
                      cardOptions={{
                        showTitle: false,
                        showChips: false,
                        showSaveButton: false,
                        className: "h-40 w-full",
                      }}
                      cardPreset="homeCurated"
                    />
                  </section>
                ))
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-muted-foreground/30 bg-muted/10 p-6 text-sm text-muted-foreground">
                  Use the search bar to explore outfits and products.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {!isResultsMode && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[3rem] z-10">
          <div className="pointer-events-auto mx-auto w-full px-2" style={{ maxWidth: CARD_MAX_WIDTH }}>
            <FilterSearchBar
              className="rounded-t-3xl"
              value={searchTerm}
              onValueChange={handleSearchChange}
              filters={isSearchFocused ? filterChips : undefined}
              pillPosition={isSearchFocused ? "top" : "none"}
              variant="elevated"
              onSubmit={handleSubmit}
              onClear={handleClear}
              placeholder={isSearchFocused 
                ? (activeFilter === "products" ? "Search products..." : "Search outfits...") 
                : "Discover your next look"
              }
              trailingAction={searchTerm.trim().length > 0 ? undefined : null}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              
              onImageUpload={handleImageUpload}
              isUploadingImage={isUploading}
              previewImageUrl={uploadedImageUrl}
              onClearImage={handleClearImage}
              showCompactPreview={false}

              leadingActions={null}
            />
          </div>
        </div>
      )}

      {isResultsMode && (
        <div className="pointer-events-none fixed inset-x-0 top-[0.5rem] z-20">
          <div className="pointer-events-auto mx-auto w-full px-2" style={{ maxWidth: CARD_MAX_WIDTH }}>
            <FilterSearchBar
              className="rounded-b-3xl"
              value={searchTerm}
              onValueChange={handleSearchChange}
              filters={filterChips}
              pillPosition="bottom"
              variant="elevated"
              onSubmit={handleSubmit}
              onClear={handleClear}
              placeholder={activeFilter === "products" ? "Search products" : "Search outfits"}
              trailingAction={searchTerm.trim().length > 0 ? undefined : null}
              
              onImageUpload={handleImageUpload}
              isUploadingImage={isUploading}
              previewImageUrl={uploadedImageUrl}
              onClearImage={handleClearImage}
              showCompactPreview={isResultsMode && explicitSearchTriggered}
              
              sortValue={sortValue}
              onSortChange={(nextSort) => {
                if (nextSort === sortValue) return

                // Commit point: sort_change (only when results are active).
                if (
                  explicitSearchTriggered &&
                  isResultsMode &&
                  (committedSearchTerm.trim().length > 0 || Boolean(appliedImageUrl))
                ) {
                  const nextModeTyped = activeFilter as SearchMode
                  const nextSearchType = computeSearchType({ queryRaw: committedSearchTerm, imageUrl: appliedImageUrl })
                  const nextFilters =
                    nextModeTyped === "products"
                      ? canonicalizeProductSearchFilters(productFilters)
                      : canonicalizeOutfitSearchFilters(outfitFilters)
                  const nextSig = computeSearchContextSignature({
                    query_raw: committedSearchTerm,
                    search_type: nextSearchType,
                    mode: nextModeTyped,
                    filters: nextFilters,
                    sort: nextSort,
                  })

                  const currentSig = currentSearchSigRef.current
                  if (!currentSig || nextSig !== currentSig) {
                    emitSearchSubmitted("sort_change", {
                      queryRaw: committedSearchTerm,
                      imageUrl: appliedImageUrl,
                      mode: nextModeTyped,
                      sort: nextSort,
                      productFilters,
                      outfitFilters,
                    })
                  }
                }

                setSortValue(nextSort)
              }}

              leadingActions={
                activeFilter === "products" && 
                (productFilterCategories.length > 0 || activeFilterIds.length > 0) && 
                !isProductResultsLoading && 
                !isProductResultsError
                  ? undefined 
                  : null 
              }
              {...(activeFilter === "products" && 
                (productFilterCategories.length > 0 || activeFilterIds.length > 0) && 
                !isProductResultsLoading && 
                !isProductResultsError && {
                  filterCategories: productFilterCategories,
                  activeFilters: activeFilterIds,
                  onFilterApply: handleFilterApply,
                  onFilterClearAll: handleFilterClearAll,
                  onFilterChange: handleFilterOptionsChange,
                })}
            />
          </div>
        </div>
      )}

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
        onSelect={handleMoodboardPickerSelect}
        onApply={handleMoodboardPickerApply}
        onCreate={handleCreateMoodboard}
        isSaving={saveToCollectionMutation.isPending || createMoodboardMutation.isPending}
        title="Add to moodboard"
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
    </div>
  )
}

export function SearchScreen() {
  return (
    <AppShellLayout>
      <SearchScreenView />
    </AppShellLayout>
  )
}
