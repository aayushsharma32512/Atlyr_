import { Footprints, Maximize2, Minimize2, Shirt, Sparkles } from "lucide-react"

import type { StudioProductTraySlot } from "@/services/studio/studioService"
import { cn } from "@/lib/utils"

/**
 * Canvas 7c — the two rows that head the rack: mode tabs, then slot pills.
 *
 * This replaces `CategoryFilterBar` on this screen only. That bar folded the
 * panel-expand control in as a fourth "Others" category, so expanding the rack
 * read as picking a garment slot; here ⤢ sits at the row's right edge where it
 * belongs, and the slots are just slots.
 *
 * All four modes are backed by something real — `saves` filters the rack by
 * what you've already saved, `similar` runs the image search against the piece
 * you're wearing, `yours` renders its Wave 2 empty state. None of them is a
 * decorative tab.
 */

export type RackMode = "alternates" | "saves" | "yours"

/**
 * `similar` is deliberately absent. It ran an image-embedding search against the
 * worn piece, which narrowed the rack to ~47 lookalikes and — worse — stayed
 * committed when you tabbed back to Alternates, so the catalogue never came
 * back. Until that search is worth its cost, Alternates shows everything.
 */
const MODES: { id: RackMode; label: string }[] = [
  { id: "alternates", label: "Alternates" },
  { id: "saves", label: "Saves" },
  { id: "yours", label: "Yours" },
]

const SLOTS: {
  id: StudioProductTraySlot
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: "top", label: "Top", icon: Shirt },
  { id: "bottom", label: "Bottom", icon: BottomsGlyph },
  { id: "shoes", label: "Shoes", icon: Footprints },
]

/** Trousers outline — lucide has no bottoms glyph. */
function BottomsGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 3h12l1 18h-5l-2-11-2 11H5L6 3Z" />
    </svg>
  )
}

export interface RackHeaderProps {
  mode: RackMode
  onModeChange: (mode: RackMode) => void
  slot: StudioProductTraySlot
  onSlotChange: (slot: StudioProductTraySlot) => void
  /** ⤢ / ⤡ — rack covers the full width, hiding the model. */
  isExpanded: boolean
  onToggleExpanded: () => void
  isReadOnly?: boolean
  className?: string
}

export function RackHeader({
  mode,
  onModeChange,
  slot,
  onSlotChange,
  isExpanded,
  onToggleExpanded,
  isReadOnly = false,
  className,
}: RackHeaderProps) {
  const ExpandIcon = isExpanded ? Minimize2 : Maximize2

  return (
    <div className={cn("shrink-0 border-b border-hairline bg-card", className)}>
      <div className="flex items-center gap-3 px-2.5 pt-2 md:gap-4 md:px-3.5 md:pt-2.5">
        {MODES.map((entry) => {
          const isActive = entry.id === mode
          return (
            <button
              key={entry.id}
              type="button"
              disabled={isReadOnly}
              onClick={() => onModeChange(entry.id)}
              className={cn(
                "flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-50 md:text-[10px]",
                isActive
                  ? entry.id === "yours"
                    ? "text-gold-deep"
                    : "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {entry.id === "yours" && <Sparkles className="size-2 md:size-2.5" aria-hidden="true" />}
              {entry.label}
            </button>
          )
        })}

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={isExpanded ? "Restore split view" : "Expand the rack"}
          className="ml-auto flex size-5 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ExpandIcon className="size-3 md:size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-4 px-2.5 md:mt-2 md:gap-5 md:px-3.5">
        {SLOTS.map((entry) => {
          const isActive = entry.id === slot
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              disabled={isReadOnly}
              onClick={() => onSlotChange(entry.id)}
              aria-pressed={isActive}
              className={cn(
                "-mb-px flex items-center gap-1 border-b-[1.5px] pb-1.5 text-[9px] font-semibold transition-colors disabled:opacity-50 md:pb-2 md:text-[11px]",
                isActive
                  ? "border-terracotta text-terracotta"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3 md:size-3.5" />
              {entry.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
