import type { OutfitItem } from "@/types"
import type { StudioProductTrayItem } from "@/services/studio/studioService"

import { ensurePlacementValue, MANNEQUIN_SEGMENT_ALIASES, MANNEQUIN_SEGMENT_NAMES, MANNEQUIN_SEGMENT_NAME_SET } from "@/features/studio/constants"
import type {
  MannequinSegmentName,
  StudioRenderedItem,
  StudioRenderedZone,
  ZoneVisibilityMap,
  StudioOutfitDTO,
  SupabaseOutfitWithProducts,
  SupabaseProductLike,
} from "@/features/studio/types"

const LEGACY_TYPE_TO_ZONE: Record<string, StudioRenderedZone> = {
  top: "top",
  bottom: "bottom",
  shoes: "shoes",
}

export function parseBodyPartsVisible(value: unknown): MannequinSegmentName[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => {
      const key = entry.trim()
      const alias = MANNEQUIN_SEGMENT_ALIASES[key]
      if (alias) {
        return alias
      }
      if (MANNEQUIN_SEGMENT_NAME_SET.has(key as MannequinSegmentName)) {
        return [key as MannequinSegmentName]
      }
      return []
    })

  return normalized.length ? normalized : null
}

export function mapSupabaseProductToStudioItem(
  zone: StudioRenderedZone,
  product: SupabaseProductLike | null,
): StudioRenderedItem | null {
  if (!product) {
    return null
  }

  const imageUrl = typeof product.image_url === "string" ? product.image_url.trim() : ""
  if (!imageUrl) {
    if (import.meta.env?.DEV) {
      console.warn("mapSupabaseProductToStudioItem: missing image_url; skipping item", {
        productId: product.id,
        zone,
      })
    }
    return null
  }
  const placementX = ensurePlacementValue(product.placement_x)
  const placementY = ensurePlacementValue(product.placement_y)
  const imageLengthCm = ensurePlacementValue(product.image_length)
  if (import.meta.env?.DEV) {
    if (product.placement_x == null || product.placement_y == null || product.image_length == null) {
      console.warn("mapSupabaseProductToStudioItem: missing placement/image_length; defaulting to 0", {
        productId: product.id,
        zone,
        placement_x: product.placement_x,
        placement_y: product.placement_y,
        image_length: product.image_length,
      })
    }
    if (!product.body_parts_visible || (Array.isArray(product.body_parts_visible) && product.body_parts_visible.length === 0)) {
      console.warn("mapSupabaseProductToStudioItem: missing body_parts_visible; masking may be incomplete", {
        productId: product.id,
        zone,
      })
    }
  }
  const gender =
    product.gender === "male" || product.gender === "female" || product.gender === "unisex"
      ? product.gender
      : null

  return {
    id: product.id,
    zone: zone ?? "top",
    imageUrl,
    placementX,
    placementY,
    imageLengthCm,
    brand: product.brand ?? null,
    productName: product.product_name ?? null,
    description: product.description ?? null,
    price: product.price ?? null,
    currency: product.currency ?? null,
    size: product.size ?? null,
    color: product.color ?? null,
    colorGroup: product.color_group ?? null,
    gender,
    productUrl: product.product_url ?? null,
    bodyPartsVisible: parseBodyPartsVisible(product.body_parts_visible),
    extras: null,
  }
}

export function mapTrayItemToStudioRenderedItem(item: StudioProductTrayItem | null): StudioRenderedItem | null {
  if (!item) {
    return null
  }

  const imageUrl = typeof item.imageUrl === "string" ? item.imageUrl.trim() : ""
  if (!imageUrl) {
    if (import.meta.env?.DEV) {
      console.warn("mapTrayItemToStudioRenderedItem: missing imageUrl; skipping item", {
        productId: item.productId,
        slot: item.slot,
      })
    }
    return null
  }

  if (import.meta.env?.DEV) {
    if (!item.bodyPartsVisible || item.bodyPartsVisible.length === 0) {
      console.warn("mapTrayItemToStudioRenderedItem: missing bodyPartsVisible; masking may be incomplete", {
        productId: item.productId,
        slot: item.slot,
      })
    }
  }

  return {
    id: item.productId,
    zone: item.slot,
    imageUrl,
    placementX: ensurePlacementValue(item.placementX),
    placementY: ensurePlacementValue(item.placementY),
    imageLengthCm: ensurePlacementValue(item.imageLength),
    brand: item.brand ?? null,
    productName: item.title ?? null,
    description: null,
    price: item.price ?? null,
    currency: item.currency ?? null,
    size: item.size ?? null,
    color: item.color ?? null,
    colorGroup: null,
    gender: null,
    productUrl: item.productUrl ?? null,
    bodyPartsVisible: parseBodyPartsVisible(item.bodyPartsVisible),
    extras: {
      trayItem: item,
    },
  }
}

