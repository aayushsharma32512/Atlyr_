import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { MoodboardPickerDrawer, OutfitCard, ProductTile, SearchBar, type FilterCategory } from "@/design-system/primitives"

import type { InspirationItem } from "@/features/studio/types"
import { mapLegacyOutfitItemsToStudioItems } from "@/features/studio/mappers/renderedItemMapper"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { cn } from "@/lib/utils"
import { getOutfitChips } from "@/utils/outfitChips"
import { useSearchOutfitResults } from "@/features/search/hooks/useSearchOutfitResults"
import { useSearchProductResults } from "@/features/search/hooks/useSearchProductResults"
import { useProductFilterOptions } from "@/features/search/hooks/useProductFilterOptions"
import { useSearchImageUpload } from "@/features/search/hooks/useSearchImageUpload"
import { SearchFilterSheet } from "@/features/search/components/SearchFilterSheet"
import { FEED_GRID } from "@/features/search/components/FeedGrid"
import { SearchDock } from "@/features/search/components/SearchDock"
import { SearchFeed } from "@/features/search/components/SearchFeed"
import { SearchListPage } from "@/features/search/components/SearchListPage"
import { SearchScopeRail } from "@/features/search/components/SearchScopeRail"
import type { FeedHandlers, FeedList, FeedLayout } from "@/features/search/components/SearchRail"
import { useSearchFeed } from "@/features/search/hooks/useSearchFeed"
import type { FeedLook, FeedPiece } from "@/features/search/utils/feedShaping"
import { isSearchScope, resolveScope, scopeToMode, scopeToSlot, type SearchScope } from "@/features/search/utils/scope"
import { readStudioLastPath } from "@/features/studio/constants"
import { buildStudioFocusUrl, isStudioSlot, parseStudioPath } from "@/features/studio/utils/studioUrlState"
import { ErrorCard, NoResultsCard, ResultsSkeleton } from "@/features/search/components/SearchResultStates"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import {
  useCreateMoodboard,
  useFavorites,
  useCollectionsOverview,
  useRemoveOutfitFromLibrary,
  useRemoveFromCollection,
  useSaveToCollection,
  useProductCollectionMembership,
  useOutfitCollectionMembership,
} from "@/features/collections/hooks/useMoodboards"
import { useLaunchStudio } from "@/features/studio/hooks/useLaunchStudio"
import type { Database } from "@/integrations/supabase/types"
import type { ProductSearchFilters, OutfitSearchFilters } from "@/services/search/searchService"
import type { StudioProductTraySlot } from "@/services/studio/studioService"
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


// ---------- Search session persistence ----------
const SEARCH_SESSION_KEY = "atlyr:search:lastState"

interface SearchSessionState {
  search: string
  mode: "products" | "outfits"
  scope?: SearchScope
  imageUrl?: string
}

