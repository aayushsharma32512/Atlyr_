import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { FootwearOption } from "@/services/outfit-screener-review/candidateThemesService"
import type { OutfitCandidatePair } from "@/services/outfit-screener-review/candidatePairsService"
import type { FootwearProductInfo } from "@/services/outfit-screener-review/candidateCompositeService"

interface PairShoeOverrideProps {
    pair: OutfitCandidatePair
    footwearOptions: FootwearOption[]
    footwearProducts: FootwearProductInfo[]
    onOverride: (shoesId: string | null) => void
}

/**
 * Off by default on every card. Turning it on reveals the theme's footwear
 * options as thumbnails so a reviewer can pick a different shoe for just
 * this one pair, when the theme default looks really wrong on it.
 */
export function PairShoeOverride({ pair, footwearOptions, footwearProducts, onOverride }: PairShoeOverrideProps) {
    const [expanded, setExpanded] = useState(Boolean(pair.shoes_override_id))

    // A fresh pair always starts collapsed, unless it already carries an override
    // from an earlier review pass.
    useEffect(() => {
        setExpanded(Boolean(pair.shoes_override_id))
    }, [pair.id, pair.shoes_override_id])

    const handleToggle = (checked: boolean) => {
        setExpanded(checked)
        if (!checked && pair.shoes_override_id) {
            onOverride(null)
        }
    }

    return (
        <div className="rounded-md border border-border/60 px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={expanded} onCheckedChange={handleToggle} />
                Shoe looks off for this pair? Override it
            </label>

            {expanded ? (
                <div className="mt-2 flex flex-wrap gap-2">
                    {footwearOptions.map((option) => {
                        const product = footwearProducts.find((p) => p.id === option.shoes_id)
                        const isSelected = pair.shoes_override_id === option.shoes_id
                        return (
                            <button
                                key={option.shoes_id}
                                type="button"
                                onClick={() => onOverride(option.shoes_id)}
                                className={cn(
                                    "flex flex-col items-center gap-1 rounded-md border p-1 transition-colors",
                                    isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50",
                                )}
                            >
                                <img
                                    src={product?.thumbnail_url ?? product?.image_url ?? undefined}
                                    alt={product?.product_name ?? option.shoes_line}
                                    className="h-10 w-10 rounded bg-muted object-contain"
                                />
                            </button>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}
