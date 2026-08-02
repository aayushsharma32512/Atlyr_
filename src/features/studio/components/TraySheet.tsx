import { Footprints, Layers, Shirt, Sparkles } from "lucide-react"

import { Drawer, DrawerContent } from "@/components/ui/drawer"
import { Skeleton } from "@/components/ui/skeleton"
import { PriceDisplay } from "@/design-system/primitives"
import { useStudioAlternatives } from "@/features/studio/hooks/useStudioAlternatives"
import type {
  StudioAlternativeProduct,
  StudioProductTrayItem,
  StudioProductTraySlot,
} from "@/services/studio/studioService"
import { cn } from "@/lib/utils"
import { isPlaceableOnMannequin, shouldFilterSlotByPlacement } from "@/features/studio/utils/placementSupport"

/**
 * Canvas 7a — the tray sheet. Handoff §8.1 names it `TraySheet` with props
 * `slot` and `mode: alternates | yours`; that contract is kept.
 *
 * What it replaces: tapping a garment on the model used to call
 * `openAlternatives`, a full route change to /studio/alternatives (7c). That is
 * a heavy answer to a light question — you tapped a shirt to see other shirts,
 * and lost the screen you were looking at. The sheet answers in place: swap,
 * see it on the model behind you, swap again. 7c is still one tap away for the
 * full rack with search and filters, via the ⧉ link at the foot.
 *
 * On the mini-model the canvas draws in the sheet header: it is not rendered
 * here. The sheet is half-height precisely so the live model stays visible
 * above it, and `PlacementAvatarRenderer` builds its own Pixi `Application`
 * per instance — a second one would mean a second WebGL context and a second
 * set of mannequin/garment texture uploads torn down on every open, to
 * duplicate a model sitting 40px higher up the screen. The running total moves
 * into the header instead, so the header still answers "what am I editing, and
 * what does it cost".
 */

const SLOT_LABELS: Record<StudioProductTraySlot, string> = {
  top: "Top",
  bottom: "Bottom",
  shoes: "Shoes",
}

/** Trousers outline — lucide has no bottoms glyph. Matches StudioSlotRows. */
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

const SLOT_GLYPHS: Record<
  StudioProductTraySlot,
  React.ComponentType<{ className?: string }>
> = {
  top: Shirt,
  bottom: BottomsGlyph,
  shoes: Footprints,
}

const SLOT_ORDER: StudioProductTraySlot[] = ["top", "bottom", "shoes"]

export type TraySheetMode = "alternates" | "yours"

export interface TraySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which slot the rack is showing. Handoff §8.1 prop. */
  slot: StudioProductTraySlot
  /** Handoff §8.1 prop. `yours` renders its empty state until Wave 2. */
  mode: TraySheetMode
  onSlotChange: (slot: StudioProductTraySlot) => void
  onModeChange: (mode: TraySheetMode) => void
  outfitId: string | null
  /** The look as worn — drives the running total and the WEARING badge. */
  wornItems: StudioProductTrayItem[]
  hiddenSlots: Partial<Record<StudioProductTraySlot, boolean>>
  onWear: (slot: StudioProductTraySlot, product: StudioAlternativeProduct) => void
  /** ⧉ — escalate to the full 7c rack, with search, filters and the peek. */
  onOpenSplitView: (slot: StudioProductTraySlot) => void
  isReadOnly?: boolean
  /** Which body is on screen — placement is per-mannequin, not per-product. */
  mannequin?: "male" | "female"
}

