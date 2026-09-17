export const adminInventoryQueryKeys = {
    all: ["admin-inventory"] as const,
    products: () => [...adminInventoryQueryKeys.all, "products"] as const,
    productsBrowse: (params: { q: string; gender: string; type: string }) =>
        [...adminInventoryQueryKeys.products(), "browse", params.q, params.gender, params.type] as const,
    outfitCount: (productId: string) => [...adminInventoryQueryKeys.products(), "outfit-count", productId] as const,
    outfits: () => [...adminInventoryQueryKeys.all, "outfits"] as const,
    reviewQueue: (categoryId: string | null) =>
        [...adminInventoryQueryKeys.outfits(), "queue", categoryId ?? "all"] as const,
    outfitsBrowse: (params: { visible: boolean; q: string; categoryId: string | null }) =>
        [
            ...adminInventoryQueryKeys.outfits(),
            "browse",
            params.visible,
            params.q,
            params.categoryId ?? "all",
        ] as const,
    categories: () => [...adminInventoryQueryKeys.all, "categories"] as const,
}
