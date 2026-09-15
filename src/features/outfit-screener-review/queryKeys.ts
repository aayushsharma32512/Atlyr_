export const outfitScreenerQueryKeys = {
    all: ["outfit-screener-review"] as const,
    themes: () => [...outfitScreenerQueryKeys.all, "themes"] as const,
    theme: (themeId: string) => [...outfitScreenerQueryKeys.all, "theme", themeId] as const,
    queue: (themeId: string) => [...outfitScreenerQueryKeys.all, "queue", themeId] as const,
    composite: (topId: string, bottomId: string, shoesId: string) =>
        [...outfitScreenerQueryKeys.all, "composite", topId, bottomId, shoesId] as const,
    footwear: (themeId: string) => [...outfitScreenerQueryKeys.all, "footwear", themeId] as const,
}
