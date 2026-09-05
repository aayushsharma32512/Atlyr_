import { Check, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import type { InspirationWebResult } from "@/services/inspirationImport/types"

type Props = {
  results: InspirationWebResult[]
  selectedId: string | null
  onSelect: (result: InspirationWebResult) => void
}

export function WebMatchRack({ results, selectedId, onSelect }: Props) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-2">
      <div className="flex w-max gap-2.5">
        {results.map((result) => {
          const selected = selectedId === result.providerResultId
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
                aria-label={`${selected ? "Deselect" : "Select"} ${result.title}`}
                aria-pressed={selected}
                className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terracotta"
                onClick={() => onSelect(result)}
              >
                <span className="relative block">
                  <img src={result.imageUrl} alt={result.title} className="aspect-square w-full rounded-[4px] bg-white object-contain" />
                  {selected ? (
                    <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border border-foreground bg-foreground text-background shadow-sm">
                      <Check className="size-3.5" />
                    </span>
                  ) : null}
                </span>
                <span className="block px-2 pb-2 pt-3">
                  <span className="block truncate text-[11px] font-semibold text-foreground">{result.title}</span>
                  <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[9px] text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{result.merchantDomain}</span>
                    <span className="shrink-0 font-semibold text-foreground">{result.priceLabel || "-"}</span>
                  </span>
                </span>
              </button>
              <a
                href={result.listingUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1 border-t border-hairline px-2 py-2 text-[9px] font-medium text-muted-foreground hover:text-foreground"
              >
                View product <ExternalLink className="size-3" />
              </a>
            </article>
          )
        })}
      </div>
    </div>
  )
}
