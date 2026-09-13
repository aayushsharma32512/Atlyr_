import type { StudioProductTraySlot } from "@/services/studio/studioService"

export type SearchScope = "looks" | "tops" | "lowers"
export type SearchMode = "products" | "outfits"

// Kicks (shoes) was dropped from the rail on 2026-09-13; the URL value stays `looks` for outfits.
export const SEARCH_SCOPES: SearchScope[] = ["looks", "tops", "lowers"]

export const SCOPE_LABELS: Record<SearchScope, string> = {
  looks: "Outfits",
  tops: "Tops",
  lowers: "Lowers",
}

const SCOPE_SLOT: Record<Exclude<SearchScope, "looks">, StudioProductTraySlot> = {
  tops: "top",
  lowers: "bottom",
}

export function isSearchScope(value: string | null | undefined): value is SearchScope {
  return value === "looks" || value === "tops" || value === "lowers"
}

export function scopeToSlot(scope: SearchScope): StudioProductTraySlot | null {
  return scope === "looks" ? null : SCOPE_SLOT[scope]
}

/** Null for a slot the rail does not offer (shoes). */
export function slotToScope(slot: StudioProductTraySlot): SearchScope | null {
  return slot === "top" ? "tops" : slot === "bottom" ? "lowers" : null
}

export function scopeToMode(scope: SearchScope): SearchMode {
  return scope === "looks" ? "outfits" : "products"
}

/** `scope` wins; an old `mode`-only link maps products→tops, outfits→looks. */
export function resolveScope(params: URLSearchParams): SearchScope {
  const scope = params.get("scope")
  if (isSearchScope(scope)) return scope
  return params.get("mode") === "products" ? "tops" : "looks"
}
