import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { Icons } from "@/design-system/icons"
import { GarmentImage, ProductTile, SectionHeader } from "@/design-system/primitives"
import type { Database } from "@/integrations/supabase/types"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { readStudioLastPath } from "@/features/studio/constants"
import { toPlacementTransform } from "@/features/studio/mappers/renderedItemMapper"
import type { StudioPlacementByMannequin } from "@/features/studio/types"
import { isPlaceableOnMannequin } from "@/features/studio/utils/placementSupport"
import { buildStudioFocusUrl, parseStudioPath } from "@/features/studio/utils/studioUrlState"
import { productDisplayImage } from "@/services/collections/collectionsService"
import type { ProductSlot } from "@/services/collections/collectionsService"
import { cn } from "@/lib/utils"

import { useMoodboardItems, useProductsByIds, useSavedProducts, useTrendingProducts } from "../hooks/useMoodboards"
import type { useProductSaveActions } from "../hooks/useProductSaveActions"

type ProductRow = Database["public"]["Tables"]["products"]["Row"]
type SaveActions = ReturnType<typeof useProductSaveActions>

/**
 * Slot keys stay top / bottom / shoes — the stored values are unchanged.
 * Only the labels move to the V2 vocabulary (tops · lowers · kicks).
 */
const SLOTS: { id: ProductSlot; label: string }[] = [
  { id: "top", label: "tops" },
  { id: "bottom", label: "lowers" },
  { id: "shoes", label: "kicks" },
]

type Tile = {
  id: string
  title: string
  imageUrl: string | null
  type: ProductSlot | null
  /** What the photoreal mannequin needs to draw it; unplaced pieces are not offered. */
  placement: StudioPlacementByMannequin | null
}

const slotOf = (value: string | null | undefined): ProductSlot | null =>
  value === "top" || value === "bottom" || value === "shoes" ? value : null

const rowToTile = (row: ProductRow): Tile => ({
  id: row.id,
  title: row.product_name ?? "Piece",
  imageUrl: productDisplayImage(row.thumbnail_url, row.image_url),
  type: slotOf(row.type),
  placement: toPlacementTransform(row),
})

interface ProductsTabProps {
  saveActions: SaveActions
  /** A pin opens the save card for that product. */
  onSave: (productId: string) => void
}

