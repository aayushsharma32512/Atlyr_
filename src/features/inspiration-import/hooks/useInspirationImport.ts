import { useCallback, useRef } from "react"
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

type PreflightEntry = { file: File; promise: Promise<{ importId: string }>; failed: boolean }

export function useStartInspirationImport() {
  const { addJob } = useJobs()
  const preflightRef = useRef<PreflightEntry | null>(null)

  // Runs the create/upload/source-ready/detect chain as soon as a photo is
  // picked, not on "Find items" — by the time the user confirms, it has often
  // already finished. Calling this again with the same File reuses that run;
  // a different File (the user swapped photos) or a failed run starts fresh.
  // The cache lives only in this ref, so it is gone the moment this screen
  // unmounts.
  const preflight = useCallback((file: File) => {
    const cached = preflightRef.current
    if (cached && cached.file === file && !cached.failed) return cached.promise

    let failed = false
    const promise = inspirationImportService.startImageImport(file).catch((error) => {
      failed = true
      throw error
    })
    promise.catch(() => {}) // prevents an unhandled-rejection warning if the user never clicks "Find items"
    preflightRef.current = { file, promise, get failed() { return failed } }
    return promise
  }, [])

  const mutation = useMutation({
    mutationFn: preflight,
    // The detect step runs in the background; tracking it as a job is what
    // lets the hub and Notifications say "pieces found" after you leave.
    onSuccess: ({ importId }) =>
      addJob({ id: "import-" + importId, type: "import", status: "processing", progress: 0, metadata: { importId } }),
  })

  return { ...mutation, preflight }
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

export function useImportWebResults(importId: string, candidateId: string | null) {
  return useQuery({
    queryKey: inspirationImportKeys.web(importId, candidateId ?? "none"),
    queryFn: ({ signal }) => candidateId
      ? inspirationImportService.searchWeb(importId, candidateId, signal)
      : Promise.resolve([]),
    enabled: false,
    retry: false,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
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
