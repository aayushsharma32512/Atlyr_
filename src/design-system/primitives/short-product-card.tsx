import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PriceDisplay } from "./price-display"
import { StatChip } from "./stat-chip"
import { Heart, ShoppingBag, Star, Users } from "lucide-react"

export interface ShortProductCardProps {
  title: string
  price: number | string
  discountPercent?: number | null
  rating: number | string
  reviewCount: number | string
  onOpenDetails?: () => void
  onSave?: () => void
  onBuy?: () => void
  className?: string
}

export function ShortProductCard({
  title,
  price,
  discountPercent,
  rating,
  reviewCount,
  onOpenDetails,
  onSave,
  onBuy,
  className,
}: ShortProductCardProps) {
  return (
    <div
      role={onOpenDetails ? "button" : undefined}
      tabIndex={onOpenDetails ? 0 : undefined}
      onClick={onOpenDetails}
      onKeyDown={onOpenDetails ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenDetails() } } : undefined}
      className={cn(
        "flex h-32 w-44 flex-col justify-between rounded-2xl bg-card px-0.5 py-1",
        onOpenDetails && "cursor-pointer shadow-sm ring-1 ring-border/30",
        className,
      )}
    >
      <div className="space-y-0 h-full relative">
        <div className="flex items-center gap-1 px-0.5">
          <h3 className="flex-1 truncate text-xs font-medium text-foreground">
            {title}
          </h3>
        </div>

        <PriceDisplay
          price={price}
          discountPercent={discountPercent ?? undefined}
          className="px-0.5 py-1.5 text-xs font-medium text-foreground"
        />

        <div className="flex items-center gap-1 px-0.5">
          <StatChip
            icon={<Star className="size-3" />}
            className="gap-1 rounded-md px-0 py-0 text-xs2 font-medium leading-snug"
            textClassName="text-muted-foreground"
            iconWrapperClassName="text-foreground"
          >
            {rating}
          </StatChip>
          <StatChip
            icon={<Users className="size-3" />}
            className="gap-1 rounded-md px-1 py-0 text-xs2 font-medium leading-snug"
            textClassName="text-muted-foreground"
            iconWrapperClassName="text-foreground"
          >
            {reviewCount}
          </StatChip>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-0 py-0">
        <Button
          type="button"
          variant="outline"
          onClick={(e) => { e.stopPropagation(); onSave?.() }}
          className="h-9 w-full gap-2 rounded-lg border-input bg-card px-2 py-1 text-sm font-medium text-foreground"
        >
          <Heart className="size-4" aria-hidden="true" />
          Save
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={(e) => { e.stopPropagation(); onBuy?.() }}
          className="h-9 w-full gap-2 rounded-lg bg-foreground px-2 py-1 text-sm font-medium text-primary-foreground hover:bg-foreground/90"
        >
          <ShoppingBag className="size-4" aria-hidden="true" />
          Buy
        </Button>
      </div>
    </div>
  )
}