export function ProductsTab({ saveActions, onSave }: ProductsTabProps) {
  const [slot, setSlot] = useState<ProductSlot>("top")
  const navigate = useNavigate()
  const location = useLocation()
  const { gender } = useProfileContext()
  // The body these pieces would be worn on. The renderer silently skips a piece
  // with no transform for it, so offering one here is a dead end.
  const mannequin = gender === "male" ? "male" : "female"

  const wardrobeQuery = useMoodboardItems("wardrobe", 40)
  const savedQuery = useSavedProducts()
  const trendingQuery = useTrendingProducts()

  // Board items do not carry the slot, so fetch the rows to filter by it.
  const wardrobeIds = useMemo(
    () =>
      (wardrobeQuery.data?.pages ?? [])
        .flat()
        .filter((item) => item.itemType === "product")
        .map((item) => item.id),
    [wardrobeQuery.data],
  )
  const wardrobeRows = useProductsByIds(wardrobeIds)

  const wardrobe = useMemo(
    () =>
      wardrobeIds
        .map((id) => wardrobeRows.data?.[id])
        .filter(Boolean)
        .map((row) => rowToTile(row as ProductRow))
        .filter((t) => t.type === slot && isPlaceableOnMannequin(t, mannequin)),
    [mannequin, slot, wardrobeIds, wardrobeRows.data],
  )
  const trending = useMemo<Tile[]>(
    () =>
      (trendingQuery.data?.[slot] ?? [])
        .filter((p) => isPlaceableOnMannequin(p, mannequin))
        .map((p) => ({
          id: p.id,
          title: p.productName ?? "Piece",
          imageUrl: p.imageUrl,
          type: p.type,
          placement: p.placement,
        })),
    [mannequin, slot, trendingQuery.data],
  )
  const favorites = useMemo<Tile[]>(
    () =>
      (savedQuery.data ?? [])
        .filter((p) => p.type === slot && isPlaceableOnMannequin(p, mannequin))
        .map((p) => ({ id: p.id, title: p.productName ?? "Piece", imageUrl: p.imageUrl, type: p.type, placement: p.placement })),
    [mannequin, savedQuery.data, slot],
  )

  const originPath = `${location.pathname}${location.search}` || "/collection"
  /**
   * A piece opens worn, not as a page about itself: Studio puts it on the look the
   * user last had open and zooms to its slot — the same move Search makes. The
   * `/studio/product/:id` detail view is off for now.
   */
  const openProduct = (tile: Tile) => {
    const remembered = parseStudioPath(readStudioLastPath(gender))
    navigate(
      buildStudioFocusUrl({
        productId: tile.id,
        slot: tile.type ?? slot,
        returnTo: originPath,
        outfitId: remembered.outfitId,
        slotIds: remembered.slotIds,
      }),
    )
  }

  const renderTile = (t: Tile) => {
    const saved = saveActions.isSaved(t.id)
    return (
      <ProductTile
        key={t.id}
        title={t.title}
        imageSrc={t.imageUrl}
        saved={saved}
        onSelect={() => openProduct(t)}
        onToggleSave={() => onSave(t.id)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Second tab row under the Collections tabs — which slot the three rows show. */}
      {/* Slot selector. V2 draws this as three equal-width pills with an ink
          fill on the active one — not the underline TabBar used by the tab
          row above it, so the two rows cannot be mistaken for each other. */}
      <div role="tablist" aria-label="Piece type" className="grid grid-cols-3 gap-2">
        {SLOTS.map((item) => {
          const isActive = item.id === slot
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSlot(item.id)}
              className={cn(
                "flex h-8 items-center justify-center rounded-control text-card font-medium transition-colors",
                isActive ? "bg-charcoal text-white" : "border border-hairline bg-white text-ink",
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {/* Row 1 — your wardrobe, on the tall 112x168 card from the recent-creations rail. */}
      <section className="flex flex-col gap-2.5">
        <SectionHeader title="wardrobe" className="border-t border-hairline pt-2" />
        <div className="flex gap-2 overflow-x-auto py-0.5 scrollbar-hide">
          <button
            type="button"
            aria-label="Add to wardrobe"
            onClick={() => navigate("/inspiration-import?intent=wardrobe")}
            className="flex h-[168px] w-[112px] shrink-0 items-center justify-center rounded-lg border border-dashed border-hairline-dashed text-ink"
          >
            <Icons.add className="h-5 w-5" aria-hidden="true" />
          </button>
          {wardrobe.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openProduct(t)}
              title={t.title}
              className="relative h-[168px] w-[112px] shrink-0 overflow-hidden rounded-lg border border-hairline bg-background"
            >
              {/* Same framing as the tiles below — a raw img here showed the
                  garment adrift in the transparent canvas it was cut from. */}
              {t.imageUrl ? <GarmentImage src={t.imageUrl} alt={t.title} cropToContent /> : null}
            </button>
          ))}
        </div>
      </section>

      {/* Row 2 — the Atlyr-curated list. */}
      {trending.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <SectionHeader title="trending" className="border-t border-hairline pt-2" />
          <div className="flex gap-2 overflow-x-auto py-0.5 scrollbar-hide">
            {trending.map((t) => (
              <div key={t.id} className="w-[150px] shrink-0">
                {renderTile(t)}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Row 3 — everything saved, as a long grid rather than a rail. */}
      <section className="flex flex-col gap-2.5">
        <SectionHeader title="saves" className="border-t border-hairline pt-2" />
        {favorites.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{favorites.map(renderTile)}</div>
        ) : (
          <p className="py-6 text-center text-sm text-taupe">Nothing saved in this slot yet.</p>
        )}
      </section>
    </div>
  )
}
