import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { ProductAlternateCard, ProductSheet, TrayActionButton, MoodboardPickerDrawer } from "@/design-system/primitives"
import { cn } from "@/lib/utils"
import { parseProductDescription } from "@/utils/productDescription"

import { BASE_DELIVERY_SPECS, BASE_PRIMARY_SPECS } from "./constants/specs"
import { useStudioContext } from "./context/StudioContext"
import { useStudioTourContext } from "./context/StudioTourContext"
import { StudioLayout } from "./StudioLayout"
import { useStudioProduct } from "@/features/studio/hooks/useStudioProduct"
import { useStudioSimilarProducts } from "@/features/studio/hooks/useStudioSimilarProducts"
import { useStudioProductImages } from "@/features/studio/hooks/useStudioProductImages"
import { useOutfitWithProduct } from "@/features/studio/hooks/useOutfitWithProduct"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useAuth } from "@/contexts/AuthContext"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { buildStudioSearchParams, isStudioSlot } from "@/features/studio/utils/studioUrlState"
import {
  seededState,
  studioHistoryStorageKey,
  type StudioHistorySnapshot,
} from "@/features/studio/utils/studioHistoryState"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { readReturnTo } from "@/utils/returnTo"
import { trackProductBuyClicked } from "@/integrations/posthog/engagementTracking/entityEvents"
import { trackStudioProductViewed } from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import { useToast } from "@/hooks/use-toast"

function ProductTagChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-6 items-center justify-center whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  )
}

const INR_PRICE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const CARD_MAX_WIDTH = "24.5rem"

