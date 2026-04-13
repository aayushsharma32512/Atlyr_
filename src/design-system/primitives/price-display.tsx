import * as React from "react"

import { cn } from "@/lib/utils"

type FormatOptions = {
  currency?: string
  maximumFractionDigits?: number
}

const DEFAULT_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

export interface PriceDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  price: number | string
  discountPercent?: number | null
  formatter?: (value: number | string) => string
  formatOptions?: FormatOptions
}

export function PriceDisplay({
  price,
  discountPercent,
  formatter,
  formatOptions,
  className,
  ...props
}: PriceDisplayProps) {
  const formattedPrice = React.useMemo(() => {
    if (typeof formatter === "function") {
      return formatter(price)
    }

    if (typeof price === "string") {
      return price
    }

    const baseFormatter = formatOptions
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: formatOptions.currency ?? "INR",
          maximumFractionDigits: formatOptions.maximumFractionDigits ?? 0,
        })
      : DEFAULT_FORMATTER

    return baseFormatter.format(price)
  }, [price, formatter, formatOptions])

  const formattedDiscount = React.useMemo(() => {
    if (discountPercent == null) return null

    const value = Math.round(discountPercent)
    const sign = value > 0 ? "-" : value < 0 ? "+" : ""
    return `${sign}${Math.abs(value)}%`
  }, [discountPercent])

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 text-xs font-semibold leading-5 text-foreground",
        className
      )}
      {...props}
    >
      <span>{formattedPrice}</span>
      {formattedDiscount ? (
        <span className="font-normal text-muted-foreground">
          ({formattedDiscount})
        </span>
      ) : null}
    </span>
  )
}

