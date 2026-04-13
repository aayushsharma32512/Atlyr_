import {
  AskAtlyrButton,
  CategoryFilterBar,
  FilterSortBar,
  ProductAlternateCard,
  ProductSummaryCard,
  ShortProductCard,
} from "@/design-system/primitives"

import { AlternativesGrid } from "@/features/studio/components/AlternativesGrid"

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

export default function DesignSystemPreview() {
  return (
    <div className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
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

