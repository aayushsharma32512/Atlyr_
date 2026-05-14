import { Heart, SquareUserRound, ChevronDown, Plus, Undo2 } from "lucide-react"
import { useState, useRef, useCallback } from "react"
import * as React from "react"

import { ProductSummaryCard, TrayActionButton, SaveOutfitDrawer, IconButton } from "@/design-system/primitives"
import type { Moodboard } from "@/services/collections/collectionsService"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"
import { cn } from "@/lib/utils"

const SLOT_LABELS: Record<StudioProductTraySlot, string> = {
  top: "Topwear",
  bottom: "Bottomwear",
  shoes: "Footwear",
}

type SaveActionMode = "drawer" | "toggle"

interface ProductTrayProps {
  items: StudioProductTrayItem[]
  isLoading?: boolean
  defaultOutfitName?: string
  defaultCategoryId?: string
  defaultOccasionId?: string
  isReadOnly?: boolean
  slotOrder?: StudioProductTraySlot[]
  hiddenSlots?: Partial<Record<StudioProductTraySlot, boolean>>
  onRemoveSlot?: (slot: StudioProductTraySlot) => void
  onRestoreSlot?: (slot: StudioProductTraySlot) => void
  onAddSlot?: (slot: StudioProductTraySlot) => void
  onReorderSlots?: (nextOrder: StudioProductTraySlot[]) => void
  onProductPress?: (product: StudioProductTrayItem) => void
  onDetailsPress?: () => void
  onTryOn?: () => void
  saveActionMode?: SaveActionMode
  saveIsActive?: boolean
  onToggleSave?: () => void
  onSaveOutfit?: (data: {
    outfitName: string
    categoryId: string
    occasionId: string
    vibe: string
    keywords: string
    isPrivate: boolean
    moodboardIds?: string[]
  }) => Promise<void> | void
  onReorder?: (reorderedItems: StudioProductTrayItem[]) => void
  moodboards?: Moodboard[]
  moodboardsLoading?: boolean
  onCreateMoodboard?: (name: string) => Promise<string | void> | string | void
  showFilter?: boolean
  showRemove?: boolean
  showItems?: boolean
  showActions?: boolean
  highlightProducts?: boolean // When true, highlight individual product items (for tour)
  highlightDetails?: boolean // When true, highlight the Details button only (for tour)
  highlightSave?: boolean // When true, highlight the Save button only (for tour)
  highlightTryOn?: boolean // When true, highlight the TryOn button only (for tour)
}

const noop = () => {}

