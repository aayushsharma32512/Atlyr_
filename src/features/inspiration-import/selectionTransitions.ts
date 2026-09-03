import type {
  InspirationCatalogueResult,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

export type InspirationResultChoice =
  | { source: "inventory"; result: InspirationCatalogueResult }
  | { source: "web"; result: InspirationWebResult }

export function toggleInventoryChoice(
  current: InspirationResultChoice | null,
  result: InspirationCatalogueResult,
): InspirationResultChoice | null {
  return current?.source === "inventory" && current.result.id === result.id
    ? null
    : { source: "inventory", result }
}

export function toggleWebChoice(
  current: InspirationResultChoice | null,
  result: InspirationWebResult,
): InspirationResultChoice | null {
  return current?.source === "web" && current.result.providerResultId === result.providerResultId
    ? null
    : { source: "web", result }
}
