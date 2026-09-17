import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { CANONICAL_HERO_RENDER_BOX } from "@/features/studio/constants/renderBox"
import type { OutfitComposite, ReviewQueueOutfit } from "@/services/admin-inventory/outfitReviewService"

interface OutfitCardProps {
    outfit: ReviewQueueOutfit
    composite?: OutfitComposite
    categoryName?: string
    onSelect: () => void
}

// Studio's frame, fitted by height, keeps the figure head to toe — same ratio the consumer feed uses.
const FIGURE_ASPECT = `${CANONICAL_HERO_RENDER_BOX.width} / ${CANONICAL_HERO_RENDER_BOX.height}`

/** Grid tile: the outfit rendered on the mannequin (thumbnail-quality WebP only), name, category. */
export function OutfitCard({ outfit, composite, categoryName, onSelect }: OutfitCardProps) {
    return (
        <button type="button" onClick={onSelect} className="flex w-full flex-col gap-1.5 text-left">
            <div className="relative flex h-72 w-full items-center justify-center overflow-hidden rounded-lg border border-hairline bg-background sm:h-80">
                <div className="h-full" style={{ aspectRatio: FIGURE_ASPECT }}>
                    <OutfitInspirationTile
                        preset="moodboardPreview"
                        renderedItems={composite?.renderedItems ?? []}
                        avatarGender={composite?.avatarGender ?? "female"}
                        allowEmptyMannequin
                        wrapperClassName="h-full w-full rounded-none bg-transparent p-0"
                    />
                </div>
            </div>
            <p className="truncate text-sm font-medium text-foreground">{outfit.name}</p>
            {categoryName ? <p className="truncate text-xs text-muted-foreground">{categoryName}</p> : null}
        </button>
    )
}
