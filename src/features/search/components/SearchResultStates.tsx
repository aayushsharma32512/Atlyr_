import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

const CARD_HEIGHT = { products: "h-[215px]", outfits: "h-[250px]" } as const

/** Four shimmer blocks in the results grid shape. */
export function ResultsSkeleton({ kind, count = 4 }: { kind: "products" | "outfits"; count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn("skeleton-shimmer rounded-lg", CARD_HEIGHT[kind])} />
      ))}
    </div>
  )
}

/** Nothing matched: the query repeated, and Find items as a dashed door to the web. */
export function NoResultsCard({ query, onFindItems }: { query: string; onFindItems: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-hairline-dashed bg-card/45 px-4 py-6 text-center">
      <span className="max-w-full truncate text-label font-semibold text-ink">{query.trim() || "This photo"}</span>
      <button
        type="button"
        onClick={onFindItems}
        className="inline-flex h-control-secondary items-center gap-2 whitespace-nowrap rounded-control border border-dashed border-ink bg-card px-4 text-label font-semibold text-ink"
      >
        <Icons.findItems className="h-5 w-5" aria-hidden="true" />
        Find items
      </button>
    </div>
  )
}

/** The request failed: a restore icon alone offers the retry. */
export function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-hairline bg-muted px-4 py-6">
      <button
        type="button"
        aria-label="Try again"
        onClick={onRetry}
        className="flex h-control-secondary w-10 items-center justify-center rounded-control border border-ink bg-card text-ink"
      >
        <Icons.restore className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  )
}
