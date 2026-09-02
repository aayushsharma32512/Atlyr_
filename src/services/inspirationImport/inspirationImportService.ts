import { supabase } from "@/integrations/supabase/client"
import { searchService } from "@/services/search/searchService"
import type {
  InspirationCommitInput,
  InspirationCommitResult,
  InspirationImport,
  InspirationWebResult,
} from "./types"
import {
  buildInspirationCatalogueFilters,
  type InspirationSearchGender,
} from "./catalogueFilters"
import { filterValidWebResults } from "./webResults"

async function invokeImport<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("inspiration-import", { body })
  if (!error) return data as T
  const context = (error as { context?: Response }).context
  if (context) {
    const payload = await context.clone().json().catch(() => null) as { message?: string; error?: string } | null
    throw new Error(payload?.message ?? payload?.error ?? error.message)
  }
  throw new Error(error.message)
}

async function createImport(file: File) {
  return invokeImport<{ importId: string; uploadPath: string }>({
    action: "create", sourceKind: "image", mimeType: file.type,
  })
}

async function uploadSource(uploadPath: string, file: File) {
  const { error } = await supabase.storage.from("inspiration-imports").upload(uploadPath, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(error.message)
}

async function markSourceReady(importId: string, file: File) {
  await invokeImport({ action: "source-ready", importId, mimeType: file.type, sizeBytes: file.size })
}

async function detectCandidates(importId: string) {
  return invokeImport({ action: "detect", importId })
}

async function startImageImport(file: File): Promise<{ importId: string }> {
  const created = await createImport(file)
  try {
    await uploadSource(created.uploadPath, file)
    await markSourceReady(created.importId, file)
    await detectCandidates(created.importId)
    return { importId: created.importId }
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("Import failed"), {
      importId: created.importId,
    })
  }
}

async function getImport(importId: string): Promise<InspirationImport> {
  const record = await invokeImport<InspirationImport>({ action: "get", importId })
  return { ...record, webResults: filterValidWebResults(record.webResults) }
}

async function selectCandidates(importId: string, candidateIds: string[]) {
  return invokeImport<{
    selectedCandidateId: string | null
    selectedCandidateIds: string[]
    selectedCandidates: Array<{ id: string; category: "top" | "bottom" }>
  }>({
    action: "select-candidate", importId, candidateIds,
  })
}

async function searchCatalogue(
  importRecord: InspirationImport,
  gender: InspirationSearchGender,
  candidateId?: string,
) {
  const candidate = importRecord.candidates.find((item) => item.id === (candidateId ?? importRecord.selectedCandidateId))
  if (!candidate) return []
  const response = await searchService.searchProducts({
    imageUrl: candidate.retrievalCropUrl,
    filters: buildInspirationCatalogueFilters(candidate.category, gender),
  })
  return response.results
}

async function searchWeb(importId: string, candidateId?: string): Promise<InspirationWebResult[]> {
  const response = await invokeImport<{ results: InspirationWebResult[] }>({
    action: "web-search", importId, ...(candidateId ? { candidateId } : {}),
  })
  return filterValidWebResults(response.results)
}

async function commitSelections(importId: string, input: InspirationCommitInput) {
  return invokeImport<InspirationCommitResult>({ action: "commit", importId, ...input })
}

export const inspirationImportService = {
  startImageImport,
  getImport,
  detectCandidates,
  selectCandidates,
  searchCatalogue,
  searchWeb,
  commitSelections,
}
