import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"

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
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        Unable to load creations right now.
        <Button size="sm" variant="secondary" onClick={() => creationsQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  if (creations.length === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-muted-foreground/30 bg-muted/10 text-sm text-muted-foreground">
        No creations yet.
      </div>
    )
  }

  const currentCreation = creations[currentSlide]

  return (
    <div className="flex flex-col gap-1" style={{ height: 'calc(100vh - 178px)' }}>
      {/* Top Container - Carousel */}
      <div className="flex flex-col items-center gap-2 px-4 sm:px-12 py-2 w-full h-full overflow-hidden">
        <div className="flex w-full max-w-[384px] flex-col items-center gap-1 h-full">
          <div className="relative w-full overflow-hidden flex-1 max-h-[600px]">
            <div
              className="absolute inset-0 z-20 pointer-events-none"
              style={{
                background: `
                  linear-gradient(to right, var(--muted, #f5f5f5) 0%, rgba(245,245,245,0.85) 10%, rgba(245,245,245,0.0) 22%, rgba(245,245,245,0.0) 78%, rgba(245,245,245,0.85) 90%, var(--muted, #f5f5f5) 100%)
                `,
              }}
            />
            <div
              ref={scrollContainerRef}
              className="h-full w-full overflow-x-auto overflow-y-hidden scrollbar-hide"
              style={{
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
                scrollBehavior: "smooth",
              }}
            >
              <div
                className="flex h-full items-center gap-4 px-20"
                style={{ width: `${(totalSlides + (isFetchingMoreCreations ? 1 : 0)) * 342}px` }}
              >
                {creations.map((creation, index) => {
                  const isActive = index === currentSlide
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
                        width: 'min(356px, 80vw)',
                        scrollSnapAlign: "center",
                      }}
                    >
                      <div
                        className="relative w-full h-full transition-opacity duration-300 transition-transform"
                        style={{
                          opacity: isActive ? 1 : 1,
                        }}
                      >
                        <div className="overflow-hidden w-full h-full rounded-lg" style={{ transform: "" }}>
                          <div className="relative h-full w-full">
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
                                    className="absolute bottom-1 right-1 z-10 rounded-full px-1 py-0 text-[10px] font-medium text-foreground"
                                    style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                                  >
                                    Atlyr
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
                            ) : null}
                            {isCardFlipped ? (
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
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {isFetchingMoreCreations ? (
                  <div
                    key="creations-loading"
                    className="relative flex h-full flex-shrink-0 items-center justify-center"
                    style={{ width: "min(356px, 80vw)" }}
                  >
                    <div className="h-full w-full animate-pulse rounded-lg bg-muted/50" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Title and Controls */}
          {currentCreation ? (
            <div className="flex w-full items-center justify-between px-1">
              <div className="flex flex-col">
                <p className="text-sm font-medium text-foreground lowercase leading-4 tracking-[-0.14px] truncate ml-3">
                  {currentCreation.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => toggleFlip(currentCreation.id)}
                  aria-label="Flip card"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <TrayActionButton
                  tone="plain"
                  iconEnd={ArrowUpRight}
                  label="Studio"
                  className="pointer-events-auto h-9 rounded-xl bg-card/80 px-2 text-xs font-medium text-foreground hover:bg-card rounded-full"
                  onClick={() => handleOpenStudio(currentCreation)}
                />
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
      </div>

      {/* space gainer for the fixed product tray so that the OutfitInspirationCard is not covered by the product tray */}
      <div className="invisible z-20 flex justify-center bg-background pb-4 min-h-[150px]">
        <ProductTray items={trayItems} slotOrder={slotOrder} />
      </div>

      {/* Bottom Bar - Product List */}
      <div className=" w-[94%] mx-auto fixed bottom-8 left-0 right-0 z-20 flex justify-center bg-background pb-4">
        <ProductTray
          items={trayItems}
          isLoading={productTrayQuery.isLoading}
          onProductPress={handleProductPress}
          onDetailsPress={handleDetailsPress}
          onTryOn={handleTryOn}
          saveActionMode="toggle"
          saveIsActive={isSaved}
          onToggleSave={handleToggleSave}
          defaultOutfitName={activeCreation?.name ?? ""}
          showFilter={false}
          showRemove={false}
          slotOrder={slotOrder}
          hiddenSlots={hiddenSlots}
          onAddSlot={handleAddSlot}
          onRemoveSlot={handleRemoveSlot}
          onRestoreSlot={handleRestoreSlot}
          onReorderSlots={handleReorderSlots}
        />
      </div>
      <SaveOutfitDrawer
        key={activeCreation?.id ?? "save-draft"}
        open={isSaveDrawerOpen}
        onOpenChange={setIsSaveDrawerOpen}
        defaultOutfitName={activeOutfit?.name ?? activeCreation?.name ?? ""}
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
    </div>
  )
}
