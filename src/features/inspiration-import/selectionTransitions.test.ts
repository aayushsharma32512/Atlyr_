import { describe, expect, test } from "bun:test"
import type {
  InspirationCatalogueResult,
  InspirationWebResult,
} from "@/services/inspirationImport/types"
import {
  toggleInventoryChoice,
  toggleWebChoice,
} from "./selectionTransitions"

const inventoryResult = { id: "inventory-1" } as InspirationCatalogueResult
const otherInventoryResult = { id: "inventory-2" } as InspirationCatalogueResult
const webResult = { providerResultId: "web-1" } as InspirationWebResult

describe("inspiration result selection transitions", () => {
  test("an inventory click selects an empty category and a second click deselects it", () => {
    const selected = toggleInventoryChoice(null, inventoryResult)

    expect(selected).toEqual(inventoryResult)
    expect(toggleInventoryChoice(selected, inventoryResult)).toBeNull()
  })

  test("clicking another inventory item replaces the selected item", () => {
    const selected = toggleInventoryChoice(null, inventoryResult)

    expect(toggleInventoryChoice(selected, otherInventoryResult)).toEqual(otherInventoryResult)
  })

  test("a web click selects an empty category", () => {
    expect(toggleWebChoice(null, webResult)).toEqual(webResult)
  })

  test("a second web click deselects it", () => {
    const selected = toggleWebChoice(null, webResult)

    expect(toggleWebChoice(selected, webResult)).toBeNull()
  })
})
