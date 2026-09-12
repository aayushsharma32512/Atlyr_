import { cn } from "@/lib/utils"

import { OutfitCard, type OutfitCardRenderedItems } from "./outfit-card"
import { SectionHeader } from "./section-header"

export interface CuratedLook {
  id: string
  title: string
  outfitId?: string | null
  renderedItems?: OutfitCardRenderedItems
  gender?: "male" | "female"
  saved?: boolean
}

export interface CuratedRow {
  id: string
  label: string
  looks: CuratedLook[]
}

export interface CuratedCollectionRowsProps {
  rows: CuratedRow[]
  heightCm?: number
  onLookSelect?: (look: CuratedLook, row: CuratedRow) => void
  onToggleSave?: (look: CuratedLook, next: boolean) => void
  onLongPressSave?: (look: CuratedLook) => void
  className?: string
}

/** One curated collection per row: section label, then a rail of 150×210 look tiles. */
export function CuratedCollectionRows({
  rows,
  heightCm,
  onLookSelect,
  onToggleSave,
  onLongPressSave,
  className,
}: CuratedCollectionRowsProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {rows.map((row) => (
        <section key={row.id} className="flex flex-col gap-2.5">
          <SectionHeader title={row.label} className="border-t border-hairline pt-2" />
          <div className="flex gap-2 overflow-x-auto py-0.5 scrollbar-hide">
            {row.looks.map((look, index) => (
              <div key={look.id} className="h-[210px] w-[150px] shrink-0">
                <OutfitCard
                  title={look.title}
                  outfitId={look.outfitId}
                  renderedItems={look.renderedItems}
                  gender={look.gender}
                  heightCm={heightCm}
                  saved={look.saved}
                  tiltIndex={index}
                  onSelect={onLookSelect ? () => onLookSelect(look, row) : undefined}
                  onToggleSave={onToggleSave ? () => onToggleSave(look, !look.saved) : undefined}
                  onLongPressSave={onLongPressSave ? () => onLongPressSave(look) : undefined}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
