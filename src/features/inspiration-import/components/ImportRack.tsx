import { Icons } from "@/design-system/icons"
import { ProductTile } from "@/design-system/primitives"
import { cn } from "@/lib/utils"
import type { InspirationCatalogueResult, InspirationWebResult } from "@/services/inspirationImport/types"

/**
 * V2 Find items · Catalogue / Web search — the import rack.
 *
 * Catalogue: a two-column grid of photo-only tiles with a heart top-right; the
 * chosen tile takes the violet border. Web: two offset columns of 4:5 tiles,
 * each named with a link-out; no hearts, because an online listing has no
 * product to save. Picks are retained per source by the screen.
 */

type CatalogueProps = {
  kind: "catalogue"
  results: InspirationCatalogueResult[]
  selectedId: string | null
  isFavorite: (id: string) => boolean
  isSaving?: boolean
  /** Adds a violet tick over the chosen tile, for racks where the border alone is too quiet. */
  markSelected?: boolean
  onSelect: (result: InspirationCatalogueResult) => void
  onToggleFavorite: (id: string, nextSaved: boolean, position: number) => void
}

type WebProps = {
  kind: "web"
  results: InspirationWebResult[]
  selectedId: string | null
  // Listings already sent to the Atlyr team. Once a garment has one, the rest of its rack is locked.
  addedIds: ReadonlySet<string>
  locked: boolean
  onSelect: (result: InspirationWebResult) => void
}

export function ImportRack(props: CatalogueProps | WebProps) {
  if (props.kind === "catalogue") {
    const { results, selectedId, isFavorite, markSelected, onSelect, onToggleFavorite } = props
    return (
      <div className="grid grid-cols-2 content-start gap-2 px-4 pt-2">
        {results.map((result, position) => {
          const favorite = isFavorite(result.id)
          const selected = selectedId === result.id
          return (
            <div key={result.id} className="relative">
              <ProductTile
                size="small"
                title={result.title}
                imageSrc={result.thumbnailSrc}
                worn={selected}
                saved={favorite}
                onSelect={() => onSelect(result)}
                onToggleSave={() => onToggleFavorite(result.id, !favorite, position)}
              />
              {markSelected && selected ? (
                // Taps still reach the heart beneath it, so the tick costs no action.
                <span className="pointer-events-none absolute right-0 top-0 flex h-8 w-8 items-center justify-center">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet text-white">
                    <Icons.check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  const { results, selectedId, addedIds, locked, onSelect } = props
  // Two offset columns, like the design: odd items start half a tile lower.
  const columns: [InspirationWebResult[], InspirationWebResult[]] = [[], []]
  results.forEach((result, index) => columns[index % 2].push(result))

  return (
    <div className="flex items-start gap-2 px-4 pt-2">
      {columns.map((column, columnIndex) => (
        <div key={columnIndex} className={cn("flex min-w-0 flex-1 flex-col gap-2.5", columnIndex === 1 && "mt-6")}>
          {column.map((result) => {
            const added = addedIds.has(result.providerResultId)
            const selected = !added && selectedId === result.providerResultId
            const disabled = added || locked
            return (
              <div key={result.id} className={cn("flex flex-col gap-1.5", locked && !added && "opacity-50")}>
                <button
                  type="button"
                  aria-label={added ? `${result.title} added to Atlyr` : `${selected ? "Deselect" : "Select"} ${result.title}`}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onSelect(result)}
                  className={cn(
                    "relative aspect-[4/5] w-full overflow-hidden rounded-chip bg-white",
                    selected || added ? "border border-violet" : "border border-hairline",
                  )}
                >
                  <img src={result.imageUrl} alt={result.title} className="h-full w-full object-contain" />
                  {added ? (
                    <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-violet text-white">
                      <Icons.check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  ) : null}
                </button>
                <div className="flex items-start gap-1">
                  <span className="min-w-0 flex-1 text-chip font-medium leading-snug text-ink">
                    {result.title}
                    {result.merchantDomain ? <span className="text-taupe"> · {result.merchantDomain}</span> : null}
                  </span>
                  <a
                    href={result.listingUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${result.title} on ${result.merchantDomain}`}
                    onClick={(event) => event.stopPropagation()}
                    className="-mr-1.5 -mt-1.5 flex h-7 w-7 flex-none items-center justify-center text-ink"
                  >
                    <Icons.openList className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
