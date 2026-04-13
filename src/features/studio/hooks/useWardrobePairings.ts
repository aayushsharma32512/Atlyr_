import { useMemo } from "react"

import { useCollectionProducts } from "@/features/collections/hooks/useMoodboards"
import { filterWardrobeItemsBySlot } from "@/features/studio/utils/wardrobePairing"
import type { CollectionProduct } from "@/services/collections/collectionsService"
import type { StudioAlternativeProduct, StudioProductTraySlot } from "@/services/studio/studioService"

function mapCollectionProductToAlternative(product: CollectionProduct): StudioAlternativeProduct {
  const itemType = product.itemType ?? "top"
  return {
    id: product.id,
    title: product.title,
    brand: product.brand ?? null,
    price: product.price ?? 0,
    currency: product.currency ?? "INR",
    imageSrc: product.imageUrl ?? "",
    productUrl: product.productUrl ?? null,
    placementX: 0,
    placementY: 0,
    imageLength: 0,
    color: null,
    size: null,
    itemType,
    gender: product.gender ?? null,
    metadataSource: "default",
  }
}

export function useWardrobePairings(slot: StudioProductTraySlot | null | undefined) {
  const wardrobeQuery = useCollectionProducts("wardrobe")
  const items = useMemo(() => {
    const filtered = filterWardrobeItemsBySlot(wardrobeQuery.data ?? [], slot)
    return filtered.map(mapCollectionProductToAlternative)
  }, [slot, wardrobeQuery.data])

  return {
    items,
    isLoading: wardrobeQuery.isLoading,
    isError: wardrobeQuery.isError,
  }
}
