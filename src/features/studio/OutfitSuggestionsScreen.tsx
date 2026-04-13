import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import {
  FilterSearchBar,
  type FilterSearchBarChip,
  OutfitInspirationGrid,
  MoodboardPickerDrawer,
  ScreenHeader,
} from "@/design-system/primitives"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useStudioContext } from "@/features/studio/context/StudioContext"
import { useLaunchStudio } from "@/features/studio/hooks/useLaunchStudio"
import { useStudioProduct } from "@/features/studio/hooks/useStudioProduct"
import { useStudioCategoryOutfitsInfinite } from "@/features/studio/hooks/useStudioCategoryOutfitsInfinite"
import { useStudioProductOutfits } from "@/features/studio/hooks/useStudioProductOutfits"
import type { InspirationItem, StudioOutfitDTO } from "@/features/studio/types"
import { mapLegacyOutfitItemsToStudioItems } from "@/features/studio/mappers/renderedItemMapper"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import {
  useCreateMoodboard,
  useFavorites,
  useMoodboards,
  useRemoveOutfitFromLibrary,
  useSaveToCollection,
} from "@/features/collections/hooks/useMoodboards"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/integrations/supabase/client"
import { isStudioSlot } from "@/features/studio/utils/studioUrlState"
import type { Outfit } from "@/types"

type OutfitGridLayoutMode = "balanced" | "fixedAvatar"

const CARD_MAX_WIDTH = "24.5rem"
const CATEGORY_PAGE_SIZE = 50
type OutfitEntry = { outfit: Outfit; studioOutfit: StudioOutfitDTO | null }

