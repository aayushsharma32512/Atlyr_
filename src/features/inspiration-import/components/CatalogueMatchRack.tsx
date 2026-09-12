import { Heart } from "lucide-react"
import { cn } from "@/lib/utils"
import type { InspirationCatalogueResult } from "@/services/inspirationImport/types"

type Props = {
  results: InspirationCatalogueResult[]
  selectedId: string | null
  isFavorite: (id: string) => boolean
  isSaving?: boolean
  onSelect: (result: InspirationCatalogueResult) => void
  onToggleFavorite: (id: string, nextSaved: boolean, position: number) => void
}

export function CatalogueMatchRack({
  results,
  selectedId,
  isFavorite,
  isSaving = false,
  onSelect,
  onToggleFavorite,
}: Props) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-2">
      <div className="flex w-max gap-2.5">
        {results.map((result, position) => {
          const selected = selectedId === result.id
          const favorite = isFavorite(result.id)
          return (
            <article
              key={result.id}
              className={cn(
                "relative w-28 overflow-hidden rounded-[7px] border-2 bg-card p-1 sm:w-40",
                selected ? "border-terracotta" : "border-hairline",
              )}
            >
              <button
                type="button"
                aria-label={`${selected ? "Deselect" : "Select"} ${result.title} for Studio`}
                aria-pressed={selected}
                className="block w-full"
                onClick={() => onSelect(result)}
              >
                <img src={result.thumbnailSrc} alt={result.title} className="aspect-square w-full rounded-[4px] bg-white object-contain" />
                <span className="block px-2 pb-2 pt-3 text-left">
                  <span className="block truncate text-[11px] font-semibold text-foreground">{result.title}</span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                    <span className="truncate">{result.brand}</span>
                    <span className="shrink-0 font-semibold text-foreground">{result.priceLabel}</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={favorite ? `Remove ${result.title} from Favorites` : `Add ${result.title} to Favorites`}
                aria-pressed={favorite}
                disabled={isSaving}
                onClick={() => onToggleFavorite(result.id, !favorite, position)}
                className={cn(
                  "absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border shadow-sm transition-colors disabled:cursor-wait",
                  favorite
                    ? "border-terracotta bg-terracotta text-white"
                    : "border-white/90 bg-black/35 text-white backdrop-blur-sm hover:bg-black/50",
                )}
              >
                <Heart className={cn("size-3.5", favorite && "fill-current")} />
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}
