import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { inspirationImportKeys } from "@/features/inspiration-import/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useJobs } from "@/features/progress/providers/JobsContext"
import { inspirationImportService } from "@/services/inspirationImport/inspirationImportService"
import type {
  InspirationImport,
  InspirationOpenStudioInput,
  InspirationStageSelectionsInput,
} from "@/services/inspirationImport/types"

const DETECTION_POLL_INTERVAL_MS = 3_000

export function useStartInspirationImport() {
  const { addJob } = useJobs()
  return useMutation({
    mutationFn: inspirationImportService.startImageImport,
    // The detect step runs in the background; tracking it as a job is what
    // lets the hub and Notifications say "pieces found" after you leave.
    onSuccess: ({ importId }) =>
      addJob({ id: "import-" + importId, type: "import", status: "processing", progress: 0, metadata: { importId } }),
  })
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

/**
 * One Web search per selected candidate (top and/or bottom), fired the moment each candidate is
 * selected — not gated on which tab the user has open. Mirrors useImportCatalogueResults so both
 * sources preload the same way; whichever categories exist get their own independent fetch.
 */
export function useImportWebResults(
  importId: string,
  candidates: { id: string }[],
) {
  const queries = useQueries({
    queries: candidates.map((candidate) => ({
      queryKey: inspirationImportKeys.web(importId, candidate.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        inspirationImportService.searchWeb(importId, candidate.id, signal),
      enabled: Boolean(importId && candidate.id),
      retry: false,
      staleTime: 60 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
    })),
  })

  return candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    data: queries[index]?.data,
    error: queries[index]?.error ?? null,
    isFetching: queries[index]?.isFetching ?? false,
    isError: queries[index]?.isError ?? false,
  }))
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
