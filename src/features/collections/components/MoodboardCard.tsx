import { useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Icons } from "@/design-system/icons"
import { GarmentImage, OutfitInspirationTile } from "@/design-system/primitives"
import type { MoodboardPreview } from "@/services/collections/collectionsService"
import { CANONICAL_HERO_RENDER_BOX } from "@/features/studio/constants/renderBox"
import { boardPath } from "../boardUrl"

interface MoodboardCardProps {
  name: string
  slug?: string
  isSystem?: boolean
  itemCount?: number
  preview?: MoodboardPreview
  gender?: "male" | "female" | null
  heightCm?: number | null
  /** Position in the grid — seeds the fixed tilt so a card keeps its angle across re-mounts. */
  index?: number
  /**
   * id → best image for that product (webp thumbnail when there is one), fetched
   * from the products table the way Studio does. The preview payload only carries
   * the full-size image_url, so this wins where it has an entry.
   */
  productImages?: Record<string, string | null>
}

type PreviewCell =
  | { kind: "outfit"; outfitId: string; gender?: "male" | "female" | null }
  | { kind: "product"; url: string }

// Square cover, 2x2 = four row-units. An outfit takes a long cell (both rows),
// a product a short one. Empty units are flat cream blocks.
const COVER_UNITS = 4
// Empty cells are the ground, like everything else: no grey blocks.
const FILLER_TONE = ["bg-background", "bg-background", "bg-background", "bg-background"]
export const FIGURE_FRAME_ASPECT = `${CANONICAL_HERO_RENDER_BOX.width} / ${CANONICAL_HERO_RENDER_BOX.height}`

const MoodboardCard = ({
  name,
  slug,
  itemCount = 0,
  preview,
  gender,
  heightCm,
  index = 0,
  productImages,
}: MoodboardCardProps) => {
  const navigate = useNavigate()
  const items = useMemo(() => preview?.items ?? [], [preview?.items])
  const isClickable = Boolean(slug)

  const cells = useMemo(() => {
    const out: PreviewCell[] = []
    let units = 0
    for (const item of items) {
      if (units >= COVER_UNITS) break
      if (item.itemType === "outfit") {
        if (units + 2 > COVER_UNITS) continue
        out.push({ kind: "outfit", outfitId: item.id, gender: item.gender ?? null })
        units += 2
      } else {
        const url = productImages?.[item.id] ?? item.imageUrl
        if (url) {
          out.push({ kind: "product", url })
          units += 1
        }
      }
    }
    return out
  }, [items, productImages])

  const handleNavigate = useCallback(() => {
    if (!slug) return
    // An empty board has nothing to show — send the user off to find things to save.
    if (itemCount === 0) {
      navigate("/search")
      return
    }
    navigate(boardPath(slug))
  }, [navigate, slug, itemCount])

  const renderCover = () => {
    if (cells.length === 0) {
      return (
        <div className="flex aspect-square w-full items-center justify-center bg-background">
          <Icons.add className="h-5 w-5 text-taupe" aria-hidden="true" />
        </div>
      )
    }

    const used = cells.reduce((n, c) => n + (c.kind === "outfit" ? 2 : 1), 0)
    const fillers = Array.from({ length: Math.max(0, COVER_UNITS - used) })

    // The square is enforced by the wrapper; the grid is pinned inside it.
    return (
      <div className="relative aspect-square w-full">
        {/* No gridlines between cells — the outer hairline is the only rule. */}
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 bg-background">
          {cells.map((cellData, i) => (
            <div
              key={i}
              className={cn(
                "relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-background",
                cellData.kind === "outfit" && "row-span-2",
              )}
            >
              {cellData.kind === "outfit" ? (
                // Same data path as Studio: the card fetches the outfit itself.
                // Studio's frame fitted by height keeps the figure head to toe.
                <div className="h-full" style={{ aspectRatio: FIGURE_FRAME_ASPECT }}>
                  <OutfitInspirationTile
                    preset="moodboardPreview"
                    outfitId={cellData.outfitId}
                    avatarGender={cellData.gender ?? gender ?? "female"}
                    avatarHeightCm={heightCm ?? 170}
                    wrapperClassName="h-full w-full rounded-none bg-transparent p-0"
                  />
                </div>
              ) : (
                // Same framing as ProductTile: a segmented cutout is authored on
                // the full placement canvas, so shoes are a sliver at the foot
                // of a tall transparent image and a plain <img> shows an empty
                // cell. Crop is display-only and skips real photographs.
                <GarmentImage src={cellData.url} alt="" cropToContent />
              )}
            </div>
          ))}
          {fillers.map((_, i) => (
            <div key={`fill-${i}`} className={FILLER_TONE[i % FILLER_TONE.length]} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
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
        className={cn("flex w-full flex-col gap-1.5 text-left", !isClickable && "cursor-default")}
      >
        {/* The hairline frames the cover only; name and count sit below it. */}
        <div className="overflow-hidden rounded-lg border border-hairline bg-background">{renderCover()}</div>
        <div className="flex items-baseline gap-2 px-0.5">
          <p className="min-w-0 flex-1 truncate text-card font-medium text-ink">{name}</p>
          {itemCount > 0 ? <span className="shrink-0 text-chip text-taupe">{itemCount}</span> : null}
        </div>
      </div>
    </div>
  )
}

export default MoodboardCard
