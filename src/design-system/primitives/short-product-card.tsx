import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { PriceDisplay } from "./price-display"
import { StatChip } from "./stat-chip"

import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Cross, Heart, ShoppingBag, Star, Users, X } from "lucide-react"
import { Toast } from "@radix-ui/react-toast"
import { useCallback } from "react"
import { toast } from "sonner"

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


  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toast("Removed from alternatives")
    },
    [toast],
  )



  return (
    <div
      className={cn(
        "flex h-32 w-44 flex-col justify-between rounded-2xl bg-card px-0.5 py-1",
        className,
      )}
    >
      <div className="space-y-0 h-full relative">
        {/* <button
            type="button"
            onClick={()=>{handleRemove}}
            aria-label="Open product details"
            className="absolute bottom-0 right-0 flex size-4 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button> */}
        <button
          type="button"
          onClick={onOpenDetails}
          aria-label="Open product details"
          className="absolute top-0 right-0  flex size-4 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="size-4 " aria-hidden="true" />
        </button>

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
          onClick={onSave}
          className="h-9 w-full gap-2 rounded-lg border-input bg-card px-2 py-1 text-sm font-medium text-foreground"
        >
          <Heart className="size-4" aria-hidden="true" />
          Save
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={onBuy}
          className="h-9 w-full gap-2 rounded-lg bg-foreground px-2 py-1 text-sm font-medium text-primary-foreground hover:bg-foreground/90"
        >
          <ShoppingBag className="size-4" aria-hidden="true" />
          Buy
        </Button>
      </div>
    </div>
  )
}


