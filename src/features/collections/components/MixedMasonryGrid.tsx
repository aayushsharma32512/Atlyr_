import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react"
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
  onRemoveProductFromCurrentMoodboard?: (productId: string) => void
  onRemoveProductFromAll?: (productId: string) => void
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
  onRemoveProductFromCurrentMoodboard,
  onRemoveProductFromAll,
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

    return (
      <div
        key={`${item.itemType}-${item.id}-${item.createdAt}`}
        className="transition-transform"
      >
        <ProductMasonryCard
          item={item}
          collectionLabel={collectionLabel}
          onProductSelect={onProductSelect}
          onRemoveFromCurrentMoodboard={
            onRemoveProductFromCurrentMoodboard ? () => onRemoveProductFromCurrentMoodboard(item.id) : undefined
          }
          onRemoveFromAll={onRemoveProductFromAll ? () => onRemoveProductFromAll(item.id) : undefined}
          getProductWrapperRef={getProductWrapperRef}
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
  const title = item.outfit?.name ?? "Moodboard look"
  const gender = item.gender ?? "female"

  const hasMultipleMoodboards = moodboardSlugs.length >= 2

  const handleSelect = useCallback(() => {
    onOutfitSelect?.(item)
  }, [item, onOutfitSelect])

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isOwner) {
      onEdit?.()
    } else {
      onMoveToMoodboard?.()
    }
  }

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

      {/* Bottom-left, opening upward: OutfitCard's 300px frame carries its own
          bottom overlay, so the trigger sits 36px up to clear it. */}
      <RemoveOptionsMenu
        label="Remove outfit"
        collectionLabel={collectionLabel}
        onRemoveFromCurrentMoodboard={onRemoveFromCurrentMoodboard}
        onRemoveFromAll={onRemoveFromAll}
        triggerClassName="absolute bottom-9 left-2 z-10"
        panelClassName="absolute left-0 bottom-full mb-1"
      />
    </div>
  )
}

type ProductMasonryCardProps = {
  item: Extract<MoodboardItem, { itemType: "product" }>
  collectionLabel?: string
  onProductSelect?: (productId: string) => void
  onRemoveFromCurrentMoodboard?: () => void
  onRemoveFromAll?: () => void
  getProductWrapperRef?: (productId: string) => RefCallback<HTMLDivElement> | undefined
}

/** Same card, same bottom-left dustbin as an outfit tile — no pin either: the
 *  dustbin and the product page (behind onSelect) already cover saving. */
function ProductMasonryCard({
  item,
  collectionLabel,
  onProductSelect,
  onRemoveFromCurrentMoodboard,
  onRemoveFromAll,
  getProductWrapperRef,
}: ProductMasonryCardProps) {
  return (
    <div ref={getProductWrapperRef?.(item.id)}>
      {/* Name only — the design carries no brand or price on a tile (brief §3.2).
          cropToContent frames a segmented cutout instead of the empty canvas
          around it, same as ProductsTab and the board covers. The dustbin is
          passed in as an overlay rather than positioned from out here, so it
          anchors to the image box itself and not the tile's full height —
          the footer (name) below the image would otherwise push it half
          outside the border on narrower columns. */}
      <ProductTile
        title={item.productName ?? "Piece"}
        imageSrc={item.imageUrl ?? null}
        mark={false}
        cropToContent
        onSelect={onProductSelect ? () => onProductSelect(item.id) : undefined}
        bottomLeftOverlay={
          <RemoveOptionsMenu
            label="Remove piece"
            collectionLabel={collectionLabel}
            onRemoveFromCurrentMoodboard={onRemoveFromCurrentMoodboard}
            onRemoveFromAll={onRemoveFromAll}
            triggerClassName="absolute bottom-2 left-2 z-10"
            panelClassName="absolute left-0 bottom-full mb-1"
          />
        }
      />
    </div>
  )
}

/**
 * Dustbin trigger + dropdown. Shared by outfit and product tiles so "remove
 * from this board" vs. "everywhere" reads and behaves identically wherever it
 * appears — only the anchor differs, since the two tiles don't share a shape.
 */
function RemoveOptionsMenu({
  label,
  collectionLabel,
  onRemoveFromCurrentMoodboard,
  onRemoveFromAll,
  triggerClassName,
  panelClassName,
}: {
  label: string
  collectionLabel?: string
  onRemoveFromCurrentMoodboard?: () => void
  onRemoveFromAll?: () => void
  triggerClassName: string
  panelClassName: string
}) {
  const [showRemoveOptions, setShowRemoveOptions] = useState(false)
  const removeOptionsRef = useRef<HTMLDivElement>(null)

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

  if (!onRemoveFromAll && !onRemoveFromCurrentMoodboard) return null

  return (
    <div ref={removeOptionsRef} className={triggerClassName}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setShowRemoveOptions((v) => !v)
        }}
        className="flex size-6 items-center justify-center rounded-md bg-transparent text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-destructive"
        aria-label={label}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {showRemoveOptions && (
        <div className={cn("min-w-[160px] rounded-lg border border-hairline bg-background py-1 shadow-md z-20", panelClassName)}>
          {onRemoveFromCurrentMoodboard && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowRemoveOptions(false)
                onRemoveFromCurrentMoodboard()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-chip text-ink hover:bg-editorial/40"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-chip text-violet hover:bg-editorial/40"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              Everywhere
            </button>
          )}
        </div>
      )}
    </div>
  )
}