export function mapLegacyOutfitItemToStudioItem(item: OutfitItem): StudioRenderedItem | null {
  const zone = LEGACY_TYPE_TO_ZONE[item.type]
  if (!zone) {
    return null
  }

  return {
    id: item.id,
    zone,
    imageUrl: item.imageUrl,
    placementX: ensurePlacementValue(item.placement_x ?? null),
    placementY: ensurePlacementValue(item.placement_y ?? null),
    imageLengthCm: ensurePlacementValue(item.image_length ?? null),
    brand: item.brand ?? null,
    productName: item.product_name ?? null,
    description: item.description ?? null,
    price: item.price ?? null,
    currency: item.currency ?? null,
    size: item.size ?? null,
    color: item.color ?? null,
    colorGroup: item.color_group ?? null,
    gender:
      item.gender === "male" || item.gender === "female" || item.gender === "unisex"
        ? item.gender
        : null,
    productUrl: item.productUrl ?? null,
    bodyPartsVisible: null,
    extras: {
      legacyOutfitItem: item,
    },
  }
}

export function mapLegacyOutfitItemsToStudioItems(items?: OutfitItem[] | null): StudioRenderedItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    return []
  }

  const mapped = items
    .map((item) => mapLegacyOutfitItemToStudioItem(item))
    .filter((entry): entry is StudioRenderedItem => Boolean(entry))

  if (import.meta.env?.DEV) {
    // Legacy path does not include body_parts_visible; prefer DTO/ Supabase data.
    console.warn("mapLegacyOutfitItemsToStudioItems used; masking may be incomplete.", {
      count: mapped.length,
    })
  }

  return mapped
}

export function studioRenderedItemToOutfitItem(item: StudioRenderedItem): OutfitItem {
  const zoneToType: Record<StudioRenderedZone, OutfitItem["type"]> = {
    top: "top",
    bottom: "bottom",
    shoes: "shoes",
  }

  return {
    id: item.id,
    type: zoneToType[item.zone],
    brand: item.brand ?? "",
    product_name: item.productName ?? null,
    size: item.size ?? "",
    price: item.price ?? 0,
    currency: item.currency ?? "INR",
    imageUrl: item.imageUrl,
    productUrl: item.productUrl ?? null,
    description: item.description ?? "",
    color: item.color ?? "",
    color_group: item.colorGroup ?? null,
    gender: item.gender,
    placement_y: item.placementY,
    placement_x: item.placementX,
    image_length: item.imageLengthCm,
  }
}

export function mergeBodyPartsVisibilityByZone(items: StudioRenderedItem[] | null | undefined): ZoneVisibilityMap {
  if (!items || items.length === 0) {
    return {}
  }

  return items.reduce<ZoneVisibilityMap>((acc, item) => {
    const next = item.bodyPartsVisible?.filter((segment): segment is MannequinSegmentName =>
      MANNEQUIN_SEGMENT_NAME_SET.has(segment),
    )
    if (!next || next.length === 0) {
      return acc
    }

    const dedupedNext = Array.from(new Set(next))
    const current = acc[item.zone]

    if (!current || current.length === 0) {
      acc[item.zone] = dedupedNext
      return acc
    }

    const intersection = current.filter((segment) => dedupedNext.includes(segment))
    acc[item.zone] = intersection.length ? intersection : dedupedNext
    return acc
  }, {})
}

export function computeOutfitVisibleSegments(items: StudioRenderedItem[] | null | undefined): MannequinSegmentName[] {
  const allSegments = MANNEQUIN_SEGMENT_NAMES
  if (!items || items.length === 0) {
    return allSegments
  }

  let constrained = false
  let intersection = new Set<MannequinSegmentName>(allSegments)

  items.forEach((item) => {
    if (item.bodyPartsVisible == null) {
      return
    }
    constrained = true
    const normalized = item.bodyPartsVisible.filter((segment): segment is MannequinSegmentName =>
      MANNEQUIN_SEGMENT_NAME_SET.has(segment),
    )
    intersection = new Set(Array.from(intersection).filter((segment) => normalized.includes(segment)))
  })

  if (!constrained) {
    return allSegments
  }

  return allSegments.filter((segment) => intersection.has(segment))
}

export function mapDbOutfitToStudioOutfit(row: SupabaseOutfitWithProducts | null): StudioOutfitDTO | null {
  if (!row) {
    return null
  }

  const zones: Array<[StudioRenderedZone, SupabaseProductLike | null | undefined]> = [
    ["top", row.top],
    ["bottom", row.bottom],
    ["shoes", row.shoes],
  ]

  const renderedItems = zones
    .map(([zone, product]) => mapSupabaseProductToStudioItem(zone, product ?? null))
    .filter((item): item is StudioRenderedItem => Boolean(item))

  const bodyPartsVisibleByZone = mergeBodyPartsVisibilityByZone(renderedItems)
  const gender =
    row.gender === "male" || row.gender === "female" || row.gender === "unisex" ? row.gender : null

  return {
    id: row.id,
    name: row.name ?? null,
    gender,
    fit: row.fit ?? null,
    feel: row.feel ?? null,
    wordAssociation: row.word_association ?? null,
    renderedItems,
    bodyPartsVisibleByZone,
    imageSrcFallback: renderedItems[0]?.imageUrl ?? null,
  }
}
