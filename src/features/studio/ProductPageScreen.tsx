import { useCallback, useEffect, useMemo, useRef } from "react"
import { ArrowDownRight, ArrowUpRight, Heart, Ruler, ShoppingBag } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { ProductAlternateCard, TrayActionButton, MoodboardPickerDrawer, ScreenHeader } from "@/design-system/primitives"
import { PriceDisplay } from "@/design-system/primitives/price-display"

import { BASE_DELIVERY_SPECS, BASE_PRIMARY_SPECS } from "./constants/specs"
import { useStudioContext } from "./context/StudioContext"
import { useStudioTourContext } from "./context/StudioTourContext"
import { StudioLayout } from "./StudioLayout"
import { useStudioProduct } from "@/features/studio/hooks/useStudioProduct"
import { useStudioSimilarProducts } from "@/features/studio/hooks/useStudioSimilarProducts"
import { useStudioProductImages } from "@/features/studio/hooks/useStudioProductImages"
import { ProductImageCarousel } from "@/components/product/ProductImageCarousel"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackProductBuyClicked } from "@/integrations/posthog/engagementTracking/entityEvents"
import { trackStudioProductViewed } from "@/integrations/posthog/engagementTracking/studio/studioTracking"

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
  const heartLongPressTimeout = useRef<NodeJS.Timeout | null>(null)
  const heartLongPressTriggered = useRef(false)
  const { productId } = useParams<{ productId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tour = useStudioTourContext()
  const { openProduct, openStudio, openSimilarItems, selectedProductId, setSelectedProductId } = useStudioContext()
  const activeProductId = productId ?? selectedProductId ?? null
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
    return [...product.fitTags, ...product.feelTags, ...product.vibeTags]
  }, [product])

  const similarItemsQuery = useStudioSimilarProducts(activeProductId)
  const similarItems = similarItemsQuery.data ?? []

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

  const handleClose = useCallback(() => {
    if (decodedReturnTo) {
      navigate(decodedReturnTo)
      return
    }
    openStudio()
  }, [decodedReturnTo, navigate, openStudio])

  const handleBuy = useCallback(() => {
    if (product?.productUrl) {
      if (activeProductId) trackProductBuyClicked(analytics, { entity_id: activeProductId })
      window.open(product.productUrl, "_blank", "noopener,noreferrer")
    }
  }, [activeProductId, analytics, product?.productUrl])

  const handleStyleIt = useCallback(() => {
    attemptOpenSimilar()
  }, [attemptOpenSimilar])

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
  const brand = product?.brand ?? "Atlyr"
  const description = product?.description ?? "—"
  const price = product?.price ?? 0
  const imageSrc = product?.imageUrl ?? "/placeholder.svg"

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
          <section className="flex flex-col items-center gap-0.5 pb-1 pt-4">
            <ScreenHeader 
              onAction={handleClose}
              highlightAction={tour.isHighlighted("return-from-product")}
              rightSlot={
                <Button
                  onClick={handleBuy}
                  className="flex h-9 items-center gap-2 rounded-l-md rounded-r-none bg-foreground px-2 text-sm font-medium text-card hover:bg-foreground/90"
                >
                  <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                  Buy
                </Button>
              }
              className="flex w-full items-center justify-between px-1"
            />
            <div className="relative w-full px-2">
              {carouselImages.length > 1 ? (
                <ProductImageCarousel 
                  images={carouselImages} 
                  className="h-64 w-full"
                />
              ) : (
                <figure className="flex h-64 w-full items-center justify-center overflow-hidden rounded-md">
                  {productQuery.isLoading ? (
                    <div className="h-full w-full animate-pulse rounded-md" />
                  ) : (
                    <img src={imageSrc} alt={title} className="h-full w-full object-contain" />
                  )}
                </figure>
              )}
              <div className="pointer-events-none absolute right-4 bottom-1 z-10">
                <TrayActionButton
                  tone="plain"
                  iconEnd={ArrowUpRight}
                  label="Studio"
                  className="pointer-events-auto h-9 rounded-xl bg-transparent px-2 text-xs font-medium text-foreground hover:bg-card"
                  onClick={openStudio}
                />
              </div>
            </div>
            <div className="flex w-full gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide">
              {tags.length > 0 ? (
                tags.map((tag) => <ProductTagChip key={tag} label={tag} />)
              ) : (
                <span className="text-xs text-muted-foreground">No tags available</span>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2 px-2.5 pb-1">
            <div className="flex w-full gap-1 px-1">
              <div className="flex flex-1 flex-col gap-1">
                <p className="text-sm font-semibold text-foreground">{brand}</p>
                <p className="text-xs font-normal text-foreground">{title}</p>
                <div className="flex items-center gap-3 text-sm">
                  <PriceDisplay price={price} className="text-sm font-semibold text-foreground" />
                </div>
              </div>
              <div className="flex w-12 flex-col items-stretch rounded-2xl bg-card/80 px-1 py-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-lg px-1 text-xs font-medium text-foreground"
                  onClick={handleBuy}
                >
                  <Ruler aria-hidden="true" />
                </Button>

                <button 
                  type="button"
                  className={`inline-flex items-center justify-center rounded-lg px-1 py-1 text-xs font-medium transition-colors hover:bg-muted/50 select-none ${isProductSaved ? 'text-red-500' : 'text-foreground'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Skip click if long press was triggered
                    if (heartLongPressTriggered.current) {
                      heartLongPressTriggered.current = false
                      return
                    }
                    if (activeProductId) {
                      productSaveActions.onToggleSave(activeProductId, !isProductSaved)
                    }
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                  onMouseDown={() => {
                    if (activeProductId) {
                      heartLongPressTimeout.current = setTimeout(() => {
                        heartLongPressTriggered.current = true
                        productSaveActions.onLongPressSave(activeProductId)
                      }, 500)
                    }
                  }}
                  onMouseUp={() => {
                    if (heartLongPressTimeout.current) {
                      clearTimeout(heartLongPressTimeout.current)
                      heartLongPressTimeout.current = null
                    }
                  }}
                  onMouseLeave={() => {
                    if (heartLongPressTimeout.current) {
                      clearTimeout(heartLongPressTimeout.current)
                      heartLongPressTimeout.current = null
                    }
                  }}
                  onTouchStart={() => {
                    if (activeProductId) {
                      heartLongPressTimeout.current = setTimeout(() => {
                        heartLongPressTriggered.current = true
                        productSaveActions.onLongPressSave(activeProductId)
                      }, 500)
                    }
                  }}
                  onTouchEnd={() => {
                    if (heartLongPressTimeout.current) {
                      clearTimeout(heartLongPressTimeout.current)
                      heartLongPressTimeout.current = null
                    }
                  }}
                  onTouchCancel={() => {
                    if (heartLongPressTimeout.current) {
                      clearTimeout(heartLongPressTimeout.current)
                      heartLongPressTimeout.current = null
                    }
                  }}
                  style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                >
                  <Heart className="h-4 w-4" aria-hidden="true" fill={isProductSaved ? "currentColor" : "none"} />
                </button>
              </div>
            </div>

            <div className="flex w-full justify-center">
              <div className="flex items-start rounded-md bg-muted/10 px-1 py-1">
                <p className="text-xs2 text-muted-foreground">{description}</p>
              </div>
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
