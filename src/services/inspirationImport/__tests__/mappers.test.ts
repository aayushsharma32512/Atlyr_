import { describe, expect, it } from "@jest/globals"
import { mapImportResultToStudioItem } from "@/services/inspirationImport/mappers"
import type { InspirationCatalogueResult } from "@/services/inspirationImport/types"

const baseResult: InspirationCatalogueResult = {
  id: "product-1",
  title: "Handloom jacket",
  brand: "Atlyr",
  price: 4200,
  currency: "INR",
  priceLabel: "₹4,200",
  imageSrc: "https://example.com/thumb.webp",
  thumbnailSrc: "https://example.com/thumb.webp",
  renderImageSrc: "https://example.com/render.png",
  color: "Rust",
  placementX: 14,
  placementY: 22,
  imageLength: 64,
  placement: {
    "female:bodytype1": {
      scale: 1.1,
      rotationDeg: 2,
      tx: 4,
      ty: 8,
      warp: [{ x: 1, y: 2 }],
    },
  },
  bodyPartsVisible: ["torso", "arm_left"],
}

describe("mapImportResultToStudioItem", () => {
  it("keeps card and mannequin imagery separate and maps the selected slot", () => {
    const result = mapImportResultToStudioItem(baseResult, "top")

    expect(result).toMatchObject({
      id: "product-1",
      zone: "top",
      imageUrl: "https://example.com/render.png",
      thumbnailUrl: "https://example.com/thumb.webp",
      placementX: 14,
      placementY: 22,
      imageLengthCm: 64,
      bodyPartsVisible: ["torso", "arm_left"],
      placement: {
        female: {
          scale: 1.1,
          rotationDeg: 2,
          tx: 4,
          ty: 8,
          mannequin: "female",
        },
      },
    })
  })

  it("returns null when no render image is available", () => {
    expect(mapImportResultToStudioItem({ ...baseResult, renderImageSrc: "" }, "bottom")).toBeNull()
  })
})
