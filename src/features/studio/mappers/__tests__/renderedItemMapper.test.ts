import { describe, expect, it } from "@jest/globals"

import type { OutfitItem } from "@/types"
import {
  computeOutfitVisibleSegments,
  mapLegacyOutfitItemToStudioItem,
  mapLegacyOutfitItemsToStudioItems,
  mapSupabaseProductToStudioItem,
  mergeBodyPartsVisibilityByZone,
  parseBodyPartsVisible,
  studioRenderedItemToOutfitItem,
} from "@/features/studio/mappers/renderedItemMapper"
import type { StudioRenderedItem, SupabaseProductLike } from "@/features/studio/types"

describe("parseBodyPartsVisible", () => {
  it("returns null for non-array inputs", () => {
    expect(parseBodyPartsVisible(null)).toBeNull()
    expect(parseBodyPartsVisible("head")).toBeNull()
  })

  it("filters unknown segments while keeping valid entries", () => {
    expect(parseBodyPartsVisible(["head", "torso", "unknown"])).toEqual(["head", "torso"])
  })

  it("normalizes whitespace and aliases", () => {
    expect(parseBodyPartsVisible([" head ", "arms"])).toEqual(["head", "arm_left", "arm_right"])
  })
})

describe("mapSupabaseProductToStudioItem", () => {
  it("maps supabase rows into studio items with placement defaults", () => {
    const product: SupabaseProductLike = {
      id: "prod-1",
      product_name: "Top",
      brand: "Atlyr",
      price: 1299,
      currency: "INR",
      image_url: "https://example.com/top.png",
      placement_x: null,
      placement_y: 25,
      image_length: null,
      body_parts_visible: ["head", "torso"],
    }

    const result = mapSupabaseProductToStudioItem("top", product)
    expect(result).toMatchObject({
      id: "prod-1",
      zone: "top",
      placementX: 0,
      placementY: 25,
      imageLengthCm: 0,
      bodyPartsVisible: ["head", "torso"],
    })
  })
})

describe("mapLegacyOutfitItemsToStudioItems", () => {
  it("drops unsupported item types while normalizing placement defaults", () => {
    const legacyTop: OutfitItem = {
      id: "legacy-top",
      type: "top",
      brand: "Legacy",
      product_name: "Legacy Top",
      size: "M",
      price: 1999,
      currency: "INR",
      imageUrl: "https://example.com/legacy-top.png",
      description: "Legacy description",
      color: "Blue",
      placement_y: null,
      placement_x: 12,
      image_length: null,
    }
    const accessory: OutfitItem = {
      ...legacyTop,
      id: "legacy-bag",
      type: "accessory",
    }
    const result = mapLegacyOutfitItemsToStudioItems([legacyTop, accessory])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: "legacy-top",
      zone: "top",
      placementX: 12,
      placementY: 0,
      imageLengthCm: 0,
    })
  })
})

describe("mapLegacyOutfitItemToStudioItem", () => {
  it("converts OutfitItem instances and preserves metadata", () => {
    const legacy: OutfitItem = {
      id: "legacy-top",
      type: "top",
      brand: "Legacy",
      product_name: "Legacy Top",
      size: "M",
      price: 1999,
      currency: "INR",
      imageUrl: "https://example.com/legacy-top.png",
      description: "Legacy description",
      color: "Blue",
      placement_y: null,
      placement_x: 12,
      image_length: null,
    }

    const result = mapLegacyOutfitItemToStudioItem(legacy)
    expect(result).toMatchObject({
      id: "legacy-top",
      zone: "top",
      placementX: 12,
      placementY: 0,
      imageLengthCm: 0,
      brand: "Legacy",
    })
    expect(result?.extras).toBeTruthy()
  })
})

