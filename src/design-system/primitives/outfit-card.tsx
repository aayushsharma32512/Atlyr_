import type { ComponentProps } from "react"

import { Icons } from "@/design-system/icons"
import { CANONICAL_HERO_RENDER_BOX } from "@/features/studio/constants/renderBox"
import { cn } from "@/lib/utils"

import { OutfitInspirationTile } from "./outfit-inspiration-tile"
import { useLongPress } from "./use-long-press"

export type OutfitCardRenderedItems = NonNullable<ComponentProps<typeof OutfitInspirationTile>["renderedItems"]>

export interface OutfitCardProps {
  title: string
  /** Maker's first name. Community grids only. */
  by?: string
  saved?: boolean
  dark?: boolean
  /** Fixed ±0.6° tilt seeded by position. Feed and board tiles only. */
  tiltIndex?: number
  outfitId?: string | null
  renderedItems?: OutfitCardRenderedItems
  gender?: "male" | "female"
  heightCm?: number
  onSelect?: () => void
  onToggleSave?: () => void
  onLongPressSave?: () => void
  className?: string
}

// Studio's frame, fitted by height, keeps the figure head to toe.
const FIGURE_ASPECT = `${CANONICAL_HERO_RENDER_BOX.width} / ${CANONICAL_HERO_RENDER_BOX.height}`

/** The look tile: figure to the hairline, pin top-right, 40h footer with the name alone. */
export function OutfitCard({
  title,
  by,
  saved = false,
  dark = false,
  tiltIndex,
  outfitId,
  renderedItems,
  gender = "female",
  heightCm = 170,
  onSelect,
  onToggleSave,
  onLongPressSave,
  className,
}: OutfitCardProps) {
  const interactive = Boolean(onSelect)
  const pinPress = useLongPress(onToggleSave, onLongPressSave)

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect?.()
              }
            }
          : undefined
      }
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg border text-left",
        dark ? "border-ink-line bg-ink-deep" : "border-hairline bg-card",
        interactive && "cursor-pointer",
        tiltIndex != null && `pin-tilt-${(tiltIndex % 6) + 1}`,
        className,
      )}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div className="h-full" style={{ aspectRatio: FIGURE_ASPECT }}>
          <OutfitInspirationTile
            preset="moodboardPreview"
            outfitId={outfitId}
            renderedItems={renderedItems}
            avatarGender={gender}
            avatarHeightCm={heightCm}
            wrapperClassName="h-full w-full rounded-none bg-transparent p-0"
          />
        </div>
        {onToggleSave ? (
          <button
            type="button"
            aria-label={saved ? "Unsave" : "Save"}
            aria-pressed={saved}
            {...pinPress}
            style={{ WebkitTouchCallout: "none", userSelect: "none" }}
            className={cn(
              "absolute right-0 top-0 flex h-8 w-8 items-center justify-center",
              dark ? "text-background" : "text-ink",
            )}
          >
            <Icons.save className="h-4 w-4" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          "flex min-h-10 shrink-0 flex-col justify-center border-t px-2 py-1",
          dark ? "border-ink-line" : "border-hairline",
        )}
      >
        <p className={cn("truncate text-card font-semibold", dark ? "text-background" : "text-ink")}>{title}</p>
        {by ? <p className={cn("truncate text-chip", dark ? "text-on-ink-1" : "text-taupe")}>{by}</p> : null}
      </div>
    </div>
  )
}
