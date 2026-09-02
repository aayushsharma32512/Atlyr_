import { useMemo } from "react"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { mapImportResultToStudioItem } from "@/services/inspirationImport/mappers"
import type {
  InspirationCatalogueResult,
  InspirationCategory,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

type Props = {
  results: Partial<Record<InspirationCategory, InspirationCatalogueResult | null>>
  webResult: InspirationWebResult | null
}

export function ImportMannequinPreview({ results, webResult }: Props) {
  const { gender, heightCm } = useProfileContext()
  const renderedItems = useMemo(() => (["top", "bottom"] as const)
    .map((category) => {
      const result = results[category]
      return result ? mapImportResultToStudioItem(result, category) : null
    })
    .filter((item) => item !== null), [results])

  return (
    <div className="warp-weft relative h-full min-h-0 overflow-hidden rounded-[7px] border border-hairline bg-card">
      {webResult ? (
        <div className="flex h-full w-full items-center justify-center bg-white p-3 sm:p-6">
          <img
            src={webResult.imageUrl}
            alt={webResult.title}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        <OutfitInspirationTile
          preset="heroCanonical"
          renderedItems={renderedItems}
          title="Garment preview"
          avatarGender={gender ?? "female"}
          avatarHeightCm={heightCm ?? undefined}
          allowEmptyMannequin
          wrapperClassName="h-full w-full"
          cardClassName="h-full w-full"
        />
      )}
      <span className="absolute left-3 top-3 rounded-[3px] border border-hairline bg-background/90 px-2 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {webResult ? "Online pick" : "On you"}
      </span>
    </div>
  )
}
