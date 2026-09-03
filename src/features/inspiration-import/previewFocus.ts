import type { InspirationCategory } from "@/services/inspirationImport/types"

export function resolvePreviewCategory(
  activeCategory: InspirationCategory,
  choices: Partial<Record<InspirationCategory, unknown>>,
): InspirationCategory {
  if (choices[activeCategory]) return activeCategory
  const otherCategory = activeCategory === "top" ? "bottom" : "top"
  return choices[otherCategory] ? otherCategory : activeCategory
}
