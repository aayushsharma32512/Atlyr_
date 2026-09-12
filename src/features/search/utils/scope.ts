import type { StudioProductTraySlot } from "@/services/studio/studioService"

export type SearchScope = "looks" | "tops" | "lowers" | "kicks"
export type SearchMode = "products" | "outfits"

export const SEARCH_SCOPES: SearchScope[] = ["looks", "tops", "lowers", "kicks"]

export const SCOPE_LABELS: Record<SearchScope, string> = {
  looks: "Looks",
  tops: "Tops",
  lowers: "Lowers",
  kicks: "Kicks",
}

const SCOPE_SLOT: Record<Exclude<SearchScope, "looks">, StudioProductTraySlot> = {
  tops: "top",
  lowers: "bottom",
  kicks: "shoes",
}

export function isSearchScope(value: string | null | undefined): value is SearchScope {
  return value === "looks" || value === "tops" || value === "lowers" || value === "kicks"
}

export function scopeToSlot(scope: SearchScope): StudioProductTraySlot | null {
  return scope === "looks" ? null : SCOPE_SLOT[scope]
}

export function slotToScope(slot: StudioProductTraySlot): SearchScope {
  return slot === "top" ? "tops" : slot === "bottom" ? "lowers" : "kicks"
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
