import { useCallback, useMemo, useState, type RefCallback } from "react"

import type { InspirationItem } from "@/features/studio/types"
import { useElementHeight } from "@/shared/hooks/useElementHeight"
import { cn } from "@/lib/utils"
import {
  OutfitInspirationTile,
  type OutfitInspirationCardOverrides,
} from "./outfit-inspiration-tile"
import type { OutfitInspirationPresetKey } from "./outfit-inspiration-presets"

const CARD_TARGET_HEIGHT = 210
const CARD_MIN_AVATAR_HEIGHT = 128

interface RecentStylesRailProps {
  items: InspirationItem[]
  className?: string
  onCardSelect?: (item: InspirationItem) => void
  onToggleSave?: (item: InspirationItem, isSaved: boolean) => void
  onLongPressSave?: (item: InspirationItem) => void
  railClassName?: string
  itemClassName?: string
  getItemWrapperRef?: (item: InspirationItem) => RefCallback<HTMLDivElement> | undefined
  cardOptions?: RecentStylesRailCardOptions
  cardPreset?: OutfitInspirationPresetKey
}

interface RecentStylesRailCardOptions {
  showTitle?: boolean
  showChips?: boolean
  showSaveButton?: boolean
  className?: string
}

export function RecentStylesRail({
  items,
  className,
  onCardSelect,
  onToggleSave,
  onLongPressSave,
  railClassName,
  itemClassName,
  getItemWrapperRef,
  cardOptions,
  cardPreset = "rail",
}: RecentStylesRailProps) {
  const content = useMemo(
    () =>
      items.map((item) => (
        <RecentStylesRailItem
          key={item.id}
          data={item}
          onSelect={onCardSelect}
          onToggleSave={onToggleSave}
          onLongPressSave={onLongPressSave}
          itemClassName={itemClassName}
          wrapperRef={getItemWrapperRef?.(item)}
          cardOptions={cardOptions}
          cardPreset={cardPreset}
        />
      )),
    [items, onCardSelect, onToggleSave, onLongPressSave, itemClassName, getItemWrapperRef, cardOptions, cardPreset],
  )

  return (
    <div className={cn("flex w-full flex-col gap-1 px-0", className)}>
      <div className={cn("flex gap-1 overflow-x-auto pb-1 scrollbar-hide", railClassName)}>
        {content.length > 0 ? content : <RailFallback />}
      </div>
    </div>
  )
}

interface RailItemProps {
  data: InspirationItem
  onSelect?: (item: InspirationItem) => void
  onToggleSave?: (item: InspirationItem, isSaved: boolean) => void
  onLongPressSave?: (item: InspirationItem) => void
  itemClassName?: string
  wrapperRef?: RefCallback<HTMLDivElement>
  cardOptions?: RecentStylesRailCardOptions
  cardPreset: OutfitInspirationPresetKey
}

const DEFAULT_ITEM_CLASSNAME = "flex h-[12.7rem] w-[7rem] flex-col cursor-pointer"

function RecentStylesRailItem({
  data,
  onSelect,
  onToggleSave,
  onLongPressSave,
  itemClassName,
  wrapperRef,
  cardOptions,
  cardPreset,
}: RailItemProps) {
  const [attachRef, wrapperHeight] = useElementHeight<HTMLDivElement>()
  const [metaHeight, setMetaHeight] = useState(0)
  const [isSaved, setIsSaved] = useState<boolean>(data.isSaved ?? false)

  const avatarHeight = useMemo(() => {
    if (!wrapperHeight) {
      return CARD_TARGET_HEIGHT - CARD_MIN_AVATAR_HEIGHT
    }

    return Math.max(CARD_MIN_AVATAR_HEIGHT, wrapperHeight - metaHeight)
  }, [wrapperHeight, metaHeight])

  const handleToggleSave = useCallback(() => {
    setIsSaved((prev) => {
      const next = !prev
      onToggleSave?.(data, next)
      return next
    })
  }, [data, onToggleSave])

  const cardOverrides: OutfitInspirationCardOverrides = {}
  if (typeof cardOptions?.showTitle === "boolean") {
    cardOverrides.showTitle = cardOptions.showTitle
  }
  if (typeof cardOptions?.showChips === "boolean") {
    cardOverrides.showChips = cardOptions.showChips
  }
  if (typeof cardOptions?.showSaveButton === "boolean") {
    cardOverrides.showSaveButton = cardOptions.showSaveButton
  }

  return (
    <OutfitInspirationTile
      preset={cardPreset}
      wrapperRef={(el) => {
        attachRef(el)
        wrapperRef?.(el)
      }}
      wrapperClassName={cn(DEFAULT_ITEM_CLASSNAME, itemClassName)}
      wrapperProps={{
        role: "button",
        tabIndex: 0,
        onClick: () => onSelect?.(data),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onSelect?.(data)
          }
        },
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
      cardClassName={cn("h-full w-full", cardOptions?.className)}
    />
  )
}

function RailFallback() {
  return (
    <div className="flex h-[12.7rem] w-[7rem] flex-shrink-0 items-center justify-center rounded-xl border border-dashed border-muted-foreground/40 text-xs text-muted-foreground">
      No styles yet
    </div>
  )
}
