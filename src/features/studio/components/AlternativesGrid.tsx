import { cn } from "@/lib/utils"

import { ProductAlternateCard } from "@/design-system/primitives"

export type AlternativeProduct = {
  id: string
  title: string
  brand: string | null
  price: number | string
  imageSrc: string
  productUrl?: string | null
}

export interface AlternativesGridProps {
  products: AlternativeProduct[]
  onSelect?: (product: AlternativeProduct) => void
  onRemove?: (productId: string) => void
  onSave?: (productId: string) => void
  isProductSaved?: (productId: string) => boolean
  onToggleSave?: (productId: string, nextSaved: boolean) => void
  onLongPressSave?: (productId: string) => void
  className?: string
  emptyState?: React.ReactNode
  minColumnWidthRem?: number
  columnGapRem?: number
}

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

export function AlternativesGrid({
  products,
  onSelect,
  onRemove,
  onSave,
  isProductSaved,
  onToggleSave,
  onLongPressSave,
  className,
  emptyState,
  minColumnWidthRem = 4.5,
  columnGapRem = 0.4,
}: AlternativesGridProps) {
  if (products.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-96 w-full items-center justify-center rounded-1xl border border-dashed border-border/60 bg-card/60",
          className,
        )}
      >
        {emptyState ?? (
          <p className="text-sm text-muted-foreground">
            No alternatives available yet.
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-0 content-start grid-cols-[repeat(auto-fit,minmax(var(--alternatives-col-min,6rem),1fr))] gap-[2px] overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent",
        className,
      )}
      style={
        {
          "--alternatives-col-min": `${minColumnWidthRem}rem`,
        } as React.CSSProperties
      }
    >
      {products.map((product) => {
        const formattedPrice =
          typeof product.price === "number"
            ? CURRENCY_FORMATTER.format(product.price)
            : product.price
        const saved = isProductSaved ? isProductSaved(product.id) : false

        return (
          <div
            key={product.id}
            onClick={() => onSelect?.(product)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect?.(product)
              }
            }}
            role="button"
            tabIndex={0}
            className="flex flex-col gap-0 items-stretch  rounded-1xl"
          >
            <ProductAlternateCard
              imageSrc={product.imageSrc}
              title={product.title}
              brand={product.brand ?? "Brand"}
              price={formattedPrice}
              onRemove={() => onRemove?.(product.id)}
              onSave={() => onSave?.(product.id)}
              isSaved={saved}
              onToggleSave={
                onToggleSave
                  ? () => {
                      onToggleSave(product.id, !saved)
                    }
                  : undefined
              }
              onLongPressSave={onLongPressSave ? () => onLongPressSave(product.id) : undefined}
            />
          </div>
        )
      })}
    </div>
  )
}