function generateSearchId(): string {
  const cryptoId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null
  if (cryptoId) return cryptoId
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

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
  
  // Scope is the outer control: it picks the feed and constrains what a search returns.
  const scope = useMemo(() => resolveScope(searchParams), [searchParams])
  const scopeSlot = scopeToSlot(scope)
  const listParam = searchParams.get("list")

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
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  // ----- Mount-only: restore last search state from sessionStorage -----
  // Runs once on mount. If the URL has no search/imageUrl param (user navigated here
  // without a deep-link), we re-inject the last committed search into the URL so the
  // results, search bar, and mode all restore seamlessly via the existing URL-sync logic.
  const hasRestoredSessionRef = useRef(false)
  useEffect(() => {
    if (hasRestoredSessionRef.current) return
    hasRestoredSessionRef.current = true

    // A nav tab tap asks for the reset state, not the last search.
    if ((location.state as { fresh?: boolean } | null)?.fresh) return

    // If URL already carries search state, honour it — don't overwrite with stale session.
    const currentParams = new URLSearchParams(window.location.search)
    if (currentParams.has("search") || currentParams.has("imageUrl")) return

    try {
      const raw = window.sessionStorage.getItem(SEARCH_SESSION_KEY)
      if (!raw) return
      const saved: SearchSessionState = JSON.parse(raw)
      if (!saved.search && !saved.imageUrl) return

      const nextParams = new URLSearchParams()
      if (saved.search) nextParams.set("search", saved.search)
      if (saved.mode) nextParams.set("mode", saved.mode)
      if (isSearchScope(saved.scope)) nextParams.set("scope", saved.scope)
      if (saved.imageUrl) nextParams.set("imageUrl", encodeURIComponent(saved.imageUrl))
      setSearchParams(nextParams, { replace: true })
    } catch {
      // Corrupt storage — ignore silently
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally mount-only

  // Logic: Results mode active if text exists OR user explicitly triggered a search OR we have an applied image
  const hasTextSearch = searchParamValue.trim().length > 0
  const isResultsMode = hasTextSearch || explicitSearchTriggered || Boolean(appliedImageUrl)

  // Results win over a `list` param: a stale link never hides the rail behind a list page.
  const openList: FeedList | null =
    !isResultsMode && (listParam === "hot" || listParam === "curations") ? listParam : null

  const [activeFilter, setActiveFilter] = useState<"products" | "outfits">(
    // Derived from the URL scope; `mode` is the legacy name for the same choice.
    () => scopeToMode(resolveScope(searchParams)),
  )

  const [outfitFilters] = useState<OutfitSearchFilters>({})
  const [productFilters, setProductFilters] = useState<ProductSearchFilters>({})
  const [activeFilterIds, setActiveFilterIds] = useState<string[]>([])
  const [activeCollectionSlugs, setActiveCollectionSlugs] = useState<string[]>([])
  const [draftTypeFilters, setDraftTypeFilters] = useState<string[]>([])
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const searchImageUpload = useSearchImageUpload()
  const { gender: profileGender, heightCm } = useProfileContext()
  const productSaveActions = useProductSaveActions()
  const favoritesQuery = useFavorites()
  const favoriteIds = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data])
  const saveToCollectionMutation = useSaveToCollection()
  const removeOutfitFromLibraryMutation = useRemoveOutfitFromLibrary()
  const createMoodboardMutation = useCreateMoodboard()
  const collectionsOverviewQuery = useCollectionsOverview()
  const moodboards = collectionsOverviewQuery.data?.moodboards ?? []
  const selectableMoodboards = useMemo(
    () => moodboards.filter((m) => !m.isSystem),
    [moodboards],
  )
  const productCollectionMembership = useProductCollectionMembership()
  const outfitMembershipQuery = useOutfitCollectionMembership()
  const removeFromCollectionMutation = useRemoveFromCollection()
  const [pendingOutfitId, setPendingOutfitId] = useState<string | null>(null)
  const [pendingOutfitCurrentSlugs, setPendingOutfitCurrentSlugs] = useState<string[]>([])
  const [isOutfitPickerOpen, setIsOutfitPickerOpen] = useState(false)
  const launchStudio = useLaunchStudio()
  const isUploading = searchImageUpload.isPending

  const lastEmittedSearchSigRef = useRef<string | null>(null)
  const currentSearchSigRef = useRef<string | null>(null)
  const currentSearchIdRef = useRef<string | null>(null)

  // Facets chosen in the 6g search room arrive as URL params. Merge them into the
  // product filters at read-time — no clobbering of the filter-drawer state.
  const mergedProductFilters = useMemo<ProductSearchFilters>(() => {
    const csv = (key: string) => {
      const raw = searchParams.get(key)
      if (!raw) return undefined
      const list = raw.split(",").map((s) => s.trim()).filter(Boolean)
      return list.length ? list : undefined
    }
    const merge = (a?: string[], b?: string[]) => {
      const set = new Set([...(a ?? []), ...(b ?? [])])
      return set.size ? Array.from(set) : undefined
    }
    return {
      ...productFilters,
      fits: merge(productFilters.fits, csv("fits")),
      feels: merge(productFilters.feels, csv("feels")),
      vibes: merge(productFilters.vibes, csv("vibes")),
      // The scope owns the item type; a sheet "type:" pick cannot widen past it.
      typeCategories: scopeSlot ? [scopeSlot] : productFilters.typeCategories,
    }
  }, [productFilters, scopeSlot, searchParams])

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

  // ----- Persist active search to sessionStorage -----
  // Fires whenever the committed search params change. Only writes when there is an
  // active search so we never overwrite a valid saved state with an empty one.
  useEffect(() => {
    if (!searchParamValue && !imageUrlParam) return
    try {
      const state: SearchSessionState = {
        search: searchParamValue,
        mode: scopeToMode(scope),
        scope,
        ...(imageUrlParam ? { imageUrl: imageUrlParam } : {}),
      }
      window.sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify(state))
    } catch {
      // Quota or private-mode errors — ignore
    }
  }, [searchParamValue, scope, imageUrlParam])

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

      // The scope in the restored URL decides what results show, image search included.
      setActiveFilter(scopeToMode(resolveScope(params)))
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
      // Split collection slugs out — they're applied client-side, not sent to backend
      const collectionIds = filterIds.filter(id => id.startsWith("collection:"))
      setActiveCollectionSlugs(collectionIds.map(id => id.replace("collection:", "")))
      const backendFilters = filterIds.filter(id => !id.startsWith("collection:"))
      const filters = parseFiltersFromIds(backendFilters)
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
    setActiveCollectionSlugs([])
    setProductFilters({})
    setDraftTypeFilters([])
  }, [])

  useEffect(() => {
    // Reset filters and sort when the search query changes from the URL
    setActiveFilterIds([])
    setActiveCollectionSlugs([])
    setProductFilters({})
    setDraftTypeFilters([])
    setSortValue("similarity")
  }, [committedSearchTerm])

  // --- QUERIES ---
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
    filters: mergedProductFilters,
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
    enabled: isFilterOpen || (isResultsMode && activeFilter === "products"),
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

  // Collection filter options — custom moodboards only (Favorites is inline)
  const collectionFilterOptions = useMemo(() => {
    const custom = selectableMoodboards.map(m => ({ id: `collection:${m.slug}`, label: m.label }))
    return custom
  }, [selectableMoodboards])

  const productFilterCategories = useMemo<FilterCategory[]>(() => {
    const collectionCategory: FilterCategory = {
      id: "collection",
      label: "User Collections",
      options: collectionFilterOptions,
    }
    if (!activeOptions) return [collectionCategory]
    const categories: FilterCategory[] = [collectionCategory,
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
  }, [activeOptions, collectionFilterOptions])

  // --- RESULT MAPPING ---
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
          attribution: undefined,
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
          type: result.type ?? null,
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
        type: item.type,
        isSaved: saved,
        onToggleSave: () => productSaveActions.onToggleSave(item.id, !saved, uiContext),
        onLongPressSave: () => productSaveActions.onLongPressSave(item.id, uiContext),
      }
    })
  }, [productResultsQuery.data?.pages, productSaveActions, sortValue])

  // Apply client-side collection/moodboard filter to product results
  const filteredProductResultItems = useMemo(() => {
    if (activeCollectionSlugs.length === 0) return productResultItems
    const memberMap = productCollectionMembership.data ?? {}
    return productResultItems.filter(item =>
      activeCollectionSlugs.some(slug => memberMap[slug]?.has(item.id))
    )
  }, [productResultItems, activeCollectionSlugs, productCollectionMembership.data])

  const originPath = useMemo(
    () => `${location.pathname}${location.search}` || "/search",
    [location.pathname, location.search],
  )

  // A piece opens Studio with that slot focused; the scope's slot is the fallback.
  const handleProductSelect = useCallback(
    (productId: string, slot: StudioProductTraySlot | null) => {
      const target = slot ?? scopeSlot ?? "top"
      // Wear it on the look the user last had in Studio; Studio restores one itself if there is none.
      const remembered = parseStudioPath(readStudioLastPath(profileGender))
      navigate(
        buildStudioFocusUrl({
          productId,
          slot: target,
          returnTo: originPath,
          outfitId: remembered.outfitId,
          slotIds: remembered.slotIds,
        }),
      )
    },
    [navigate, originPath, profileGender, scopeSlot],
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
    (item: { id: string; type?: string | null }) => {
      const position = productPositionById.get(item.id)
      trackItemClicked(analytics, {
        entity_type: "product",
        entity_id: item.id,
        layout: "vertical_grid",
        position,
      })
      const slot = item.type ?? null
      handleProductSelect(item.id, isStudioSlot(slot) ? slot : null)
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
      const alreadySaved = favoriteIds.includes(outfitId)
      try {
        if (!alreadySaved) {
          await saveToCollectionMutation.mutateAsync({ outfitId, slug: "favorites", label: "Favorites" })
          trackSaveToggled(analytics, { entity_type: "outfit", entity_id: outfitId, new_state: true, save_method: "long_press", ...uiContext })
          trackSavedToCollection(analytics, { entity_type: "outfit", entity_id: outfitId, collection_slug: "favorites", save_method: "long_press", ...uiContext })
        }
        // Pre-populate current custom moodboard slugs for diff-sync
        const membership = outfitMembershipQuery.data ?? {}
        const currentSlugs = Object.entries(membership)
          .filter(([slug, ids]) => !["favorites", "try-ons", "generations"].includes(slug) && ids.has(outfitId))
          .map(([slug]) => slug)
        pendingOutfitContextRef.current = uiContext
        setPendingOutfitId(outfitId)
        setPendingOutfitCurrentSlugs(currentSlugs)
        setIsOutfitPickerOpen(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save outfit"
        toast({ title: "Save failed", description: message, variant: "destructive" })
      }
    },
    [analytics, favoriteIds, outfitMembershipQuery.data, saveToCollectionMutation, toast],
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
    async (selectedSlugs: string[]) => {
      if (!pendingOutfitId) return
      const uiContext = pendingOutfitContextRef.current ?? {}
      const current = new Set(pendingOutfitCurrentSlugs)
      const next = new Set(selectedSlugs)
      const toAdd = selectedSlugs.filter((s) => !current.has(s))
      const toRemove = pendingOutfitCurrentSlugs.filter((s) => !next.has(s))
      let hadError = false
      try {
        for (const slug of toAdd) {
          const label = selectableMoodboards.find((b) => b.slug === slug)?.label ?? slug
          await saveToCollectionMutation.mutateAsync({ outfitId: pendingOutfitId, slug, label })
          trackSavedToCollection(analytics, { entity_type: "outfit", entity_id: pendingOutfitId, collection_slug: slug, save_method: "long_press", ...uiContext })
        }
        for (const slug of toRemove) {
          await removeFromCollectionMutation.mutateAsync({ outfitId: pendingOutfitId, slug })
        }
      } catch { hadError = true }
      setPendingOutfitId(null)
      setPendingOutfitCurrentSlugs([])
      if (hadError) toast({ title: "Could not update all moodboards", variant: "destructive" })
    },
    [analytics, pendingOutfitCurrentSlugs, pendingOutfitId, removeFromCollectionMutation, saveToCollectionMutation, selectableMoodboards, toast],
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

  // Bar X: back to the reset state, top of the page.
  const handleClearAll = useCallback(() => {
    setSearchTerm("")
    setUploadedImageUrl(undefined)
    setAppliedImageUrl(undefined)
    setImageSearchTriggered(false)
    setExplicitSearchTriggered(false)
    setActiveFilterIds([])
    setActiveCollectionSlugs([])
    setProductFilters({})
    setDraftTypeFilters([])
    try {
      window.sessionStorage.removeItem(SEARCH_SESSION_KEY)
    } catch {
      // ignore
    }
    // Clearing the query drops back to this scope's feed, not to Looks.
    const params = new URLSearchParams()
    params.set("scope", scope)
    params.set("mode", scopeToMode(scope))
    setSearchParams(params, { replace: false })
    window.scrollTo({ top: 0, behavior: "auto" })
  }, [scope, setSearchParams])

  const handleFindItems = useCallback(() => navigate("/inspiration-import"), [navigate])

  // The sheet shows the design's groups only: Gender, Fit, Feel, Vibe, Boards.
  // Category is owned by the scope rail (Looks / Tops / Lowers / Kicks) now.
  const sheetCategories = useMemo<FilterCategory[]>(() => {
    const order: Array<[string, string]> = [
      ["gender", "Gender"],
      ["fit", "Fit"],
      ["feel", "Feel"],
      ["vibe", "Vibe"],
      ["collection", "Boards"],
    ]
    return order.flatMap(([id, label]) => {
      const category = productFilterCategories.find((c) => c.id === id)
      return category ? [{ ...category, label }] : []
    })
  }, [productFilterCategories])

  // --- RENDER HELPERS ---
  const renderOutfitResultsContent = () => {
    if (isOutfitResultsLoading) return <ResultsSkeleton kind="outfits" />
    if (isOutfitResultsError) return <ErrorCard onRetry={() => outfitResultsQuery.refetch()} />
    if (outfitResultItems.length === 0) return <NoResultsCard query={searchParamValue} onFindItems={handleFindItems} />
    return (
      <div className={FEED_GRID}>
        {outfitResultItems.map((item) => {
          const outfitId = item.outfitId ?? item.outfit?.id ?? ""
          return (
            <div key={item.id} ref={outfitImpressionRefByOutfitId.get(outfitId)} className="h-[250px]">
              <OutfitCard
                title={item.title ?? ""}
                outfitId={outfitId}
                renderedItems={item.renderedItems}
                gender={item.gender}
                heightCm={item.heightCm}
                saved={Boolean(item.isSaved)}
                onSelect={() => handleInspirationSelect(item)}
                onToggleSave={() => handleToggleFavorite(item, !item.isSaved)}
                onLongPressSave={() => handleLongPressSave(item)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  const renderProductResultsContent = () => {
    if (isProductResultsLoading) return <ResultsSkeleton kind="products" />
    if (isProductResultsError) return <ErrorCard onRetry={() => productResultsQuery.refetch()} />
    if (filteredProductResultItems.length === 0) {
      return <NoResultsCard query={searchParamValue} onFindItems={handleFindItems} />
    }
    return (
      <div className={FEED_GRID}>
        {filteredProductResultItems.map((item) => (
          <div key={item.id} ref={productImpressionRefById.get(item.id)}>
            <ProductTile
              title={item.title}
              imageSrc={item.imageSrc}
              saved={item.isSaved}
              cropToContent
              onSelect={() => handleProductGridSelect(item)}
              onToggleSave={item.onToggleSave}
              onLongPressSave={item.onLongPressSave}
            />
          </div>
        ))}
      </div>
    )
  }

  // --- URL & INTERACTION LOGIC ---
  const isFetchingMore =
    activeFilter === "outfits" ? outfitResultsQuery.isFetchingNextPage : productResultsQuery.isFetchingNextPage

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
        const target = scopeToMode(scope)
        return prev === target ? prev : target
      })
    }
    // Don't force products mode for image-only search - respect user's mode choice
    // Both outfit and product search support image search
  }, [scope, searchParamValue])

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
    // The scope decides what a search returns; mode is its legacy name.
    const nextMode = scopeToMode(scope)
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
    params.set("scope", scope)
    setSearchParams(params, { replace: false })
  }, [
    scope,
    emitSearchSubmitted,
    outfitFilters,
    productFilters,
    searchTerm,
    setSearchParams,
    sortValue,
    uploadedImageUrl,
  ])

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
        // Scope and the legacy mode param always travel together.
        params.set("scope", next === "outfits" ? "looks" : scope === "looks" ? "tops" : scope)
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
      scope,
      searchParams,
      setSearchParams,
      sortValue,
    ],
  )

  // The rail changes scope; mode follows so the analytics commit point still fires.
  const handleScopeChange = useCallback(
    (next: SearchScope) => {
      if (next === scope) return
      handleFilterChange(scopeToMode(next))
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set("scope", next)
          params.set("mode", scopeToMode(next))
          params.delete("list")
          return params
        },
        { replace: true },
      )
      window.scrollTo({ top: 0, behavior: "auto" })
    },
    [handleFilterChange, scope, setSearchParams],
  )

  // Filters with nothing typed: seed the query from the picked words and land on products.
  const handleSheetApply = useCallback(
    (filterIds: string[]) => {
      if (isResultsMode) {
        // Filters are product filters, so Apply from Outfits lands on Products.
        if (activeFilter === "outfits") handleFilterChange("products")
        handleFilterApply(filterIds)
        return
      }
      // The sheet no longer has a Category group, but guard against stale type: ids anyway —
      // the scope rail owns category and a sheet pick can never reach the query for it.
      const words = filterIds
        .filter((id) => !id.startsWith("collection:") && !id.startsWith("gender:") && !id.startsWith("type:"))
        .map((id) => id.split(":")[1]?.replace(/[-_]/g, " ") ?? "")
        .filter(Boolean)
      if (words.length === 0) return
      const csv = (prefix: string) =>
        filterIds.filter((id) => id.startsWith(`${prefix}:`)).map((id) => id.slice(prefix.length + 1))
      const params = new URLSearchParams()
      params.set("search", words.join(" "))
      params.set("mode", "products")
      params.set("scope", scope === "looks" ? "tops" : scope)
      if (csv("fit").length) params.set("fits", csv("fit").join(","))
      if (csv("feel").length) params.set("feels", csv("feel").join(","))
      if (csv("vibe").length) params.set("vibes", csv("vibe").join(","))
      setSearchParams(params, { replace: false })
    },
    [activeFilter, handleFilterApply, handleFilterChange, isResultsMode, scope, setSearchParams],
  )

  const isOutfitSaved = useCallback((outfitId: string) => favoriteIds.includes(outfitId), [favoriteIds])
  const toggleOutfitSave = useCallback(
    (outfitId: string, next: boolean) => handleToggleOutfitById(outfitId, next, { layout: "vertical_grid" }, "click"),
    [handleToggleOutfitById],
  )
  const longPressOutfitSave = useCallback(
    (outfitId: string) => handleLongPressOutfitById(outfitId, { layout: "vertical_grid" }),
    [handleLongPressOutfitById],
  )

  const feedHandlers = useMemo<FeedHandlers>(
    () => ({
      onOpenLook: (look: FeedLook, layout: FeedLayout, position: number) => {
        trackItemClicked(analytics, { entity_type: "outfit", entity_id: look.outfit.id, layout, position })
        void launchStudio(look.outfit)
      },
      onOpenPiece: (piece: FeedPiece, layout: FeedLayout, position: number) => {
        trackItemClicked(analytics, { entity_type: "product", entity_id: piece.id, layout, position })
        handleProductSelect(piece.id, piece.slot)
      },
      isLookSaved: isOutfitSaved,
      onToggleLookSave: toggleOutfitSave,
      onLongPressLookSave: longPressOutfitSave,
      isPieceSaved: (id: string) => productSaveActions.isSaved(id),
      onTogglePieceSave: (id: string, next: boolean) => productSaveActions.onToggleSave(id, next, { layout: "vertical_grid" }),
      onLongPressPieceSave: (id: string) => productSaveActions.onLongPressSave(id, { layout: "vertical_grid" }),
    }),
    [
      analytics,
      handleProductSelect,
      isOutfitSaved,
      launchStudio,
      longPressOutfitSave,
      productSaveActions,
      toggleOutfitSave,
    ],
  )

  // The feed only runs when results are not on screen.
  const feed = useSearchFeed(scope, !isResultsMode)

  const handleOpenList = useCallback(
    (list: FeedList) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set("list", list)
          return params
        },
        { replace: false },
      )
      window.scrollTo({ top: 0, behavior: "auto" })
    },
    [setSearchParams],
  )

  const handleCloseList = useCallback(() => {
    // Go back only when we pushed the list ourselves; a deep link must stay in-app.
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx
    if (typeof historyIndex === "number" && historyIndex > 0) {
      navigate(-1)
      return
    }
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        params.delete("list")
        return params
      },
      { replace: true },
    )
  }, [navigate, setSearchParams])

  const listTitle = openList === "hot" ? "Hot Styles" : "Atlyr Curations"

  return (
    <div className="flex flex-1 flex-col">
      {/* Header like Collections: 52h title row, then the scope pills where its tab bar sits. Fixed, ghost block under it. */}
      {openList ? null : (
        <header className="fixed inset-x-0 top-0 z-30 bg-background">
          <div className="flex h-control-header-title items-center border-b border-hairline px-4">
            <h1 className="min-w-0 flex-1 font-display text-title font-medium text-ink">Search</h1>
          </div>
          <div className="flex h-9 items-center px-4">
            <SearchScopeRail value={scope} onChange={handleScopeChange} />
          </div>
        </header>
      )}
      <div className={cn("shrink-0", openList ? "h-2" : "h-[88px]")} aria-hidden="true" />

      {/* 56 dock + 55 nav + 16, less the shell's 40. */}
      <div className="mx-auto w-full max-w-[24.5rem] px-4 pb-[87px] md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">
        {isResultsMode ? (
          <>
            {activeFilter === "products" ? renderProductResultsContent() : renderOutfitResultsContent()}
            <div ref={loadMoreRef} className="h-6 w-full" />
            {isFetchingMore ? <ResultsSkeleton kind={activeFilter} count={2} /> : null}
          </>
        ) : openList ? (
          feed.kind === "looks" ? (
            <SearchListPage
              kind="looks"
              title={listTitle}
              section={feed[openList]}
              heightCm={heightCm ?? 170}
              onBack={handleCloseList}
              handlers={feedHandlers}
            />
          ) : (
            <SearchListPage
              kind="pieces"
              title={listTitle}
              section={feed[openList]}
              heightCm={heightCm ?? 170}
              onBack={handleCloseList}
              handlers={feedHandlers}
            />
          )
        ) : (
          <SearchFeed sections={feed} heightCm={heightCm ?? 170} onOpenList={handleOpenList} handlers={feedHandlers} />
        )}
      </div>

      <SearchDock>
        <SearchBar
          mode={isResultsMode ? "results" : "idle"}
          value={searchTerm}
          onValueChange={handleSearchChange}
          onSubmit={() => {
            handleSubmit()
            ;(document.activeElement as HTMLElement | null)?.blur()
          }}
          onClear={handleClearAll}
          thumbSrc={uploadedImageUrl}
          onClearThumb={handleClearImage}
          onPickImage={handleImageUpload}
          isUploading={isUploading}
          onFilter={() => setIsFilterOpen(true)}
          onFindItems={handleFindItems}
        />
      </SearchDock>

      <SearchFilterSheet
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        categories={sheetCategories}
        activeFilters={activeFilterIds}
        onApply={handleSheetApply}
        onClear={handleFilterClearAll}
        onDraftChange={handleFilterOptionsChange}
      />

      <MoodboardPickerDrawer
        open={isOutfitPickerOpen}
        onOpenChange={(open) => {
          setIsOutfitPickerOpen(open)
          if (!open) {
            setPendingOutfitId(null)
            setPendingOutfitCurrentSlugs([])
          }
        }}
        moodboards={selectableMoodboards}
        mode="multi"
        defaultSelections={pendingOutfitCurrentSlugs}
        onSelect={handleMoodboardPickerSelect}
        onApply={handleMoodboardPickerApply}
        onCreate={handleCreateMoodboard}
        isSaving={saveToCollectionMutation.isPending || createMoodboardMutation.isPending}
        title="Move Moodboard"
      />

      <MoodboardPickerDrawer
        open={productSaveActions.isPickerOpen}
        onOpenChange={(open) => {
          if (!open) productSaveActions.closePicker()
        }}
        moodboards={productSaveActions.moodboards}
        mode="multi"
        defaultSelections={productSaveActions.currentMoodboardSlugs}
        onSelect={() => {}}
        onApply={productSaveActions.onApplyMoodboards}
        onCreate={productSaveActions.onCreateMoodboard}
        isSaving={productSaveActions.isSaving}
        title="Move Moodboard"
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
