import type { ProductSearchFilters } from "@/services/search/searchService"
import type { InspirationCategory } from "./types"

export type InspirationSearchGender = "male" | "female" | null

export function buildInspirationCatalogueFilters(
  category: InspirationCategory,
  gender: InspirationSearchGender,
): ProductSearchFilters {
  return {
    typeCategories: [category],
    ...(gender ? { genders: [gender, "unisex"] } : {}),
  }
}
