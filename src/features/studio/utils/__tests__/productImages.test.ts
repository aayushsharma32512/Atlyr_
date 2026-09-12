import { describe, expect, it } from "bun:test"

import { isSegmentedAsset, isTryOnRender, toDisplayImages } from "../productImages"
import type { StudioProductImage } from "@/services/studio/productImagesService"

const B = "https://x.supabase.co/storage/v1/object/public"

// Real path shapes, taken from the live table.
const SCRAPED_RAW = `${B}/ingested_inventory/raw/e7b648cb/2.jpg`
const SCRAPED_AUTO = `${B}/ingestion-automated/f1abc4cf/raw/1.jpg`
const GHOST_STAGING = `${B}/ingested_inventory/staging/ghost_mannequins/e7b648cb.jpg`
const SEGMENTED = `${B}/ingestion-automated/segmentation/f1abc4cf/front.png`
const MANUAL_SEGMENTED = `${B}/ingestion-automated/manual_shoes/segmented/TRADM04.png`
const TRYON = `${B}/ingestion-automated/f1abc4cf/tryon/front.jpg`
const VTON_JOB = `${B}/ingestion-automated/jobs/b8f0ff25/vton_5.png`
// The one that slipped through a folder-only rule: a vton FILE under manual/.
const VTON_MANUAL = `${B}/ingestion-automated/f1abc4cf/manual/vton.png?v=1787680001711`
const MANUAL_SEGMENTED_SIBLING = `${B}/ingestion-automated/f1abc4cf/manual/segmented.png?v=1787747282231`

const img = (kind: string, url: string): StudioProductImage => ({
  id: url,
  productId: "p1",
  url,
  kind: kind as StudioProductImage["kind"],
  sortOrder: 0,
  isPrimary: false,
  gender: null,
})

describe("isTryOnRender", () => {
  it("catches every try-on shape in the catalogue", () => {
    expect(isTryOnRender(TRYON)).toBe(true)
    expect(isTryOnRender(VTON_JOB)).toBe(true)
    expect(isTryOnRender(VTON_MANUAL)).toBe(true)
  })

  it("keeps the segmented sibling sitting in the same manual/ folder", () => {
    expect(isTryOnRender(MANUAL_SEGMENTED_SIBLING)).toBe(false)
  })

  it("does not treat ghost_mannequins as a try-on — 651 rows live there", () => {
    expect(isTryOnRender(GHOST_STAGING)).toBe(false)
  })

  it("ignores the query string when reading the filename", () => {
    expect(isTryOnRender(`${B}/x/y/vton.png?v=123`)).toBe(true)
    expect(isTryOnRender(`${B}/x/y/segmented.png?v=123`)).toBe(false)
  })

  it("does not match a filename that merely starts with the letters", () => {
    expect(isTryOnRender(`${B}/x/y/vtonic-shirt.jpg`)).toBe(false)
  })

  it("leaves scraped and segmented images alone", () => {
    for (const url of [SCRAPED_RAW, SCRAPED_AUTO, GHOST_STAGING, SEGMENTED, MANUAL_SEGMENTED]) {
      expect(isTryOnRender(url)).toBe(false)
    }
  })
})

describe("isSegmentedAsset", () => {
  it("catches every cutout path in the catalogue", () => {
    for (const url of [GHOST_STAGING, SEGMENTED, MANUAL_SEGMENTED, MANUAL_SEGMENTED_SIBLING]) {
      expect(isSegmentedAsset(url)).toBe(true)
    }
  })

  it("leaves scraped photos alone", () => {
    expect(isSegmentedAsset(SCRAPED_RAW)).toBe(false)
    expect(isSegmentedAsset(SCRAPED_AUTO)).toBe(false)
  })
})

describe("toDisplayImages", () => {
  it("keeps scraped photos and drops every segmented cutout", () => {
    const out = toDisplayImages([
      img("model", SCRAPED_RAW),
      img("flatlay", MANUAL_SEGMENTED),
      img("detail", SCRAPED_AUTO),
      img("ghost", GHOST_STAGING),
    ])
    expect(out).toEqual([SCRAPED_RAW, SCRAPED_AUTO])
  })

  it("hides the mannequin try-on even though it is stored as kind=model", () => {
    const out = toDisplayImages([img("model", TRYON), img("model", SCRAPED_RAW)])
    expect(out).toEqual([SCRAPED_RAW])
  })

  it("hides a vton job render", () => {
    expect(toDisplayImages([img("model", VTON_JOB), img("model", SCRAPED_RAW)])).toEqual([SCRAPED_RAW])
  })

  it("shows the Air Jordan's scraped photo, not the cutout or the mannequin", () => {
    // Exactly what the live rows look like after the backfill.
    const out = toDisplayImages([
      img("ghost", MANUAL_SEGMENTED_SIBLING),
      img("model", VTON_MANUAL),
      img("model", SCRAPED_AUTO),
    ])
    expect(out).toEqual([SCRAPED_AUTO])
  })

  it("falls back to the product image when only cutouts exist", () => {
    expect(toDisplayImages([img("ghost", MANUAL_SEGMENTED_SIBLING)], "product.png")).toEqual([
      "product.png",
    ])
  })

  it("preserves the order the service returned", () => {
    const out = toDisplayImages([img("detail", SCRAPED_AUTO), img("model", SCRAPED_RAW)])
    expect(out).toEqual([SCRAPED_AUTO, SCRAPED_RAW])
  })

  it("falls back to the product image when only a try-on render exists", () => {
    expect(toDisplayImages([img("model", TRYON)], "product.png")).toEqual(["product.png"])
  })

  it("falls back when there are no rows at all", () => {
    expect(toDisplayImages([], "product.png")).toEqual(["product.png"])
    expect(toDisplayImages(undefined, "product.png")).toEqual(["product.png"])
  })

  it("returns nothing rather than a blank frame when there is no fallback", () => {
    expect(toDisplayImages(undefined, null)).toEqual([])
    expect(toDisplayImages([img("model", TRYON)])).toEqual([])
  })

  it("skips rows with an empty url", () => {
    expect(toDisplayImages([img("model", ""), img("model", SCRAPED_RAW)])).toEqual([SCRAPED_RAW])
  })
})
