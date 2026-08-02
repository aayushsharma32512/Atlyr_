import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, ChevronLeft, ChevronRight, MoreVertical, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { OutfitInspirationTile, SaveOutfitDrawer, TrayActionButton } from "@/design-system/primitives"
import { ProductTray } from "@/features/studio/components/ProductTray"
import { useStudioProductTray } from "@/features/studio/hooks/useStudioProductTray"
import { usePrefetchCreationAssets } from "@/features/collections/hooks/usePrefetchCreationAssets"
import {
  useCreations,
  useCreateMoodboard,
  useFavorites,
  useMoodboards,
  useSaveToCollection,
  useRemoveFromCollection,
  useOutfitCollectionMembership,
  useAnonymiseOutfit,
} from "../hooks/useMoodboards"
import { cn } from "@/lib/utils"
import type { Creation } from "@/services/collections/collectionsService"
import { useUpdateOutfit } from "@/features/outfits/hooks/useUpdateOutfit"
import { useToast } from "@/hooks/use-toast"
import { useLocation, useNavigate } from "react-router-dom"
import { buildStudioSearchParams, buildStudioUrl } from "@/features/studio/utils/studioUrlState"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useAuth } from "@/contexts/AuthContext"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackTryonFlowStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

const PAGE_SIZE = 6

const SLOT_LABEL: Record<StudioProductTraySlot, string> = { top: "Top", bottom: "Bottom", shoes: "Shoes" }

function formatTrayPrice(price?: number | null, currency?: string | null): string {
  if (typeof price !== "number" || !Number.isFinite(price)) return "—"
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency ?? "INR", maximumFractionDigits: 0 }).format(price)
  } catch {
    return `₹${Math.round(price).toLocaleString("en-IN")}`
  }
}

// "airy kota weave · high rise" style spec line from the piece's own tags.
function buildTraySpec(item: StudioProductTrayItem): string {
  const parts = [item.materialType, item.fitTags?.[0], item.feelTags?.[0]].filter(
    (v): v is string => Boolean(v && v.trim() && v.toLowerCase() !== "null"),
  )
  return parts.slice(0, 2).join(" · ")
}