export function ProductTray({
  items,
  isLoading,
  defaultOutfitName,
  defaultCategoryId,
  defaultOccasionId,
  isReadOnly = false,
  slotOrder,
  hiddenSlots,
  onRemoveSlot,
  onRestoreSlot,
  onAddSlot,
  onReorderSlots,
  onProductPress,
  onDetailsPress,
  onTryOn,
  saveActionMode = "drawer",
  saveIsActive = false,
  onToggleSave,
  onSaveOutfit,
  onReorder,
  moodboards = [],
  moodboardsLoading,
  onCreateMoodboard,
  showFilter = true,
  showRemove = true,
  showItems = true,
  showActions = true,
  highlightProducts = false,
  highlightDetails = false,
  highlightSave = false,
  highlightTryOn = false,
}: ProductTrayProps) {
  const hasItems = items.length > 0
  const [isSaveDrawerOpen, setIsSaveDrawerOpen] = useState(false)
  const [localItems, setLocalItems] = useState(items) // The local items that are being displayed in the tray
  const [localSlotOrder, setLocalSlotOrder] = useState<StudioProductTraySlot[] | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null) // The index of the card that is being dragged
  const [targetIndex, setTargetIndex] = useState<number | null>(null) // The index of the card that the dragged card is being dropped on
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]) // A ref to the cards in the tray


  React.useEffect(() => {
    setLocalItems(items)
  }, [items])

  const usesSlotOrder = Boolean(slotOrder && slotOrder.length > 0)

  React.useEffect(() => {
    if (!usesSlotOrder) {
      setLocalSlotOrder(null)
      return
    }
    setLocalSlotOrder(slotOrder ?? null)
  }, [slotOrder, usesSlotOrder])

  const slotItemMap = React.useMemo(() => {
    const map = new Map<StudioProductTraySlot, StudioProductTrayItem>()
    items.forEach((item) => {
      map.set(item.slot, item)
    })
    return map
  }, [items])

  const handleSaveClick = () => {
    if (isReadOnly) {
      return
    }
    if (saveActionMode === "toggle") {
      onToggleSave?.()
      return
    }
    setIsSaveDrawerOpen(true)
  }

  // When the user starts dragging a card
  const handleDragStart = useCallback((index: number) => {
    if (isReadOnly) {
      return
    }
    setDraggedIndex(index)
    setTargetIndex(index)
  }, [isReadOnly])

  const handleDragEnd = useCallback(() => {
    if (isReadOnly) {
      return
    }
    if (usesSlotOrder) {
      if (localSlotOrder && draggedIndex !== null && targetIndex !== null && draggedIndex !== targetIndex) {
        const nextOrder = [...localSlotOrder]
        const [draggedItem] = nextOrder.splice(draggedIndex, 1)
        nextOrder.splice(targetIndex, 0, draggedItem)
        setLocalSlotOrder(nextOrder)
        onReorderSlots?.(nextOrder)
      }
      setDraggedIndex(null)
      setTargetIndex(null)
      return
    }
    if (draggedIndex !== null && targetIndex !== null && draggedIndex !== targetIndex) {
      const newItems = [...localItems]
      const [draggedItem] = newItems.splice(draggedIndex, 1)
      newItems.splice(targetIndex, 0, draggedItem)
      setLocalItems(newItems)
      onReorder?.(newItems)
    }
    setDraggedIndex(null)
    setTargetIndex(null)
  }, [draggedIndex, isReadOnly, localItems, localSlotOrder, onReorder, onReorderSlots, targetIndex, usesSlotOrder])

  const handleDragMove = useCallback((clientY: number) => {
    if (isReadOnly) {
      return
    }
    if (draggedIndex === null) return
    const rowCount = usesSlotOrder && localSlotOrder ? localSlotOrder.length : localItems.length

    let newTargetIndex = draggedIndex

    // Check each card to find drop position
    for (let i = 0; i < cardRefs.current.length; i++) {
      const cardRef = cardRefs.current[i]
      if (!cardRef || i === draggedIndex) continue

      const rect = cardRef.getBoundingClientRect()

      // Check if cursor is over this card
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const centerY = rect.top + rect.height / 2
        newTargetIndex = clientY < centerY ? i : i + 1
        break
      }

      // Check if above first card
      if (i === 0 && clientY < rect.top) {
        newTargetIndex = 0
        break
      }

      // Check if below last card
      if (i === cardRefs.current.length - 1 && clientY > rect.bottom) {
        newTargetIndex = cardRefs.current.length
        break
      }
    }

    // Adjust for removed item when dragging down
    if (newTargetIndex > draggedIndex) {
      newTargetIndex--
    }

    // Clamp to valid range
    newTargetIndex = Math.max(0, Math.min(newTargetIndex, rowCount - 1))

    if (newTargetIndex !== targetIndex) {
      setTargetIndex(newTargetIndex)
    }
  }, [draggedIndex, isReadOnly, localItems.length, localSlotOrder, targetIndex, usesSlotOrder])

  const SaveIcon = saveActionMode === "toggle"
    ? ({ className }: { className?: string }) => (
      <Heart
        className={cn("size-4", saveIsActive ? "fill-current text-red-500" : "text-muted-foreground", className)}
        aria-hidden="true"
      />
    )
    : Heart

  return (
    <section className={cn(
      "mx-auto w-full max-w-sm rounded-t-3xl px-1 pb-0 pt-1",
      (highlightProducts) ? "bg-transparent" : "bg-card"
    )}>
      {showItems && <div className="flex flex-col gap-0.5 pb-2">
        {isLoading ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-muted-foreground/30 bg-muted/10 p-4 text-xs text-muted-foreground">
            Loading outfit items…
          </div>
        ) : usesSlotOrder ? (
          (localSlotOrder ?? slotOrder ?? []).map((slot, index) => {
            const product = slotItemMap.get(slot)
            const isHidden = Boolean(hiddenSlots?.[slot])
            const isDragged = draggedIndex === index

            let translateY = 0
            if (draggedIndex !== null && targetIndex !== null && !isDragged) {
              if (draggedIndex < targetIndex && index > draggedIndex && index <= targetIndex) {
                translateY = -64
              }
              if (draggedIndex > targetIndex && index >= targetIndex && index < draggedIndex) {
                translateY = 64
              }
            }

            if (!product || isHidden) {
              const label = SLOT_LABELS[slot] ?? "Item"
              return (
                <div
                  ref={(el) => { cardRefs.current[index] = el }}
                  className={cn("flex items-stretch gap-2", isDragged && "z-50")}
                  key={`${slot}-hidden`}
                >
                  <div
                    className="flex-1 transition-transform duration-200"
                    style={!isDragged && translateY !== 0 ? { transform: `translateY(${translateY}px)` } : undefined}
                  >
                    <div className="flex items-center gap-2 rounded-xl border border-sidebar-border bg-card px-2 py-2 text-xs text-muted-foreground">
                      <IconButton
                        tone="ghost"
                        size="sm"
                        aria-label={`Restore ${label}`}
                        onClick={!isReadOnly && isHidden && onRestoreSlot ? () => onRestoreSlot(slot) : undefined}
                        disabled={isReadOnly || !isHidden || !onRestoreSlot}
                        className="text-foreground"
                      >
                        <Undo2 className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                      <button
                        type="button"
                        onClick={!isReadOnly && onAddSlot ? () => onAddSlot(slot) : undefined}
                        disabled={isReadOnly || !onAddSlot}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border border-border/70 px-3 py-1 text-xs font-medium text-foreground",
                          "hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60",
                        )}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{`Add ${label}`}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div
                ref={(el) => { cardRefs.current[index] = el }}
                className={cn("flex items-stretch gap-2", isDragged && "z-50")}
                key={`${product.slot}-${product.productId}`}
              >
                <div
                  className={cn("transition-transform relative duration-200 w-full", highlightProducts && "isolate z-[75]")}
                  style={!isDragged && translateY !== 0 ? { transform: `translateY(${translateY}px)` } : undefined}
                >
                  <ProductSummaryCard
                    className={cn("w-full", highlightProducts && "ring-2 ring-primary rounded-xl")}
                    showRemove={showRemove}
                    showFilter={showFilter}
                    title={product.title}
                    rating={product.rating ?? "—"}
                    reviewCount={product.reviewCount ?? "—"}
                    price={product.price}
                    discountPercent={null}
                    onFilter={noop}
                    onRemove={!isReadOnly && onRemoveSlot ? () => onRemoveSlot(slot) : undefined}
                    onClick={onProductPress ? () => onProductPress(product) : undefined}
                    onDragStart={!isReadOnly ? () => handleDragStart(index) : undefined}
                    onDragEnd={!isReadOnly ? handleDragEnd : undefined}
                    onDragMove={!isReadOnly ? handleDragMove : undefined}
                  />
                </div>
              </div>
            )
          })
        ) : hasItems ? (
          localItems.map((product, index) => {
            const isDragged = draggedIndex === index

            let translateY = 0
            if (draggedIndex !== null && targetIndex !== null && !isDragged) {
              if (draggedIndex < targetIndex && index > draggedIndex && index <= targetIndex) {
                translateY = -64
              }
              if (draggedIndex > targetIndex && index >= targetIndex && index < draggedIndex) {
                translateY = 64
              }
            }

            return (
              <div
                ref={(el) => { cardRefs.current[index] = el }}
                className={cn("flex items-stretch gap-1", isDragged && "z-50")}
                key={`${product.slot}-${product.productId}`}
              >
                <div
                  className={cn("transition-transform relative duration-200 w-full", highlightProducts && "isolate z-[75]")}
                  style={!isDragged && translateY !== 0 ? { transform: `translateY(${translateY}px)` } : undefined}
                >
                  <ProductSummaryCard
                    className={cn("w-full", highlightProducts && "ring-2 ring-primary rounded-xl")}
                    showRemove={showRemove}
                    title={product.title}
                    rating={product.rating ?? "—"}
                    reviewCount={product.reviewCount ?? "—"}
                    price={product.price}
                    discountPercent={null}
                    showFilter={showFilter}
                    onFilter={noop}
                    onRemove={noop}
                    onClick={onProductPress ? () => onProductPress(product) : undefined}
                    onDragStart={!isReadOnly ? () => handleDragStart(index) : undefined}
                    onDragEnd={!isReadOnly ? handleDragEnd : undefined}
                    onDragMove={!isReadOnly ? handleDragMove : undefined}
                  />
                </div>
              </div>
            )
          })
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-muted-foreground/30 bg-muted/10 p-4 text-xs text-muted-foreground">
            No outfit items available.
          </div>
        )}
      </div>}

      {/* Horizontal action row at the bottom */}
      {showActions && (
        <div className="flex items-center gap-0 px-1 pt-1 pb-0">
          <div className={cn("relative flex flex-1", highlightSave && "isolate z-[75]")}>
            {highlightSave && (
              <div className="absolute -inset-1 !z-[75] pointer-events-none rounded-xl ring-2 ring-primary shadow-lg" />
            )}
            <TrayActionButton
              tone="outline"
              iconStart={SaveIcon}
              label={saveActionMode === "toggle" && saveIsActive ? "Saved" : "Save"}
              aria-label="Save"
              aria-pressed={saveActionMode === "toggle" ? saveIsActive : undefined}
              disabled={isReadOnly}
              className={cn("w-full h-9 rounded-xl text-xs", highlightSave && "relative z-[75]")}
              onClick={isReadOnly ? undefined : handleSaveClick}
            />
          </div>
          <div className="h-6 w-px bg-border/60 shrink-0" aria-hidden="true" />
          <div className={cn("relative flex flex-1", highlightTryOn && "isolate z-[75]")}>
            {highlightTryOn && (
              <div className="absolute -inset-1 !z-[75] pointer-events-none rounded-xl ring-2 ring-primary shadow-lg" />
            )}
            <TrayActionButton
              tone="outline"
              iconStart={SquareUserRound}
              label="Tryon"
              aria-label="Try on"
              disabled={isReadOnly}
              className={cn("w-full h-9 rounded-xl text-xs", highlightTryOn && "relative z-[75]")}
              onClick={isReadOnly ? undefined : onTryOn}
            />
          </div>
          <div className="h-6 w-px bg-border/60 shrink-0" aria-hidden="true" />
          <div className={cn("relative flex flex-1", (highlightDetails || highlightProducts) && "isolate z-[75]")}>
            {highlightDetails && (
              <div className="absolute -inset-1 z-40 rounded-xl ring-2 ring-primary" />
            )}
            <TrayActionButton
              tone="plain"
              iconEnd={ChevronDown}
              label="Details"
              aria-label="Details"
              disabled={isReadOnly}
              className={cn("w-full h-9 rounded-xl text-xs", (highlightDetails || highlightProducts) && "relative z-[75]")}
              onClick={isReadOnly ? undefined : onDetailsPress}
            />
          </div>
        </div>
      )}

      {saveActionMode === "drawer" ? (
        <SaveOutfitDrawer
          open={isSaveDrawerOpen}
          onOpenChange={setIsSaveDrawerOpen}
          defaultOutfitName={defaultOutfitName}
          defaultCategoryId={defaultCategoryId}
          defaultOccasionId={defaultOccasionId}
          isLoadingMoodboards={moodboardsLoading}
          moodboards={moodboards}
          onCreateMoodboard={onCreateMoodboard}
          onSave={onSaveOutfit}
        />
      ) : null}
    </section>
  )
}