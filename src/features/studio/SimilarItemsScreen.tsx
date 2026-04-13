import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowDownRight } from "lucide-react"

import { MoodboardPickerDrawer, OutfitInspirationTile, ProductAlternateCard, ScreenHeader, TrayActionButton } from "@/design-system/primitives"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import {
  useCreateMoodboard,
  useFavorites,
  useMoodboards,
  useRemoveOutfitFromLibrary,
  useSaveToCollection,
} from "@/features/collections/hooks/useMoodboards"
import { useLaunchStudio } from "@/features/studio/hooks/useLaunchStudio"
import { useStudioOutfitComplementaryProducts } from "@/features/studio/hooks/useStudioOutfitComplementaryProducts"
import { useStudioProduct } from "@/features/studio/hooks/useStudioProduct"
import { useStudioProductOutfits } from "@/features/studio/hooks/useStudioProductOutfits"
import { useWardrobePairings } from "@/features/studio/hooks/useWardrobePairings"
import { mapLegacyOutfitItemsToStudioItems } from "@/features/studio/mappers/renderedItemMapper"
import type { StudioOutfitDTO } from "@/features/studio/types"
import { buildStudioSearchParams, type SlotIdMap } from "@/features/studio/utils/studioUrlState"
import type { StudioAlternativeProduct, StudioComplementaryProduct, StudioProductTraySlot } from "@/services/studio/studioService"
import type { Outfit } from "@/types"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import { useToast } from "@/hooks/use-toast"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { buildRailId, type EntityUiContext, trackItemClicked, trackProductBuyClicked, trackSavedToCollection, trackSaveToggled } from "@/integrations/posthog/engagementTracking/entityEvents"
import { trackStudioProductViewed } from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"

import { ProductSummaryCard } from "./components/ProductSummaryCard"
import { BASE_DELIVERY_SPECS, BASE_PRIMARY_SPECS } from "./constants/specs"
import { useStudioContext } from "./context/StudioContext"
import { StudioLayout } from "./StudioLayout"

const INR_PRICE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const CARD_MAX_WIDTH = "24.5rem"

interface ProductRailProps {
  items: StudioAlternativeProduct[] | StudioComplementaryProduct[]
  isLoading: boolean
  emptyLabel: string
  isSaved?: (productId: string) => boolean
  onToggleSave?: (productId: string, nextSaved: boolean, uiContext: EntityUiContext) => void
  onLongPressSave?: (productId: string, uiContext: EntityUiContext) => void
  onItemClick?: (item: StudioAlternativeProduct | StudioComplementaryProduct, index: number) => void
  uiContextBase?: Omit<EntityUiContext, "position">
}

