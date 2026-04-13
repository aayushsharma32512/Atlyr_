import { TrayActionButton } from "@/design-system/primitives"
import { cn } from "@/lib/utils"
import type { TryOn } from "@/services/collections/collectionsService"
import type { RefCallback } from "react"
import { ArrowUpRight } from "lucide-react"

type TryOnGridProps = {
  items: TryOn[]
  onSelect: (item: TryOn, index: number) => void
  onOpenStudio: (item: TryOn) => void
  overlay?: boolean
  getItemWrapperRef?: (item: TryOn, index: number) => RefCallback<HTMLDivElement> | undefined
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

export function TryOnGrid({ items, onSelect, onOpenStudio, overlay = true, getItemWrapperRef }: TryOnGridProps) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-muted-foreground/30 bg-muted/10 text-sm text-muted-foreground">
        No try-ons yet
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item, index) => {
        const label = dateFormatter.format(new Date(item.createdAt))
        return (
          <div
            key={item.id}
            ref={getItemWrapperRef?.(item, index)}
            className={cn(
              "group relative aspect-[3/4] overflow-hidden rounded-2xl border border-muted-foreground/10 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md",
              item.imageUrl ? "text-foreground" : "text-muted-foreground",
            )}
            role="button"
            tabIndex={0}
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => onSelect(item, index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect(item, index)
              }
            }}
            style={{ WebkitTouchCallout: "none" }}
          >
            {item.imageUrl ? (
              <>
                <img
                  src={item.imageUrl}
                  alt="Try-on preview"
                  className="h-full w-full object-cover select-none"
                  loading="lazy"
                  draggable={false}
                />
                <div
                  className="absolute bottom-1 right-1 z-10 rounded-full px-0.5 py-0 text-[10px] font-medium text-foreground"
                  onContextMenu={(event) => event.preventDefault()}
                  style={{ WebkitTouchCallout: "none" }}
                >
                  Atlyr
                </div>
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs">Preview unavailable</div>
            )}
            <div className="absolute left-1 top-1 px-2 py-1 font-medium text-foreground text-nowrap text-xs2">
              {label}
            </div>
            {item.outfitId ? (
              <div className="absolute bottom-1 left-1 z-20">
                <TrayActionButton
                  tone="plain"
                  iconEnd={ArrowUpRight}
                  label="Studio"
                  className="pointer-events-auto h-fit w-fit rounded-xl bg-transparent px-0.5 py-0 text-[10px] font-medium text-foreground hover:bg-background"
                  onClick={() => onOpenStudio(item)}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
