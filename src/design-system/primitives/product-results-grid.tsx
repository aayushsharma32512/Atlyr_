import { useMemo, type RefCallback } from "react"

import { cn } from "@/lib/utils"

import { ProductAlternateCard, type ProductAlternateCardProps } from "./product-alternate-card"
import { buildGridColumns } from "./balanced-grid-utils"

interface ProductResultsGridItem
  extends Pick<
    ProductAlternateCardProps,
    "imageSrc" | "title" | "brand" | "price" | "onRemove" | "onSave" | "onToggleSave" | "onLongPressSave" | "isSaved"
  > {
  id: string
}

interface ProductResultsGridProps {
  items: ProductResultsGridItem[]
  className?: string
  columns?: number
  rows?: number
  onItemSelect?: (item: ProductResultsGridItem) => void
  getItemWrapperRef?: (item: ProductResultsGridItem) => RefCallback<HTMLDivElement> | undefined
}

const DEFAULT_COLUMNS = 3
const DEFAULT_ROWS = 8

export function ProductResultsGrid({
  items,
  className,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  onItemSelect,
  getItemWrapperRef,
}: ProductResultsGridProps) {
  const columnBuckets = useMemo(() => {
    const safeColumns = Math.max(columns, 1)
    const effectiveRows = Math.max(rows, Math.ceil(items.length / safeColumns))

    return buildGridColumns(items, safeColumns, effectiveRows, (item, index) => `${item.id}-${index}`)
  }, [columns, items, rows])

  const isInteractive = Boolean(onItemSelect)

  return (
    <div className={cn("flex flex-1 gap-1.5", className, "min-w-0")}>
      {columnBuckets.map((column, columnIndex) => (
        <div className="flex w-full flex-1 flex-col gap-1 min-w-0" key={`product-grid-column-${columnIndex}`}>
          {column.map(({ item, key }) => (
            <div
              key={key}
              ref={getItemWrapperRef?.(item)}
              role={isInteractive ? "button" : undefined}
              tabIndex={isInteractive ? 0 : undefined}
              onClick={isInteractive ? () => onItemSelect?.(item) : undefined}
              onKeyDown={
                isInteractive
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onItemSelect?.(item)
                      }
                    }
                  : undefined
              }
              className={cn(isInteractive && "cursor-pointer")}
            >
              <ProductAlternateCard
                imageSrc={item.imageSrc}
                title={item.title}
                brand={item.brand}
                price={item.price}
                onRemove={item.onRemove}
                onSave={item.onSave}
                onToggleSave={item.onToggleSave}
                onLongPressSave={item.onLongPressSave}
                isSaved={item.isSaved}
                layout="fluid"
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