function ProductRail({
  items,
  isLoading,
  emptyLabel,
  isSaved,
  onToggleSave,
  onLongPressSave,
  onItemClick,
  uiContextBase,
}: ProductRailProps) {
  if (isLoading) {
    return (
      <div className="flex h-36 w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex h-36 w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  return (
    <>
      {items.map((product, index) => (
        <ProductAlternateCard
          key={product.id}
          imageSrc={product.imageSrc}
          title={product.title}
          brand={product.brand ?? "Atlyr"}
          price={
            typeof product.price === "number" ? INR_PRICE_FORMATTER.format(product.price) : "—"
          }
          onClick={onItemClick ? () => onItemClick(product, index) : undefined}
          isSaved={isSaved ? isSaved(product.id) : undefined}
          onToggleSave={
            onToggleSave
              ? () => {
                  const nextSaved = !(isSaved ? isSaved(product.id) : false)
                  onToggleSave(product.id, nextSaved, { ...(uiContextBase ?? {}), position: index })
                }
              : undefined
          }
          onLongPressSave={onLongPressSave ? () => onLongPressSave(product.id, { ...(uiContextBase ?? {}), position: index }) : undefined}
        />
      ))}
    </>
  )
}

interface OutfitRailProps {
  outfits: Array<{ outfit: Outfit; studioOutfit: StudioOutfitDTO | null }>
  isLoading: boolean
  emptyLabel: string
  avatarGender?: "male" | "female"
  onSelect?: (outfit: Outfit, index: number, uiContext: EntityUiContext) => void
  favoriteIds?: string[]
  onToggleSave?: (outfitId: string, nextSaved: boolean, uiContext: EntityUiContext) => void
  onLongPressSave?: (outfitId: string, uiContext: EntityUiContext) => void
  uiContextBase?: Omit<EntityUiContext, "position">
}

function OutfitRail({
  outfits,
  isLoading,
  emptyLabel,
  avatarGender,
  onSelect,
  favoriteIds = [],
  onToggleSave,
  onLongPressSave,
  uiContextBase,
}: OutfitRailProps) {
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  if (isLoading) {
    return (
      <div className="flex h-40 w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
        Loading styles...
      </div>
    )
  }

  if (outfits.length === 0) {
    return (
      <div className="flex h-40 w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }

  const isInteractive = Boolean(onSelect)

  return (
    <>
      {outfits.map(({ outfit, studioOutfit }, index) => {
        const renderedItems = studioOutfit?.renderedItems ?? mapLegacyOutfitItemsToStudioItems(outfit.items)
        const key = outfit.id ?? studioOutfit?.id ?? `${outfit.name ?? "outfit"}-${index}`
        const outfitId = studioOutfit?.id ?? outfit.id ?? null
        return (
          <OutfitRailItem
            key={key}
            outfit={outfit}
            studioOutfit={studioOutfit}
            renderedItems={renderedItems}
            isInteractive={isInteractive}
            avatarGender={avatarGender}
            onSelect={onSelect ? (selected) => onSelect(selected, index, { ...(uiContextBase ?? {}), position: index }) : undefined}
            isSaved={outfitId ? favoriteSet.has(outfitId) : false}
            onToggleSave={onToggleSave ? (id, next) => onToggleSave(id, next, { ...(uiContextBase ?? {}), position: index }) : undefined}
            onLongPressSave={onLongPressSave ? (id) => onLongPressSave(id, { ...(uiContextBase ?? {}), position: index }) : undefined}
          />
        )
      })}
    </>
  )
}

interface OutfitRailItemProps {
  outfit: Outfit
  studioOutfit: StudioOutfitDTO | null
  renderedItems: ReturnType<typeof mapLegacyOutfitItemsToStudioItems>
  isInteractive: boolean
  avatarGender?: "male" | "female"
  onSelect?: (outfit: Outfit) => void
  isSaved: boolean
  onToggleSave?: (outfitId: string, nextSaved: boolean) => void
  onLongPressSave?: (outfitId: string) => void
}

function OutfitRailItem({
  outfit,
  studioOutfit,
  renderedItems,
  isInteractive,
  avatarGender,
  onSelect,
  isSaved,
  onToggleSave,
  onLongPressSave,
}: OutfitRailItemProps) {
  const [localSaved, setLocalSaved] = useState(isSaved)
  useEffect(() => {
    setLocalSaved(isSaved)
  }, [isSaved])

  const outfitId = studioOutfit?.id ?? outfit.id ?? null
  const handleToggleSave = useCallback(() => {
    if (!outfitId) return
    setLocalSaved((prev) => {
      const next = !prev
      onToggleSave?.(outfitId, next)
      return next
    })
  }, [onToggleSave, outfitId])

  return (
    <OutfitInspirationTile
      preset="homeCurated"
      wrapperClassName={isInteractive ? "cursor-pointer border-0 p-0 rounded-sm" : "border-0 p-0 rounded-sm"}
      wrapperProps={{
        role: isInteractive ? "button" : undefined,
        tabIndex: isInteractive ? 0 : undefined,
        onClick: isInteractive ? () => onSelect?.(outfit) : undefined,
        onKeyDown: isInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect?.(outfit)
              }
            }
          : undefined,
      }}
      cardOverrides={{ showSaveButton: true, sizeMode: "fixed" }}
      
      outfitId={outfitId ?? undefined}
      avatarGender={avatarGender}
      renderedItems={renderedItems}
      fallbackImageSrc={
        studioOutfit?.imageSrcFallback ?? renderedItems?.[0]?.imageUrl ?? outfit.items?.[0]?.imageUrl ?? undefined
      }
      title={studioOutfit?.name ?? outfit.name}
      chips={[studioOutfit?.fit ?? outfit.fit, studioOutfit?.feel ?? outfit.feel].filter(Boolean) as string[]}
      attribution={resolveOutfitAttribution(outfit.created_by)}
      disableAvatarSwipe
      isSaved={localSaved}
      onToggleSave={onToggleSave ? handleToggleSave : undefined}
      onLongPressSave={outfitId && onLongPressSave ? () => onLongPressSave(outfitId) : undefined}
    />
  )
}

export function SimilarItemsView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { openProduct, openStudio, selectedProductId } = useStudioContext()
  const launchStudio = useLaunchStudio()
  const { toast } = useToast()
  const analytics = useEngagementAnalytics()
  const { gender: avatarGender } = useProfileContext()
  const productSaveActions = useProductSaveActions()
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
  const pendingOutfitContextRef = useRef<EntityUiContext | null>(null)
  const lastViewedProductIdRef = useRef<string | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const pairWithWardrobeRailId = useMemo(() => buildRailId("studio_similar", "Pair with wardrobe"), [])
  const pairWithNewItemsRailId = useMemo(() => buildRailId("studio_similar", "Pair with new items"), [])
  const popularStylesRailId = useMemo(() => buildRailId("studio_similar", "Popular styles"), [])

  const pairWithWardrobeUiBase = useMemo(
    () => ({ layout: "horizontal_rail", section: "pair_with_wardrobe", rail_id: pairWithWardrobeRailId } satisfies EntityUiContext),
    [pairWithWardrobeRailId],
  )
  const pairWithNewItemsUiBase = useMemo(
    () => ({ layout: "horizontal_rail", section: "pair_with_new_items", rail_id: pairWithNewItemsRailId } satisfies EntityUiContext),
    [pairWithNewItemsRailId],
  )
  const popularStylesUiBase = useMemo(
    () => ({ layout: "horizontal_rail", section: "popular_styles", rail_id: popularStylesRailId } satisfies EntityUiContext),
    [popularStylesRailId],
  )

  const productIdFromParams = searchParams.get("productId")
  const activeProductId = productIdFromParams ?? selectedProductId ?? null
  const outfitIdFromParams = searchParams.get("outfitId")

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
  const basePath = useMemo(() => {
    const match = location.pathname.match(/(.*\/studio)(?:\/.*)?$/)
    if (match?.[1]) {
      return match[1]
    }
    return "/studio"
  }, [location.pathname])

  const productQuery = useStudioProduct(activeProductId)
  const product = productQuery.data

  const handleApplyComplementary = useCallback(
    (clickedProductId: string, clickedSlot: StudioProductTraySlot | null) => {
      if (!activeProductId) {
        toast({ title: "No product selected", description: "Pick a product first." })
        return
      }
      const mainSlot = product?.slot ?? null
      if (!mainSlot || !clickedSlot) {
        toast({ title: "Not ready yet", description: "Please try again in a moment." })
        return
      }
      if (mainSlot === clickedSlot) {
        toast({ title: "Pick a complementary item", description: "That item belongs to the same category." })
        return
      }
      if (!outfitIdFromParams) {
        toast({ title: "Start a studio outfit first", description: "This flow needs an active outfit." })
        return
      }

      const allSlots: StudioProductTraySlot[] = ["top", "bottom", "shoes"]
      const hiddenSlot = allSlots.find((slot) => slot !== mainSlot && slot !== clickedSlot) ?? null
      if (!hiddenSlot) {
        toast({ title: "Unable to apply item", description: "Please try a different item." })
        return
      }

      const slotIds: SlotIdMap = {}
      slotIds[mainSlot] = activeProductId
      slotIds[clickedSlot] = clickedProductId

      const params = buildStudioSearchParams({
        outfitId: outfitIdFromParams,
        slotIds,
        hiddenSlots: { [hiddenSlot]: true },
      })
      const search = params.toString()
      navigate(`${basePath}${search ? `?${search}` : ""}`)
    },
    [activeProductId, basePath, navigate, outfitIdFromParams, product?.slot, toast],
  )

  useEffect(() => {
    if (!activeProductId) return
    if (!product) return
    if (lastViewedProductIdRef.current === activeProductId) return
    lastViewedProductIdRef.current = activeProductId
    trackStudioProductViewed(analytics, activeProductId)
  }, [activeProductId, analytics, product])
  const heroTags = useMemo(() => {
    if (!product) {
      return []
    }
    return [...product.fitTags, ...product.feelTags, ...product.vibeTags]
  }, [product])

  const wardrobeQuery = useWardrobePairings(product?.slot ?? null)
  const wardrobeItems = wardrobeQuery.items
  const isWardrobeLoading = wardrobeQuery.isLoading || productQuery.isLoading

  const complementaryQuery = useStudioOutfitComplementaryProducts({
    productId: activeProductId,
    slot: product?.slot ?? null,
    limit: 20,
    gender: avatarGender,
  })
  const complementaryItems = complementaryQuery.data ?? []

  const productOutfitsQuery = useStudioProductOutfits({
    productId: activeProductId,
    slot: product?.slot ?? null,
    gender: avatarGender,
  })
  const productOutfits = productOutfitsQuery.data ?? []

  const handleClose = useCallback(() => {
    if (decodedReturnTo) {
      navigate(decodedReturnTo)
      return
    }
    if (activeProductId) {
      openProduct(activeProductId, { initialProduct: product ?? null })
      return
    }
    openStudio()
  }, [decodedReturnTo, navigate, activeProductId, openProduct, openStudio, product])
  const handleMoreStyles = useCallback(() => {
    if (!activeProductId) {
      return
    }
    const params = new URLSearchParams()
    params.set("productId", activeProductId)
    if (product?.slot) {
      params.set("slot", product.slot)
    }
    const returnTo = `${location.pathname}${location.search}` || `${basePath}/similar`
    params.set("returnTo", encodeURIComponent(returnTo))
    navigate(`${basePath}/outfit-suggestions?${params.toString()}`)
  }, [activeProductId, basePath, location.pathname, location.search, navigate, product?.slot])

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

  const handleAddToBag = useCallback(() => {
    if (product?.productUrl) {
      trackProductBuyClicked(analytics, { entity_id: product.id })
      window.open(product.productUrl, "_blank", "noopener,noreferrer")
    }
  }, [analytics, product?.id, product?.productUrl])

  if (!activeProductId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-dashed border-muted-foreground/40 bg-card/80 p-4 text-center">
          <p className="text-sm font-semibold text-foreground">No product selected</p>
          <p className="mt-2 text-xs text-muted-foreground">Pick a product in Studio to view similar items.</p>
          <TrayActionButton label="Back to Studio" className="mt-3 w-full justify-center" onClick={openStudio} />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-start overflow-hidden px-2 pb-3 pt-3">
        <div className={`flex w-full max-w-[${CARD_MAX_WIDTH}] flex-1 flex-col overflow-hidden rounded-t-[2rem] border border-border bg-card shadow-sm`}>
          <ScreenHeader onAction={handleClose}/>
          <div
            ref={scrollContainerRef}
            className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-2"
          >
          <section>
            {product ? (
              <ProductSummaryCard
                imageSrc={product.imageUrl ?? "/placeholder.svg"}
                brand={product.brand ?? "Atlyr"}
                title={product.title}
                price={product.price ?? 0}
                primarySpecs={[
                  ...(product.materialType ? [{ icon: BASE_PRIMARY_SPECS[0].icon, label: product.materialType }] : []),
                  ...(product.care ? [{ icon: BASE_PRIMARY_SPECS[1].icon, label: product.care }] : []),
                  BASE_PRIMARY_SPECS[2], // Size guide icon
                ]}
                deliverySpecs={[BASE_DELIVERY_SPECS[BASE_DELIVERY_SPECS.length - 1]]} // Only heart icon
                tags={heroTags}
                onAddToBag={handleAddToBag}
                onSizeGuide={product.productUrl ? handleAddToBag : undefined}
                isSaved={productSaveActions.isSaved(product.id)}
                onToggleSave={() => {
                  const saved = productSaveActions.isSaved(product.id)
                  productSaveActions.onToggleSave(product.id, !saved)
                }}
                onLongPressSave={() => productSaveActions.onLongPressSave(product.id)}
              />
            ) : (
              <div className="h-36 w-full animate-pulse rounded-xl bg-muted/20" />
            )}
          </section>

          <section className="flex flex-col gap-2">
            <header className="flex items-center justify-between px-1">
              <p className="text-xs font-medium text-foreground">Pair with wardrobe</p>
            </header>
            <div className="overflow-x-auto px-1 pb-1 scrollbar-hide">
              <div className="flex gap-2">
                <ProductRail
                  items={wardrobeItems}
                  isLoading={isWardrobeLoading}
                  emptyLabel="No wardrobe matches yet."
                  onItemClick={(item) => handleApplyComplementary(item.id, item.itemType ?? null)}
                  isSaved={productSaveActions.isSaved}
                  uiContextBase={pairWithWardrobeUiBase}
                  onToggleSave={(productId, nextSaved, uiContext) => productSaveActions.onToggleSave(productId, nextSaved, uiContext)}
                  onLongPressSave={(productId, uiContext) => productSaveActions.onLongPressSave(productId, uiContext)}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <header className="flex items-center justify-between px-1">
              <p className="text-xs font-medium text-foreground">Pair with new items</p>
            </header>
            <div className="overflow-x-auto px-1 pb-1 scrollbar-hide">
              <div className="flex gap-2">
                <ProductRail
                  items={complementaryItems}
                  isLoading={complementaryQuery.isLoading}
                  emptyLabel="No complementary items yet."
                  onItemClick={(item) => handleApplyComplementary(item.id, item.itemType ?? null)}
                  isSaved={productSaveActions.isSaved}
                  uiContextBase={pairWithNewItemsUiBase}
                  onToggleSave={(productId, nextSaved, uiContext) => productSaveActions.onToggleSave(productId, nextSaved, uiContext)}
                  onLongPressSave={(productId, uiContext) => productSaveActions.onLongPressSave(productId, uiContext)}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <header className="flex items-center justify-between px-1">
              <p className="text-xs font-medium text-foreground">Popular styles</p>
            </header>
            <div className="overflow-x-auto px-1 pb-2 scrollbar-hide">
              <div className="flex gap-2">
                <OutfitRail
                  outfits={productOutfits}
                  isLoading={productOutfitsQuery.isLoading}
                  emptyLabel="No outfits for this product yet."
                  avatarGender={avatarGender ?? undefined}
                  uiContextBase={popularStylesUiBase}
                  onSelect={(outfit, _index, uiContext) => {
                    trackItemClicked(analytics, {
                      entity_type: "outfit",
                      entity_id: outfit.id,
                      ...uiContext,
                    })
                    launchStudio(outfit)
                  }}
                  favoriteIds={favoriteIds}
                  onToggleSave={(outfitId, nextSaved, uiContext) => handleToggleOutfitById(outfitId, nextSaved, uiContext, "click")}
                  onLongPressSave={(outfitId, uiContext) => handleLongPressOutfitById(outfitId, uiContext)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <TrayActionButton
                tone="plain"
                iconEnd={ArrowDownRight}
                label="More Styles"
                className="w-28 justify-center rounded-xl bg-card/80 px-1 text-xs font-medium text-foreground hover:bg-card"
                onClick={handleMoreStyles}
                disabled={!activeProductId}
              />
            </div>
          </section>
          </div>
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

export function SimilarItemsScreen() {
  return (
    <StudioLayout>
      <SimilarItemsView />
    </StudioLayout>
  )
}

export default SimilarItemsScreen
