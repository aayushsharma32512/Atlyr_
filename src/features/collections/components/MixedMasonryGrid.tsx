import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefCallback } from "react"
import { MoreVertical, Trash2, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useResponsiveColumns } from "@/shared/hooks/useResponsiveColumns"
import { OutfitCard, ProductTile } from "@/design-system/primitives"
import type { MoodboardItem } from "@/services/collections/collectionsService"

const PRICE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

type OutfitMoodboardItem = Extract<MoodboardItem, { itemType: "outfit" }>

type MixedMasonryGridProps = {
  items: MoodboardItem[]
  /** Rendered ahead of every item, in the first column — e.g. an "add item" CTA. */
  leadingTile?: ReactNode
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
  leadingTile,
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
  // Responsive columns so cards shrink on wide screens — keeps product tiles and
  // outfit avatars at a matching size instead of two giant mismatched columns.
  const columnCount = useResponsiveColumns(4)
  const buckets = useMemo(() => {
    const cols: MoodboardItem[][] = Array.from({ length: columnCount }, () => [])
    items.forEach((item, index) => {
      cols[index % columnCount].push(item)
    })
    return cols
  }, [items, columnCount])

  const renderItem = (item: MoodboardItem) => {
    if (item.itemType === "outfit") {
      const isOwner = Boolean(currentUserId && item.outfit?.user_id === currentUserId)
      const moodboardSlugs = getOutfitMoodboardSlugs ? getOutfitMoodboardSlugs(item.id) : []
      return (
        <div
          key={`${item.itemType}-${item.id}-${item.createdAt}`}
          className="transition-transform"
        >
          <OutfitMasonryCard
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
        </div>
      )
    }

    const saved = isProductSaved ? isProductSaved(item.id) : false
    // The wrapper only carries the impressions ref and the tilt now. ProductTile
    // is its own card and its own tap target, so the bordered role="button" box
    // around it was a frame inside a frame with a button inside a button.
    return (
      <div
        key={`${item.itemType}-${item.id}-${item.createdAt}`}
        ref={getProductWrapperRef?.(item.id)}
        className="transition-transform"
      >
        {/* Name only — the design carries no brand or price on a tile (brief §3.2).
            cropToContent frames a segmented cutout instead of the empty canvas
            around it, same as ProductsTab and the board covers. */}
        <ProductTile
          title={item.productName ?? "Piece"}
          imageSrc={item.imageUrl ?? null}
          saved={saved}
          cropToContent
          onSelect={onProductSelect ? () => onProductSelect(item.id) : undefined}
          onToggleSave={() => onToggleProductSave?.(item.id, !saved)}
          onLongPressSave={() => onLongPressProductSave?.(item.id)}
        />
      </div>
    )
  }

  return (
    <div
      className={cn("grid w-full gap-2.5", className)}
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {buckets.map((column, index) => (
        <div key={`masonry-col-${index}`} className="flex min-w-0 flex-col gap-2.5">
          {index === 0 ? leadingTile : null}
          {column.map(renderItem)}
        </div>
      ))}
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
  const gender = item.gender ?? "female"

  const hasMultipleMoodboards = moodboardSlugs.length >= 2

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
    <div ref={getOutfitWrapperRef?.(item.id)} className="relative">
      {/* The same look tile Search draws: figure to the hairline, name under it. */}
      <div className="h-[300px]">
        <OutfitCard
          title={title}
          outfitId={item.id}
          renderedItems={item.renderedItems}
          gender={gender}
          onSelect={onOutfitSelect ? handleSelect : undefined}
        />
      </div>

      {/* Three-dot edit — top-right */}
      {showEdit && (
        <button
          type="button"
          onClick={handleEditClick}
          className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-md bg-transparent text-muted-foreground/80 transition-colors hover:bg-muted/60"
          aria-label={isOwner ? "Edit outfit" : "Move to moodboard"}
        >
          <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}

      {/* Dustbin — bottom-left of the frame, dropdown opens upward-right */}
      {showDustbin && (
        <div ref={removeOptionsRef} className="absolute bottom-9 left-2 z-10">
          <button
            type="button"
            onClick={handleDustbinClick}
            className="flex size-6 items-center justify-center rounded-md bg-transparent text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-destructive"
            aria-label="Remove outfit"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>

          {showRemoveOptions && (
            <div className="absolute left-0 bottom-full mb-1 min-w-[160px] rounded-md border border-hairline bg-background shadow-md py-1 z-20">
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
