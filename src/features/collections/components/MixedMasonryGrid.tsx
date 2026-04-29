import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react"
import { MoreVertical, Trash2, X } from "lucide-react"

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
  currentUserId?: string | null
  collectionSlug?: string
  collectionLabel?: string
  onOutfitSelect?: (item: MoodboardItem) => void
  onEditOutfit?: (item: OutfitMoodboardItem) => void
  onMoveToMoodboard?: (outfitId: string) => void
  getOutfitMoodboardSlugs?: (outfitId: string) => string[]
  onRemoveFromCurrentMoodboard?: (outfitId: string) => void
  onRemoveFromAll?: (outfitId: string) => void
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
  currentUserId,
  collectionSlug,
  collectionLabel,
  onOutfitSelect,
  onEditOutfit,
  onMoveToMoodboard,
  getOutfitMoodboardSlugs,
  onRemoveFromCurrentMoodboard,
  onRemoveFromAll,
  onProductSelect,
  isProductSaved,
  onToggleProductSave,
  onLongPressProductSave,
  getOutfitWrapperRef,
  getProductWrapperRef,
  className,
}: MixedMasonryGridProps) {
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
      const isOwner = Boolean(currentUserId && item.outfit?.user_id === currentUserId)
      const moodboardSlugs = getOutfitMoodboardSlugs ? getOutfitMoodboardSlugs(item.id) : []
      return (
        <OutfitMasonryCard
          key={`${item.itemType}-${item.id}-${item.createdAt}`}
          item={item}
          isOwner={isOwner}
          moodboardSlugs={moodboardSlugs}
          collectionLabel={collectionLabel}
          onOutfitSelect={onOutfitSelect}
          onEdit={onEditOutfit ? () => onEditOutfit(item) : undefined}
          onMoveToMoodboard={onMoveToMoodboard ? () => onMoveToMoodboard(item.id) : undefined}
          onRemoveFromCurrentMoodboard={onRemoveFromCurrentMoodboard ? () => onRemoveFromCurrentMoodboard(item.id) : undefined}
          onRemoveFromAll={onRemoveFromAll ? () => onRemoveFromAll(item.id) : undefined}
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
  isOwner: boolean
  moodboardSlugs: string[]
  collectionLabel?: string
  onOutfitSelect?: (item: MoodboardItem) => void
  onEdit?: () => void
  onMoveToMoodboard?: () => void
  onRemoveFromCurrentMoodboard?: () => void
  onRemoveFromAll?: () => void
  getOutfitWrapperRef?: (outfitId: string) => RefCallback<HTMLDivElement> | undefined
}

function OutfitMasonryCard({
  item,
  isOwner,
  moodboardSlugs,
  collectionLabel,
  onOutfitSelect,
  onEdit,
  onMoveToMoodboard,
  onRemoveFromCurrentMoodboard,
  onRemoveFromAll,
  getOutfitWrapperRef,
}: OutfitMasonryCardProps) {
  const [metaHeight, setMetaHeight] = useState(0)
  const [showRemoveOptions, setShowRemoveOptions] = useState(false)
  const removeOptionsRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!showRemoveOptions) return
    const handler = (e: MouseEvent) => {
      if (removeOptionsRef.current && !removeOptionsRef.current.contains(e.target as Node)) {
        setShowRemoveOptions(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showRemoveOptions])

  const title = item.outfit?.name ?? "Moodboard look"
  const chips = getOutfitChips(item.outfit)
  const gender = item.gender ?? "female"
  const avatarHeight = Math.max(
    MASONRY_OUTFIT_CARD_MIN_AVATAR_HEIGHT,
    MASONRY_OUTFIT_CARD_TOTAL_HEIGHT - metaHeight - MASONRY_OUTFIT_CARD_VERTICAL_GAP,
  )

  const hasMultipleMoodboards = moodboardSlugs.length >= 2
  const editButtonBottom = metaHeight + MASONRY_OUTFIT_CARD_VERTICAL_GAP

  const handleSelect = useCallback(() => {
    onOutfitSelect?.(item)
  }, [item, onOutfitSelect])

  const handleDustbinClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowRemoveOptions((v) => !v)
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOwner) {
      onEdit?.()
    } else {
      onMoveToMoodboard?.()
    }
  }

  const showDustbin = Boolean(onRemoveFromAll || onRemoveFromCurrentMoodboard)
  const showEdit = Boolean(onEdit || onMoveToMoodboard)

  return (
    <div className="relative">
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
        showSaveButton={false}
        avatarGender={gender}
        sizeMode="fluid"
        fluidLayout="avatar"
        fluidHeight={avatarHeight}
        onMetaHeightChange={setMetaHeight}
        cardClassName="w-full"
      />

      {/* Three-dot edit — top-right */}
      {showEdit && (
        <button
          type="button"
          onClick={handleEditClick}
          className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-xl bg-transparent text-muted-foreground/80 transition-colors hover:bg-muted/60"
          aria-label={isOwner ? "Edit outfit" : "Move to moodboard"}
        >
          <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}

      {/* Dustbin — bottom-left, dropdown opens upward-right */}
      {showDustbin && (
        <div ref={removeOptionsRef} className="absolute z-10" style={{ bottom: editButtonBottom, left: 8 }}>
          <button
            type="button"
            onClick={handleDustbinClick}
            className="flex size-6 items-center justify-center rounded-xl bg-transparent text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-destructive"
            aria-label="Remove outfit"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>

          {showRemoveOptions && (
            <div className="absolute left-0 bottom-full mb-1 min-w-[160px] rounded-xl border border-border bg-background shadow-lg py-1 z-20">
              {onRemoveFromCurrentMoodboard && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowRemoveOptions(false)
                    onRemoveFromCurrentMoodboard()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/50"
                >
                  <X className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{collectionLabel ?? "This board"}</span>
                </button>
              )}
              {onRemoveFromAll && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowRemoveOptions(false)
                    onRemoveFromAll()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-muted/50"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  Everywhere
                </button>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
