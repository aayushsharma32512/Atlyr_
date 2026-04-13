type Gender = "male" | "female" | null

export const homeKeys = {
  all: ["home"] as const,
  recentStyles: (userId: string | null, gender: Gender) =>
    [...homeKeys.all, "recent-styles", userId ?? "guest", gender ?? "neutral"] as const,
  curatedOutfits: (gender: Gender, size: number, seed: string) =>
    [...homeKeys.all, "curated-outfits", gender ?? "neutral", size, seed] as const,
}
