import { useCallback, useEffect, useMemo, useState, type RefCallback } from "react"

import { cn } from "@/lib/utils"
import { OutfitInspirationTile, ProductAlternateCard } from "@/design-system/primitives"
import type { MoodboardItem } from "@/services/collections/collectionsService"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"
import { getOutfitChips } from "@/utils/outfitChips"

const PRICE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const MASONRY_OUTFIT_CARD_TOTAL_HEIGHT = 320
const MASONRY_OUTFIT_CARD_VERTICAL_GAP = 2
const MASONRY_OUTFIT_CARD_MIN_AVATAR_HEIGHT = 128

type OutfitMoodboardItem = Extract<MoodboardItem, { itemType: "outfit" }>

type MixedMasonryGridProps = {
  items: MoodboardItem[]
  favoriteOutfitIds?: string[]
  onOutfitSelect?: (item: MoodboardItem) => void
  onToggleOutfitSave?: (outfitId: string, nextSaved: boolean) => void
  onLongPressOutfitSave?: (outfitId: string) => void
  onProductSelect?: (productId: string) => void
  isProductSaved?: (productId: string) => boolean
  onToggleProductSave?: (productId: string, nextSaved: boolean) => void
  onLongPressProductSave?: (productId: string) => void
  getOutfitWrapperRef?: (outfitId: string) => RefCallback<HTMLDivElement> | undefined
  getProductWrapperRef?: (productId: string) => RefCallback<HTMLDivElement> | undefined
  className?: string
}

export function MixedMasonryGrid({
  items,
  favoriteOutfitIds = [],
  onOutfitSelect,
  onToggleOutfitSave,
  onLongPressOutfitSave,
  onProductSelect,
  isProductSaved,
  onToggleProductSave,
  onLongPressProductSave,
  getOutfitWrapperRef,
  getProductWrapperRef,
  className,
}: MixedMasonryGridProps) {
  const favoriteSet = useMemo(() => new Set(favoriteOutfitIds), [favoriteOutfitIds])

  const [leftColumn, rightColumn] = useMemo(() => {
    const left: MoodboardItem[] = []
    const right: MoodboardItem[] = []
    items.forEach((item, index) => {
      if (index % 2 === 0) {
        left.push(item)
      } else {
        right.push(item)
      }
    })
    return [left, right] as const
  }, [items])

  const formatPrice = (price: number | null | undefined, currency: string | null | undefined) => {
    if (typeof price !== "number") return "—"
    if (!currency || currency === "INR") {
      return PRICE_FORMATTER.format(price)
    }
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(price)
  }

  const renderItem = (item: MoodboardItem) => {
    if (item.itemType === "outfit") {
      return (
        <OutfitMasonryCard
          key={`${item.itemType}-${item.id}-${item.createdAt}`}
          item={item}
          isSaved={favoriteSet.has(item.id)}
          onOutfitSelect={onOutfitSelect}
          onToggleOutfitSave={onToggleOutfitSave}
          onLongPressOutfitSave={onLongPressOutfitSave}
          getOutfitWrapperRef={getOutfitWrapperRef}
        />
      )
    }

    const saved = isProductSaved ? isProductSaved(item.id) : false
    const priceLabel = formatPrice(item.price ?? null, item.currency ?? null)
    const isInteractive = Boolean(onProductSelect)
    return (
      <div
        key={`${item.itemType}-${item.id}-${item.createdAt}`}
        ref={getProductWrapperRef?.(item.id)}
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onClick={isInteractive ? () => onProductSelect?.(item.id) : undefined}
        onKeyDown={
          isInteractive
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onProductSelect?.(item.id)
                }
              }
            : undefined
        }
        className={cn("rounded-2xl border border-muted/20 bg-transparent p-1", isInteractive && "cursor-pointer")}
      >
        <ProductAlternateCard
          imageSrc={item.imageUrl ?? ""}
          title={item.productName ?? "Product"}
          brand={item.brand ?? "Brand"}
          price={priceLabel}
          isSaved={saved}
          onToggleSave={() => onToggleProductSave?.(item.id, !saved)}
          onLongPressSave={() => onLongPressProductSave?.(item.id)}
          layout="masonry"
        />
      </div>
    )
  }

  return (
    <div className={cn("grid w-full grid-cols-2 gap-2", className)}>
      <div className="flex min-w-0 flex-col gap-2">{leftColumn.map(renderItem)}</div>
      <div className="flex min-w-0 flex-col gap-2">{rightColumn.map(renderItem)}</div>
    </div>
  )
}

type OutfitMasonryCardProps = {
  item: OutfitMoodboardItem
  isSaved: boolean
  onOutfitSelect?: (item: MoodboardItem) => void
  onToggleOutfitSave?: (outfitId: string, nextSaved: boolean) => void
  onLongPressOutfitSave?: (outfitId: string) => void
  getOutfitWrapperRef?: (outfitId: string) => RefCallback<HTMLDivElement> | undefined
}

function OutfitMasonryCard({
  item,
  isSaved,
  onOutfitSelect,
  onToggleOutfitSave,
  onLongPressOutfitSave,
  getOutfitWrapperRef,
}: OutfitMasonryCardProps) {
  const [metaHeight, setMetaHeight] = useState(0)
  const [localSaved, setLocalSaved] = useState(isSaved)

  useEffect(() => {
    setLocalSaved(isSaved)
  }, [isSaved])

  const title = item.outfit?.name ?? "Moodboard look"
  const chips = getOutfitChips(item.outfit)
  const gender = item.gender ?? "female"
  const avatarHeight = Math.max(
    MASONRY_OUTFIT_CARD_MIN_AVATAR_HEIGHT,
    MASONRY_OUTFIT_CARD_TOTAL_HEIGHT - metaHeight - MASONRY_OUTFIT_CARD_VERTICAL_GAP,
  )

  const handleToggleSave = useCallback(() => {
    setLocalSaved((prev) => {
      const next = !prev
      onToggleOutfitSave?.(item.id, next)
      return next
    })
  }, [item.id, onToggleOutfitSave])

  const handleSelect = useCallback(() => {
    onOutfitSelect?.(item)
  }, [item, onOutfitSelect])

  return (
    <OutfitInspirationTile
      preset="homeCurated"
      wrapperClassName="flex flex-col gap-1"
      wrapperStyle={{ minHeight: MASONRY_OUTFIT_CARD_TOTAL_HEIGHT }}
      wrapperRef={getOutfitWrapperRef?.(item.id)}
      wrapperProps={{
        role: onOutfitSelect ? "button" : undefined,
        tabIndex: onOutfitSelect ? 0 : undefined,
        onClick: onOutfitSelect ? handleSelect : undefined,
        onKeyDown: onOutfitSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                handleSelect()
              }
            }
          : undefined,
      }}
      outfitId={item.id}
      renderedItems={item.renderedItems}
      title={title}
      chips={chips}
      attribution={resolveOutfitAttribution(item.outfit?.created_by)}
      isSaved={localSaved}
      onToggleSave={handleToggleSave}
      onLongPressSave={onLongPressOutfitSave ? () => onLongPressOutfitSave(item.id) : undefined}
      avatarGender={gender}
      sizeMode="fluid"
      fluidLayout="avatar"
      fluidHeight={avatarHeight}
      onMetaHeightChange={setMetaHeight}
      cardClassName="w-full"
    />
  )
}
