import { useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Icons } from "@/design-system/icons"
import { OutfitInspirationTile } from "@/design-system/primitives"
import type { MoodboardPreview } from "@/services/collections/collectionsService"
import { CANONICAL_HERO_RENDER_BOX } from "@/features/studio/constants/renderBox"

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
const FILLER_TONE = ["bg-editorial", "bg-skeleton", "bg-muted", "bg-warp"]
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
  const isClickable = Boolean(slug) && itemCount > 0

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
    navigate(`/home?${new URLSearchParams({ moodboard: slug }).toString()}`)
  }, [navigate, slug])

  const renderCover = () => {
    if (cells.length === 0) {
      return (
        <div className="flex aspect-square w-full items-center justify-center bg-skeleton">
          <Icons.add className="h-5 w-5 text-taupe" aria-hidden="true" />
        </div>
      )
    }

    const used = cells.reduce((n, c) => n + (c.kind === "outfit" ? 2 : 1), 0)
    const fillers = Array.from({ length: Math.max(0, COVER_UNITS - used) })

    // The square is enforced by the wrapper; the grid is pinned inside it.
    return (
      <div className="relative aspect-square w-full">
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-[2px] bg-hairline">
          {cells.map((cellData, i) => (
            <div
              key={i}
              className={cn(
                "flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-skeleton",
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
                <img
                  src={cellData.url}
                  alt=""
                  loading="lazy"
                  className="max-h-full max-w-full object-contain p-1"
                />
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
    <div className={`pin-tilt-${(index % 6) + 1}`}>
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
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-lg border border-hairline bg-card text-left",
          !isClickable && "cursor-default",
        )}
      >
        {renderCover()}
        <div className="flex h-10 items-center border-t border-hairline px-2">
          <p className="min-w-0 truncate text-card font-semibold text-ink">{name}</p>
        </div>
      </div>
    </div>
  )
}

export default MoodboardCard
