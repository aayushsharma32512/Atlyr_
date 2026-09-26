import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Loader2 } from "lucide-react"
import { Icons } from "@/design-system/icons"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { getImportAvatarPlacementMode } from "@/features/inspiration-import/previewPlacementMode"
import {
  getGarmentPreviewCrop,
  isBoundsFrameFor,
  type PreviewCropInsets,
} from "@/features/inspiration-import/previewCrop"
import { resolvePreviewCategory } from "@/features/inspiration-import/previewFocus"
import { STUDIO_BASE_ITEMS_ENABLED, usePlaceholderItems } from "@/features/studio/hooks/usePlaceholderItems"
import { hidesBottomPlaceholder } from "@/features/studio/utils/layerOrder"
import type { AvatarItemBoundsFrame } from "@/features/studio/types"
import { cn } from "@/lib/utils"
import { mapImportResultToStudioItem } from "@/services/inspirationImport/mappers"
import type {
  InspirationCatalogueResult,
  InspirationCategory,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

type Props = {
  // Drives the mannequin. Only an Inventory pick (selectInventoryResult in the screen) changes
  // this. Web search never writes to it, so leaving Web search always returns to this same render.
  inventoryChoices: Partial<Record<InspirationCategory, InspirationCatalogueResult | null>>
  activeCategory: InspirationCategory
  // The Web pick for the category currently open, if any. Only changes what the top card shows.
  activeWebChoice: InspirationWebResult | null
  resultsSource: "inventory" | "web"
}

export function ImportMannequinPreview({ inventoryChoices, activeCategory, activeWebChoice, resultsSource }: Props) {
  const { gender, heightCm } = useProfileContext()
  const viewerGender = gender ?? "female"
  const bothInventory = Boolean(inventoryChoices.top) && Boolean(inventoryChoices.bottom)
  const focusedCategory = resolvePreviewCategory(activeCategory, inventoryChoices)
  const focusedInventory = inventoryChoices[focusedCategory] ?? null
  const { top: placeholderTop, bottom: placeholderBottom } = usePlaceholderItems(viewerGender)
  const renderedItems = useMemo(() => {
    const visibleInventory = bothInventory
      ? inventoryChoices
      : focusedInventory
        ? { [focusedCategory]: focusedInventory }
        : {}
    const picked = (["top", "bottom"] as const)
      .map((category) => {
        const result = visibleInventory[category]
        return result ? mapImportResultToStudioItem(result, category) : null
      })
      .filter((item) => item !== null)
    if (!STUDIO_BASE_ITEMS_ENABLED || picked.length !== 1) return picked
    // One zone dressed: stand in for the other, or the mannequin's baked-in underwear shows.
    const top = inventoryChoices.top
    const coversHips = hidesBottomPlaceholder({ typeCategory: top?.type_category, productName: top?.title })
    const standIn = picked[0].zone === "top" ? (coversHips ? null : placeholderBottom) : placeholderTop
    return standIn ? [...picked, standIn] : picked
  }, [bothInventory, inventoryChoices, focusedCategory, focusedInventory, placeholderBottom, placeholderTop])
  const avatarPlacementMode = getImportAvatarPlacementMode(renderedItems, viewerGender)
  // The Web search rail shows its own pick as a full photo over the mannequin. Nothing about
  // renderedItems above changes because of it, so closing Web search always uncovers the same
  // mannequin render that was there before.
  const webResult = resultsSource === "web" ? activeWebChoice : null

  // The crop that is painted belongs to the last render that finished with every garment placed and
  // measured. The renderer keeps its last composite on screen until the next one is drawn, so the
  // crop must wait for the same moment — moving it first showed the previous figure un-zoomed, then
  // the base layer, then the new garment.
  const [shownFrame, setShownFrame] = useState<{ crop: PreviewCropInsets | null } | null>(null)
  const nextFrame = useRef({ itemIds: [] as string[], cropItemId: null as string | null, cropCategory: focusedCategory })
  nextFrame.current = {
    itemIds: renderedItems.map((item) => item.id),
    cropItemId: !bothInventory && focusedInventory ? focusedInventory.id : null,
    cropCategory: focusedCategory,
  }
  // Clearing every pick unmounts the figure, which throws away the composite it was holding, so
  // the next render has no earlier frame to sit behind.
  const hasItems = renderedItems.length > 0
  useEffect(() => {
    if (!hasItems) setShownFrame(null)
  }, [hasItems])
  const handleItemBoundsChange = useCallback((frame: AvatarItemBoundsFrame) => {
    const { itemIds, cropItemId, cropCategory } = nextFrame.current
    if (!isBoundsFrameFor(frame, itemIds)) return
    setShownFrame({ crop: cropItemId ? getGarmentPreviewCrop(frame, cropItemId, cropCategory) : null })
  }, [])

  const crop = shownFrame?.crop ?? null
  const mannequinCropStyle: CSSProperties | undefined = crop ? {
    top: `${crop.topPercent}%`,
    right: `${crop.rightPercent}%`,
    bottom: `${crop.bottomPercent}%`,
    left: `${crop.leftPercent}%`,
  } : undefined

  // Nothing to preview yet (no pick, the focused category has zero catalogue matches, or the first
  // render is still in progress) — a bare or base-item mannequin here looked like a rendering
  // glitch, since nothing was actually chosen.
  const placeholder = (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-taupe">
      {hasItems ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <>
          <Icons.image className="h-6 w-6" aria-hidden="true" />
          <span className="text-chip">no match yet</span>
        </>
      )}
    </div>
  )

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-control bg-white">
      {hasItems ? (
        <div
          className={cn("absolute", !crop && "inset-0", !shownFrame && "invisible")}
          style={mannequinCropStyle}
        >
          <OutfitInspirationTile
            preset="heroCanonical"
            // The box is too small to show the 2K upgrade; the webp is the final texture here.
            textureQuality="thumbnail"
            renderedItems={renderedItems}
            title="Garment preview"
            avatarGender={viewerGender}
            avatarHeightCm={heightCm ?? undefined}
            allowEmptyMannequin={false}
            avatarPlacementMode={avatarPlacementMode}
            onItemBoundsChange={handleItemBoundsChange}
            wrapperClassName="h-full w-full"
            cardClassName="h-full w-full"
          />
        </div>
      ) : null}
      {hasItems && shownFrame ? null : placeholder}
      {/* The Web photo covers the figure rather than replacing it, so the figure keeps the composite
          it has already drawn and closing Web search uncovers it with no rebuild. */}
      {webResult ? (
        <img
          src={webResult.imageUrl}
          alt={webResult.title}
          className="absolute inset-0 h-full w-full bg-white object-cover object-center"
        />
      ) : null}
    </div>
  )
}
