import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import type { MoodboardPreview } from "@/services/collections/collectionsService"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreVertical } from "lucide-react"

interface MoodboardCardProps {
  name: string
  slug?: string
  isSystem?: boolean
  itemCount?: number
  preview?: MoodboardPreview
  onDelete?: (slug: string, name: string) => void
  /** Position in the board grid — seeds the fixed tilt + stagger so the wall
   *  reads like pinned scraps, not a rigid grid (boards/feed only). */
  index?: number
}

// Fixed per-slot rotations + vertical offsets — hand-placed pinboard scatter.
// Fixed (never random) so a card keeps its angle across re-mounts (tilt gate,
// Design_Tokens §4.3).
const CARD_TILT = ["-2.1deg", "1.6deg", "-1.1deg", "2deg", "-1.7deg", "1.2deg"]
const CARD_DROP = ["0rem", "0.9rem", "0.35rem", "0.7rem", "0.2rem", "0.55rem"]

const MoodboardCard = ({ name, slug, isSystem = false, itemCount = 0, preview, onDelete, index = 0 }: MoodboardCardProps) => {
  const navigate = useNavigate()
  const items = useMemo(() => preview?.items ?? [], [preview?.items])
  const isClickable = Boolean(slug) && itemCount > 0
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const canDelete = Boolean(onDelete && slug && !isSystem)

  // Flatten the board into individual flat-lay garment images — a product's own
  // image, or each garment inside an outfit's rendered items — so the collage shows
  // flat pieces on cream, exactly like the kalagriha canvas board card (6e).
  const garments = useMemo(() => {
    const urls: string[] = []
    for (const item of items) {
      if (urls.length >= 4) break
      if (item.itemType === "outfit") {
        for (const rendered of item.renderedItems ?? []) {
          if (rendered.imageUrl) {
            urls.push(rendered.imageUrl)
            if (urls.length >= 4) break
          }
        }
      } else if (item.imageUrl) {
        urls.push(item.imageUrl)
      }
    }
    return urls
  }, [items])

  const handleNavigate = useCallback(() => {
    if (!slug) return
    if (isMenuOpen || isConfirmingDelete) return
    const params = new URLSearchParams({ moodboard: slug })
    navigate(`/home?${params.toString()}`)
  }, [isConfirmingDelete, isMenuOpen, navigate, slug])

  // Scrapbook collage — cream cells tilted a touch, each a flat garment, exactly
  // like the canvas board card. Layout adapts to how many pieces preview:
  // 1 → full · 2 → split · 3 → row · 4+ → big-left + stacked + right.
  const cell = (src: string | undefined, tilt: string, className?: string) => (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-[4px] bg-background p-2",
        className,
      )}
      style={{ transform: `rotate(${tilt})` }}
    >
      {src ? <img src={src} alt="" loading="lazy" className="max-h-full max-w-[86%] object-contain" /> : null}
    </div>
  )

  const renderCollage = () => {
    const n = garments.length
    if (n === 0) {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            navigate("/search")
          }}
          className="flex h-[110px] w-full flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-hairline-dashed text-taupe transition-colors hover:bg-editorial/30"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-hairline-dashed text-primary">
            <span className="text-lg font-light leading-none">+</span>
          </span>
          <span className="text-[10px]">Add pieces</span>
        </button>
      )
    }
    if (n === 1) return <div className="h-[118px]">{cell(garments[0], "-1deg", "h-full w-full")}</div>
    if (n === 2)
      return (
        <div className="flex h-[110px] gap-2">
          {cell(garments[0], "-2deg", "flex-1")}
          {cell(garments[1], "1.8deg", "flex-1")}
        </div>
      )
    if (n === 3)
      return (
        <div className="flex h-[92px] gap-2">
          {cell(garments[0], "2deg", "flex-1")}
          {cell(garments[1], "-1.6deg", "flex-1")}
          {cell(garments[2], "1.4deg", "flex-1")}
        </div>
      )
    return (
      <div className="flex h-[118px] gap-2">
        {cell(garments[0], "-2deg", "flex-[1.4]")}
        <div className="flex flex-1 flex-col gap-2">
          {cell(garments[1], "1.6deg", "flex-1")}
          {cell(garments[2], "2.2deg", "flex-1")}
        </div>
        {cell(garments[3], "1.8deg", "flex-1")}
      </div>
    )
  }

  const tilt = CARD_TILT[index % CARD_TILT.length]
  const drop = CARD_DROP[index % CARD_DROP.length]

  return (
    // Outer stays upright: it carries the stagger drop and holds the pushpin
    // vertical while the card leaf tilts beneath it — a pinned-scrap look.
    <div className="relative w-full" style={{ marginTop: drop }}>
      {/* Pushpin — charcoal head (terracotta stays the action colour, gold stays
          provenance), a soft sheen, and a short cast shadow onto the card. */}
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-[45%]">
        <span className="relative block h-3 w-3 rounded-full bg-ink-deep shadow-[0_2px_3px_rgba(46,42,36,0.4)]">
          <span className="absolute left-[2.5px] top-[2px] h-[3px] w-[3px] rounded-full bg-background/55" />
        </span>
      </span>
      <div
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        aria-disabled={isClickable ? undefined : true}
        onClick={isClickable ? handleNavigate : undefined}
        onKeyDown={
          isClickable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  handleNavigate()
                }
              }
            : undefined
        }
        style={{ transform: `rotate(${tilt})` }}
        className={cn(
          "relative w-full rounded-frame border border-hairline bg-card p-3.5 text-left shadow-[0_1px_3px_rgba(46,42,36,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(46,42,36,0.12)]",
          !isClickable && "cursor-default",
        )}
      >
      {canDelete ? (
        <div className="absolute right-2 top-2 z-10">
          <DropdownMenu
            open={isMenuOpen}
            onOpenChange={(open) => {
              setIsMenuOpen(open)
              if (!open) {
                setIsConfirmingDelete(false)
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full bg-card/80"
                aria-label="Moodboard actions"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {isConfirmingDelete ? (
                <div className="flex w-56 flex-col gap-2 px-2 py-2">
                  <div className="text-xs font-medium text-foreground">Delete moodboard?</div>
                  <div className="text-xs text-muted-foreground">
                    This will permanently remove it.
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsConfirmingDelete(false)
                        setIsMenuOpen(false)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (!slug || !onDelete) return
                        void onDelete(slug, name)
                        setIsConfirmingDelete(false)
                        setIsMenuOpen(false)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={(event) => {
                    event.preventDefault()
                    setIsConfirmingDelete(true)
                  }}
                >
                  Delete moodboard
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      {renderCollage()}
      <div className="mt-3">
        <p className="truncate text-sm font-semibold leading-snug text-foreground">{name}</p>
        {itemCount > 0 ? (
          <p className="mt-0.5 text-[10.5px] text-taupe">
            {itemCount} {itemCount === 1 ? "pin" : "pins"}
          </p>
        ) : null}
      </div>
      </div>
    </div>
  )
}

export default MoodboardCard
