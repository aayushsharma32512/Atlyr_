import type { StudioProductTraySlot } from "@/services/studio/studioService"

export const studioKeys = {
  all: ["studio"] as const,
  outfit: (outfitId: string | null | undefined) => [...studioKeys.all, "outfit", outfitId ?? "none"] as const,
  productTray: (outfitId: string | null | undefined) => [...studioKeys.all, "product-tray", outfitId ?? "none"] as const,
  hero: (outfitId: string | null | undefined, slot: string | null | undefined) =>
    [...studioKeys.all, "hero-product", outfitId ?? "none", slot ?? "none"] as const,
  alternatives: (args: { outfitId: string | null | undefined; slot: string | null | undefined; gender: string | null }) =>
    [...studioKeys.all, "alternatives", args.outfitId ?? "none", args.slot ?? "none", args.gender ?? "neutral"] as const,
  productOutfits: (
    productId: string | null | undefined,
    slot: StudioProductTraySlot | null | undefined,
    gender: string | null | undefined,
  ) => [...studioKeys.all, "product-outfits", productId ?? "none", slot ?? "none", gender ?? "neutral"] as const,
  outfitComplementaryProducts: (
    productId: string | null | undefined,
    slot: StudioProductTraySlot | null | undefined,
    limit: number,
    gender: string | null | undefined,
  ) =>
    [
      ...studioKeys.all,
      "outfit-complementary-products",
      productId ?? "none",
      slot ?? "none",
      limit,
      gender ?? "neutral",
    ] as const,
  product: (productId: string | null | undefined) => [...studioKeys.all, "product", productId ?? "none"] as const,
  similarProducts: (productId: string | null | undefined) => [...studioKeys.all, "similar-products", productId ?? "none"] as const,
  complementaryProducts: (productId: string | null | undefined, gender: string | null | undefined) =>
    [...studioKeys.all, "complementary-products", productId ?? "none", gender ?? "neutral"] as const,
  categoryOutfits: (category: string | null | undefined, gender?: string | null) =>
    [...studioKeys.all, "category-outfits", category ?? "none", gender ?? "neutral"] as const,
  mannequin: (gender: "male" | "female" | null | undefined, bodyType: string | null | undefined) =>
    [...studioKeys.all, "mannequin", gender ?? "neutral", bodyType ?? "default"] as const,
  outfitProducts: (outfitId: string | null | undefined) =>
    [...studioKeys.all, "outfit-products", outfitId ?? "none"] as const,
  searchAlternatives: (args: {
    slot: string
    query: string
    imageUrl: string | null
    filtersHash: string
    gender: string | null
  }) =>
    [
      ...studioKeys.all,
      "search-alternatives",
      args.slot,
      args.query || "none",
      args.imageUrl || "none",
      args.filtersHash || "none",
      args.gender ?? "neutral",
    ] as const,
  swap: (outfitId: string | null | undefined) => [...studioKeys.all, "swap", outfitId ?? "none"] as const,
  productImages: (productId: string | null | undefined) => [...studioKeys.all, "product-images", productId ?? "none"] as const,
}
