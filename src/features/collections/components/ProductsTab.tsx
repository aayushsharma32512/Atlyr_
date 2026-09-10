import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { Icons } from "@/design-system/icons"
import { ProductTile, SectionHeader, TabBar } from "@/design-system/primitives"
import type { Database } from "@/integrations/supabase/types"
import { productDisplayImage } from "@/services/collections/collectionsService"
import type { ProductSlot } from "@/services/collections/collectionsService"
import { cn } from "@/lib/utils"

import { useMoodboardItems, useProductsByIds, useSavedProducts, useTrendingProducts } from "../hooks/useMoodboards"
import type { useProductSaveActions } from "../hooks/useProductSaveActions"

type ProductRow = Database["public"]["Tables"]["products"]["Row"]
type SaveActions = ReturnType<typeof useProductSaveActions>

const SLOTS: { id: ProductSlot; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "shoes", label: "Shoes" },
]

type Tile = { id: string; title: string; imageUrl: string | null; type: ProductSlot | null }

const slotOf = (value: string | null | undefined): ProductSlot | null =>
  value === "top" || value === "bottom" || value === "shoes" ? value : null

const rowToTile = (row: ProductRow): Tile => ({
  id: row.id,
  title: row.product_name ?? "Piece",
  imageUrl: productDisplayImage(row.thumbnail_url, row.image_url),
  type: slotOf(row.type),
})

interface ProductsTabProps {
  saveActions: SaveActions
}

export function ProductsTab({ saveActions }: ProductsTabProps) {
  const [slot, setSlot] = useState<ProductSlot>("top")
  const navigate = useNavigate()
  const location = useLocation()

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
    () => wardrobeIds.map((id) => wardrobeRows.data?.[id]).filter(Boolean).map((row) => rowToTile(row as ProductRow)).filter((t) => t.type === slot),
    [slot, wardrobeIds, wardrobeRows.data],
  )
  const trending = useMemo<Tile[]>(
    () =>
      (trendingQuery.data?.[slot] ?? []).map((p) => ({
        id: p.id,
        title: p.productName ?? "Piece",
        imageUrl: p.imageUrl,
        type: p.type,
      })),
    [slot, trendingQuery.data],
  )
  const favorites = useMemo<Tile[]>(
    () =>
      (savedQuery.data ?? [])
        .filter((p) => p.type === slot)
        .map((p) => ({ id: p.id, title: p.productName ?? "Piece", imageUrl: p.imageUrl, type: p.type })),
    [savedQuery.data, slot],
  )

  const originPath = `${location.pathname}${location.search}` || "/collection"
  const openProduct = (id: string) =>
    navigate(`/studio/product/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(originPath)}`)

  const renderTile = (t: Tile) => {
    const saved = saveActions.isSaved(t.id)
    return (
      <ProductTile
        key={t.id}
        title={t.title}
        imageSrc={t.imageUrl}
        saved={saved}
        onSelect={() => openProduct(t.id)}
        onToggleSave={() => saveActions.onToggleSave(t.id, !saved)}
        onLongPressSave={() => saveActions.onLongPressSave(t.id)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Second tab row under the Collections tabs — which slot the three rows show. */}
      <TabBar items={SLOTS} activeId={slot} onChange={(id) => setSlot(id as ProductSlot)} aria-label="Piece type" className="px-0" />

      {/* Row 1 — your wardrobe, on the tall 112x168 card from the recent-creations rail. */}
      <section className="flex flex-col gap-2.5">
        <SectionHeader title="Wardrobe" className="border-t border-hairline pt-2" />
        <div className="flex gap-2 overflow-x-auto py-0.5 scrollbar-hide">
          <button
            type="button"
            aria-label="Add to wardrobe"
            onClick={() => navigate("/inspiration-import")}
            className="flex h-[168px] w-[112px] shrink-0 items-center justify-center rounded-lg border border-dashed border-hairline-dashed text-ink"
          >
            <Icons.add className="h-5 w-5" aria-hidden="true" />
          </button>
          {wardrobe.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openProduct(t.id)}
              title={t.title}
              className={cn(
                "relative h-[168px] w-[112px] shrink-0 overflow-hidden rounded-lg border border-hairline bg-muted",
                i % 2 === 0 ? "-rotate-[0.6deg]" : "rotate-[0.6deg]",
              )}
            >
              {t.imageUrl ? (
                <img src={t.imageUrl} alt={t.title} loading="lazy" className="h-full w-full object-contain p-2" />
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {/* Row 2 — the Atlyr-curated list. */}
      {trending.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <SectionHeader title="Trending" className="border-t border-hairline pt-2" />
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
        <SectionHeader title="Favorites" className="border-t border-hairline pt-2" />
        {favorites.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{favorites.map(renderTile)}</div>
        ) : (
          <p className="py-6 text-center text-sm text-taupe">Nothing saved in this slot yet.</p>
        )}
      </section>
    </div>
  )
}
