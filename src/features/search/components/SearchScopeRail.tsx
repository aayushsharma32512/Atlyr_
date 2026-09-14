import { cn } from "@/lib/utils"
import { SCOPE_LABELS, SEARCH_SCOPES, type SearchScope } from "@/features/search/utils/scope"

interface SearchScopeRailProps {
  value: SearchScope
  onChange: (next: SearchScope) => void
}

/**
 * looks · tops · lowers · kicks. One control for what the page shows and what a
 * search returns. V2 draws it as equal-width pills with an ink fill on the
 * active one — the same treatment as the Products slot selector on Boards.
 */
export function SearchScopeRail({ value, onChange }: SearchScopeRailProps) {
  return (
    <div role="group" aria-label="Scope" className="grid w-full grid-cols-4 gap-2">
      {SEARCH_SCOPES.map((scope) => {
        const isActive = scope === value
        return (
          <button
            key={scope}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(scope)}
            className={cn(
              "flex h-8 items-center justify-center rounded-control text-chip font-medium transition-colors",
              isActive ? "bg-charcoal text-white" : "border border-hairline bg-white text-ink",
            )}
          >
            {SCOPE_LABELS[scope]}
          </button>
        )
      })}
    </div>
  )
}
