import type { OutfitSearchFilters, ProductSearchFilters } from "@/services/search/searchService"

import { stableStringify } from "@/integrations/posthog/engagementTracking/stableStringify"

export type CanonicalFilterOperator = "eq" | "in" | "gte" | "lte" | "between" | "contains" | "exists"

export type CanonicalFilter = {
  key: string
  operator: CanonicalFilterOperator
  value: unknown
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}

function pushInFilter(filters: CanonicalFilter[], key: string, values: string[] | undefined) {
  if (!values || values.length === 0) return
  filters.push({ key, operator: "in", value: sortStrings(values) })
}

export function canonicalizeProductSearchFilters(input?: ProductSearchFilters): CanonicalFilter[] {
  const filters: CanonicalFilter[] = []
  const f = input ?? {}

  pushInFilter(filters, "typeCategories", f.typeCategories)
  pushInFilter(filters, "typeSubCategories", f.typeSubCategories)
  pushInFilter(filters, "brands", f.brands)
  pushInFilter(filters, "fits", f.fits)
  pushInFilter(filters, "feels", f.feels)
  pushInFilter(filters, "colorGroups", f.colorGroups)
  pushInFilter(filters, "sizes", f.sizes)
  pushInFilter(filters, "genders", f.genders)
  pushInFilter(filters, "categoryIds", f.categoryIds)
  pushInFilter(filters, "vibes", f.vibes)

  const min = typeof f.minPrice === "number" && Number.isFinite(f.minPrice) ? f.minPrice : undefined
  const max = typeof f.maxPrice === "number" && Number.isFinite(f.maxPrice) ? f.maxPrice : undefined
  if (min !== undefined || max !== undefined) {
    const value: { min?: number; max?: number } = {}
    if (min !== undefined) value.min = min
    if (max !== undefined) value.max = max
    // Spec requirement: encode ranges as between + {min?, max?}
    filters.push({ key: "price", operator: "between", value })
  }

  return canonicalizeFilterList(filters)
}

export function canonicalizeOutfitSearchFilters(input?: OutfitSearchFilters): CanonicalFilter[] {
  const filters: CanonicalFilter[] = []
  const f = input ?? {}

  pushInFilter(filters, "categories", f.categories)
  pushInFilter(filters, "occasions", f.occasions)
  pushInFilter(filters, "fits", f.fits)

  return canonicalizeFilterList(filters)
}

export function canonicalizeFilterList(filters: CanonicalFilter[]): CanonicalFilter[] {
  return [...filters].sort((a, b) => {
    const keyCmp = a.key.localeCompare(b.key)
    if (keyCmp !== 0) return keyCmp
    const opCmp = a.operator.localeCompare(b.operator)
    if (opCmp !== 0) return opCmp
    return stableStringify(a.value).localeCompare(stableStringify(b.value))
  })
}

export type SearchType = "text" | "image" | "both"
export type SearchMode = "outfits" | "products"
export type SearchTrigger = "query_submit" | "filters_apply" | "sort_change" | "mode_change"

export function computeSearchType(opts: { queryRaw: string; imageUrl?: string | null }): SearchType {
  const hasText = opts.queryRaw.trim().length > 0
  const hasImage = Boolean(opts.imageUrl && opts.imageUrl.trim().length > 0)
  if (hasText && hasImage) return "both"
  if (hasImage) return "image"
  return "text"
}

export function computeSearchContextSignature(input: {
  query_raw: string
  search_type: SearchType
  mode: SearchMode
  filters: CanonicalFilter[]
  sort: string
}): string {
  return stableStringify({
    query_raw: input.query_raw,
    search_type: input.search_type,
    mode: input.mode,
    filters: input.filters,
    sort: input.sort,
  })
}

