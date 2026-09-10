export const collectionsKeys = {
  all: ["collections"] as const,
  overview: () => [...collectionsKeys.all, "overview"] as const,
  moodboards: () => [...collectionsKeys.all, "moodboards"] as const,
  moodboardPreview: (slug: string) => [...collectionsKeys.moodboards(), "preview", slug] as const,
  collectionsMeta: () => [...collectionsKeys.all, "meta"] as const,
  createMoodboard: () => [...collectionsKeys.all, "create-moodboard"] as const,
  deleteMoodboard: () => [...collectionsKeys.all, "delete-moodboard"] as const,
  renameMoodboard: () => [...collectionsKeys.all, "rename-moodboard"] as const,
  saveToCollection: () => [...collectionsKeys.all, "save-to-collection"] as const,
  saveProductToCollection: () => [...collectionsKeys.all, "save-product-to-collection"] as const,
  removeFromCollection: () => [...collectionsKeys.all, "remove-from-collection"] as const,
  removeProductFromCollection: () => [...collectionsKeys.all, "remove-product-from-collection"] as const,
  removeOutfitFromLibrary: () => [...collectionsKeys.all, "remove-outfit-from-library"] as const,
  removeProductFromLibrary: () => [...collectionsKeys.all, "remove-product-from-library"] as const,
  productsByIds: (ids: string[]) => [...collectionsKeys.all, "products-by-ids", [...ids].sort().join(",")] as const,
  creations: (size = 20) => [...collectionsKeys.all, "creations", size] as const,
  /**
   * Every creations page, whatever its size — the key to INVALIDATE on.
   *
   * `creations()` looks size-agnostic but is not: the default fills the slot, so it
   * builds the fully-specified key for size 20. invalidateQueries matches by prefix,
   * and no live query uses 20 (the tab and the prefetcher both ask for 6), so
   * invalidating it matched nothing and the list silently kept serving cache for its
   * 30-minute staleTime. Deleting a creation left it on screen.
   */
  creationsAll: () => [...collectionsKeys.all, "creations"] as const,
  creationsCounts: () => [...collectionsKeys.all, "creations-counts"] as const,
  tryOns: (size = 20) => [...collectionsKeys.all, "try-ons", size] as const,
  /** Every try-ons page, whatever its size. Same trap as creationsAll. */
  tryOnsAll: () => [...collectionsKeys.all, "try-ons"] as const,
  favorites: () => [...collectionsKeys.all, "favorites"] as const,
  moodboardOutfits: (slug: string, size = 20) => [...collectionsKeys.all, "moodboard-outfits", slug, size] as const,
  moodboardItemsAll: () => [...collectionsKeys.all, "moodboard-items"] as const,
  moodboardItems: (slug: string, size = 20) => [...collectionsKeys.all, "moodboard-items", slug, size] as const,
  collectionProducts: (slug: string) => [...collectionsKeys.products(), "collection", slug] as const,
  products: () => [...collectionsKeys.all, "products"] as const,
  productCollectionMembership: () => [...collectionsKeys.products(), "membership"] as const,
  productFavorites: () => [...collectionsKeys.all, "product-favorites"] as const,
  trendingProducts: (gender: string | null) => [...collectionsKeys.products(), "trending", gender ?? "all"] as const,
}
