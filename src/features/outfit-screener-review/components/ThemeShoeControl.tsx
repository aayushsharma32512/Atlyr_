import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { OutfitCandidateTheme } from "@/services/outfit-screener-review/candidateThemesService"
import type { FootwearProductInfo } from "@/services/outfit-screener-review/candidateCompositeService"
import { useSetThemeShoes } from "../hooks/useSetThemeShoes"

interface ThemeShoeControlProps {
    theme: OutfitCandidateTheme
    footwearProducts: FootwearProductInfo[]
}

/**
 * The theme's default shoe, small and out of the way of the accept/reject
 * loop. Tapping it opens the theme's footwear options; picking one applies
 * to every pair in the theme that has no pair-level override.
 */
export function ThemeShoeControl({ theme, footwearProducts }: ThemeShoeControlProps) {
    const setThemeShoesMutation = useSetThemeShoes(theme.theme_id)
    const chosenProduct = footwearProducts.find((p) => p.id === theme.chosen_shoes_id)

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                >
                    <img
                        src={chosenProduct?.thumbnail_url ?? chosenProduct?.image_url ?? undefined}
                        alt=""
                        className="h-8 w-8 rounded bg-muted object-contain"
                    />
                    <span>Theme shoe &middot; change</span>
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
                <p className="mb-2 text-xs font-medium text-foreground">Default shoe for this theme</p>
                <div className="grid grid-cols-4 gap-2">
                    {theme.footwear_options.map((option) => {
                        const product = footwearProducts.find((p) => p.id === option.shoes_id)
                        const isSelected = option.shoes_id === theme.chosen_shoes_id
                        return (
                            <button
                                key={option.shoes_id}
                                type="button"
                                onClick={() => setThemeShoesMutation.mutate(option.shoes_id)}
                                className={cn(
                                    "flex flex-col items-center gap-1 rounded-md border p-1 transition-colors",
                                    isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50",
                                )}
                            >
                                <img
                                    src={product?.thumbnail_url ?? product?.image_url ?? undefined}
                                    alt={product?.product_name ?? option.shoes_line}
                                    className="h-12 w-12 rounded bg-muted object-contain"
                                />
                            </button>
                        )
                    })}
                </div>
            </PopoverContent>
        </Popover>
    )
}