export function TraySheet({
  open,
  onOpenChange,
  slot,
  mode,
  onSlotChange,
  onModeChange,
  outfitId,
  wornItems,
  hiddenSlots,
  onWear,
  onOpenSplitView,
  isReadOnly = false,
  mannequin = "female",
}: TraySheetProps) {
  // `enabled` inside the hook already gates on outfitId/slot; the drawer
  // unmounts its content when closed, so nothing fetches until it opens.
  // No limit override: every consumer shares one cache entry, so asking for a
  // smaller slice here would just be the first mount deciding what the 7c rack
  // gets to show. The sheet scrolls.
  const { data: alternatives, isLoading } = useStudioAlternatives(
    mode === "alternates" ? outfitId : null,
    mode === "alternates" ? slot : null,
  )

  // Same rule as the 7c rack: never offer a piece the photoreal mannequin will
  // silently refuse to draw.
  const offerable = shouldFilterSlotByPlacement(slot)
    ? (alternatives ?? []).filter((product) => isPlaceableOnMannequin(product, mannequin))
    : (alternatives ?? [])

  const visibleWorn = wornItems.filter((item) => !hiddenSlots[item.slot])
  const lookTotal = visibleWorn.reduce((sum, item) => sum + (item.price ?? 0), 0)
  const wornInSlot = wornItems.find((item) => item.slot === slot)
  const wornProductId = hiddenSlots[slot] ? null : wornInSlot?.productId ?? null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto flex max-h-[62%] max-w-sm flex-col rounded-t-xl border-hairline bg-background px-5 pb-4 pt-0">
        <div className="mx-auto mb-3 h-[3px] w-10 shrink-0 rounded-full bg-hairline-4" aria-hidden="true" />

        {/* Which slot, and what the look costs. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {SLOT_ORDER.map((candidate) => {
            const Glyph = SLOT_GLYPHS[candidate]
            const isActive = candidate === slot
            return (
              <button
                key={candidate}
                type="button"
                onClick={() => onSlotChange(candidate)}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] transition-colors",
                  isActive
                    ? "border-ink bg-ink text-on-ink-1"
                    : "border-hairline bg-card text-muted-foreground hover:border-hairline-4",
                )}
              >
                <Glyph className="size-3" />
                {SLOT_LABELS[candidate]}
              </button>
            )
          })}

          <span className="ml-auto text-right">
            <PriceDisplay price={lookTotal} className="block text-[11px] font-bold text-foreground" />
            <span className="block text-[7px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {visibleWorn.length} {visibleWorn.length === 1 ? "piece" : "pieces"}
            </span>
          </span>
        </div>

        {/* alternates | yours — the §8.1 mode switch. */}
        <div className="mt-3 flex shrink-0 items-center gap-4 border-b border-hairline">
          {(["alternates", "yours"] as const).map((candidate) => {
            const isActive = candidate === mode
            return (
              <button
                key={candidate}
                type="button"
                onClick={() => onModeChange(candidate)}
                className={cn(
                  "-mb-px flex items-center gap-1 border-b-[1.5px] pb-1.5 text-[8.5px] font-semibold uppercase tracking-[0.14em] transition-colors",
                  isActive
                    ? candidate === "yours"
                      ? "border-gold text-gold-deep"
                      : "border-ink text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {candidate === "yours" && <Sparkles className="size-2.5" aria-hidden="true" />}
                {candidate === "yours" ? "Yours" : "Alternates"}
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-3">
          {mode === "yours" ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-[5px] border-[1.5px] border-dashed border-hairline-4 bg-card/40 px-6 py-8 text-center">
              <Layers className="size-4 text-taupe" aria-hidden="true" />
              <p className="text-[9.5px] font-semibold text-foreground">Your own pieces</p>
              <p className="text-[8px] text-muted-foreground">
                Wardrobe items you upload will appear here, ready to style into any look.
              </p>
            </div>
          ) : isLoading ? (
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="aspect-[4/5] rounded-[4px]" />
              ))}
            </div>
          ) : offerable.length === 0 ? (
            <p className="py-8 text-center text-[9px] text-muted-foreground">
              Nothing else in this slot yet.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {offerable.map((product) => {
                const isWorn = product.id === wornProductId
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={isReadOnly || isWorn}
                    onClick={isReadOnly || isWorn ? undefined : () => onWear(slot, product)}
                    title={isWorn ? "Already on the model" : `Wear ${product.title}`}
                    className={cn(
                      "group flex min-w-0 flex-col text-left",
                      "disabled:cursor-default",
                      isReadOnly && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "bg-warp-grid relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-[4px] border bg-card",
                        isWorn ? "border-terracotta" : "border-hairline group-hover:border-hairline-4",
                      )}
                    >
                      {product.imageSrc ? (
                        <img
                          src={product.imageSrc}
                          alt=""
                          loading="lazy"
                          className="relative max-h-[85%] max-w-[85%] object-contain"
                        />
                      ) : (
                        <span className="relative text-[6px] font-semibold tracking-[0.1em] text-taupe">
                          NO IMAGE
                        </span>
                      )}
                      {isWorn && (
                        <span className="absolute inset-x-0 bottom-0 bg-terracotta py-[2px] text-center text-[6px] font-bold tracking-[0.1em] text-on-ink-1">
                          WEARING
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-[7.5px] font-semibold text-foreground">
                      {product.title}
                    </span>
                    <PriceDisplay
                      price={product.price}
                      className="block text-[7.5px] font-bold text-muted-foreground"
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onOpenSplitView(slot)}
          className="mt-2.5 shrink-0 text-center text-[9px] font-semibold text-ink-body"
        >
          ⧉ Full split view — search, filters and details
        </button>
      </DrawerContent>
    </Drawer>
  )
}
