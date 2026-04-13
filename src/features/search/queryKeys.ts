type Gender = "male" | "female" | null

const serializeFilters = (filters: unknown) => JSON.stringify(filters ?? {})

export const searchKeys = {
  all: ["search"] as const,
  browseCollections: (gender: Gender) => [...searchKeys.all, "browse-collections", gender ?? "neutral"] as const,
  outfitResults: (params: { query: string; gender: Gender; filters: unknown }) =>
    [...searchKeys.all, "outfits", params.query, params.gender ?? "neutral", serializeFilters(params.filters)] as const,
  
  // Include filters in the query key
  productResults: (params: { query: string; filters: unknown }) =>
    [...searchKeys.all, "products", params.query, serializeFilters(params.filters)] as const,
    
  productFilterOptions: (typeFilters?: string[]) => 
    [...searchKeys.all, "product-filter-options", JSON.stringify(typeFilters ?? [])] as const,
  uploadImage: () => [...searchKeys.all, "upload-image"] as const,
}
