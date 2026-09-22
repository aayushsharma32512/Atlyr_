import { supabase } from "@/integrations/supabase/client"
import { searchService } from "@/services/search/searchService"
import type {
  InspirationImport,
  InspirationImportIntent,
  InspirationOpenStudioInput,
  InspirationOpenStudioResult,
  InspirationAddWebSelectionsInput,
  InspirationAddWebSelectionsResult,
  InspirationWebRequest,
  InspirationWebResult,
} from "./types"
import {
  buildInspirationCatalogueFilters,
  type InspirationSearchGender,
} from "./catalogueFilters"
import { filterValidWebResults } from "./webResults"
import { readWebSearchCache, writeWebSearchCache } from "./webSearchCache"

type InvokeImportOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  timeoutMessage?: string
}

function isAbortedRequest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const name = (value as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

async function invokeImport<T>(
  body: Record<string, unknown>,
  options: InvokeImportOptions = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("inspiration-import", {
    body,
    signal: options.signal,
    timeout: options.timeoutMs,
  })
  if (!error) return data as T
  const context = (error as { context?: unknown }).context
  if (options.timeoutMessage && isAbortedRequest(context)) {
    throw new Error(options.timeoutMessage)
  }
  if (typeof Response !== "undefined" && context instanceof Response) {
    const payload = await context.clone().json().catch(() => null) as { message?: string; error?: string } | null
    throw new Error(payload?.message ?? payload?.error ?? error.message)
  }
  throw new Error(error.message)
}

async function createImport(file: File, intent?: InspirationImportIntent) {
  return invokeImport<{ importId: string; uploadPath: string }>({
    action: "create", sourceKind: "image", mimeType: file.type, ...(intent ? { intent } : {}),
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

async function startImageImport(
  file: File,
  intent?: InspirationImportIntent,
): Promise<{ importId: string }> {
  const created = await createImport(file, intent)
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

export type SeedPiece = { file: File; category: "top" | "bottom" }

const EXT_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

/**
 * Seeded import: cutouts the client already holds become the selected
 * candidates directly — no detection round trip — so the import opens on the
 * rack. One piece is the globe on a product; two is Studio's Find items (the
 * worn top and bottom). The first cutout is the import's source; any other sits
 * beside it as original.<category>.<ext>, which the bucket policy admits.
 */
async function startSeededImport(pieces: SeedPiece[]): Promise<{ importId: string }> {
  const [first, ...rest] = pieces
  if (!first) throw new Error("Nothing to search with.")
  console.log("[find-items] 3/5 creating import", pieces.map((piece) => ({ category: piece.category, bytes: piece.file.size })))
  const created = await createImport(first.file)
  console.log("[find-items] 3/5 import created", created)
  try {
    await uploadSource(created.uploadPath, first.file)
    const extra = await Promise.all(
      rest.map(async (piece) => {
        const ext = EXT_BY_MIME[piece.file.type] ?? "webp"
        const path = created.uploadPath.replace(/original\.[^/]+$/, `original.${piece.category}.${ext}`)
        await uploadSource(path, piece.file)
        return { category: piece.category, path }
      }),
    )
    console.log("[find-items] 4/5 crops uploaded", { source: created.uploadPath, extra })
    await markSourceReady(created.importId, first.file)
    const seeded = await invokeImport<{ importId: string; candidateIds: string[]; status: string }>({
      action: "seed-candidate",
      importId: created.importId,
      pieces: [{ category: first.category, path: created.uploadPath }, ...extra],
    })
    console.log("[find-items] 5/5 candidates seeded", seeded)
    return { importId: created.importId }
  } catch (error) {
    console.error("[find-items] FAILED after create", { importId: created.importId, error })
    throw Object.assign(error instanceof Error ? error : new Error("Import failed"), {
      importId: created.importId,
    })
  }
}

async function startProductImport(file: File, category: "top" | "bottom"): Promise<{ importId: string }> {
  return startSeededImport([{ file, category }])
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

async function searchWeb(
  importId: string,
  candidateId: string,
  signal?: AbortSignal,
): Promise<InspirationWebResult[]> {
  const cached = readWebSearchCache(importId, candidateId)
  if (cached) return cached
  const response = await invokeImport<{ results: InspirationWebResult[] }>({
    action: "web-search", importId, candidateId,
  }, {
    signal,
    timeoutMs: 55_000,
    timeoutMessage: "Online search took too long. Please try again.",
  })
  const results = filterValidWebResults(response.results)
  writeWebSearchCache(importId, candidateId, results)
  return results
}

async function addWebSelections(
  importId: string,
  input: InspirationAddWebSelectionsInput,
): Promise<InspirationAddWebSelectionsResult> {
  return invokeImport<InspirationAddWebSelectionsResult>({
    action: "add-web-selections",
    importId,
    ...input,
  })
}

async function listWebRequests(): Promise<InspirationWebRequest[]> {
  const { requests } = await invokeImport<{ requests: InspirationWebRequest[] }>({ action: "admin-list-web-requests" })
  // Requests made before the flow was tagged carry no intent; those are inspiration.
  return requests.map((request) => ({
    ...request,
    intent: request.intent === "wardrobe" ? "wardrobe" : "inspiration",
  }))
}

async function markWebRequestQueued(input: { selectionId: string; ingestionJobId: string }) {
  return invokeImport<{ id: string; status: "queued"; ingestionJobId: string }>({ action: "admin-mark-web-request", ...input })
}

async function openInStudio(importId: string, input: InspirationOpenStudioInput) {
  return invokeImport<InspirationOpenStudioResult>({ action: "open-studio", importId, ...input })
}

export const inspirationImportService = {
  startImageImport,
  startProductImport,
  startSeededImport,
  getImport,
  detectCandidates,
  selectCandidates,
  searchCatalogue,
  searchWeb,
  addWebSelections,
  openInStudio,
  listWebRequests,
  markWebRequestQueued,
}
