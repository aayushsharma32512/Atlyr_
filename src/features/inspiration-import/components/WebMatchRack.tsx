import { Check, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import type { InspirationWebResult } from "@/services/inspirationImport/types"

type Props = {
  results: InspirationWebResult[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function WebMatchRack({ results, selectedId, onSelect }: Props) {
  return (
    <div className="-mx-5 h-fit overflow-x-auto px-5 pb-2">
      <div className="flex w-max items-start gap-3">
        {results.map((result) => {
          const selected = selectedId === result.id
          return (
            <article key={result.id} className={cn("h-fit w-32 self-start overflow-hidden rounded-frame border bg-card sm:w-40", selected ? "border-terracotta" : "border-hairline")}>
              <button
                type="button"
                aria-label={`${selected ? "Deselect" : "Select"} ${result.title}`}
                aria-pressed={selected}
                className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terracotta"
                onClick={() => onSelect(selected ? null : result.id)}
              >
                <img src={result.imageUrl} alt={result.title} className="aspect-[5/4] w-full bg-white object-contain sm:aspect-[4/5]" />
                <div className="px-3 pt-3">
                  <p className="truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{result.merchantDomain}</p>
                  <h3 className="mt-1 line-clamp-2 text-xs font-medium leading-4 text-foreground">{result.title}</h3>
                </div>
              </button>
              <div className="space-y-2 px-3 pb-3 pt-2">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : result.id)}
                  className={cn(
                    "flex w-full items-center justify-center gap-1 rounded-frame border px-2 py-2 text-[10px] font-semibold",
                    selected ? "border-foreground bg-foreground text-background" : "border-hairline text-foreground",
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                  {selected ? "Ready to import" : "Choose this"}
                </button>
                <a href={result.listingUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-[9px] text-muted-foreground hover:text-foreground">
                  View product <ExternalLink className="size-3" />
                </a>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
