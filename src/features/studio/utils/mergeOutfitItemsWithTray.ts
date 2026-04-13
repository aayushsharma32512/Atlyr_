import type { Outfit, OutfitItem } from "@/types"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"

const SLOT_ORDER: StudioProductTraySlot[] = ["top", "bottom", "shoes"]

function normalizeSlot(type: OutfitItem["type"]): StudioProductTraySlot | null {
  if (type === "top" || type === "bottom" || type === "shoes") {
    return type
  }
  return null
}

function toOutfitItemFromTray(trayItem: StudioProductTrayItem): OutfitItem {
  return {
    id: trayItem.productId,
    type: trayItem.slot,
    brand: trayItem.brand ?? "",
    product_name: trayItem.title,
    size: trayItem.size ?? "",
    price: trayItem.price,
    currency: trayItem.currency,
    imageUrl: trayItem.imageUrl ?? "",
    productUrl: trayItem.productUrl ?? null,
    description: "",
    color: trayItem.color ?? "",
    placement_x: trayItem.placementX,
    placement_y: trayItem.placementY,
    image_length: trayItem.imageLength,
    category_id: null,
    type_category: null,
  }
}

export function mergeOutfitItemsWithTray(outfit: Outfit | null, trayItems: StudioProductTrayItem[]): OutfitItem[] {
  if (!outfit) {
    return []
  }

  const mergedItems = outfit.items.map((item) => {
    const slot = normalizeSlot(item.type)
    if (!slot) {
      return item
    }
    const override = trayItems.find((trayItem) => trayItem.slot === slot)
    if (!override) {
      return item
    }
    return {
      ...item,
      id: override.productId,
      brand: override.brand ?? item.brand,
      product_name: override.title,
      price: override.price,
      currency: override.currency,
      imageUrl: override.imageUrl ?? item.imageUrl,
      productUrl: override.productUrl ?? item.productUrl,
      placement_x: override.placementX,
      placement_y: override.placementY,
      image_length: override.imageLength,
      color: override.color ?? item.color,
      size: override.size ?? item.size,
    }
  })

  const slotsInItems = new Set<StudioProductTraySlot>()
  mergedItems.forEach((item) => {
    const slot = normalizeSlot(item.type)
    if (slot) {
      slotsInItems.add(slot)
    }
  })

  SLOT_ORDER.forEach((slot) => {
    if (slotsInItems.has(slot)) {
      return
    }
    const trayItem = trayItems.find((item) => item.slot === slot)
    if (!trayItem) {
      return
    }
    mergedItems.push(toOutfitItemFromTray(trayItem))
  })

  return mergedItems
}
