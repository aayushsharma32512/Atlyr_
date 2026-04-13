import { useCallback, useEffect, useMemo, useState, type RefCallback } from "react"

import type { InspirationItem } from "@/features/studio/types"
import { cn } from "@/lib/utils"
import { buildGridColumns, type GridEntry } from "./balanced-grid-utils"
import {
  OutfitInspirationTile,
  type OutfitInspirationCardOverrides,
} from "./outfit-inspiration-tile"
import type { OutfitInspirationPresetKey } from "./outfit-inspiration-presets"

type OutfitGridLayoutMode = "balanced" | "fixedAvatar"

interface OutfitInspirationGridProps {
  items: InspirationItem[]
  className?: string
  columns?: number
  rows?: number
  layoutMode?: OutfitGridLayoutMode
  cardTotalHeight?: number
  cardVerticalGap?: number
  cardMinAvatarHeight?: number
  fixedAvatarHeight?: number
  cardPreset?: OutfitInspirationPresetKey
  cardOverrides?: OutfitInspirationCardOverrides
  onCardSelect?: (item: InspirationItem) => void
  onToggleSave?: (item: InspirationItem, isSaved: boolean) => void
  onLongPressSave?: (item: InspirationItem) => void
  getItemWrapperRef?: (item: InspirationItem) => RefCallback<HTMLDivElement> | undefined
}

type ColumnEntry = GridEntry<InspirationItem>

interface ColumnBucketsProps {
  columns: ColumnEntry[][]
  cardTotalHeight: number
  cardVerticalGap: number
  cardMinAvatarHeight: number
  fixedAvatarHeight: number
  layoutMode: OutfitGridLayoutMode
  cardPreset: OutfitInspirationPresetKey
  cardOverrides?: OutfitInspirationCardOverrides
  onCardSelect?: (item: InspirationItem) => void
  onToggleSave?: (item: InspirationItem, isSaved: boolean) => void
  onLongPressSave?: (item: InspirationItem) => void
  getItemWrapperRef?: (item: InspirationItem) => RefCallback<HTMLDivElement> | undefined
}

const DEFAULT_COLUMNS = 2
const DEFAULT_ROWS = 8
const DEFAULT_CARD_TOTAL_HEIGHT = 190
const DEFAULT_CARD_VERTICAL_GAP = 2
const DEFAULT_CARD_MIN_AVATAR_HEIGHT = 128
const DEFAULT_FIXED_AVATAR_HEIGHT = 156

export function OutfitInspirationGrid({
  items,
  className,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  layoutMode = "balanced",
  cardTotalHeight = DEFAULT_CARD_TOTAL_HEIGHT,
  cardVerticalGap = DEFAULT_CARD_VERTICAL_GAP,
  cardMinAvatarHeight = DEFAULT_CARD_MIN_AVATAR_HEIGHT,
  fixedAvatarHeight = DEFAULT_FIXED_AVATAR_HEIGHT,
  cardPreset = "gridMeta",
  cardOverrides,
  onCardSelect,
  onToggleSave,
  onLongPressSave,
  getItemWrapperRef,
}: OutfitInspirationGridProps) {
  const columnBuckets = useMemo(() => {
    const safeColumns = Math.max(columns, 1)
    const effectiveRows = Math.max(rows, Math.ceil(items.length / safeColumns))

    return buildGridColumns(items, safeColumns, effectiveRows, (item, index) => `${item.id}-${index}`)
  }, [columns, items, rows])

  return (
    <div className={cn("flex flex-1 gap-1 min-w-0", className)}>
      <GridColumns
        columns={columnBuckets}
        cardTotalHeight={cardTotalHeight}
        cardVerticalGap={cardVerticalGap}
        cardMinAvatarHeight={cardMinAvatarHeight}
        fixedAvatarHeight={fixedAvatarHeight}
        layoutMode={layoutMode}
        cardPreset={cardPreset}
        cardOverrides={cardOverrides}
        onCardSelect={onCardSelect}
        onToggleSave={onToggleSave}
        onLongPressSave={onLongPressSave}
        getItemWrapperRef={getItemWrapperRef}
      />
    </div>
  )
}

function GridColumns({
  columns,
  cardTotalHeight,
  cardVerticalGap,
  cardMinAvatarHeight,
  fixedAvatarHeight,
  layoutMode,
  cardPreset,
  cardOverrides,
  onCardSelect,
  onToggleSave,
  onLongPressSave,
  getItemWrapperRef,
}: ColumnBucketsProps) {
  return (
    <>
      {columns.map((column, columnIndex) => (
        <div className="flex w-full flex-1 flex-col gap-1 min-w-0" key={`grid-column-${columnIndex}`}>
          {column.map((entry) =>
            layoutMode === "balanced" ? (
              <BalancedGridCard
                key={entry.key}
                data={entry.item}
                cardTotalHeight={cardTotalHeight}
                cardVerticalGap={cardVerticalGap}
                cardMinAvatarHeight={cardMinAvatarHeight}
                cardPreset={cardPreset}
                cardOverrides={cardOverrides}
                onCardSelect={onCardSelect}
                onToggleSave={onToggleSave}
                onLongPressSave={onLongPressSave}
                wrapperRef={getItemWrapperRef?.(entry.item)}
              />
            ) : (
              <FixedAvatarGridCard
                key={entry.key}
                data={entry.item}
                fixedAvatarHeight={fixedAvatarHeight}
                cardPreset={cardPreset}
                cardOverrides={cardOverrides}
                onCardSelect={onCardSelect}
                onToggleSave={onToggleSave}
                onLongPressSave={onLongPressSave}
                wrapperRef={getItemWrapperRef?.(entry.item)}
              />
            ),
          )}
        </div>
      ))}
    </>
  )
}

