import type { Database } from "@/integrations/supabase/types"
import type { ItemType, Outfit, OutfitItem, Occasion } from "@/types"

type DbOutfitRow = Database["public"]["Tables"]["outfits"]["Row"] & {
  occasion?: Database["public"]["Tables"]["occasions"]["Row"] | null
  top?: Database["public"]["Tables"]["products"]["Row"] | null
  bottom?: Database["public"]["Tables"]["products"]["Row"] | null
  shoes?: Database["public"]["Tables"]["products"]["Row"] | null
}

type DbProductRow = Database["public"]["Tables"]["products"]["Row"]

function mapProductToOutfitItem(product: DbProductRow | null | undefined): OutfitItem | null {
  if (!product) {
    return null
  }

  const gender =
    product.gender === "male" || product.gender === "female" || product.gender === "unisex"
      ? product.gender
      : null

  return {
    id: product.id,
    type: product.type as ItemType,
    brand: product.brand,
    gender,
    product_name: product.product_name ?? null,
    size: product.size,
    price: product.price,
    currency: product.currency,
    imageUrl: product.image_url,
    productUrl: product.product_url ?? null,
    description: product.description,
    color: product.color,
    color_group: product.color_group ?? null,
    category_id: product.category_id ?? null,
    fit: product.fit ?? null,
    feel: product.feel ?? null,
    placement_x: product.placement_x,
    placement_y: product.placement_y,
    image_length: product.image_length ?? null,
    type_category: product.type_category ?? null,
  }
}

function mapOccasion(occasion: DbOutfitRow["occasion"]): Occasion {
  if (occasion) {
    return {
      id: occasion.id,
      name: occasion.name,
      slug: occasion.slug,
      backgroundUrl: occasion.background_url,
      description: occasion.description ?? "",
    }
  }

  return {
    id: "unknown",
    name: "Occasion",
    slug: "unknown",
    backgroundUrl: "",
    description: "",
  }
}

export function mapDbOutfitToOutfit(row: DbOutfitRow): Outfit {
  const items = [mapProductToOutfitItem(row.top), mapProductToOutfitItem(row.bottom), mapProductToOutfitItem(row.shoes)].filter(
    Boolean,
  ) as OutfitItem[]

  const totalPrice = items.reduce((sum, item) => sum + (item?.price ?? 0), 0)
  const currency = items[0]?.currency ?? "INR"

  const gender =
    row.gender === "male" || row.gender === "female" || row.gender === "unisex" ? row.gender : null

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    totalPrice,
    currency,
    occasion: mapOccasion(row.occasion ?? null),
    backgroundId: row.background_id ?? undefined,
    items,
    gender,
    fit: row.fit ?? null,
    feel: row.feel ?? null,
    vibes: row.vibes ?? null,
    word_association: row.word_association ?? null,
    rating: row.rating ?? null,
    popularity: row.popularity ?? null,
    created_at: row.created_at ?? null,
    created_by: row.created_by ?? null,
    user_id: row.user_id ?? null,
  }
}