export function OutfitSuggestionsView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { selectedProductId } = useStudioContext()
  const launchStudio = useLaunchStudio()
  const [searchTerm, setSearchTerm] = useState("")
  const [activeFilter, setActiveFilter] = useState<"products" | "outfits">("outfits")
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | undefined>(undefined)
  const [layoutMode] = useState<OutfitGridLayoutMode>("balanced")
  const { toast } = useToast()
  const { gender, heightCm } = useProfileContext()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const categoryIdFromParams = searchParams.get("categoryId")
  const categoryTitleFromParams = searchParams.get("title")
  const isCategoryMode = Boolean(categoryIdFromParams)

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

  const productIdFromParams = searchParams.get("productId")
  const slotFromParams = searchParams.get("slot")
  const resolvedProductId = isCategoryMode ? null : (productIdFromParams ?? selectedProductId ?? null)

  const productQuery = useStudioProduct(resolvedProductId)
  const resolvedSlot = useMemo(() => {
    if (slotFromParams && isStudioSlot(slotFromParams)) {
      return slotFromParams
    }
    return productQuery.data?.slot ?? null
  }, [productQuery.data?.slot, slotFromParams])

  const productOutfitsQuery = useStudioProductOutfits({
    productId: resolvedProductId,
    slot: resolvedSlot,
    enabled: !isCategoryMode,
  })

  const categoryOutfitsQuery = useStudioCategoryOutfitsInfinite({
    categoryId: categoryIdFromParams,
    enabled: isCategoryMode,
    limit: CATEGORY_PAGE_SIZE,
  })

  useEffect(() => {
    if (!isCategoryMode) {
      return
    }

    const node = loadMoreRef.current
    if (!node) {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) {
        return
      }
      if (categoryOutfitsQuery.hasNextPage && !categoryOutfitsQuery.isFetchingNextPage) {
        categoryOutfitsQuery.fetchNextPage()
      }
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [
    categoryOutfitsQuery.fetchNextPage,
    categoryOutfitsQuery.hasNextPage,
    categoryOutfitsQuery.isFetchingNextPage,
    isCategoryMode,
  ])

  const favoritesQuery = useFavorites()
  const favoriteIds = favoritesQuery.data ?? []
  const saveToCollectionMutation = useSaveToCollection()
  const removeOutfitFromLibraryMutation = useRemoveOutfitFromLibrary()
  const createMoodboardMutation = useCreateMoodboard()
  const { data: moodboards = [] } = useMoodboards()
  const selectableMoodboards = useMemo(
    () => moodboards.filter((m) => !m.isSystem),
    [moodboards],
  )
  const [pendingOutfitId, setPendingOutfitId] = useState<string | null>(null)
  const [isOutfitPickerOpen, setIsOutfitPickerOpen] = useState(false)

  const buildInspirationItem = useCallback(
    (entry: OutfitEntry, index: number): InspirationItem => {
      const outfit = entry.outfit
      const studioOutfit = entry.studioOutfit
      const outfitId = studioOutfit?.id ?? outfit.id ?? null
      const renderedItems = studioOutfit?.renderedItems ?? mapLegacyOutfitItemsToStudioItems(outfit.items)

      return {
        id: outfitId ?? `${index}`,
        variant: "narrow" as const,
        title: studioOutfit?.name ?? outfit.name ?? "Outfit",
        chips: [studioOutfit?.fit ?? outfit.fit, studioOutfit?.feel ?? outfit.feel].filter(Boolean) as string[],
        attribution: resolveOutfitAttribution(outfit.created_by),
        outfitId,
        renderedItems,
        gender: gender ?? "female",
        heightCm: heightCm ?? 170,
        showTitle: true,
        showChips: true,
        showSaveButton: true,
        isSaved: outfitId ? favoriteIds.includes(outfitId) : false,
        outfit,
      } satisfies InspirationItem
    },
    [favoriteIds, gender, heightCm],
  )

  const outfitEntries = useMemo<OutfitEntry[]>(() => {
    if (isCategoryMode) {
      return categoryOutfitsQuery.data?.pages.flatMap((page) => page.results) ?? []
    }
    return (productOutfitsQuery.data ?? []) as OutfitEntry[]
  }, [categoryOutfitsQuery.data?.pages, isCategoryMode, productOutfitsQuery.data])

  const outfitItems = useMemo(() => {
    return outfitEntries.map((entry, index) => buildInspirationItem(entry, index))
  }, [buildInspirationItem, outfitEntries])

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = searchTerm.trim()
    if (trimmed.length === 0 && !uploadedImageUrl) {
      return
    }
    const params = new URLSearchParams()
    if (trimmed.length > 0) {
      params.set("search", trimmed)
    }
    if (uploadedImageUrl) {
      params.set("imageUrl", encodeURIComponent(uploadedImageUrl))
    }
    params.set("mode", activeFilter)
    navigate(`/search?${params.toString()}`, { replace: false })
  }, [activeFilter, navigate, searchTerm, uploadedImageUrl])

  const handleClear = useCallback(() => {
    setSearchTerm("")
  }, [])

  const handleFilterChange = useCallback((next: "products" | "outfits") => {
    setActiveFilter(next)
  }, [])

  const handleFilterToggle = useCallback(() => {
    const next = activeFilter === "products" ? "outfits" : "products"
    handleFilterChange(next)
  }, [activeFilter, handleFilterChange])

  const handleClearImage = useCallback(() => {
    setUploadedImageUrl(undefined)
  }, [])

  const handleImageUpload = async (file: File) => {
    try {
      setIsUploading(true)
      const fileExt = file.name.split(".").pop()
      const fileName = `${Math.random()}.${fileExt}`
      const filePath = `search-images/${fileName}`

      const { error: uploadError } = await supabase.storage.from("public-files").upload(filePath, file)
      if (uploadError) throw uploadError

      const { data } = supabase.storage.from("public-files").getPublicUrl(filePath)
      const publicUrl = data.publicUrl

      setUploadedImageUrl(publicUrl)
      setActiveFilter("products")
    } catch (error) {
      console.error("Image upload failed:", error)
      toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" })
    } finally {
      setIsUploading(false)
    }
  }

  const handleBack = useCallback(() => {
    if (decodedReturnTo) {
      navigate(decodedReturnTo)
      return
    }
    navigate(-1)
  }, [decodedReturnTo, navigate])

  const handleToggleOutfitById = useCallback(
    async (outfitId: string, nextSaved: boolean) => {
      try {
        if (nextSaved) {
          await saveToCollectionMutation.mutateAsync({ outfitId, slug: "favorites", label: "Favorites" })
        } else {
          await removeOutfitFromLibraryMutation.mutateAsync({ outfitId })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update favorite"
        toast({ title: "Save failed", description: message, variant: "destructive" })
        favoritesQuery.refetch()
      }
    },
    [favoritesQuery, removeOutfitFromLibraryMutation, saveToCollectionMutation, toast],
  )

  const handleLongPressOutfitById = useCallback(
    async (outfitId: string) => {
      try {
        await saveToCollectionMutation.mutateAsync({ outfitId, slug: "favorites", label: "Favorites" })
        setPendingOutfitId(outfitId)
        setIsOutfitPickerOpen(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save outfit"
        toast({ title: "Save failed", description: message, variant: "destructive" })
      }
    },
    [saveToCollectionMutation, toast],
  )

  const handleToggleFavorite = useCallback(
    (item: InspirationItem, nextSaved: boolean) => {
      const outfitId = item.outfitId ?? item.outfit?.id ?? null
      if (!outfitId) return
      handleToggleOutfitById(outfitId, nextSaved)
    },
    [handleToggleOutfitById],
  )

  const handleLongPressSave = useCallback(
    (item: InspirationItem) => {
      const outfitId = item.outfitId ?? item.outfit?.id ?? null
      if (!outfitId) return
      handleLongPressOutfitById(outfitId)
    },
    [handleLongPressOutfitById],
  )

  const handleMoodboardPickerSelect = useCallback(
    async (slug: string) => {
      if (!pendingOutfitId) return
      const label = selectableMoodboards.find((board) => board.slug === slug)?.label ?? slug
      try {
        await saveToCollectionMutation.mutateAsync({ outfitId: pendingOutfitId, slug, label })
        setPendingOutfitId(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to add to moodboard"
        toast({ title: "Add failed", description: message, variant: "destructive" })
      }
    },
    [pendingOutfitId, saveToCollectionMutation, selectableMoodboards, toast],
  )

  const handleMoodboardPickerApply = useCallback(
    async (slugs: string[]) => {
      if (!pendingOutfitId) return
      try {
        for (const slug of slugs) {
          const label = selectableMoodboards.find((board) => board.slug === slug)?.label ?? slug
          await saveToCollectionMutation.mutateAsync({ outfitId: pendingOutfitId, slug, label })
        }
        setPendingOutfitId(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to add to moodboards"
        toast({ title: "Add failed", description: message, variant: "destructive" })
      }
    },
    [pendingOutfitId, saveToCollectionMutation, selectableMoodboards, toast],
  )

  const handleCreateMoodboard = useCallback(
    async (name: string) => {
      const result = await createMoodboardMutation.mutateAsync(name)
      return result.slug
    },
    [createMoodboardMutation],
  )

  const handleOutfitSelect = useCallback(
    (item: InspirationItem) => {
      if (!item.outfit) {
        return
      }
      launchStudio(item.outfit)
    },
    [launchStudio],
  )

  const filters = useMemo<FilterSearchBarChip[]>(
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

  const hasProductId = Boolean(resolvedProductId)
  const isSlotReady = Boolean(resolvedSlot)
  const isContextLoading = hasProductId && !isSlotReady && productQuery.isLoading
  const hasProductContext = hasProductId && isSlotReady
  const screenTitle = categoryTitleFromParams ?? "More styles"

  return (
    <div className="flex flex-1 flex-col items-center justify-start overflow-hidden px-1 pt-3">
      <div className={`flex w-full max-w-[${CARD_MAX_WIDTH}] flex-1 flex-col overflow-hidden rounded-[2rem] bg-card shadow-sm`}>
        <ScreenHeader title={screenTitle} onAction={handleBack} />
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-20 pt-2 scrollbar-hide">
            {isCategoryMode ? (
              categoryOutfitsQuery.isLoading ? (
                <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                  Loading styles...
                </div>
              ) : categoryOutfitsQuery.isError ? (
                <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                  Unable to load styles right now.
                </div>
              ) : outfitItems.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                  No outfits in this section yet.
                </div>
              ) : (
                <>
                  <OutfitInspirationGrid
                    items={outfitItems}
                    columns={2}
                    rows={8}
                    layoutMode={layoutMode}
                    cardTotalHeight={290}
                    cardVerticalGap={4}
                    cardMinAvatarHeight={128}
                    fixedAvatarHeight={156}
                    cardPreset="homeCurated"
                    onCardSelect={handleOutfitSelect}
                    onToggleSave={handleToggleFavorite}
                    onLongPressSave={handleLongPressSave}
                  />
                  <div ref={loadMoreRef} className="h-6 w-full" />
                  {categoryOutfitsQuery.isFetchingNextPage ? (
                    <div className="flex justify-center pb-2 text-xs text-muted-foreground">Loading more...</div>
                  ) : null}
                </>
              )
            ) : !hasProductId ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Pick a product in Studio to view styles.
              </div>
            ) : isContextLoading ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Loading styles...
              </div>
            ) : !hasProductContext ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Unable to load styles right now.
              </div>
            ) : productOutfitsQuery.isLoading ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Loading styles...
              </div>
            ) : productOutfitsQuery.isError ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Unable to load styles right now.
              </div>
            ) : outfitItems.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                No outfits for this product yet.
              </div>
            ) : (
              <OutfitInspirationGrid
                items={outfitItems}
                columns={2}
                rows={8}
                layoutMode={layoutMode}
                cardTotalHeight={290}
                cardVerticalGap={4}
                cardMinAvatarHeight={128}
                fixedAvatarHeight={156}
                cardPreset="homeCurated"
                onCardSelect={handleOutfitSelect}
                onToggleSave={handleToggleFavorite}
                onLongPressSave={handleLongPressSave}
              />
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-[3rem] z-10">
        <div className="pointer-events-auto mx-auto w-full px-2" style={{ maxWidth: CARD_MAX_WIDTH }}>
          <FilterSearchBar
            className="rounded-t-3xl"
            value={searchTerm}
            onValueChange={handleSearchChange}
            filters={isSearchFocused ? filters : undefined}
            pillPosition={isSearchFocused ? "top" : "none"}
            variant="elevated"
            onSubmit={handleSubmit}
            onClear={handleClear}
            placeholder={
              isSearchFocused
                ? activeFilter === "products"
                  ? "Search products..."
                  : "Search outfits..."
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
    </div>
  )
}
