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
  /** Scrapbook feed: deterministic tilt + uneven card heights (canvas 6d). */
  stagger?: boolean
  onCardSelect?: (item: InspirationItem) => void
  onToggleSave?: (item: InspirationItem, isSaved: boolean) => void
  onLongPressSave?: (item: InspirationItem) => void
  getItemWrapperRef?: (item: InspirationItem) => RefCallback<HTMLDivElement> | undefined
}

// Deterministic hash so a card's tilt + height stay stable across re-mounts.
function hashKey(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
const PIN_TILTS = ["pin-tilt-1", "pin-tilt-2", "pin-tilt-3", "pin-tilt-4", "pin-tilt-5", "pin-tilt-6"]
const HEIGHT_DELTAS = [-34, -16, 0, 18, 36]

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
  stagger?: boolean
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
  stagger = false,
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
    <div className={cn("flex flex-1 gap-2.5 min-w-0", className)}>
      <GridColumns
        columns={columnBuckets}
        cardTotalHeight={cardTotalHeight}
        cardVerticalGap={cardVerticalGap}
        cardMinAvatarHeight={cardMinAvatarHeight}
        fixedAvatarHeight={fixedAvatarHeight}
        layoutMode={layoutMode}
        cardPreset={cardPreset}
        cardOverrides={cardOverrides}
        stagger={stagger}
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
  stagger,
  onCardSelect,
  onToggleSave,
  onLongPressSave,
  getItemWrapperRef,
}: ColumnBucketsProps) {
  return (
    <>
      {columns.map((column, columnIndex) => (
        <div className="flex w-full flex-1 flex-col gap-2.5 min-w-0" key={`grid-column-${columnIndex}`}>
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
                stagger={stagger}
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
  stagger?: boolean
}

function BalancedGridCard({
  data,
  cardTotalHeight,
  cardVerticalGap,
  cardMinAvatarHeight,
  cardPreset,
  cardOverrides,
  stagger,
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

  // Scrapbook stagger: a deterministic per-card tilt + height offset so the feed
  // reads as an uneven masonry, not a rigid grid (canvas 6d). Fixed by id so cards
  // don't re-tilt on re-mount.
  const seed = hashKey(data.outfitId ?? data.outfit?.id ?? data.id ?? "")
  const tiltClass = stagger ? PIN_TILTS[seed % PIN_TILTS.length] : ""
  const effectiveHeight = stagger ? cardTotalHeight + HEIGHT_DELTAS[seed % HEIGHT_DELTAS.length] : cardTotalHeight

  const avatarHeight = Math.max(
    cardMinAvatarHeight,
    effectiveHeight - metaHeight - cardVerticalGap,
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
      variety={stagger}
      wrapperClassName={cn("relative flex w-full flex-col transition-transform", tiltClass)}
      wrapperStyle={{ minHeight: effectiveHeight }}
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
