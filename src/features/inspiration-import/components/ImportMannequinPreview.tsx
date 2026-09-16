import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import { Icons } from "@/design-system/icons"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { getImportAvatarPlacementMode } from "@/features/inspiration-import/previewPlacementMode"
import { getGarmentPreviewCrop } from "@/features/inspiration-import/previewCrop"
import { resolvePreviewCategory } from "@/features/inspiration-import/previewFocus"
import type { AvatarItemBoundsFrame } from "@/features/studio/types"
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
  const renderedItems = useMemo(() => {
    const visibleInventory = bothInventory
      ? inventoryChoices
      : focusedInventory
        ? { [focusedCategory]: focusedInventory }
        : {}
    return (["top", "bottom"] as const)
      .map((category) => {
        const result = visibleInventory[category]
        return result ? mapImportResultToStudioItem(result, category) : null
      })
      .filter((item) => item !== null)
  }, [bothInventory, inventoryChoices, focusedCategory, focusedInventory])
  const avatarPlacementMode = getImportAvatarPlacementMode(renderedItems, viewerGender)
  const renderedItemSignature = renderedItems.map((item) => `${item.id}:${item.imageUrl}`).join("|")
  const [itemBoundsFrame, setItemBoundsFrame] = useState<AvatarItemBoundsFrame | null>(null)
  useEffect(() => setItemBoundsFrame(null), [avatarPlacementMode, renderedItemSignature])
  const handleItemBoundsChange = useCallback((frame: AvatarItemBoundsFrame) => {
    setItemBoundsFrame(frame)
  }, [])
  // The Web search rail shows its own pick as a full photo over the mannequin. Nothing about
  // renderedItems above changes because of it, so closing Web search always uncovers the same
  // mannequin render that was there before.
  const webResult = resultsSource === "web" ? activeWebChoice : null
  const mannequinCropClass = bothInventory || !focusedInventory
    ? "inset-0"
    : focusedCategory === "top"
      ? "-inset-x-[28%] -bottom-[62%] top-[-8%]"
      : "-inset-x-[28%] -top-[58%] bottom-[-12%]"
  const dynamicCrop = !bothInventory && focusedInventory
    ? getGarmentPreviewCrop(itemBoundsFrame, focusedInventory.id, focusedCategory)
    : null
  const mannequinCropStyle: CSSProperties | undefined = dynamicCrop ? {
    top: `${dynamicCrop.topPercent}%`,
    right: `${dynamicCrop.rightPercent}%`,
    bottom: `${dynamicCrop.bottomPercent}%`,
    left: `${dynamicCrop.leftPercent}%`,
  } : undefined

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-control bg-white">
      {webResult ? (
        <div className="h-full w-full bg-white">
          <img
            src={webResult.imageUrl}
            alt={webResult.title}
            className="h-full w-full object-cover object-center"
          />
        </div>
      ) : renderedItems.length === 0 ? (
        // Nothing to preview yet (no pick, or the focused category has zero
        // catalogue matches) — a bare or base-item mannequin here looked like
        // a rendering glitch, since nothing was actually chosen.
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-taupe">
          <Icons.image className="h-6 w-6" aria-hidden="true" />
          <span className="text-chip">no match yet</span>
        </div>
      ) : (
        <div className={`absolute transition-[inset] duration-200 ${mannequinCropClass}`} style={mannequinCropStyle}>
          <OutfitInspirationTile
            preset="heroCanonical"
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
      )}
    </div>
  )
}
