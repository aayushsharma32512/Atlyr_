import {
  AskAtlyrButton,
  CategoryFilterBar,
  FilterSortBar,
  ProductAlternateCard,
  ProductSummaryCard,
  ShortProductCard,
} from "@/design-system/primitives"

import { AlternativesGrid } from "@/features/studio/components/AlternativesGrid"
import MoodboardCard from "@/features/collections/components/MoodboardCard"
import CollectionsHeader from "@/features/collections/components/CollectionsHeader"
import { ProductsTab } from "@/features/collections/components/ProductsTab"
import { Chip, CuratedCollectionRows, OutfitCard, ProductTile, SearchBar } from "@/design-system/primitives"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { SearchFilterSheet } from "@/features/search/components/SearchFilterSheet"
import { ErrorCard, NoResultsCard, ResultsSkeleton } from "@/features/search/components/SearchResultStates"
import { useState } from "react"

const mockProduct = {
  title: "Zara Striped Cotton Top with xyz xyz",
  rating: 4.3,
  reviewCount: 1100,
  price: 2345,
  discountPercent: 17,
}

const alternativeProducts = [
  {
    id: "alt-1",
    title: "H&M Linen Blend Resort Shirt",
    brand: "H&M",
    price: 2303,
    imageSrc: "https://picsum.photos/seed/atlyr-top-1/200/200",
  },
  {
    id: "alt-2",
    title: "Uniqlo Supima Cotton Crew",
    brand: "Uniqlo",
    price: 1890,
    imageSrc: "https://picsum.photos/seed/atlyr-top-2/200/200",
  },
  {
    id: "alt-3",
    title: "Mango Relaxed Button Down",
    brand: "Mango",
    price: 2599,
    imageSrc: "https://picsum.photos/seed/atlyr-top-3/200/200",
  },
  {
    id: "alt-4",
    title: "Zudio Summer Linen Top",
    brand: "Zudio",
    price: 1499,
    imageSrc: "https://picsum.photos/seed/atlyr-top-4/200/200",
  },
  {
    id: "alt-5",
    title: "Fabindia Khadi Kurta",
    brand: "Fabindia",
    price: 2990,
    imageSrc: "https://picsum.photos/seed/atlyr-top-5/200/200",
  },
  {
    id: "alt-6",
    title: "Forever21 Crochet Shrug",
    brand: "Forever21",
    price: 1799,
    imageSrc: "https://picsum.photos/seed/atlyr-top-6/200/200",
  },
]

const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const productPreviewItem = (seed: string) => ({
  itemType: "product" as const,
  id: `product-${seed}`,
  imageUrl: `https://picsum.photos/seed/${seed}/300/400`,
})

// Real outfit ids, shaped exactly like the board-preview RPC emits them (id only,
// no rendered items) so the cover proves it fetches what Studio fetches.
const REAL_OUTFIT_IDS = [
  "8841bc7d-7081-4558-a019-2de81fd392fc",
  "7bcba165-0659-42fa-91d9-5ea6d15a704e",
  "0cb02d16-675f-42c8-ba6f-f1b2fde04a38",
  "8cb2bde9-eb9d-4295-9a76-2a210a83d8ec",
]
const realOutfit = (i: number) => ({ itemType: "outfit" as const, id: REAL_OUTFIT_IDS[i] })

function RealBoardCards() {
  return (
    <div className="w-[390px] px-4">
      <div className="grid grid-cols-2 items-start gap-2">
        <MoodboardCard name="Two outfits" slug="r1" itemCount={2} index={0} preview={{ slug: "r1", items: [realOutfit(0), realOutfit(1)] }} />
        <MoodboardCard
          name="Outfit + product"
          slug="r2"
          itemCount={2}
          index={1}
          preview={{ slug: "r2", items: [realOutfit(2), productPreviewItem("real-d")] }}
        />
      </div>
    </div>
  )
}

function ProductsTabPreview() {
  const saveActions = useProductSaveActions()
  return <ProductsTab saveActions={saveActions} />
}

const noop = () => {}

const SHEET_CATEGORIES = [
  { id: "type", label: "Category", options: ["top", "bottom", "shoes"].map((v) => ({ id: `type:${v}`, label: v })) },
  { id: "fit", label: "Fit", options: ["relaxed", "slim", "boxy", "regular", "oversized", "cropped"].map((v) => ({ id: `fit:${v}`, label: v })) },
  { id: "feel", label: "Feel", options: ["soft", "crisp", "handloom"].map((v) => ({ id: `feel:${v}`, label: v })) },
  { id: "vibe", label: "Vibe", options: ["indie", "office", "festive"].map((v) => ({ id: `vibe:${v}`, label: v })) },
  { id: "collection", label: "Boards", options: [{ id: "collection:gallery", label: "Gallery night" }] },
]

