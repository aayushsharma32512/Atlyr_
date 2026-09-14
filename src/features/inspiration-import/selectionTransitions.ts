import type {
  InspirationCatalogueResult,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

// Inventory and Web each keep their own pick per category — one does not replace the other.
// See toggleWebChoice below for why.
export function toggleInventoryChoice(
  current: InspirationCatalogueResult | null,
  result: InspirationCatalogueResult,
): InspirationCatalogueResult | null {
  return current?.id === result.id ? null : result
}

// A Web pick only ever changes what the "Online pick" card shows. It must never replace or
// clear the Inventory pick, which is the only thing the mannequin renders.
export function toggleWebChoice(
  current: InspirationWebResult | null,
  result: InspirationWebResult,
): InspirationWebResult | null {
  return current?.providerResultId === result.providerResultId ? null : result
}