interface GridCardProps {
  data: InspirationItem
  cardPreset: OutfitInspirationPresetKey
  cardOverrides?: OutfitInspirationCardOverrides
  onCardSelect?: (item: InspirationItem) => void
  onToggleSave?: (item: InspirationItem, isSaved: boolean) => void
  onLongPressSave?: (item: InspirationItem) => void
  wrapperRef?: RefCallback<HTMLDivElement>
}

interface BalancedCardProps extends GridCardProps {
  cardTotalHeight: number
  cardVerticalGap: number
  cardMinAvatarHeight: number
}

function BalancedGridCard({
  data,
  cardTotalHeight,
  cardVerticalGap,
  cardMinAvatarHeight,
  cardPreset,
  cardOverrides,
  onCardSelect,
  onToggleSave,
  onLongPressSave,
  wrapperRef,
}: BalancedCardProps) {
  const [metaHeight, setMetaHeight] = useState(0)
  const [isSaved, setIsSaved] = useState<boolean>(data.isSaved ?? false)
  useEffect(() => {
    setIsSaved(data.isSaved ?? false)
  }, [data.isSaved])

  const avatarHeight = Math.max(
    cardMinAvatarHeight,
    cardTotalHeight - metaHeight - cardVerticalGap,
  )


  const handleToggleSave = useCallback(() => {
    setIsSaved((prev) => {
      const next = !prev
      onToggleSave?.(data, next)
      return next
    })
  }, [data, onToggleSave])

  const handleSelect = useCallback(() => {
    onCardSelect?.(data)
  }, [data, onCardSelect])

  return (
    <OutfitInspirationTile
      preset={cardPreset}
      wrapperClassName="relative flex w-full flex-col"
      wrapperStyle={{ minHeight: cardTotalHeight }}
      wrapperRef={wrapperRef}
      wrapperProps={{
        role: onCardSelect ? "button" : undefined,
        tabIndex: onCardSelect ? 0 : undefined,
        onClick: onCardSelect ? handleSelect : undefined,
        onKeyDown: onCardSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                handleSelect()
              }
            }
          : undefined,
      }}
      cardOverrides={cardOverrides}
      outfitId={data.outfitId ?? data.outfit?.id ?? null}
      renderedItems={data.renderedItems}
      fallbackImageSrc={data.imageSrcFallback}
      title={data.title}
      chips={data.chips}
      attribution={data.attribution}
      isSaved={isSaved}
      onToggleSave={handleToggleSave}
      onLongPressSave={onLongPressSave ? () => onLongPressSave(data) : undefined}
      avatarHeadSrc={data.avatarHeadSrc}
      avatarGender={data.gender ?? "female"}
      avatarHeightCm={data.heightCm}
      sizeMode="fluid"
      fluidLayout="avatar"
      fluidHeight={avatarHeight}
      onMetaHeightChange={setMetaHeight}
      cardClassName="w-full"
    />
  )
}

interface FixedCardProps extends GridCardProps {
  fixedAvatarHeight: number
}

function FixedAvatarGridCard({
  data,
  fixedAvatarHeight,
  cardPreset,
  cardOverrides,
  onCardSelect,
  onToggleSave,
  onLongPressSave,
  wrapperRef,
}: FixedCardProps) {
  const [isSaved, setIsSaved] = useState<boolean>(data.isSaved ?? false)
  useEffect(() => {
    setIsSaved(data.isSaved ?? false)
  }, [data.isSaved])

  const handleToggleSave = useCallback(() => {
    setIsSaved((prev) => {
      const next = !prev
      onToggleSave?.(data, next)
      return next
    })
  }, [data, onToggleSave])

  const handleSelect = useCallback(() => {
    onCardSelect?.(data)
  }, [data, onCardSelect])

  return (
    <OutfitInspirationTile
      preset={cardPreset}
      wrapperClassName="flex w-full flex-col"
      wrapperRef={wrapperRef}
      wrapperProps={{
        role: onCardSelect ? "button" : undefined,
        tabIndex: onCardSelect ? 0 : undefined,
        onClick: onCardSelect ? handleSelect : undefined,
        onKeyDown: onCardSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                handleSelect()
              }
            }
          : undefined,
      }}
      cardOverrides={cardOverrides}
      outfitId={data.outfitId ?? data.outfit?.id ?? null}
      renderedItems={data.renderedItems}
      fallbackImageSrc={data.imageSrcFallback}
      title={data.title}
      chips={data.chips}
      attribution={data.attribution}
      isSaved={isSaved}
      onToggleSave={handleToggleSave}
      onLongPressSave={onLongPressSave ? () => onLongPressSave(data) : undefined}
      avatarHeadSrc={data.avatarHeadSrc}
      avatarGender={data.gender ?? "female"}
      avatarHeightCm={data.heightCm}
      sizeMode="fluid"
      fluidLayout="avatar"
      fluidHeight={fixedAvatarHeight}
      cardClassName="w-full"
    />
  )
}
