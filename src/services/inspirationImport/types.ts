import type { ProductSearchResult } from "@/services/search/searchService"

export type InspirationCategory = "top" | "bottom"

export type InspirationCandidate = {
  id: string
  category: InspirationCategory
  label: string | null
  confidence: number
  bbox: { l: number; t: number; w: number; h: number }
  boxSource: "fashn_union_dino" | "fashn_only" | "dino_only"
  retrievalCropUrl: string
  selected: boolean
  metrics: Record<string, unknown>
}

export type InspirationWebResult = {
  id: string
  candidateId: string
  providerResultId: string
  title: string
  merchantDomain: string
  listingUrl: string
  imageUrl: string
  rank: number
  priceLabel: string | null
  selectionToken: string | null
}

export type InspirationImport = {
  import: {
    id: string
    status: string
    errorCode: string | null
    errorMessage: string | null
    studioOutfitId: string | null
  }
  sourceUrl: string | null
  candidates: InspirationCandidate[]
  selectedCandidateId: string | null
  selectedCandidateIds: string[]
  webResults: InspirationWebResult[]
  selections: {
    catalogueProductIds: string[]
    webResultIds: string[]
  }
}

type InspirationWebSelectionInput = {
  candidateId: string
  selectionToken: string
}

type InspirationCatalogueSelectionInput = {
  candidateId: string
  productId: string
}

export type InspirationStageSelectionsInput = {
  selections: InspirationWebSelectionInput[]
  catalogueSelections: InspirationCatalogueSelectionInput[]
}

export type InspirationStageSelectionsResult = {
  selectionCount: number
  webSelectionIds: string[]
}

export type InspirationOpenStudioInput = {
  outfitId: string
  topProductId: string | null
  bottomProductId: string | null
}

export type InspirationOpenStudioResult = {
  outfitId: string
  topId: string | null
  bottomId: string | null
}

export type InspirationCatalogueResult = ProductSearchResult
