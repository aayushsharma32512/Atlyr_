import { Chip } from "@/design-system/primitives"
import { SCOPE_LABELS, SEARCH_SCOPES, type SearchScope } from "@/features/search/utils/scope"

interface SearchScopeRailProps {
  value: SearchScope
  onChange: (next: SearchScope) => void
}

/** Looks · Tops · Lowers · Kicks. One control for what the page shows and what a search returns. */
export function SearchScopeRail({ value, onChange }: SearchScopeRailProps) {
  return (
    <div role="group" aria-label="Scope" className="flex h-[34px] w-full items-center gap-2">
      {SEARCH_SCOPES.map((scope) => (
        <Chip key={scope} label={SCOPE_LABELS[scope]} active={scope === value} onClick={() => onChange(scope)} className="flex-1 justify-center rounded-[10px] px-3" />
      ))}
    </div>
  )
}
