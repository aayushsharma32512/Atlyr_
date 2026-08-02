import { Bookmark } from "lucide-react"

import { Drawer, DrawerContent } from "@/components/ui/drawer"
import { PriceDisplay } from "@/design-system/primitives"
import { cn } from "@/lib/utils"

/**
 * Canvas 7e — the product peek. Handoff Wave 1B item 3 (`BUILD`, FE-only); the
 * component name and `item / onWear / onDetails` contract come from §8.1.
 *
 * The halfway stop between the rack and the full product page. Tapping a card
 * used to navigate to /studio/product/:productId — a route change out of the
 * studio — which is punishing when the rack is a grid of small tiles you want to
 * skim. This shows fabric, fit and provenance over the dimmed studio, lets you
 * wear it without losing the look, and escalates to the page only on request.
 *
 * Layout follows the canvas rather than the handoff's §8 redline (image left at
 * 40%, 55% height). The handoff's own closing line defers visual truth to the
 * canvas, and the canvas is the later artefact — its extra elements (the
 * provenance line, the spec chips, save-without-leaving) are what justify the
 * screen existing at all.
 *
 * Exactly one filled terracotta: "Wear it". Save is gold-outline, because
 * saving is ownership rather than action.
 */
export interface ProductPeekItem {
  id: string
  title: string
  brand: string | null
  price: number
  imageUrl: string | null
  /** Which slot this piece would occupy — labels the sheet. */
  slotLabel?: string | null
  /** Short fabric/craft note. Gold register: this is provenance. */
  provenance?: string | null
  /** Fit / feel / size chips. */
  specs?: string[]
}

export interface ProductPeekCardProps {
  item: ProductPeekItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onWear: (item: ProductPeekItem) => void
  onDetails: (item: ProductPeekItem) => void
  onSave?: (item: ProductPeekItem) => void
  /**
   * Only meaningful alongside `isWorn`. Tapping a garment on the 7a model opens
   * this sheet as a deep dive on what you're already wearing; the one thing
   * that dive can't answer is "what else could go here", so it hands off to the
   * tray sheet rather than dead-ending.
   */
  onSeeAlternates?: (item: ProductPeekItem) => void
  /**
   * The piece is already on the model. "Wear it" is then meaningless, so the
   * sheet promotes "Full details" to the single terracotta instead of offering
   * an action that does nothing.
   */
  isWorn?: boolean
  isReadOnly?: boolean
}

export function ProductPeekCard({
  item,
  open,
  onOpenChange,
  onWear,
  onDetails,
  onSave,
  onSeeAlternates,
  isWorn = false,
  isReadOnly = false,
}: ProductPeekCardProps) {
  if (!item) return null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* vaul gives drag-to-dismiss and tap-backdrop-to-close for free, which is
          the whole point of a peek — it should be cheap to back out of. */}
      <DrawerContent className="mx-auto max-w-sm rounded-t-xl border-hairline bg-background px-6 pb-6 pt-0">
        <div className="mx-auto mb-3.5 h-[3px] w-10 rounded-full bg-hairline-4" aria-hidden="true" />

        <p className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          In your studio{item.slotLabel ? ` · ${item.slotLabel}` : ""}
        </p>

        <div className="bg-warp-grid relative mt-2.5 flex h-[168px] items-center justify-center overflow-hidden rounded-md border border-hairline bg-card">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="relative max-h-[150px] max-w-[80%] object-contain"
            />
          ) : (
            <span className="relative text-[9px] font-semibold tracking-[0.1em] text-taupe">
              NO IMAGE
            </span>
          )}
        </div>

        <div className="mt-3 flex items-baseline gap-2.5">
          <h2 className="min-w-0 flex-1 truncate font-display text-[22px] font-medium text-foreground">
            {item.title}
          </h2>
          <PriceDisplay
            price={item.price}
            className="shrink-0 text-[14px] font-bold text-foreground"
          />
        </div>

        {item.brand && (
          <p className="mt-0.5 text-[9.5px] font-medium text-muted-foreground">{item.brand}</p>
        )}

        {item.provenance && (
          <p className="mt-2 text-[9.5px] font-medium text-gold-deep">◈ {item.provenance}</p>
        )}

        {item.specs && item.specs.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {item.specs.map((spec) => (
              <span
                key={spec}
                className="rounded-[3px] border border-hairline-4 px-2.5 py-1 text-[8.5px] font-medium uppercase text-ink-body"
              >
                {spec}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3.5 flex items-center gap-2.5">
          {onSave && (
            <button
              type="button"
              disabled={isReadOnly}
              onClick={() => onSave(item)}
              aria-label="Save this piece"
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-[3px] border border-gold px-3.5 py-3",
                "text-[11px] font-semibold text-gold-deep transition-colors hover:bg-gold/5",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <Bookmark className="size-3" aria-hidden="true" />
              Save
            </button>
          )}
          <button
            type="button"
            disabled={isReadOnly && !isWorn}
            onClick={() => (isWorn ? onDetails(item) : onWear(item))}
            className={cn(
              "flex-1 rounded-[3px] bg-primary py-3 text-[12px] font-bold text-primary-foreground",
              "shadow-sm transition-shadow hover:shadow-md",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {isWorn ? "Full details →" : "Wear it"}
          </button>
        </div>

        {!isWorn && (
          <button
            type="button"
            onClick={() => onDetails(item)}
            className="mt-3 w-full text-center text-[10px] font-semibold text-ink-body"
          >
            Full details — fabric, care, provenance →
          </button>
        )}

        {isWorn &&
          (onSeeAlternates ? (
            <button
              type="button"
              disabled={isReadOnly}
              onClick={() => onSeeAlternates(item)}
              className="mt-3 w-full text-center text-[10px] font-semibold text-ink-body disabled:opacity-60"
            >
              {item.slotLabel ? `Other ${item.slotLabel.toLowerCase()} options` : "See other options"} →
            </button>
          ) : (
            <p className="mt-3 text-center text-[9px] font-medium text-muted-foreground">
              Already on the model
            </p>
          ))}
      </DrawerContent>
    </Drawer>
  )
}
