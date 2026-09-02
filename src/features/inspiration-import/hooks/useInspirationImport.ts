import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { collectionsKeys } from "@/features/collections/queryKeys"
import { inspirationImportKeys } from "@/features/inspiration-import/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { inspirationImportService } from "@/services/inspirationImport/inspirationImportService"
import type { InspirationCommitInput, InspirationImport } from "@/services/inspirationImport/types"

export function useStartInspirationImport() {
  return useMutation({ mutationFn: inspirationImportService.startImageImport })
}

export function useInspirationImport(importId: string | null) {
  return useQuery({
    queryKey: importId ? inspirationImportKeys.detail(importId) : inspirationImportKeys.detail("new"),
    queryFn: () => inspirationImportService.getImport(importId!),
    enabled: Boolean(importId),
    staleTime: 2_000,
    refetchInterval: (query) => {
      const record = query.state.data as InspirationImport | undefined
      return record?.import.status === "detecting" ? 1_500 : false
    },
  })
}

export function useDetectImportCandidates(importId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => inspirationImportService.detectCandidates(importId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(importId) }),
  })
}

export function useSelectImportCandidates(importId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (candidateIds: string[]) => inspirationImportService.selectCandidates(importId, candidateIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(importId) }),
  })
}

export function useImportCatalogueResults(
  importRecord: InspirationImport | undefined,
) {
  const { gender, isLoading: isProfileLoading } = useProfileContext()
  const selectedIds = new Set(importRecord?.selectedCandidateIds ?? [])
  const selectedCandidates = (importRecord?.candidates ?? [])
    .filter((candidate) => selectedIds.has(candidate.id))
    .sort((left, right) => left.category.localeCompare(right.category))
  const queries = useQueries({
    queries: selectedCandidates.map((candidate) => ({
      queryKey: inspirationImportKeys.catalogue(
        importRecord!.import.id,
        candidate.id,
        candidate.category,
        gender,
      ),
      queryFn: () => inspirationImportService.searchCatalogue(importRecord!, gender, candidate.id),
      enabled: Boolean(importRecord && !isProfileLoading),
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    })),
  })

  return selectedCandidates.map((candidate, index) => ({
    candidate,
    results: queries[index]?.data ?? [],
    error: queries[index]?.error ?? null,
    isLoading: queries[index]?.isLoading ?? false,
  }))
}

export function useImportWebResults(importId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (candidateId?: string) => inspirationImportService.searchWeb(importId, candidateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(importId) }),
  })
}

export function useCommitImportSelections(importId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (input: InspirationCommitInput) => inspirationImportService.commitSelections(importId, input),
    onSuccess: (result) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(importId) }),
        queryClient.invalidateQueries({ queryKey: collectionsKeys.overview() }),
        queryClient.invalidateQueries({ queryKey: collectionsKeys.collectionProducts("wardrobe") }),
        queryClient.invalidateQueries({ queryKey: collectionsKeys.productFavorites() }),
        queryClient.invalidateQueries({ queryKey: collectionsKeys.moodboardPreview("wardrobe") }),
      ])
      const count = result.catalogue.addedProductIds.length
      toast({
        title: count ? `${count} item${count === 1 ? "" : "s"} added to Wardrobe` : "Selections saved",
        description: result.web ? "The online item is ready to import later." : undefined,
      })
    },
  })
}
