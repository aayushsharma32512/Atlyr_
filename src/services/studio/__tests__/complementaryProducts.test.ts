import { describe, expect, it } from "@jest/globals"

import { collectComplementaryProductRows } from "../studioService"
import type { Database } from "@/integrations/supabase/types"

type ProductRow = Database["public"]["Tables"]["products"]["Row"]

const makeProductRow = (id: string, type: Database["public"]["Enums"]["item_type"]): ProductRow => ({
  id,
  brand: "Brand",
  category_id: null,
  color: "black",
  color_group: null,
  care: null,
  created_at: "2024-01-01",
  currency: "INR",
  description: "desc",
  description_text: null,
  feel: null,
  fit: null,
  garment_summary: null,
  garment_summary_back: null,
  garment_summary_front: null,
  garment_summary_version: null,
  gender: null,
  image_length: null,
  image_url: "https://example.com/image.png",
  material_type: null,
  occasion: null,
  placement_x: null,
  placement_y: null,
  price: 1000,
  product_specifications: null,
  product_length: null,
  product_name: `Product ${id}`,
  product_url: null,
  similar_items: null,
  size: "M",
  size_chart: null,
  body_parts_visible: null,
  type,
  type_category: null,
  updated_at: "2024-01-02",
  vector_embedding: null,
  vibes: null,
})

const makeOutfitRow = (overrides: Partial<Database["public"]["Tables"]["outfits"]["Row"]> & {
  top?: ProductRow | null
  bottom?: ProductRow | null
  shoes?: ProductRow | null
}) =>
  ({
    id: overrides.id ?? "outfit-1",
    background_id: null,
    bottom_id: overrides.bottom?.id ?? null,
    category: "casual",
    created_at: "2024-01-01",
    created_by: null,
    description: null,
    description_text: null,
    feel: null,
    fit: null,
    gender: null,
    is_private: false,
    name: "Outfit",
    occasion: "daily",
    outfit_match: null,
    popularity: 0,
    rating: 0,
    shoes_id: overrides.shoes?.id ?? null,
    top_id: overrides.top?.id ?? null,
    updated_at: "2024-01-01",
    vector_embedding: null,
    visible_in_feed: true,
    vibes: null,
    word_association: null,
    user_id: null,
    top: overrides.top ?? null,
    bottom: overrides.bottom ?? null,
    shoes: overrides.shoes ?? null,
  } as any)

describe("collectComplementaryProductRows", () => {
  it("returns complementary products in outfit recency order and dedupes", () => {
    const top = makeProductRow("top-1", "top")
    const bottom1 = makeProductRow("bottom-1", "bottom")
    const shoes1 = makeProductRow("shoes-1", "shoes")
    const bottom2 = makeProductRow("bottom-2", "bottom")
    const shoes2 = makeProductRow("shoes-2", "shoes")

    const rows = [
      makeOutfitRow({ id: "outfit-1", top, bottom: bottom1, shoes: shoes1 }),
      makeOutfitRow({ id: "outfit-2", top, bottom: bottom2, shoes: shoes2 }),
    ]

    const result = collectComplementaryProductRows(rows, "top", top.id, 20)
    expect(result.map((item) => item.id)).toEqual(["bottom-1", "shoes-1", "bottom-2", "shoes-2"])
  })

  it("respects the limit and skips the active product", () => {
    const top = makeProductRow("top-1", "top")
    const bottom = makeProductRow("bottom-1", "bottom")
    const shoes = makeProductRow("shoes-1", "shoes")

    const rows = [makeOutfitRow({ id: "outfit-1", top, bottom, shoes })]

    const result = collectComplementaryProductRows(rows, "top", top.id, 1)
    expect(result.map((item) => item.id)).toEqual(["bottom-1"])
  })
})
