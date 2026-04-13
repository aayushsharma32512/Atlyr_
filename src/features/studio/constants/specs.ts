import { createElement } from "react"
import { ChevronsRight, Heart, IterationCw, PaintBucket, Ruler, SwatchBook, Truck } from "lucide-react"

import type { SpecRowItem } from "@/features/studio/components/SpecRow"

const icon = (Component: typeof SwatchBook) =>
  createElement(Component, { className: "h-3 w-3", "aria-hidden": "true" })

export const BASE_PRIMARY_SPECS: SpecRowItem[] = [
  {
    icon: icon(SwatchBook),
    label: "Cotton",
  },
  {
    icon: icon(PaintBucket),
    label: "Machine",
  },
  {
    icon: icon(Ruler),
    ariaLabel: "Size chart",
  },
]

export const BASE_DELIVERY_SPECS: SpecRowItem[] = [
  {
    icon: icon(Truck),
    label: "3 days",
  },
  {
    icon: icon(IterationCw),
    label: "15 days",
  },
  {
    icon: icon(Heart),
    ariaLabel: "Save",
  },
]

