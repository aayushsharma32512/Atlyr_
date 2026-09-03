import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { inspirationImportKeys } from "@/features/inspiration-import/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { inspirationImportService } from "@/services/inspirationImport/inspirationImportService"
import type {
  InspirationImport,
  InspirationOpenStudioInput,
  InspirationStageSelectionsInput,
} from "@/services/inspirationImport/types"

const DETECTION_POLL_INTERVAL_MS = 3_000

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
      return record?.import.status === "detecting" ? DETECTION_POLL_INTERVAL_MS : false
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
  return useMutation({
    mutationFn: (candidateId: string) => inspirationImportService.searchWeb(importId, candidateId),
  })
}

export function useStageImportSelections(importId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InspirationStageSelectionsInput) => inspirationImportService.stageSelections(importId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(importId) })
    },
  })
}

export function useOpenInspirationImportInStudio(importId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InspirationOpenStudioInput) => inspirationImportService.openInStudio(importId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(importId) }),
  })
}
