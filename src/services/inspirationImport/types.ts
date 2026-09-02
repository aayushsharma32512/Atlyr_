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
  title: string
  merchantDomain: string
  listingUrl: string
  imageUrl: string
  rank: number
}

export type InspirationImport = {
  import: {
    id: string
    status: string
    errorCode: string | null
    errorMessage: string | null
  }
  sourceUrl: string | null
  candidates: InspirationCandidate[]
  selectedCandidateId: string | null
  selectedCandidateIds: string[]
  webResults: InspirationWebResult[]
  selections: {
    catalogueProductIds: string[]
    webResultId: string | null
  }
}

export type InspirationCommitInput = {
  catalogueProductIds: string[]
  webResultId: string | null
}

export type InspirationCommitResult = {
  catalogue: {
    addedProductIds: string[]
    alreadyPresentProductIds: string[]
  }
  web: { selectionId: string; status: "selected_for_ingestion" } | null
}

export type InspirationCatalogueResult = ProductSearchResult
