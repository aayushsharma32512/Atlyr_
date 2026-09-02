import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { InspirationCatalogueResult } from "@/services/inspirationImport/types"

type Props = {
  results: InspirationCatalogueResult[]
  previewId: string | null
  selectedIds: Set<string>
  onPreview: (id: string) => void
  onToggle: (id: string) => void
}

export function CatalogueMatchRack({
  results,
  previewId,
  selectedIds,
  onPreview,
  onToggle,
}: Props) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-2">
      <div className="flex w-max gap-2.5">
        {results.map((result) => {
          const selected = selectedIds.has(result.id)
          const previewed = previewId === result.id
          return (
            <article
              key={result.id}
              className={cn(
                "relative w-28 overflow-hidden rounded-[7px] border-2 bg-card p-1 sm:w-40",
                previewed ? "border-terracotta" : "border-hairline",
              )}
            >
              <button type="button" className="block w-full" onClick={() => onPreview(result.id)}>
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
                aria-label={selected ? `Remove ${result.title} from Wardrobe selection` : `Add ${result.title} to Wardrobe`}
                aria-pressed={selected}
                onClick={() => onToggle(result.id)}
                className={cn(
                  "absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border text-[10px] transition-colors",
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : "border-hairline bg-background/95 text-foreground",
                )}
              >
                <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-35")} />
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}
