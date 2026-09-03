import type { InspirationCandidate, InspirationCategory } from "@/services/inspirationImport/types"

const CATEGORY_ORDER: InspirationCategory[] = ["top", "bottom"]

type CandidateChoice = Pick<InspirationCandidate, "id" | "category" | "confidence">

export function getDefaultCandidateIds(candidates: CandidateChoice[]): string[] {
  return CATEGORY_ORDER.flatMap((category) => {
    let best: CandidateChoice | null = null
    for (const candidate of candidates) {
      if (candidate.category !== category) continue
      if (!best || candidate.confidence > best.confidence) best = candidate
    }
    return best ? [best.id] : []
  })
}
