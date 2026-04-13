import {
  mapTrayItemToAlternative,
  type StudioAlternativeProduct,
  type StudioProductTrayItem,
  type StudioProductTraySlot,
} from "@/services/studio/studioService"

export function upsertTrayItem(items: StudioProductTrayItem[], replacement: StudioProductTrayItem) {
  const index = items.findIndex((item) => item.slot === replacement.slot)
  if (index === -1) {
    return [...items, replacement]
  }
  const next = [...items]
  next[index] = replacement
  return next
}

export function toTrayItem(slot: StudioProductTraySlot, product: StudioAlternativeProduct): StudioProductTrayItem {
  return {
    slot,
    productId: product.id,
    title: product.title,
    brand: product.brand ?? null,
    price: product.price ?? 0,
    currency: product.currency ?? "INR",
    productUrl: product.productUrl ?? null,
    rating: null,
    reviewCount: null,
    imageUrl: product.imageSrc ?? null,
    placementX: product.placementX,
    placementY: product.placementY,
    imageLength: product.imageLength,
    color: product.color ?? null,
    size: product.size ?? null,
    itemType: product.itemType ?? slot,
    metadataSource: product.metadataSource ?? "default",
    fitTags: [],
    feelTags: [],
    vibeTags: [],
    care: null,
    materialType: null,
    bodyPartsVisible: product.bodyPartsVisible ?? null,
  }
}

export function injectDisplacedAlternative(
  list: StudioAlternativeProduct[],
  displacedItem: StudioProductTrayItem | null,
) {
  if (!displacedItem) {
    return list
  }
  const displacedAlternative = mapTrayItemToAlternative(displacedItem)
  const withoutDuplicate = list.filter((alt) => alt.id !== displacedAlternative.id)
  return [displacedAlternative, ...withoutDuplicate]
}
