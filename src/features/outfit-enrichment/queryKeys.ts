export const enrichmentQueryKeys = {
    all: ["outfit-enrichment"] as const,
    drafts: () => [...enrichmentQueryKeys.all, "drafts"] as const,
    draftsByStatus: (status: string, page: number = 1, limit: number = 50) =>
        [...enrichmentQueryKeys.drafts(), status, { page, limit }] as const,
    draftDetail: (draftId: string) =>
        [...enrichmentQueryKeys.drafts(), draftId] as const,
    enrichedOutfits: () => [...enrichmentQueryKeys.all, "enriched"] as const,
    enrichedByOutfits: (outfitIds: string[]) =>
        [...enrichmentQueryKeys.enrichedOutfits(), outfitIds] as const,
    // Batch enrichment
    batchJobs: () => [...enrichmentQueryKeys.all, "batch"] as const,
    batchJob: (jobId: string) =>
        [...enrichmentQueryKeys.batchJobs(), jobId] as const,
    counts: () => [...enrichmentQueryKeys.all, "counts"] as const,
}