export function ProductPageView() {
  const { productId } = useParams<{ productId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tour = useStudioTourContext()
  const { openProduct, openStudio, openSimilarItems, selectedProductId, setSelectedProductId } = useStudioContext()
  const { user } = useAuth()
  const { profile, gender } = useProfileContext()
  const { toast } = useToast()
  const activeProductId = productId ?? selectedProductId ?? null
  useEffect(() => {
    if (productId) {
      setSelectedProductId(productId)
    }
  }, [productId, setSelectedProductId])

  const productQuery = useStudioProduct(activeProductId)
  const product = productQuery.data
  const tags = useMemo(() => {
    if (!product) {
      return []
    }
    // Six fits the two rows a full-width details block gives us.
    return [...product.fitTags, ...product.feelTags, ...product.vibeTags].slice(0, 6)
  }, [product])

  const similarItemsQuery = useStudioSimilarProducts(activeProductId)
  const similarItems = similarItemsQuery.data ?? []

  // Find the most recent outfit in the DB that contains this product (used for Add to Studio)
  const outfitWithProductQuery = useOutfitWithProduct(activeProductId)
  const { mutateAsync: createDraftOutfitMutation } = useCreateDraftOutfit()

  // Fetch all images for the product from product_images table (architecture-compliant)
  const productImagesQuery = useStudioProductImages(activeProductId)
  const productImages = productImagesQuery.data ?? []

  // Product save actions for favorites and moodboards
  const productSaveActions = useProductSaveActions()
  const isProductSaved = activeProductId ? productSaveActions.isSaved(activeProductId) : false
  const analytics = useEngagementAnalytics()
  const lastViewedProductIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!activeProductId) return
    if (!product) return
    if (lastViewedProductIdRef.current === activeProductId) return
    lastViewedProductIdRef.current = activeProductId
    trackStudioProductViewed(analytics, activeProductId)
  }, [activeProductId, analytics, product])
  
  // Transform images for the carousel component
  const carouselImages = useMemo(() => {
    // First, include images from the product_images table
    const dbImages = productImages
      .filter(img => img.url)
      .map((img) => ({
        id: img.id,
        url: img.url,
        alt: product?.title ?? 'Product image',
      }))
    
    // If no images from DB, fall back to the product's main image
    if (dbImages.length === 0 && product?.imageUrl) {
      return [{
        id: 'primary',
        url: product.imageUrl,
        alt: product?.title ?? 'Product image',
      }]
    }
    
    return dbImages
  }, [productImages, product?.title, product?.imageUrl])

  const attemptOpenSimilar = useCallback(() => {
    if (!activeProductId) {
      return
    }
    openSimilarItems(activeProductId, { initialProduct: product ?? null })
  }, [activeProductId, openSimilarItems, product])

  const handleSimilarItemSelect = useCallback(
    (productId: string) => {
      openProduct(productId)
    },
    [openProduct],
  )

  // Where the × goes. Whoever opened this page owns the answer: Collections and
  // search pass ?returnTo=, and sending them to Studio instead was the bug.
  const decodedReturnTo = useMemo(() => readReturnTo(searchParams.toString()), [searchParams])

  // × button: back to the opener, else the last active Studio state from sessionStorage.
  const handleClose = useCallback(() => {
    if (decodedReturnTo) {
      navigate(decodedReturnTo)
      return
    }
    try {
      const raw = window.sessionStorage.getItem("atlyr:studio:lastSession")
      if (raw) {
        const session = JSON.parse(raw) as {
          outfitId: string
          slotIds: { top: string | null; bottom: string | null; shoes: string | null }
          hiddenSlots: { top: boolean; bottom: boolean; shoes: boolean }
        }
        if (session?.outfitId) {
          const params = buildStudioSearchParams({
            outfitId: session.outfitId,
            slotIds: session.slotIds,
            hiddenSlots: session.hiddenSlots,
          })
          const search = params.toString()
          navigate(`/studio${search ? `?${search}` : ""}`)
          return
        }
      }
    } catch {}
    navigate("/studio")
  }, [decodedReturnTo, navigate])

  const handleBuy = useCallback(() => {
    if (product?.productUrl) {
      if (activeProductId) trackProductBuyClicked(analytics, { entity_id: activeProductId })
      window.open(product.productUrl, "_blank", "noopener,noreferrer")
    }
  }, [activeProductId, analytics, product?.productUrl])

  const handleStyleIt = useCallback(() => {
    attemptOpenSimilar()
  }, [attemptOpenSimilar])

  // "Studio" button: load an outfit containing this product (or create one), then navigate to Studio.
  //
  // Logic:
  //   1. Find the most recently created outfit in DB that contains this product in any slot.
  //      (Sorting key is "latest" for now — swappable to rating/relevance later.)
  //   2a. Outfit found → create a DRAFT COPY of it in DB (same top/bottom/shoes) so the
  //       user can modify it without affecting the original.
  //   2b. No outfit found → create a cold-start draft with just this product in its slot.
  //   3. Before navigating: pre-seed the undo history in localStorage so that one Undo
  //      takes the user back to whichever outfit they had open in Studio before tapping here.
  const handleAddToStudio = useCallback(async () => {
    if (!activeProductId || !product) {
      openStudio()
      return
    }

    const slot = product.slot ?? null

    if (!isStudioSlot(slot)) {
      toast({
        title: "No container found for product",
        description: "This product type can't be placed in the Studio outfit.",
        variant: "destructive",
      })
      openStudio()
      return
    }

    if (!user?.id) {
      openStudio()
      return
    }

    // ── Read the previous Studio session so we can restore it via Undo ──────
    // StudioScreen writes this on every state change; ProductPageScreen reads it here.
    let previousSnapshot: {
      outfitId: string
      slotIds: { top: string | null; bottom: string | null; shoes: string | null }
      hiddenSlots: { top: boolean; bottom: boolean; shoes: boolean }
    } | null = null
    try {
      const raw = window.sessionStorage.getItem("atlyr:studio:lastSession")
      if (raw) previousSnapshot = JSON.parse(raw)
    } catch { /* ignore */ }

    // ── Determine the draft's slot composition ───────────────────────────────
    const foundOutfit = outfitWithProductQuery.data ?? null

    let draftTopId: string | null = null
    let draftBottomId: string | null = null
    let draftShoesId: string | null = null

    if (foundOutfit) {
      // Full outfit found: copy all slots, then override the matching slot with the viewed product
      draftTopId    = slot === "top"    ? activeProductId : (foundOutfit.top_id ?? null)
      draftBottomId = slot === "bottom" ? activeProductId : (foundOutfit.bottom_id ?? null)
      draftShoesId  = slot === "shoes"  ? activeProductId : (foundOutfit.shoes_id ?? null)
    } else {
      // No outfit found: single-product cold start
      draftTopId    = slot === "top"    ? activeProductId : null
      draftBottomId = slot === "bottom" ? activeProductId : null
      draftShoesId  = slot === "shoes"  ? activeProductId : null
    }

    try {
      const draft = await createDraftOutfitMutation({
        userId: user.id,
        topId: draftTopId,
        bottomId: draftBottomId,
        shoesId: draftShoesId,
        gender: foundOutfit?.gender ?? gender ?? "female",
        backgroundId: foundOutfit?.background_id ?? null,
        createdByName: profile?.name ?? null,
      })

      // ── Pre-seed undo history so Undo returns to the previous Studio outfit ─
      // We write the new draft as `present` and the previous session as the last
      // `past` entry BEFORE navigating, so useStudioHistory hydrates with undo
      // already available. The draft is also the restore anchor: it is the look
      // the studio is about to open with.
      if (previousSnapshot?.outfitId) {
        const historyKey = studioHistoryStorageKey(user.id)
        const newDraftSnapshot: StudioHistorySnapshot = {
          outfitId: draft.id,
          slotIds: {
            top:    draftTopId,
            bottom: draftBottomId,
            shoes:  draftShoesId,
          },
          hiddenSlots: { top: false, bottom: false, shoes: false },
        }
        try {
          const existingRaw = window.localStorage.getItem(historyKey)
          const existingHistory = existingRaw ? JSON.parse(existingRaw) : null
          const existingPast: StudioHistorySnapshot[] = existingHistory?.past ?? []
          window.localStorage.setItem(
            historyKey,
            JSON.stringify(seededState(newDraftSnapshot, [...existingPast, previousSnapshot])),
          )
        } catch { /* quota / private-mode — undo just won't have the previous outfit */ }
      }

      // ── Navigate to Studio with the new draft ────────────────────────────────
      const params = buildStudioSearchParams({
        outfitId: draft.id,
        slotIds: {
          top:    draftTopId,
          bottom: draftBottomId,
          shoes:  draftShoesId,
        },
      })
      const search = params.toString()
      navigate(`/studio${search ? `?${search}` : ""}`)
    } catch {
      toast({
        title: "Could not open outfit",
        description: "Please try again.",
        variant: "destructive",
      })
    }
  }, [
    activeProductId,
    createDraftOutfitMutation,
    gender,
    navigate,
    openStudio,
    outfitWithProductQuery.data,
    product,
    profile?.name,
    toast,
    user?.id,
  ])

  const specItems = useMemo(() => {
    const items: { icon: React.ReactNode; label: string }[] = []
    
    // Material type (e.g., Cotton) - from products.material_type
    if (product?.materialType) {
      items.push({
        icon: BASE_PRIMARY_SPECS[0].icon,
        label: product.materialType,
      })
    }
    
    // Care instructions (e.g., Machine) - from products.care
    if (product?.care) {
      items.push({
        icon: BASE_PRIMARY_SPECS[1].icon,
        label: product.care,
      })
    }
    
    // Delivery specs - commented out for future use when DB has these fields
    // items.push({
    //   icon: BASE_DELIVERY_SPECS[0].icon,
    //   label: "3 days", // TODO: Replace with product.estimatedDelivery
    // })
    // items.push({
    //   icon: BASE_DELIVERY_SPECS[1].icon,
    //   label: "15 days", // TODO: Replace with product.returnWindow
    // })
    
    return items
  }, [product?.materialType, product?.care])

  const title = product?.title ?? "Product"
  // The sheet takes plain URLs; the carousel DTO carries alt text it does not use.
  const sheetImages = useMemo(
    () => carouselImages.map((image) => image.url).filter((url): url is string => Boolean(url)),
    [carouselImages],
  )
  const sheetSlot = product?.slot === "top" || product?.slot === "bottom" || product?.slot === "shoes" ? product.slot : null
  // Scraped descriptions arrive as a whole mini-page of markup — see
  // parseProductDescription for why this is split rather than flattened.
  const descriptionSections = useMemo(
    () => parseProductDescription(product?.description),
    [product?.description],
  )
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  // Lead with the prose; everything after it (Details, Wash care, Shipping) is
  // reference material that shouldn't push the page down until asked for.
  const visibleSections = isDescriptionExpanded
    ? descriptionSections
    : descriptionSections.slice(0, 1)
  const hasMoreSections = descriptionSections.length > 1

  if (!activeProductId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-dashed border-muted-foreground/40 bg-card/80 p-4 text-center">
          <p className="text-sm font-semibold text-foreground">Product unavailable</p>
          <p className="mt-2 text-xs text-muted-foreground">We couldn’t find the product you requested.</p>
          <Button className="mt-3 w-full" onClick={openStudio}>
            Back to Studio
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-1 flex-col items-center justify-start overflow-hidden px-2 pb-3 pt-4">
      <div className={`flex w-full max-w-[${CARD_MAX_WIDTH}] flex-1 flex-col overflow-hidden rounded-t-[2rem] border border-border bg-card shadow-sm`}>
        <div className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto">
          <section className="flex flex-col gap-2 px-4 pb-1 pt-3">
            {/* The piece sheet, stacked: the horizontal 205px variant is sized for
                the Studio dock and leaves a full screen half empty. The × rides
                the sheet's own corner rather than owning a header row. No brand,
                no price, no reviews — the sheet carries the piece only. */}
            <div className="w-full">
              <ProductSheet
                layout="panel"
                corner="close"
                onCorner={handleClose}
                highlightCorner={tour.isHighlighted("return-from-product")}
                title={title}
                images={sheetImages}
                slot={sheetSlot}
                showSlot={Boolean(sheetSlot)}
                attributes={tags}
                saved={isProductSaved}
                onSave={() => {
                  if (activeProductId) productSaveActions.onToggleSave(activeProductId, !isProductSaved)
                }}
                onLongPressSave={() => {
                  if (activeProductId) productSaveActions.onLongPressSave(activeProductId)
                }}
                onTryOn={handleAddToStudio}
                tryOnLabel="Open in Studio"
                onFindItems={handleBuy}
                isLoading={productQuery.isLoading}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2 px-2.5 pb-1">
            <div className="flex w-full flex-col items-start gap-2.5 px-1">
              {visibleSections.length === 0 && (
                <p className="text-xs2 text-muted-foreground">
                  No description for this piece yet.
                </p>
              )}

              {visibleSections.map((section, index) => (
                <div key={section.title ?? `section-${index}`} className="w-full">
                  {section.title && (
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {section.title}
                    </p>
                  )}
                  <div className="flex flex-col gap-1">
                    {section.paragraphs.map((paragraph, line) => (
                      <p
                        key={line}
                        className={cn(
                          "text-xs2 leading-relaxed text-ink-body",
                          // The lead paragraph stays clamped while collapsed so
                          // a 900-word blurb can't own the screen.
                          index === 0 && !isDescriptionExpanded && "line-clamp-4",
                        )}
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              ))}

              {(hasMoreSections || !isDescriptionExpanded) && descriptionSections.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsDescriptionExpanded((open) => !open)}
                  className="text-xs2 font-semibold text-terracotta"
                >
                  {isDescriptionExpanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>

            <div className="flex w-full items-center overflow-hidden rounded-md bg-card/80">
              {specItems.map((item, index) => (
                <div
                  key={`spec-${index}`}
                  className="flex flex-1 items-center justify-center gap-1 px-1 py-1 text-xs font-normal text-foreground"
                >
                  <span className="flex items-center justify-center text-muted-foreground">{item.icon}</span>
                  <span>{item.label}</span>
                  {index < specItems.length - 1 ? <span className="hidden h-6 sm:block" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="relative flex flex-col gap-2 px-3 pb-4">
            <header className="flex items-center justify-between">
              <p className="text-xs font-normal text-foreground">Similar Items</p>
            </header>

            <div className="overflow-x-auto pb-1 scrollbar-hide">
              <div className="flex gap-2">
                {similarItemsQuery.isLoading ? (
                  <div className="flex h-36 w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
                    Loading similar items…
                  </div>
                ) : similarItems.length > 0 ? (
                  similarItems.map((product) => (
                <div
                  key={product.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSimilarItemSelect(product.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      handleSimilarItemSelect(product.id)
                    }
                  }}
                  className="cursor-pointer"
                >
                  <ProductAlternateCard
                    imageSrc={product.imageSrc}
                    title={product.title}
                    brand={product.brand}
                    price={typeof product.price === "number" ? INR_PRICE_FORMATTER.format(product.price) : "—"}
                    isSaved={productSaveActions.isSaved(product.id)}
                    onToggleSave={() => productSaveActions.onToggleSave(product.id, !productSaveActions.isSaved(product.id))}
                    onLongPressSave={() => productSaveActions.onLongPressSave(product.id)}
                  />
                </div>
                  ))
                ) : (
                  <div className="flex h-36 w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-card/70 px-4 text-[10px] text-muted-foreground">
                    No similar items yet.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <TrayActionButton
                tone="plain"
                iconEnd={ArrowDownRight}
                label="Style It"
                className="w-24 justify-center rounded-xl bg-card/80 px-1 text-xs font-medium text-foreground hover:bg-card"
                onClick={handleStyleIt}
              />
            </div>
          </section>
        </div>
      </div>
    </div>

      {/* Moodboard picker drawer for long press save */}
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

export function ProductPageScreen() {
  return (
    <StudioLayout>
      <ProductPageView />
    </StudioLayout>
  )
}

export default ProductPageScreen