function SearchPreviewSections() {
  const [sheetOpen, setSheetOpen] = useState(() => new URLSearchParams(window.location.search).has("sheet"))
  const look = (i: number, extra: Partial<React.ComponentProps<typeof OutfitCard>> = {}) => (
    <div className="h-[250px]">
      <OutfitCard title={`Look ${i + 1}`} outfitId={REAL_OUTFIT_IDS[i]} tiltIndex={i} onSelect={noop} onToggleSave={noop} {...extra} />
    </div>
  )
  return (
    <>
      <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">SearchBar (390px)</h2>
        <div className="flex w-[390px] flex-col gap-4 px-4">
          <SearchBar mode="idle" value="" onValueChange={noop} onSubmit={noop} onFilter={noop} onPickImage={noop} />
          <SearchBar mode="results" value="ikat overshirt for a gallery night" onValueChange={noop} onSubmit={noop} onClear={noop} chip="products" onChipChange={noop} onFilter={noop} onPickImage={noop} onFindItems={noop} />
          <SearchBar mode="results" value="" onValueChange={noop} onSubmit={noop} onClear={noop} chip="outfits" onChipChange={noop} onFilter={noop} onPickImage={noop} onFindItems={noop} thumbSrc="https://picsum.photos/seed/thumb/40/40" onClearThumb={noop} />
        </div>
      </section>
      <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Chips + result states (390px)</h2>
        <div className="flex w-[390px] flex-col gap-4 px-4">
          <div className="flex gap-1.5">
            <Chip label="Sangeet" onClick={noop} />
            <Chip label="Handloom" mark onClick={noop} />
            <Chip label="Products" active onClick={noop} />
            <Chip label="Relaxed" active onRemove={noop} />
          </div>
          <ResultsSkeleton kind="products" count={2} />
          <NoResultsCard query="bandhgala kolhapuri y2k" onFindItems={noop} />
          <ErrorCard onRetry={noop} />
          <button type="button" onClick={() => setSheetOpen(true)} className="h-control-secondary rounded-control border border-ink text-label text-ink">
            Open filters
          </button>
          <SearchFilterSheet open={sheetOpen} onOpenChange={setSheetOpen} categories={SHEET_CATEGORIES} activeFilters={["feel:handloom", "fit:relaxed"]} onApply={noop} onClear={noop} />
        </div>
      </section>
      <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">OutfitCard grid + curated row (390px)</h2>
        <div className="flex w-[390px] flex-col gap-4 px-4">
          <div className="grid grid-cols-2 gap-2">
            {look(0, { by: "Meera" })}
            {look(1, { by: "Arjun", saved: true })}
            {look(2, { dark: true })}
            {look(3)}
          </div>
          <CuratedCollectionRows
            rows={[{ id: "r", label: "Indie fusion", looks: REAL_OUTFIT_IDS.map((id, i) => ({ id, title: `Look ${i + 1}`, outfitId: id })) }]}
            onLookSelect={noop}
            onToggleSave={noop}
          />
        </div>
      </section>
    </>
  )
}

export default function DesignSystemPreview() {
  return (
    <div className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
        <SearchPreviewSections />
        <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Products tab (390px)</h2>
          <div className="w-[390px] px-4"><ProductsTabPreview /></div>
        </section>
        <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">ProductTile states</h2>
          <div className="grid w-[390px] grid-cols-3 gap-2 px-4">
            <ProductTile title="Ajrakh block overshirt" imageSrc="https://picsum.photos/seed/pt-a/300/300" />
            <ProductTile title="Ivory kota wide leg" imageSrc="https://picsum.photos/seed/pt-b/300/300" saved />
            <ProductTile title="Cream cotton tee" imageSrc="https://picsum.photos/seed/pt-c/300/300" worn />
          </div>
        </section>
        <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Collections header (390px)</h2>
          <div className="w-[390px] overflow-hidden border border-hairline">
            <CollectionsHeader activeTab="moodboards" onTabChange={() => {}} />
          </div>
        </section>
        <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Moodboard cards — real outfits</h2>
          <RealBoardCards />
        </section>
        <header className="space-y-3 text-center">
          <h1 className="text-2xl font-semibold">Design System Preview</h1>
          <p className="text-sm text-muted-foreground">
            Use this sandbox route to inspect the new primitives before plugging them into feature
            flows.
          </p>
        </header>

        <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Product Summary Card</h2>
          <ProductSummaryCard
            title={mockProduct.title}
            rating={mockProduct.rating}
            reviewCount={mockProduct.reviewCount}
            price={mockProduct.price}
            discountPercent={mockProduct.discountPercent}
            onFilter={() => {}}
            onRemove={() => {}}
            onAddToBag={() => {}}
          />
        </section>

        <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Studio Alternatives Primitives</h2>
            <p className="text-sm text-muted-foreground">
              Category filter bar, filter/sort bar, compact product card, and Atlyr assistant call to
              action.
            </p>
          </div>
          <div className="grid gap-4">
            <CategoryFilterBar />
            <FilterSortBar />
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ShortProductCard
                title={mockProduct.title}
                price={mockProduct.price}
                discountPercent={mockProduct.discountPercent}
                rating={mockProduct.rating}
                reviewCount={`${mockProduct.reviewCount.toLocaleString("en-IN")}`}
              />
              <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/10 p-4">
                <AskAtlyrButton onClick={() => {}} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ProductAlternateCard
                imageSrc={alternativeProducts[0].imageSrc}
                title={alternativeProducts[0].title}
                brand={alternativeProducts[0].brand}
                price={INR_FORMATTER.format(alternativeProducts[0].price)}
              />
              <ProductAlternateCard
                imageSrc={alternativeProducts[1].imageSrc}
                title={alternativeProducts[1].title}
                brand={alternativeProducts[1].brand}
                price={INR_FORMATTER.format(alternativeProducts[1].price)}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-6 rounded-3xl border border-sidebar-border/60 bg-card/80 p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Alternatives Grid (Feature Component)</h2>
            <p className="text-sm text-muted-foreground">
              Combines the primitives to mimic the studio alternates panel.
            </p>
          </div>
          <AlternativesGrid
            products={alternativeProducts.map((product) => ({
              ...product,
              price: INR_FORMATTER.format(product.price),
            }))}
          />
        </section>
      </div>
    </div>
  )
}

