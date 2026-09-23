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
  /** The row's stored stacking, front-most first. Absent or null: the default rule. */
  slotOrder?: ("top" | "bottom" | "shoes")[] | null
  gender?: "male" | "female"
  heightCm?: number
  onSelect?: () => void
  onToggleSave?: () => void
  onLongPressSave?: () => void
  className?: string
  /** Off for 96w rail tiles: figure only, no 40h name row. */
  footer?: boolean
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
  slotOrder,
  gender = "female",
  heightCm = 170,
  onSelect,
  onToggleSave,
  onLongPressSave,
  className,
  footer = true,
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
        "flex h-full w-full flex-col gap-1.5 text-left",
        interactive && "cursor-pointer",
        tiltIndex != null && `pin-tilt-${(tiltIndex % 6) + 1}`,
        className,
      )}
    >
      {/* V2: the hairline frames the figure only; the name sits below it on
          the ground. No filled card, and no dark variant. */}
      <div
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-background",
          dark ? "border-ink-line" : "border-hairline",
        )}
      >
        <div className="h-full" style={{ aspectRatio: FIGURE_ASPECT }}>
          <OutfitInspirationTile
            preset="moodboardPreview"
            outfitId={outfitId}
            renderedItems={renderedItems}
            slotOrder={slotOrder ?? undefined}
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
              // Selected hearts are violet everywhere.
              saved ? "text-violet" : dark ? "text-background" : "text-ink",
            )}
          >
            <Icons.save className="h-4 w-4" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {footer ? (
        <div className="flex shrink-0 flex-col justify-center px-0.5">
          <p className="truncate text-card font-medium text-ink">{title}</p>
          {by ? <p className="truncate text-chip text-taupe">{by}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
