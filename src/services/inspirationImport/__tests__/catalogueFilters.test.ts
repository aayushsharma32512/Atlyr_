import { describe, expect, it } from "@jest/globals"

import { buildInspirationCatalogueFilters } from "@/services/inspirationImport/catalogueFilters"

describe("buildInspirationCatalogueFilters", () => {
  it("constrains female searches to the selected category plus female and unisex products", () => {
    expect(buildInspirationCatalogueFilters("top", "female")).toEqual({
      typeCategories: ["top"],
      genders: ["female", "unisex"],
    })
  })

  it("constrains male searches to the selected category plus male and unisex products", () => {
    expect(buildInspirationCatalogueFilters("bottom", "male")).toEqual({
      typeCategories: ["bottom"],
      genders: ["male", "unisex"],
    })
  })

  it("keeps the category constraint without inventing a gender when the profile has none", () => {
    expect(buildInspirationCatalogueFilters("top", null)).toEqual({
      typeCategories: ["top"],
    })
  })
})
