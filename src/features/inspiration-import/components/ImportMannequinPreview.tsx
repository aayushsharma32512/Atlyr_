import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { getImportAvatarPlacementMode } from "@/features/inspiration-import/previewPlacementMode"
import { getGarmentPreviewCrop } from "@/features/inspiration-import/previewCrop"
import { resolvePreviewCategory } from "@/features/inspiration-import/previewFocus"
import type { InspirationResultChoice } from "@/features/inspiration-import/selectionTransitions"
import type { AvatarItemBoundsFrame } from "@/features/studio/types"
import { mapImportResultToStudioItem } from "@/services/inspirationImport/mappers"
import type {
  InspirationCategory,
} from "@/services/inspirationImport/types"

type Props = {
  choices: Partial<Record<InspirationCategory, InspirationResultChoice | null>>
  activeCategory: InspirationCategory
  resultsSource: "inventory" | "web"
}

export function ImportMannequinPreview({ choices, activeCategory, resultsSource }: Props) {
  const { gender, heightCm } = useProfileContext()
  const viewerGender = gender ?? "female"
  const bothInventory = choices.top?.source === "inventory" && choices.bottom?.source === "inventory"
  const focusedCategory = resolvePreviewCategory(activeCategory, choices)
  const focusedChoice = choices[focusedCategory] ?? null
  const focusedInventory = focusedChoice?.source === "inventory" ? focusedChoice : null
  const renderedItems = useMemo(() => {
    const visibleInventory = bothInventory
      ? choices
      : focusedInventory
        ? { [focusedCategory]: focusedInventory }
        : {}
    return (["top", "bottom"] as const)
      .map((category) => {
        const choice = visibleInventory[category]
        return choice?.source === "inventory" ? mapImportResultToStudioItem(choice.result, category) : null
      })
      .filter((item) => item !== null)
  }, [bothInventory, choices, focusedCategory, focusedInventory])
  const avatarPlacementMode = getImportAvatarPlacementMode(renderedItems, viewerGender)
  const renderedItemSignature = renderedItems.map((item) => `${item.id}:${item.imageUrl}`).join("|")
  const [itemBoundsFrame, setItemBoundsFrame] = useState<AvatarItemBoundsFrame | null>(null)
  useEffect(() => setItemBoundsFrame(null), [avatarPlacementMode, renderedItemSignature])
  const handleItemBoundsChange = useCallback((frame: AvatarItemBoundsFrame) => {
    setItemBoundsFrame(frame)
  }, [])
  // A web choice is only allowed to replace the mannequin while the Web search rail is visible.
  // This also makes the optimistic Inventory transition immune to a delayed persistence response.
  const webResult = resultsSource === "web" && !bothInventory && focusedChoice?.source === "web"
    ? focusedChoice.result
    : null
  const mannequinCropClass = bothInventory || !focusedInventory
    ? "inset-0"
    : focusedCategory === "top"
      ? "-inset-x-[28%] -bottom-[62%] top-[-8%]"
      : "-inset-x-[28%] -top-[58%] bottom-[-12%]"
  const dynamicCrop = !bothInventory && focusedInventory
    ? getGarmentPreviewCrop(itemBoundsFrame, focusedInventory.result.id, focusedCategory)
    : null
  const mannequinCropStyle: CSSProperties | undefined = dynamicCrop ? {
    top: `${dynamicCrop.topPercent}%`,
    right: `${dynamicCrop.rightPercent}%`,
    bottom: `${dynamicCrop.bottomPercent}%`,
    left: `${dynamicCrop.leftPercent}%`,
  } : undefined

  return (
    <div className="warp-weft relative h-full min-h-0 overflow-hidden rounded-[7px] border border-hairline bg-card">
      {webResult ? (
        <div className="h-full w-full bg-white">
          <img
            src={webResult.imageUrl}
            alt={webResult.title}
            className="h-full w-full object-cover object-center"
          />
        </div>
      ) : (
        <div className={`absolute transition-[inset] duration-200 ${mannequinCropClass}`} style={mannequinCropStyle}>
          <OutfitInspirationTile
            preset="heroCanonical"
            renderedItems={renderedItems}
            title="Garment preview"
            avatarGender={viewerGender}
            avatarHeightCm={heightCm ?? undefined}
            allowEmptyMannequin
            avatarPlacementMode={avatarPlacementMode}
            onItemBoundsChange={handleItemBoundsChange}
            wrapperClassName="h-full w-full"
            cardClassName="h-full w-full"
          />
        </div>
      )}
      <span className="absolute left-3 top-3 rounded-[3px] border border-hairline bg-background/90 px-2 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {webResult ? "Online pick" : "On you"}
      </span>
    </div>
  )
}
