import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { ProductTile, SectionHeader, TabBar } from "@/design-system/primitives"
import type { ProductSlot } from "@/services/collections/collectionsService"

import { useSavedProducts, useTrendingProducts } from "../hooks/useMoodboards"
import type { useProductSaveActions } from "../hooks/useProductSaveActions"

type SaveActions = ReturnType<typeof useProductSaveActions>

const SLOTS: { id: ProductSlot; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "shoes", label: "Shoes" },
]

type Tile = { id: string; title: string; imageUrl: string | null; type: ProductSlot | null }

interface ProductsTabProps {
  saveActions: SaveActions
}

export function ProductsTab({ saveActions }: ProductsTabProps) {
  const [slot, setSlot] = useState<ProductSlot>("top")
  const navigate = useNavigate()
  const location = useLocation()

  const savedQuery = useSavedProducts()
  const trendingQuery = useTrendingProducts()

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

      {/* Row 1 — the Atlyr-curated list. */}
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

      {/* Row 2 — everything saved, as a long grid rather than a rail. */}
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