describe("studioRenderedItemToOutfitItem", () => {
  it("maps studio rendered items back to OutfitItem shape", () => {
    const rendered = mapSupabaseProductToStudioItem("bottom", {
      id: "prod-bottom",
      product_name: "Bottom",
      brand: "Atlyr",
      price: 2299,
      currency: "INR",
      image_url: "https://example.com/bottom.png",
      placement_x: 5,
      placement_y: 40,
      image_length: 90,
    })

    expect(rendered).not.toBeNull()
    const outfitItem = studioRenderedItemToOutfitItem(rendered!)
    expect(outfitItem).toMatchObject({
      id: "prod-bottom",
      type: "bottom",
      placement_x: 5,
      placement_y: 40,
      image_length: 90,
    })
  })
})

const createRenderedItem = (overrides: Partial<StudioRenderedItem>): StudioRenderedItem => ({
  id: overrides.id ?? "item",
  zone: overrides.zone ?? "top",
  imageUrl: overrides.imageUrl ?? "https://example.com/item.png",
  placementX: overrides.placementX ?? 0,
  placementY: overrides.placementY ?? 0,
  imageLengthCm: overrides.imageLengthCm ?? 0,
  brand: overrides.brand ?? null,
  productName: overrides.productName ?? null,
  description: overrides.description ?? null,
  price: overrides.price ?? null,
  currency: overrides.currency ?? null,
  size: overrides.size ?? null,
  color: overrides.color ?? null,
  colorGroup: overrides.colorGroup ?? null,
  gender: overrides.gender ?? null,
  productUrl: overrides.productUrl ?? null,
  bodyPartsVisible: overrides.bodyPartsVisible ?? null,
  extras: overrides.extras ?? null,
})

describe("mergeBodyPartsVisibilityByZone", () => {
  it("intersects body parts per zone when multiple items provide data", () => {
    const items = [
      createRenderedItem({ id: "top-1", zone: "top", bodyPartsVisible: ["head", "torso", "arm_left"] }),
      createRenderedItem({ id: "top-2", zone: "top", bodyPartsVisible: ["torso", "arm_left", "arm_right"] }),
      createRenderedItem({ id: "bottom-1", zone: "bottom", bodyPartsVisible: ["legs", "feet"] }),
    ]
    expect(mergeBodyPartsVisibilityByZone(items)).toEqual({
      top: ["torso", "arm_left"],
      bottom: ["legs", "feet"],
    })
  })

  it("falls back to the latest non-empty entry when intersections are empty", () => {
    const items = [
      createRenderedItem({ id: "top-1", zone: "top", bodyPartsVisible: ["head"] }),
      createRenderedItem({ id: "top-2", zone: "top", bodyPartsVisible: ["torso"] }),
    ]
    expect(mergeBodyPartsVisibilityByZone(items)).toEqual({
      top: ["torso"],
    })
  })
})

describe("computeOutfitVisibleSegments", () => {
  it("returns all segments when no item provides bodyPartsVisible", () => {
    const items = [
      createRenderedItem({ id: "top-1", zone: "top", bodyPartsVisible: null }),
      createRenderedItem({ id: "bottom-1", zone: "bottom", bodyPartsVisible: null }),
    ]
    expect(computeOutfitVisibleSegments(items)).toEqual(["head", "neck", "torso", "arm_left", "arm_right", "legs", "feet"])
  })

  it("intersects visible segments across items, treating null as 'no constraint'", () => {
    const items = [
      createRenderedItem({ id: "top-1", zone: "top", bodyPartsVisible: ["head", "torso"] }),
      createRenderedItem({ id: "bottom-1", zone: "bottom", bodyPartsVisible: ["torso", "legs"] }),
      createRenderedItem({ id: "shoes-1", zone: "shoes", bodyPartsVisible: null }),
    ]
    expect(computeOutfitVisibleSegments(items)).toEqual(["torso"])
  })

  it("returns an empty list when an explicit empty list is present", () => {
    const items = [
      createRenderedItem({ id: "top-1", zone: "top", bodyPartsVisible: [] }),
      createRenderedItem({ id: "bottom-1", zone: "bottom", bodyPartsVisible: ["legs"] }),
    ]
    expect(computeOutfitVisibleSegments(items)).toEqual([])
  })
})
