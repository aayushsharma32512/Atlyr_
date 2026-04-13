export const outfitsKeys = {
  all: ["outfits"] as const,
  categories: (limit: number | null, term: string | null) =>
    [...outfitsKeys.all, "categories", limit ?? "all", term ?? ""] as const,
  occasions: (limit: number | null, term: string | null) =>
    [...outfitsKeys.all, "occasions", limit ?? "all", term ?? ""] as const,
  save: ["outfits", "save"] as const,
  update: ["outfits", "update"] as const,
  createDraft: ["outfits", "create-draft"] as const,
  findByItems: ["outfits", "find-by-items"] as const,
  starterByGender: (gender: "male" | "female") =>
    [...outfitsKeys.all, "starter", gender] as const,
}