export function CreationsTab() {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [flippedIds, setFlippedIds] = useState<Record<string, boolean>>({})
  const [vtoImageErrorUrls, setVtoImageErrorUrls] = useState<Record<string, string>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const creationsQuery = useCreations(PAGE_SIZE)
  const creations = useMemo<Creation[]>(
    () => ((creationsQuery.data?.pages as Creation[][] | undefined) ?? []).flat(),
    [creationsQuery.data?.pages],
  )
  const fetchNextCreationsPage = creationsQuery.fetchNextPage
  const hasMoreCreations = Boolean(creationsQuery.hasNextPage)
  const isFetchingMoreCreations = creationsQuery.isFetchingNextPage
  const shouldLoadMoreCreations =
    creations.length > 0 && hasMoreCreations && !isFetchingMoreCreations && currentSlide >= creations.length - 3
  const totalSlides = creations.length
  const activeCreation = creations[currentSlide]
  const navigate = useNavigate()
  const location = useLocation()
  const favoritesQuery = useFavorites()
  const favoriteIds = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data])
  const saveToCollectionMutation = useSaveToCollection()
  const removeFromCollectionMutation = useRemoveFromCollection()
  const updateOutfitMutation = useUpdateOutfit()
  const { data: moodboards = [], isLoading: moodboardsLoading } = useMoodboards()
  const selectableMoodboards = useMemo(() => moodboards.filter((m) => !m.isSystem), [moodboards])
  const createMoodboardMutation = useCreateMoodboard()
  const { user } = useAuth()
  const { profile } = useProfileContext()
  const { toast } = useToast()
  const startLikenessFlow = useStartLikenessFlow()
  const analytics = useEngagementAnalytics()
  const [isSaveDrawerOpen, setIsSaveDrawerOpen] = useState(false)
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false)
  // Which piece the "IN THIS OUTFIT" detail card is showing (6e3). Null = first.
  const [selectedTraySlot, setSelectedTraySlot] = useState<StudioProductTraySlot | null>(null)

  const outfitMembershipQuery = useOutfitCollectionMembership()
  const anonymiseOutfitMutation = useAnonymiseOutfit()
  const productTrayQuery = useStudioProductTray(activeCreation?.outfitId ?? null)
  const trayItems = useMemo(() => productTrayQuery.data ?? [], [productTrayQuery.data])
  const activeOutfitQuery = useStudioOutfit(activeCreation?.outfitId ?? null)
  const activeOutfit = activeOutfitQuery.data?.outfit ?? null
  const defaultCategoryId = useMemo(
    () => (activeOutfit?.category && activeOutfit.category !== "others" ? activeOutfit.category : undefined),
    [activeOutfit?.category],
  )
  const defaultOccasionId = useMemo(
    () => (activeOutfit?.occasion?.id && activeOutfit.occasion.id !== "others" ? activeOutfit.occasion.id : undefined),
    [activeOutfit?.occasion?.id],
  )
  
  // Slot management state
  const defaultSlotOrder = useMemo<StudioProductTraySlot[]>(() => ["top", "bottom", "shoes"], [])
  const [slotOrder, setSlotOrder] = useState<StudioProductTraySlot[]>(defaultSlotOrder)
  const [hiddenSlots, setHiddenSlots] = useState<Partial<Record<StudioProductTraySlot, boolean>>>({})
  
  // Reset slot order when active creation changes
  useEffect(() => {
    setSlotOrder(defaultSlotOrder)
    setHiddenSlots({})
    setSelectedTraySlot(null)
  }, [activeCreation?.outfitId, defaultSlotOrder])

  useEffect(() => {
    if (!shouldLoadMoreCreations) return
    void fetchNextCreationsPage()
  }, [fetchNextCreationsPage, shouldLoadMoreCreations])
  
  // Prefetch must be called unconditionally (before any early returns)
  usePrefetchCreationAssets({ creations, currentSlide, vtoImageErrorUrls })
  const isSaved = useMemo(
    () => (activeCreation?.outfitId ? favoriteIds.includes(activeCreation.outfitId) : false),
    [activeCreation?.outfitId, favoriteIds],
  )
  const isDraftCreation = useMemo(() => {
    if (!activeCreation) return false
    return (
      activeCreation.name?.startsWith("draft-look-") &&
      activeCreation.isPrivate === true &&
      activeCreation.visibleInFeed === false
    )
  }, [activeCreation])
  const outfitItems = useMemo(
    () => ({
      topId: trayItems.find((item) => item.slot === "top")?.productId ?? null,
      bottomId: trayItems.find((item) => item.slot === "bottom")?.productId ?? null,
      footwearId: trayItems.find((item) => item.slot === "shoes")?.productId ?? null,
    }),
    [trayItems],
  )
  const slotIds = useMemo(
    () => ({
      top: outfitItems.topId ?? null,
      bottom: outfitItems.bottomId ?? null,
      shoes: outfitItems.footwearId ?? null,
    }),
    [outfitItems.bottomId, outfitItems.footwearId, outfitItems.topId],
  )
  const collectionReturnTo = useMemo(() => {
    const params = new URLSearchParams(location.search)
    params.set("tab", "creations")
    const search = params.toString()
    return `/collection${search ? `?${search}` : ""}`
  }, [location.search])

  const handleToggleSave = useCallback(async () => {
    const outfitId = activeCreation?.outfitId ?? null
    if (!outfitId) return
    try {
      if (isDraftCreation) {
        if (!activeOutfit) {
          toast({
            title: "Outfit loading",
            description: "Please try again in a moment.",
          })
          return
        }
        setIsSaveDrawerOpen(true)
        return
      }
      if (isSaved) {
        await removeFromCollectionMutation.mutateAsync({ outfitId, slug: "favorites" })
      } else {
        await saveToCollectionMutation.mutateAsync({ outfitId, slug: "favorites", label: "Favorites" })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update favorite"
      toast({ title: "Save failed", description: message, variant: "destructive" })
      favoritesQuery.refetch()
    }
  }, [
    activeCreation?.outfitId,
    favoritesQuery,
    isDraftCreation,
    isSaved,
    removeFromCollectionMutation,
    saveToCollectionMutation,
    toast,
  ])

  const handleSaveDraftOutfit = useCallback(
    async (data: {
      outfitName: string
      categoryId: string
      occasionId: string
      vibe: string
      keywords: string
      isPrivate: boolean
      moodboardIds?: string[]
    }) => {
      if (!activeOutfit || !user?.id) {
        const error = new Error("Please sign in to save outfits")
        toast({
          title: "Sign in required",
          description: "Create an account or sign in to save outfits.",
          variant: "destructive",
        })
        throw error
      }

      try {
        await updateOutfitMutation.mutateAsync({
          outfitId: activeOutfit.id,
          userId: user.id,
          name: data.outfitName,
          categoryId: data.categoryId,
          occasionId: data.occasionId,
          backgroundId: activeOutfit.backgroundId ?? null,
          isPrivate: data.isPrivate,
          vibe: data.vibe,
          keywords: data.keywords,
          createdByName: profile?.name ?? null,
        })

        const selectedMoodboardSlugs = data.moodboardIds ?? []
        const moodboardLabelBySlug = new Map(selectableMoodboards.map((m) => [m.slug, m.label] as const))

        let hadCollectionError = false
        try {
          await saveToCollectionMutation.mutateAsync({ outfitId: activeOutfit.id, slug: "favorites", label: "Favorites" })
        } catch {
          hadCollectionError = true
        }

        for (const slug of selectedMoodboardSlugs) {
          try {
            await saveToCollectionMutation.mutateAsync({ outfitId: activeOutfit.id, slug, label: moodboardLabelBySlug.get(slug) })
          } catch {
            hadCollectionError = true
          }
        }

        toast({
          title: "Outfit saved",
          description: hadCollectionError ? "Saved outfit, but could not add it to all collections." : undefined,
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
      activeOutfit,
      selectableMoodboards,
      profile?.name,
      saveToCollectionMutation,
      toast,
      updateOutfitMutation,
      user?.id,
    ],
  )

  const handleEditOutfitSave = useCallback(
    async (data: {
      outfitName: string
      categoryId: string
      occasionId: string
      vibe: string
      keywords: string
      isPrivate: boolean
      moodboardIds?: string[]
    }) => {
      if (!activeOutfit || !user?.id) return

      await updateOutfitMutation.mutateAsync({
        outfitId: activeOutfit.id,
        userId: user.id,
        name: data.outfitName,
        categoryId: data.categoryId,
        occasionId: data.occasionId,
        backgroundId: activeOutfit.backgroundId ?? null,
        isPrivate: data.isPrivate,
        vibe: data.vibe || null,
        keywords: data.keywords || null,
        createdByName: profile?.name ?? null,
      })

      // Diff-sync moodboards
      const selectedSlugs = data.moodboardIds ?? []
      const membership = outfitMembershipQuery.data ?? {}
      const currentSlugs = Object.entries(membership)
        .filter(([slug, ids]) => ids.has(activeOutfit.id) && selectableMoodboards.some((m) => m.slug === slug))
        .map(([slug]) => slug)
      const current = new Set(currentSlugs)
      const next = new Set(selectedSlugs)
      const toAdd = selectedSlugs.filter((s) => !current.has(s))
      const toRemove = currentSlugs.filter((s) => !next.has(s))
      const labelBySlug = new Map(selectableMoodboards.map((m) => [m.slug, m.label]))

      for (const slug of toAdd) {
        try {
          await saveToCollectionMutation.mutateAsync({ outfitId: activeOutfit.id, slug, label: labelBySlug.get(slug) })
        } catch { /* ignore individual failures */ }
      }
      for (const slug of toRemove) {
        try {
          await removeFromCollectionMutation.mutateAsync({ outfitId: activeOutfit.id, slug })
        } catch { /* ignore individual failures */ }
      }
    },
    [
      activeOutfit,
      outfitMembershipQuery.data,
      profile?.name,
      removeFromCollectionMutation,
      saveToCollectionMutation,
      selectableMoodboards,
      updateOutfitMutation,
      user?.id,
    ],
  )

  const scrollToSlide = useCallback((index: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    
    // Get actual card width from first card element, or use 356px as fallback
    const firstCard = container.querySelector('[data-card-index="0"]') as HTMLElement
    const cardWidth = firstCard?.offsetWidth ?? 356
    const gap = 16 // gap-4 = 16px
    
    // Calculate target scroll position
    let targetScroll = 0
    if (index > 0) {
      targetScroll = index * (cardWidth + gap)
    }
    
    // Use requestAnimationFrame for smoother scroll
    requestAnimationFrame(() => {
      container.scrollTo({
        left: targetScroll,
        behavior: "smooth",
      })
    })
  }, [])

  const handleProductPress = useCallback(
    (product: StudioProductTrayItem) => {
      const params = buildStudioSearchParams({
        outfitId: activeCreation?.outfitId ?? null,
        slotIds,
      })
      params.set("productId", product.productId)
      params.set("returnTo", encodeURIComponent(collectionReturnTo))
      const search = params.toString()
      navigate(`/studio/product/${encodeURIComponent(product.productId)}${search ? `?${search}` : ""}`)
    },
    [activeCreation?.outfitId, collectionReturnTo, navigate, slotIds],
  )

  const handleDetailsPress = useCallback(() => {
    if (!activeCreation?.outfitId) return
    const params = buildStudioSearchParams({
      outfitId: activeCreation.outfitId,
      slotIds,
    })
    const search = params.toString()
    navigate(`/studio/scroll-up${search ? `?${search}` : ""}`)
  }, [activeCreation?.outfitId, navigate, slotIds])

  const handleTryOn = useCallback(() => {
    if (!activeOutfit) {
      toast({
        title: "Outfit loading",
        description: "Try-on is almost ready. Please try again in a moment.",
      })
      return
    }
    trackTryonFlowStarted(analytics, {
      slotIds: {
        topId: outfitItems.topId,
        bottomId: outfitItems.bottomId,
        shoesId: outfitItems.footwearId,
      },
    })
    void startLikenessFlow({
      outfitItems,
      outfitSnapshot: {
        id: activeOutfit.id,
        name: activeOutfit.name ?? null,
        category: activeOutfit.category ?? null,
        occasionId: activeOutfit.occasion?.id ?? null,
        backgroundId: activeOutfit.backgroundId ?? null,
        gender: activeOutfit.gender ?? null,
      },
    })
  }, [activeOutfit, analytics, outfitItems, startLikenessFlow, toast])

  const handleAddSlot = useCallback(
    (slot: StudioProductTraySlot) => {
      if (!activeCreation?.outfitId) return
      const url = buildStudioUrl("/studio", "alternatives", {
        outfitId: activeCreation.outfitId,
        slotIds,
        slot,
      })
      navigate(url)
    },
    [activeCreation?.outfitId, navigate, slotIds],
  )

  const handleRemoveSlot = useCallback(
    (slot: StudioProductTraySlot) => {
      setHiddenSlots((prev) => ({ ...prev, [slot]: true }))
    },
    [],
  )

  const handleRestoreSlot = useCallback(
    (slot: StudioProductTraySlot) => {
      setHiddenSlots((prev) => ({ ...prev, [slot]: false }))
    },
    [],
  )

  const handleReorderSlots = useCallback((nextOrder: StudioProductTraySlot[]) => {
    setSlotOrder(nextOrder)
  }, [])

  const handlePrevious = useCallback(() => {
    if (!totalSlides) return
    const newIndex = currentSlide > 0 ? currentSlide - 1 : totalSlides - 1
    setCurrentSlide(newIndex)
    scrollToSlide(newIndex)
  }, [currentSlide, scrollToSlide, totalSlides])

  const handleNext = useCallback(() => {
    if (!totalSlides) return
    const newIndex = currentSlide < totalSlides - 1 ? currentSlide + 1 : 0
    setCurrentSlide(newIndex)
    scrollToSlide(newIndex)
  }, [currentSlide, totalSlides, scrollToSlide])

  const handleDotClick = useCallback((index: number) => {
    setCurrentSlide(index)
    scrollToSlide(index)
  }, [scrollToSlide])

  // Debounced scroll handler to update current slide based on scroll position
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    
    const scrollLeft = container.scrollLeft
    // Get actual card width from first card element, or use 356px as fallback
    const firstCard = container.querySelector('[data-card-index="0"]') as HTMLElement
    const cardWidth = firstCard?.offsetWidth ?? 356
    const gap = 16
    
    // Calculate which slide is currently centered
    const newIndex = Math.round(scrollLeft / (cardWidth + gap))
    const clampedIndex = Math.max(0, Math.min(newIndex, totalSlides - 1))
    
    if (clampedIndex !== currentSlide) {
      setCurrentSlide(clampedIndex)
    }
  }, [currentSlide, totalSlides])

  React.useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    
    let timeoutId: NodeJS.Timeout
    const debouncedScroll = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(handleScroll, 100)
    }
    
    container.addEventListener("scroll", debouncedScroll, { passive: true })
    return () => {
      clearTimeout(timeoutId)
      container.removeEventListener("scroll", debouncedScroll)
    }
  }, [handleScroll])

  const toggleFlip = (id: string) => {
    setFlippedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleOpenStudio = (creation: Creation) => {
    if (!creation.outfitId) return
    const url = buildStudioUrl("/studio", "studio", { outfitId: creation.outfitId })
    navigate(url)
  }

  const resolveGender = (value?: string | null): "male" | "female" => (value === "male" ? "male" : "female")

  // usePrefetchCreationAssets({ creations, currentSlide, vtoImageErrorUrls })

  if (creationsQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="aspect-[3/4] animate-pulse rounded-xl bg-muted/70" />
        ))}
      </div>
    )
  }

  if (creationsQuery.isError) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-frame border border-destructive/40 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        Unable to load creations right now.
        <Button size="sm" variant="secondary" onClick={() => creationsQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  if (creations.length === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-frame border border-dashed border-hairline-dashed bg-card/40 text-sm text-muted-foreground">
        No creations yet.
      </div>
    )
  }

  const currentCreation = creations[currentSlide]
  const isCurrentFlipped = Boolean(currentCreation && flippedIds[currentCreation.id])
  // Pieces ride below the card as the "IN THIS OUTFIT" strip (6e3).
  const orderedTrayItems = useMemo(() => {
    const order: StudioProductTraySlot[] = ["top", "bottom", "shoes"]
    return [...trayItems].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot))
  }, [trayItems])
  const selectedTrayItem =
    orderedTrayItems.find((item) => item.slot === selectedTraySlot) ?? orderedTrayItems[0] ?? null
  const creationSubtitle = useMemo(() => {
    const parts = [activeOutfit?.category, activeOutfit?.vibes].filter(
      (v): v is string => Boolean(v && v.trim() && v !== "others" && v.toLowerCase() !== "null"),
    )
    return parts.join(" · ")
  }, [activeOutfit?.category, activeOutfit?.vibes])

  return (
    // Natural vertical flow — the whole tab scrolls inside the page's scroll
    // container (no locked height / fixed bottom bar that clipped the content).
    // Desktop widens into two columns (card left · pieces right) so the card
    // isn't a lonely strip in the middle of a wide screen.
    <div className="mx-auto flex w-full max-w-[384px] flex-col gap-4 pb-6 md:max-w-[880px] md:flex-row md:items-start md:gap-8">
      <div className="flex w-full flex-col gap-2 px-1 md:w-[480px] md:flex-none">
        {/* Framed creation card (canvas 6e3) */}
        {currentCreation ? (
          <div className="rounded-frame border border-hairline bg-card p-3 shadow-[0_10px_26px_rgba(30,27,22,0.10)]">
            {/* Header — title + favourite / edit */}
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-foreground md:text-base">{currentCreation.name}</p>
              <div className="flex items-center gap-3 leading-none text-taupe">
                <button
                  type="button"
                  onClick={handleToggleSave}
                  aria-label={isSaved ? "Remove from favourites" : "Add to favourites"}
                  className={cn("text-[13px] leading-none transition-colors", isSaved ? "text-primary" : "hover:text-primary")}
                >
                  ♥
                </button>
                {!isDraftCreation && activeOutfit ? (
                  <button
                    type="button"
                    onClick={() => setIsEditDrawerOpen(true)}
                    aria-label="Edit creation"
                    className="text-[13px] leading-none transition-colors hover:text-foreground"
                  >
                    ✎
                  </button>
                ) : null}
              </div>
            </div>
            {creationSubtitle ? (
              <p className="mt-0.5 truncate text-[10px] text-faint md:text-xs">{creationSubtitle}</p>
            ) : null}

            {/* Preview — warp/weft ground, the carousel of avatar/try-on views */}
            <div className="relative mt-2 h-[340px] overflow-hidden rounded-lg border border-warp bg-secondary md:h-[420px]">
              <div className="warp-weft absolute inset-0" />
              <div
                className="absolute inset-0 z-20 pointer-events-none"
                style={{
                  background: `
                    linear-gradient(to right, var(--muted, #f5f5f5) 0%, rgba(245,245,245,0.85) 8%, rgba(245,245,245,0.0) 20%, rgba(245,245,245,0.0) 80%, rgba(245,245,245,0.85) 92%, var(--muted, #f5f5f5) 100%)
                  `,
                }}
              />
              <div
                ref={scrollContainerRef}
                className="relative z-10 h-full w-full overflow-x-auto overflow-y-hidden scrollbar-hide"
                style={{
                  scrollSnapType: "x mandatory",
                  WebkitOverflowScrolling: "touch",
                  scrollBehavior: "smooth",
                }}
              >
                <div
                  className="flex h-full items-center gap-4 px-16"
                  style={{ width: `${(totalSlides + (isFetchingMoreCreations ? 1 : 0)) * 342}px` }}
                >
                  {creations.map((creation, index) => {
                    const isCardFlipped = Boolean(flippedIds[creation.id])
                    const isVisible = Math.abs(index - currentSlide) <= 2
                    const gender = resolveGender(creation.gender)
                    const vtoUrl = creation.vtoImageUrl
                    const vtoErrored = Boolean(vtoUrl && vtoImageErrorUrls[creation.outfitId] === vtoUrl)
                    const showVtoImage = Boolean(vtoUrl) && !vtoErrored

                    return (
                      <div
                        key={creation.id ?? `creation-${index}`}
                        data-card-index={index}
                        className="relative flex h-full flex-shrink-0 items-center justify-center"
                        style={{
                          width: 'min(360px, 80vw)',
                          scrollSnapAlign: "center",
                        }}
                      >
                        <div className="relative h-full w-full overflow-hidden rounded-md">
                          {!isCardFlipped ? (
                            showVtoImage ? (
                              <>
                                <img
                                  src={vtoUrl ?? undefined}
                                  alt={creation.name ?? "Try-on"}
                                  className="h-full w-full object-cover select-none"
                                  loading={isVisible ? "eager" : "lazy"}
                                  draggable={false}
                                  style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                                  onError={() => {
                                    if (!creation.outfitId || !vtoUrl) return
                                    setVtoImageErrorUrls((prev) =>
                                      prev[creation.outfitId] === vtoUrl ? prev : { ...prev, [creation.outfitId]: vtoUrl },
                                    )
                                  }}
                                />
                                <div
                                  className="absolute bottom-1 right-1.5 z-10 font-deva text-[11px] leading-none text-background/85 drop-shadow-[0_1px_2px_rgba(23,20,16,0.55)]"
                                  style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                                >
                                  कलागृह
                                </div>
                              </>
                            ) : isVisible ? (
                              <OutfitInspirationTile
                                preset="heroCanonical"
                                outfitId={creation.outfitId}
                                title={creation.name}
                                chips={[]}
                                cardClassName="h-full w-full"
                                avatarHeadSrc="/avatars/Default.png"
                                avatarGender={gender}
                                avatarHeightCm={170}
                                disableAvatarSwipe
                              />
                            ) : (
                              <div className="h-full w-full rounded-md bg-muted/40" />
                            )
                          ) : (
                            <div className="absolute inset-0">
                              {isVisible ? (
                                <OutfitInspirationTile
                                  preset="heroCanonical"
                                  outfitId={creation.outfitId}
                                  title={creation.name}
                                  chips={[]}
                                  cardClassName="h-full w-full"
                                  avatarHeadSrc="/avatars/Default.png"
                                  avatarGender={gender}
                                  avatarHeightCm={170}
                                  disableAvatarSwipe
                                />
                              ) : (
                                <div className="h-full w-full rounded-md bg-muted/40" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {isFetchingMoreCreations ? (
                    <div
                      key="creations-loading"
                      className="relative flex h-full flex-shrink-0 items-center justify-center"
                      style={{ width: "min(360px, 80vw)" }}
                    >
                      <div className="h-full w-full animate-pulse rounded-md bg-muted/50" />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Front/try-on label + flip badge (over the preview) */}
              <span className="absolute left-2.5 top-2 z-30 text-[7px] font-medium uppercase tracking-[0.12em] text-taupe">
                {isCurrentFlipped ? "Try-on" : "Front · Outfit"}
              </span>
              <button
                type="button"
                onClick={() => toggleFlip(currentCreation.id)}
                className="absolute right-2 top-2 z-30 flex items-center gap-1 rounded-[3px] bg-ink-deep px-2 py-1 text-[8px] font-semibold leading-none text-gold"
                aria-label="Flip to try-on"
              >
                <RotateCcw className="h-2.5 w-2.5" /> flip · ✦ try-on
              </button>
            </div>

            {/* Actions */}
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => handleOpenStudio(currentCreation)}
                className="flex-1 rounded-[3px] border border-hairline bg-card py-2.5 text-center text-[11px] font-semibold text-foreground transition-colors hover:bg-editorial/40"
              >
                Open in Studio
              </button>
              <button
                type="button"
                onClick={() => handleOpenStudio(currentCreation)}
                className="flex-1 rounded-[3px] bg-primary py-2.5 text-center text-[11px] font-bold text-primary-foreground transition-opacity hover:bg-primary/90"
              >
                Try it on →
              </button>
            </div>
          </div>
        ) : null}

        {/* Pagination */}
        <div className="flex items-center justify-center gap-1 w-full py-0.5">
          <button
            onClick={handlePrevious}
            className="flex items-center justify-center p-1 shrink-0 hover:bg-muted/30 rounded-md transition-colors"
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-1.5 px-1 shrink-0">
            {Array.from({ length: Math.min(9, totalSlides) }).map((_, index) => {
              const isActive = index === currentSlide
              return (
                <button
                  key={index}
                  onClick={() => handleDotClick(index)}
                  className={cn(
                    "shrink-0 transition-all duration-200 rounded-full",
                    isActive
                      ? "h-2 w-2 bg-foreground"
                      : "h-1.5 w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/60"
                  )}
                  aria-label={`Go to slide ${index + 1}`}
                />
              )
            })}
          </div>
          <button
            onClick={handleNext}
            className="flex items-center justify-center p-1 shrink-0 hover:bg-muted/30 rounded-md transition-colors"
            aria-label="Next slide"
          >
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* IN THIS OUTFIT — one row per piece (top · bottom · shoes). No selected/
          detail duplicate — each row is the piece itself, tap → its PDP (6e3). */}
      {orderedTrayItems.length > 0 ? (
        <div className="w-full min-w-0 px-1 md:flex-1 md:pt-1">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-taupe md:text-[11px]">In this outfit</p>
          <div className="mt-2 flex flex-col gap-2">
            {orderedTrayItems.map((item) => (
              <button
                key={item.slot}
                type="button"
                onClick={() => handleProductPress(item)}
                className="flex w-full min-w-0 items-center gap-3 rounded-[5px] border border-hairline bg-card px-3 py-2.5 text-left transition-colors hover:border-hairline-3 hover:bg-editorial/30 md:py-3"
              >
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" loading="lazy" className="h-12 w-12 flex-none object-contain md:h-16 md:w-16" />
                ) : (
                  <span className="h-12 w-12 flex-none rounded-[3px] bg-editorial md:h-16 md:w-16" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-taupe md:text-[10px]">
                    {item.brand?.trim() || SLOT_LABEL[item.slot]}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-[13px] font-semibold leading-snug text-foreground md:text-[15px]">{item.title}</span>
                  {buildTraySpec(item) ? (
                    <span className="mt-0.5 block truncate text-[10px] text-taupe md:text-[11px]">{buildTraySpec(item)}</span>
                  ) : null}
                </span>
                <span className="flex-none self-start text-[13px] font-bold text-foreground md:text-[15px]">
                  {formatTrayPrice(item.price, item.currency)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : productTrayQuery.isLoading ? (
        <div className="w-full px-1 md:flex-1">
          <div className="h-[72px] w-full animate-pulse rounded-[5px] bg-muted/40" />
        </div>
      ) : null}
      <SaveOutfitDrawer
        key={activeCreation?.id ?? "save-draft"}
        open={isSaveDrawerOpen}
        onOpenChange={setIsSaveDrawerOpen}
        defaultOutfitName={
          isDraftCreation
            ? `${profile?.name ?? "Your"}'s Look #${String(Date.now()).slice(-4)}`
            : (activeOutfit?.name ?? activeCreation?.name ?? "")
        }
        defaultCategoryId={defaultCategoryId}
        defaultOccasionId={defaultOccasionId}
        defaultVibe={activeOutfit?.vibes ?? null}
        defaultKeywords={activeOutfit?.word_association ?? null}
        defaultIsPrivate={activeCreation?.isPrivate ?? true}
        isLoadingMoodboards={moodboardsLoading}
          moodboards={selectableMoodboards}
        onCreateMoodboard={(name) => createMoodboardMutation.mutateAsync(name).then((res) => res.slug)}
        onSave={handleSaveDraftOutfit}
      />

      {/* Edit drawer for saved (non-draft) creations */}
      {!isDraftCreation && activeOutfit && (
        <SaveOutfitDrawer
          key={`edit-${activeCreation?.id ?? "edit"}`}
          open={isEditDrawerOpen}
          onOpenChange={setIsEditDrawerOpen}
          mode="edit"
          defaultOutfitName={activeOutfit.name ?? activeCreation?.name ?? ""}
          defaultCategoryId={defaultCategoryId}
          defaultOccasionId={defaultOccasionId}
          defaultVibe={activeOutfit.vibes ?? null}
          defaultKeywords={activeOutfit.word_association ?? null}
          defaultIsPrivate={activeCreation?.isPrivate ?? false}
          defaultMoodboardIds={
            Object.entries(outfitMembershipQuery.data ?? {})
              .filter(([slug, ids]) => ids.has(activeOutfit.id) && selectableMoodboards.some((m) => m.slug === slug))
              .map(([slug]) => slug)
          }
          moodboards={selectableMoodboards}
          isLoadingMoodboards={moodboardsLoading}
          onCreateMoodboard={(name) => createMoodboardMutation.mutateAsync(name).then((res) => res.slug)}
          onSave={handleEditOutfitSave}
          onDelete={async () => {
            await anonymiseOutfitMutation.mutateAsync(activeOutfit.id)
          }}
        />
      )}
    </div>
  )
}
