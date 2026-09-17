import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import {
  INSPIRATION_BUCKET, HttpError, asObject, env, json, optionalString, publicError,
  requireUser, requiredString, safeHttpUrl, signedUrl,
} from "../_shared/inspiration-import.ts"
import { filterShoppingResults, getLensPriceLabel } from "../_shared/inspiration-lens.ts"
import {
  signInspirationWebSelection,
  verifyInspirationWebSelection,
  type InspirationWebSelectionPayload,
} from "../_shared/inspiration-web-token.ts"

type AnyClient = Awaited<ReturnType<typeof requireUser>>["admin"]
type ImportRow = Record<string, any>
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }
const DEFAULT_DETECTION_TIMEOUT_SECONDS = 180

function queryError(error: { message: string } | null, message: string) {
  if (error) throw new Error(`${message}: ${error.message}`)
}

async function ownedImport(admin: AnyClient, userId: string, importId: string): Promise<ImportRow> {
  const { data, error } = await admin.from("inspiration_imports").select("*")
    .eq("id", importId).eq("user_id", userId).maybeSingle()
  queryError(error, "Unable to read import")
  if (!data) throw new HttpError(404, "import_not_found", "Import not found")
  return data
}

function detectionTimeoutSeconds(): number {
  const configured = Number(Deno.env.get("INSPIRATION_DETECTION_TIMEOUT_S"))
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_DETECTION_TIMEOUT_SECONDS
}

async function expireStaleDetection(
  context: Awaited<ReturnType<typeof requireUser>>,
  importRow: ImportRow,
): Promise<ImportRow> {
  if (importRow.status !== "detecting" || typeof importRow.detection_started_at !== "string") {
    return importRow
  }

  const cutoffMs = Date.now() - detectionTimeoutSeconds() * 1000
  const startedAtMs = Date.parse(importRow.detection_started_at)
  if (!Number.isFinite(startedAtMs) || startedAtMs > cutoffMs) return importRow
  const cutoff = new Date(cutoffMs).toISOString()

  const { data, error } = await context.admin.from("inspiration_imports")
    .update({
      status: "failed",
      error_code: "detection_timeout",
      error_message: "Garment detection took too long. Please try again.",
    })
    .eq("id", importRow.id)
    .eq("user_id", context.userId)
    .eq("status", "detecting")
    .lte("detection_started_at", cutoff)
    .select("*")
    .maybeSingle()
  queryError(error, "Unable to expire garment detection")

  // A callback or a newer attempt may have won the conditional-update race.
  return data ?? ownedImport(context.admin, context.userId, importRow.id)
}

async function createImport(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const mimeType = requiredString(body, "mimeType")
  const extension = MIME_EXT[mimeType]
  if (!extension) throw new HttpError(415, "invalid_image_type", "Choose a JPEG, PNG or WebP image")
  const importId = crypto.randomUUID()
  const uploadPath = `${context.userId}/${importId}/source/original.${extension}`
  const { error } = await context.admin.from("inspiration_imports").insert({
    id: importId, user_id: context.userId, source_kind: "image", source_path: uploadPath, status: "created",
  })
  queryError(error, "Unable to create import")
  return { importId, uploadPath }
}

async function sourceReady(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  const importRow = await ownedImport(context.admin, context.userId, importId)
  if (importRow.status !== "created") return { importId, status: importRow.status }
  const sourcePath = importRow.source_path as string
  const split = sourcePath.lastIndexOf("/")
  const folder = sourcePath.slice(0, split)
  const filename = sourcePath.slice(split + 1)
  const { data, error } = await context.admin.storage.from(INSPIRATION_BUCKET).list(folder, { search: filename, limit: 10 })
  queryError(error, "Unable to verify source upload")
  const object = (data ?? []).find((entry) => entry.name === filename)
  if (!object) throw new HttpError(409, "source_missing", "Uploaded source image was not found")
  const mimeType = requiredString(body, "mimeType")
  if (!MIME_EXT[mimeType]) throw new HttpError(415, "invalid_image_type", "Choose a JPEG, PNG or WebP image")
  const claimedSize = Number(body.sizeBytes)
  if (!Number.isFinite(claimedSize) || claimedSize <= 0 || claimedSize > 10 * 1024 * 1024) {
    throw new HttpError(400, "invalid_image_size", "Source image must be smaller than 10 MB")
  }
  const metadata = object.metadata as Record<string, unknown> | null
  const actualSize = Number(metadata?.size ?? claimedSize)
  const actualMime = typeof metadata?.mimetype === "string" ? metadata.mimetype : mimeType
  if (!MIME_EXT[actualMime] || actualMime !== mimeType) {
    throw new HttpError(415, "invalid_image_type", "Uploaded image type does not match the request")
  }
  if (actualSize <= 0 || actualSize > 10 * 1024 * 1024) {
    throw new HttpError(400, "invalid_image_size", "Source image must be smaller than 10 MB")
  }
  const { error: updateError } = await context.admin.from("inspiration_imports")
    .update({ status: "source_ready", error_code: null, error_message: null })
    .eq("id", importId).eq("user_id", context.userId).eq("status", "created")
  queryError(updateError, "Unable to confirm source upload")
  return { importId, status: "source_ready" }
}

/**
 * Seed a selected candidate from the uploaded source itself — for product-level
 * Find items, where the client already holds a segmented garment. Detection
 * exists to find a garment in a photo; here there is nothing to find, so the
 * source file doubles as the retrieval crop.
 *
 * The candidates table grants the service role SELECT only: every write goes
 * through the SECURITY DEFINER RPCs. So this drives the real state machine with
 * a synthetic detector result — begin → finalize(one candidate) → select — and
 * ends in `candidate_selected`, exactly where a detected import ends. Catalogue
 * and web search then run unchanged.
 */
async function seedCandidate(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  // One piece (the globe on a product) or two (Studio's Find items: the worn top
  // and bottom). Each is its own object under the import's source folder; the
  // first is the source itself, so `path` may be omitted for it.
  const rawPieces = Array.isArray(body.pieces) ? body.pieces : [{ category: body.category, path: null }]
  if (rawPieces.length < 1 || rawPieces.length > 2) throw new HttpError(400, "invalid_pieces", "Seed one or two pieces")
  const pieces = rawPieces.map((raw) => {
    const piece = (raw ?? {}) as Record<string, unknown>
    const category = piece.category
    if (category !== "top" && category !== "bottom") throw new HttpError(400, "invalid_category", "Category must be top or bottom")
    return { category, path: typeof piece.path === "string" ? piece.path : null }
  })
  if (new Set(pieces.map((piece) => piece.category)).size !== pieces.length) {
    throw new HttpError(400, "invalid_pieces", "One piece per category")
  }
  const importRow = await ownedImport(context.admin, context.userId, importId)
  // Same gate as begin_inspiration_detection; a stale "detecting" lease is retried by the RPC.
  if (!["source_ready", "failed", "detecting"].includes(importRow.status as string)) {
    throw new HttpError(409, "import_not_seedable", "Confirm the uploaded image first")
  }
  const sourcePath = importRow.source_path as string
  const folder = sourcePath.slice(0, sourcePath.lastIndexOf("/"))
  const { data: listed, error: listError } = await context.admin.storage.from(INSPIRATION_BUCKET).list(folder, { limit: 20 })
  queryError(listError, "Unable to verify source upload")
  const resolved = pieces.map((piece) => {
    const path = piece.path ?? sourcePath
    if (!path.startsWith(`${folder}/`)) throw new HttpError(400, "invalid_path", "Piece must sit in the import's source folder")
    const object = (listed ?? []).find((entry) => entry.name === path.slice(folder.length + 1))
    if (!object) throw new HttpError(409, "source_missing", "Uploaded garment image was not found")
    // The web search posts this exact file to Lens, which caps uploads at 500 KB.
    const size = Number((object.metadata as Record<string, unknown> | null)?.size ?? body.sizeBytes)
    if (!Number.isFinite(size) || size <= 0 || size > 500 * 1024) {
      throw new HttpError(400, "invalid_image_size", "Garment crop must be smaller than 500 KB")
    }
    return { category: piece.category, path }
  })

  // 1 · begin: claims a detection attempt (authenticated RPC, like startDetection).
  const { data: beginData, error: beginError } = await context.client.rpc("begin_inspiration_detection", {
    p_import_id: importId, p_lease_seconds: 60,
  })
  queryError(beginError, "Unable to begin seeding")
  const attempt = Array.isArray(beginData) ? beginData[0] : beginData
  if (!attempt?.started || !attempt.attempt_id) throw new HttpError(409, "import_busy", "This import is busy; try again")

  // 2 · finalize: one full-frame candidate per piece, its file as its crop (service-role RPC).
  const candidates = resolved.map((piece) => ({
    id: crypto.randomUUID(), category: piece.category, label: null, confidence: 1,
    bbox: { l: 0, t: 0, w: 1, h: 1 }, boxSource: "dino_only",
    retrievalCropPath: piece.path, metrics: { seeded: "product" },
  }))
  const { data: finalized, error: finalizeError } = await context.admin.rpc("finalize_inspiration_detection", {
    p_import_id: importId, p_attempt_id: attempt.attempt_id,
    p_candidates: candidates, p_error_code: null, p_error_message: null,
  })
  queryError(finalizeError, "Unable to seed candidate")
  if (!finalized) throw new HttpError(409, "seed_stale", "The import changed while seeding; try again")

  // 3 · select them all (authenticated RPC, like selectCandidate).
  const candidateIds = candidates.map((candidate) => candidate.id)
  const { error: selectError } = await context.client.rpc("select_inspiration_candidates", {
    p_import_id: importId, p_candidate_ids: candidateIds,
  })
  if (selectError) throw new HttpError(409, "candidate_unavailable", "Seeded candidate could not be selected")
  return { importId, candidateId: candidateIds[0], candidateIds, status: "candidate_selected" }
}

// Detector candidate shape and crop upload, mirrored from
// inspiration-import-detector-callback/index.ts. That function stays in place
// but is now unused: the detector below answers in the same request, so there
// is no callback leg left to receive.
type DetectorCandidate = {
  category: "top" | "bottom"
  label: string | null
  confidence: number
  bbox: { l: number; t: number; w: number; h: number }
  boxSource: "fashn_union_dino" | "fashn_only" | "dino_only"
  retrievalCropBase64: string
  metrics: Record<string, unknown>
}

function base64Bytes(value: string): Uint8Array {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new HttpError(400, "invalid_crop", "Detector crop is invalid")
  let binary: string
  try { binary = atob(encoded) } catch { throw new HttpError(400, "invalid_crop", "Detector crop is invalid") }
  if (!binary.length || binary.length > 500 * 1024) {
    throw new HttpError(400, "invalid_crop", "Detector crop exceeds 500 KB")
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function detectorCandidate(value: unknown): DetectorCandidate {
  const body = asObject(value)
  const category = body.category
  const boxSource = body.boxSource
  const bbox = asObject(body.bbox)
  const confidence = Number(body.confidence)
  if (category !== "top" && category !== "bottom") throw new HttpError(400, "invalid_candidate", "Invalid category")
  if (!["fashn_union_dino", "fashn_only", "dino_only"].includes(String(boxSource))) {
    throw new HttpError(400, "invalid_candidate", "Invalid box source")
  }
  const normalized = { l: Number(bbox.l), t: Number(bbox.t), w: Number(bbox.w), h: Number(bbox.h) }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1
    || Object.values(normalized).some((entry) => !Number.isFinite(entry))
    || normalized.l < 0 || normalized.t < 0 || normalized.w <= 0 || normalized.h <= 0
    || normalized.l + normalized.w > 1.001 || normalized.t + normalized.h > 1.001) {
    throw new HttpError(400, "invalid_candidate", "Invalid candidate geometry")
  }
  return {
    category, label: typeof body.label === "string" ? body.label.slice(0, 160) : null,
    confidence, bbox: normalized, boxSource: boxSource as DetectorCandidate["boxSource"],
    retrievalCropBase64: requiredString(body, "retrievalCropBase64"),
    metrics: body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)
      ? body.metrics as Record<string, unknown> : {},
  }
}

// The box is a single CPU host, not an auto-scaled fleet: a transient failure
// (network blip, one slow request queued behind another) is worth one retry.
// Detection is a pure read of the source image, so retrying never duplicates
// stored data.
const DETECT_MAX_ATTEMPTS = 3
const DETECT_RETRY_DELAY_MS = 1_000

async function callDetector(sourceUrl: string): Promise<unknown[]> {
  let lastError: unknown
  for (let attempt = 1; attempt <= DETECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${env("INSPIRATION_DETECT_URL").replace(/\/$/, "")}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Modal-Token": env("INSPIRATION_DETECT_TOKEN") },
        body: JSON.stringify({ image_url: sourceUrl }),
        signal: AbortSignal.timeout(30_000),
      })
      const responseBody = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || !Array.isArray(responseBody.candidates)) {
        throw new Error("Detector did not return candidates")
      }
      return responseBody.candidates
    } catch (error) {
      lastError = error
      if (attempt < DETECT_MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, DETECT_RETRY_DELAY_MS))
    }
  }
  throw lastError
}

async function startDetection(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  await ownedImport(context.admin, context.userId, importId)
  const uploaded: string[] = []
  try {
    const { data, error } = await context.client.rpc("begin_inspiration_detection", {
      p_import_id: importId,
      p_lease_seconds: Number(Deno.env.get("INSPIRATION_DETECTION_LEASE_S") ?? "180"),
    })
    queryError(error, "Unable to begin garment detection")
    const attempt = Array.isArray(data) ? data[0] : data
    if (!attempt?.started) {
      return { importId, status: "detecting", accepted: true }
    }
    const sourceUrl = await signedUrl(
      context.admin, attempt.source_path, Number(Deno.env.get("INSPIRATION_SIGNED_URL_TTL_S") ?? "600"),
    )
    if (!sourceUrl) throw new Error("Import has no source image")

    const rawCandidates = await callDetector(sourceUrl)
    if (rawCandidates.length > 12) throw new HttpError(400, "invalid_candidates", "Detector returned too many candidates")
    const candidates = rawCandidates.map(detectorCandidate)

    const persisted: Record<string, unknown>[] = []
    for (const item of candidates) {
      const id = crypto.randomUUID()
      const retrievalCropPath = `${context.userId}/${importId}/candidates/${id}/retrieval.webp`
      const { error: uploadError } = await context.admin.storage.from(INSPIRATION_BUCKET).upload(
        retrievalCropPath, base64Bytes(item.retrievalCropBase64), { contentType: "image/webp", upsert: false },
      )
      if (uploadError) throw new Error(`Unable to store candidate crop: ${uploadError.message}`)
      uploaded.push(retrievalCropPath)
      persisted.push({
        id, category: item.category, label: item.label, confidence: item.confidence,
        bbox: item.bbox, boxSource: item.boxSource, retrievalCropPath, metrics: item.metrics,
      })
    }

    const noCandidates = persisted.length === 0
    const { data: finalized, error: finalizeError } = await context.admin.rpc("finalize_inspiration_detection", {
      p_import_id: importId, p_attempt_id: attempt.attempt_id,
      p_candidates: persisted,
      p_error_code: noCandidates ? "no_garments_found" : null,
      p_error_message: noCandidates ? "No top or bottom was found. Try a clearer photo." : null,
    })
    queryError(finalizeError, "Unable to record garment detection")
    if (!finalized && uploaded.length) await context.admin.storage.from(INSPIRATION_BUCKET).remove(uploaded)
    return { importId, status: "detecting", accepted: true, stale: !finalized }
  } catch (error) {
    if (uploaded.length) await context.admin.storage.from(INSPIRATION_BUCKET).remove(uploaded)
    await context.admin.from("inspiration_imports").update({
      status: "failed", error_code: "detector_unavailable", error_message: "Garment detection is temporarily unavailable",
    }).eq("id", importId).eq("user_id", context.userId).eq("status", "detecting")
    throw error
  }
}

async function getImport(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  const importRow = await expireStaleDetection(
    context,
    await ownedImport(context.admin, context.userId, importId),
  )
  const [candidatesResult, webResult, selectionsResult] = await Promise.all([
    context.admin.from("inspiration_import_candidates").select("*").eq("import_id", importId)
      .order("confidence", { ascending: false }),
    context.admin.from("inspiration_import_web_results").select("*").eq("import_id", importId).order("rank"),
    context.admin.from("inspiration_import_selections").select("source,product_id,web_result_id,status").eq("import_id", importId),
  ])
  queryError(candidatesResult.error, "Unable to read candidates")
  queryError(webResult.error, "Unable to read online results")
  queryError(selectionsResult.error, "Unable to read selections")
  const candidates = await Promise.all((candidatesResult.data ?? []).map(async (candidate: ImportRow) => ({
    id: candidate.id, category: candidate.category, label: candidate.detector_label,
    confidence: candidate.confidence, bbox: candidate.bbox, boxSource: candidate.box_source,
    retrievalCropUrl: await signedUrl(context.admin, candidate.retrieval_crop_path),
    selected: Boolean(candidate.selected_at), metrics: candidate.metrics ?? {},
  })))
  const selectedCandidates = candidates.filter((candidate) => candidate.selected)
  return {
    import: {
      id: importRow.id, status: importRow.status,
      errorCode: importRow.error_code, errorMessage: importRow.error_message,
      studioOutfitId: importRow.studio_outfit_id ?? null,
    },
    sourceUrl: await signedUrl(context.admin, importRow.source_path), candidates,
    selectedCandidateId: selectedCandidates[0]?.id ?? null,
    selectedCandidateIds: selectedCandidates.map((candidate) => candidate.id),
    webResults: (webResult.data ?? []).flatMap((result: ImportRow) => {
      const listingUrl = safeHttpUrl(result.listing_url)
      const imageUrl = safeHttpUrl(result.image_url)
      if (!listingUrl || !imageUrl) return []
      return [{
        id: result.id, candidateId: result.candidate_id,
        providerResultId: result.provider_result_id,
        title: result.title, merchantDomain: result.merchant_domain,
        listingUrl, imageUrl, rank: result.rank, priceLabel: null, selectionToken: null,
      }]
    }),
    selections: {
      catalogueProductIds: (selectionsResult.data ?? []).filter((row: ImportRow) => row.source === "catalogue").map((row: ImportRow) => row.product_id),
      webResultIds: (selectionsResult.data ?? [])
        .filter((row: ImportRow) => row.source === "web")
        .map((row: ImportRow) => row.web_result_id),
    },
  }
}

async function selectCandidate(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const candidateIds = Array.isArray(body.candidateIds)
    ? body.candidateIds
    : [requiredString(body, "candidateId")]
  if (candidateIds.length < 1 || candidateIds.length > 2
    || candidateIds.some((candidateId) => typeof candidateId !== "string" || !candidateId)) {
    throw new HttpError(400, "invalid_candidate_selection", "Choose at most one top and one bottom")
  }
  const { data, error } = await context.client.rpc("select_inspiration_candidates", {
    p_import_id: requiredString(body, "importId"), p_candidate_ids: candidateIds,
  })
  if (error) throw new HttpError(409, "candidate_unavailable", "Candidate is no longer available")
  const rows = Array.isArray(data) ? data : data ? [data] : []
  return {
    selectedCandidateId: rows[0]?.selected_candidate_id ?? null,
    selectedCandidateIds: rows.map((row) => row.selected_candidate_id),
    selectedCandidates: rows.map((row) => ({ id: row.selected_candidate_id, category: row.category })),
  }
}

async function selectedCandidate(
  context: Awaited<ReturnType<typeof requireUser>>,
  importId: string,
  candidateId: string | null = null,
) {
  const importRow = await ownedImport(context.admin, context.userId, importId)
  let query = context.admin.from("inspiration_import_candidates").select("*")
    .eq("import_id", importId).not("selected_at", "is", null)
  if (candidateId) query = query.eq("id", candidateId)
  const { data, error } = await query.limit(2)
  queryError(error, "Unable to read selected candidate")
  if (!data?.length) {
    throw new HttpError(409, "candidate_required", candidateId
      ? "The requested garment is not selected"
      : "Select a garment first")
  }
  if (!candidateId && data.length > 1) {
    throw new HttpError(409, "candidate_required", "Choose which selected garment to search")
  }
  return { importRow, candidate: data[0] as ImportRow }
}

async function normalizeLens(
  payload: Record<string, unknown>,
  imageId: string,
  importId: string,
  candidateId: string,
) {
  const matches = filterShoppingResults(
    Array.isArray(payload.visual_matches) ? payload.visual_matches as Record<string, unknown>[] : [],
  )
  const seen = new Set<string>()
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60
  const results = matches.flatMap((raw, index) => {
    const listingUrl = safeHttpUrl(raw.link)
    const imageUrl = safeHttpUrl(raw.image) ?? safeHttpUrl(raw.thumbnail)
    if (!listingUrl || !imageUrl || typeof raw.title !== "string" || seen.has(listingUrl)) return []
    seen.add(listingUrl)
    const providerResultId = `${imageId}:${String(raw.position ?? index)}`
    return [{
      version: 1 as const,
      importId,
      candidateId,
      providerResultId,
      rank: typeof raw.position === "number" ? raw.position : index,
      title: raw.title,
      merchantDomain: new URL(listingUrl).hostname.replace(/^www\./, ""),
      listingUrl,
      imageUrl,
      priceLabel: getLensPriceLabel(raw),
      expiresAt,
    }]
  })
  return Promise.all(results.map(async (result) => {
    const { priceLabel, ...selectionPayload } = result
    return {
      id: result.providerResultId,
      candidateId: result.candidateId,
      providerResultId: result.providerResultId,
      title: result.title,
      merchantDomain: result.merchantDomain,
      listingUrl: result.listingUrl,
      imageUrl: result.imageUrl,
      rank: result.rank,
      priceLabel,
      selectionToken: await signInspirationWebSelection(
        selectionPayload,
        env("SUPABASE_SERVICE_ROLE_KEY"),
      ),
    }
  }))
}

async function webSearch(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  const candidateId = optionalString(body, "candidateId")
  const current = await selectedCandidate(context, importId, candidateId)
  const { data: crop, error: cropError } = await context.admin.storage.from(INSPIRATION_BUCKET).download(current.candidate.retrieval_crop_path)
  queryError(cropError, "Unable to read retrieval crop")
  if (!crop || crop.size > 500 * 1024) throw new HttpError(400, "lens_image_too_large", "Garment crop is too large for online search")
  const form = new FormData()
  form.set("api_key", env("SERPAPI_API_KEY"))
  form.set("image", crop, "retrieval.webp")
  const uploadResponse = await fetch("https://serpapi.com/image", { method: "POST", body: form, signal: AbortSignal.timeout(20_000) })
  const upload = await uploadResponse.json().catch(() => ({})) as Record<string, unknown>
  if (!uploadResponse.ok || typeof upload.image_id !== "string") {
    console.error("[inspiration-import] serpapi upload", uploadResponse.status, upload.error ?? null)
    throw new Error("SerpApi image upload failed")
  }
  const params = new URLSearchParams({
    engine: "google_lens", image_id: upload.image_id,
    country: Deno.env.get("SERPAPI_COUNTRY") ?? "us", hl: "en", safe: "active", auto_crop: "false",
    api_key: env("SERPAPI_API_KEY"),
  })
  const response = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(25_000) })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || !Array.isArray(payload.visual_matches)) {
    console.error("[inspiration-import] serpapi lens", response.status, payload.error ?? null)
    throw new Error("SerpApi Lens search failed")
  }
  const stillSelected = await selectedCandidate(context, importId, current.candidate.id)
  if (stillSelected.candidate.id !== current.candidate.id) throw new HttpError(409, "candidate_changed", "The selected garment changed; search again")
  return {
    results: await normalizeLens(payload, upload.image_id, importId, current.candidate.id),
  }
}

function validSelectionPayload(value: InspirationWebSelectionPayload): boolean {
  return value.version === 1
    && typeof value.providerResultId === "string" && Boolean(value.providerResultId)
    && Number.isInteger(value.rank) && value.rank >= 0
    && typeof value.title === "string" && Boolean(value.title.trim())
    && typeof value.merchantDomain === "string" && Boolean(value.merchantDomain.trim())
    && Boolean(safeHttpUrl(value.listingUrl))
    && Boolean(safeHttpUrl(value.imageUrl))
    && Number.isInteger(value.expiresAt)
}

async function addWebSelections(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  if (!Array.isArray(body.selections) || body.selections.length < 1 || body.selections.length > 2) {
    throw new HttpError(400, "invalid_web_selections", "Choose at most one online top and one online bottom")
  }

  const verified: InspirationWebSelectionPayload[] = []
  const seenCandidates = new Set<string>()
  for (const raw of body.selections) {
    const input = asObject(raw)
    const candidateId = requiredString(input, "candidateId")
    const selectionToken = requiredString(input, "selectionToken")
    if (seenCandidates.has(candidateId)) {
      throw new HttpError(400, "invalid_web_selections", "Each garment can have only one online pick")
    }
    seenCandidates.add(candidateId)
    await selectedCandidate(context, importId, candidateId)
    const selection = await verifyInspirationWebSelection(selectionToken, env("SUPABASE_SERVICE_ROLE_KEY"))
    if (!selection || !validSelectionPayload(selection)
      || selection.importId !== importId || selection.candidateId !== candidateId
      || selection.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new HttpError(400, "invalid_web_selection", "An online result expired. Search online again and reselect it")
    }
    verified.push(selection)
  }

  const { data, error } = await context.admin.rpc("add_inspiration_import_web_selections", {
    p_user_id: context.userId,
    p_import_id: importId,
    p_web_results: verified.map((selection) => ({
      candidateId: selection.candidateId,
      providerResultId: selection.providerResultId,
      rank: selection.rank,
      title: selection.title,
      merchantDomain: selection.merchantDomain,
      listingUrl: selection.listingUrl,
      imageUrl: selection.imageUrl,
      expiresAt: selection.expiresAt,
    })),
  })
  if (error) {
    console.error("[inspiration-import] add to atlyr failed", {
      importId,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    throw new HttpError(409, "add_web_selections_failed", "The online picks could not be saved")
  }
  return data
}

async function requireAdmin(context: Awaited<ReturnType<typeof requireUser>>) {
  const { data, error } = await context.admin.from("profiles").select("role").eq("user_id", context.userId).maybeSingle()
  queryError(error, "Unable to read profile")
  if (data?.role !== "admin") throw new HttpError(403, "admin_required", "Admin access required")
}

// The Atlyr team's review list: every web pick a user sent with "add to atlyr", newest first.
async function adminListWebRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  await requireAdmin(context)
  const { data: selections, error } = await context.admin.from("inspiration_import_selections")
    .select("id,import_id,candidate_id,web_result_id,status,ingestion_job_id,ingested_product_id,created_at")
    .eq("source", "web").order("created_at", { ascending: false }).limit(200)
  queryError(error, "Unable to read requests")
  const rows = (selections ?? []) as ImportRow[]
  if (!rows.length) return { requests: [] }

  const unique = (values: unknown[]) => [...new Set(values.filter(Boolean))] as string[]
  const [webResults, candidates, imports] = await Promise.all([
    context.admin.from("inspiration_import_web_results").select("id,title,merchant_domain,listing_url,image_url")
      .in("id", unique(rows.map((row) => row.web_result_id))),
    context.admin.from("inspiration_import_candidates").select("id,category,retrieval_crop_path")
      .in("id", unique(rows.map((row) => row.candidate_id))),
    context.admin.from("inspiration_imports").select("id,user_id")
      .in("id", unique(rows.map((row) => row.import_id))),
  ])
  queryError(webResults.error, "Unable to read online results")
  queryError(candidates.error, "Unable to read candidates")
  queryError(imports.error, "Unable to read imports")
  const importById = new Map((imports.data ?? []).map((row: ImportRow) => [row.id, row]))
  const { data: profiles, error: profilesError } = await context.admin.from("profiles").select("user_id,name")
    .in("user_id", unique((imports.data ?? []).map((row: ImportRow) => row.user_id)))
  queryError(profilesError, "Unable to read profiles")
  const webById = new Map((webResults.data ?? []).map((row: ImportRow) => [row.id, row]))
  const candidateById = new Map((candidates.data ?? []).map((row: ImportRow) => [row.id, row]))
  const nameByUserId = new Map((profiles ?? []).map((row: ImportRow) => [row.user_id, row.name]))

  // Rows with a job show the pipeline's live state instead of the stamp written at submit time.
  const jobById = new Map<string, ImportRow>()
  const verdictByProductId = new Map<string, string>()
  const jobIds = unique(rows.map((row) => row.ingestion_job_id))
  if (jobIds.length) {
    const { data: jobs, error: jobsError } = await context.admin.from("ingestion_pipeline_jobs")
      .select("job_id,current_state,ingested_product_id").in("job_id", jobIds)
    queryError(jobsError, "Unable to read ingestion jobs")
    for (const job of (jobs ?? []) as ImportRow[]) jobById.set(job.job_id, job)
    const productIds = unique((jobs ?? []).map((job: ImportRow) => job.ingested_product_id))
    if (productIds.length) {
      const { data: products, error: productsError } = await context.admin.from("ingested_products")
        .select("id,verdict").in("id", productIds)
      queryError(productsError, "Unable to read ingested products")
      for (const product of (products ?? []) as ImportRow[]) verdictByProductId.set(product.id, product.verdict)
    }
  }
  const liveStatus = (row: ImportRow) => {
    const job = row.ingestion_job_id ? jobById.get(row.ingestion_job_id) : null
    if (!job) return { status: row.status, jobState: null, productId: row.ingested_product_id ?? null }
    const productId = job.ingested_product_id ?? null
    if (productId && verdictByProductId.get(productId) === "approved") return { status: "ingested", jobState: job.current_state, productId }
    if (["failed", "discarded", "cancelled"].includes(job.current_state)) return { status: "failed", jobState: job.current_state, productId }
    return { status: "ingesting", jobState: job.current_state, productId }
  }

  const requests = await Promise.all(rows.map(async (row) => {
    const web = webById.get(row.web_result_id) ?? {}
    const candidate = candidateById.get(row.candidate_id) ?? {}
    const userId = importById.get(row.import_id)?.user_id ?? null
    const live = liveStatus(row)
    return {
      id: row.id, importId: row.import_id, status: live.status, jobState: live.jobState, createdAt: row.created_at,
      ingestionJobId: row.ingestion_job_id ?? null, ingestedProductId: live.productId,
      category: candidate.category ?? null,
      cropUrl: await signedUrl(context.admin, candidate.retrieval_crop_path ?? null),
      title: web.title ?? "", merchantDomain: web.merchant_domain ?? "",
      listingUrl: safeHttpUrl(web.listing_url) ?? "", imageUrl: safeHttpUrl(web.image_url) ?? "",
      userId, userName: userId ? nameByUserId.get(userId) ?? null : null,
    }
  }))
  return { requests }
}

async function adminMarkWebRequest(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  await requireAdmin(context)
  const selectionId = requiredString(body, "selectionId")
  const ingestionJobId = requiredString(body, "ingestionJobId")
  const { data, error } = await context.admin.from("inspiration_import_selections")
    .update({ status: "queued", ingestion_job_id: ingestionJobId, updated_at: new Date().toISOString() })
    .eq("id", selectionId).eq("source", "web").select("id").maybeSingle()
  queryError(error, "Unable to update request")
  if (!data) throw new HttpError(404, "request_not_found", "Request not found")
  return { id: data.id, status: "queued", ingestionJobId }
}

async function openStudio(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const { data, error } = await context.client.rpc("open_inspiration_import_in_studio", {
    p_import_id: requiredString(body, "importId"),
    p_outfit_id: requiredString(body, "outfitId"),
    p_top_product_id: optionalString(body, "topProductId"),
    p_bottom_product_id: optionalString(body, "bottomProductId"),
  })
  if (error) throw new HttpError(409, "open_studio_failed", "The selected pieces could not be opened in Studio")
  return data
}

async function deleteImport(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  const importRow = await ownedImport(context.admin, context.userId, importId)
  const { data: candidates, error: candidatesError } = await context.admin
    .from("inspiration_import_candidates").select("retrieval_crop_path").eq("import_id", importId)
  queryError(candidatesError, "Unable to read import assets")
  const paths = [
    importRow.source_path,
    ...(candidates ?? []).map((candidate: ImportRow) => candidate.retrieval_crop_path),
  ].filter(Boolean) as string[]
  if (paths.length) {
    const { error } = await context.admin.storage.from(INSPIRATION_BUCKET).remove(paths)
    queryError(error, "Unable to delete import assets")
  }
  const { error } = await context.admin.from("inspiration_imports").delete()
    .eq("id", importId).eq("user_id", context.userId)
  queryError(error, "Unable to delete import")
  return { deleted: true }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  try {
    const context = await requireUser(req)
    const body = asObject(await req.json())
    const action = requiredString(body, "action")
    const handlers: Record<string, () => Promise<unknown>> = {
      create: () => createImport(context, body),
      "source-ready": () => sourceReady(context, body),
      detect: () => startDetection(context, body),
      "seed-candidate": () => seedCandidate(context, body),
      get: () => getImport(context, body),
      "select-candidate": () => selectCandidate(context, body),
      "web-search": () => webSearch(context, body),
      "add-web-selections": () => addWebSelections(context, body),
      // Older app builds still send this name; remove once every client uses add-web-selections.
      "stage-selections": () => addWebSelections(context, body),
      "admin-list-web-requests": () => adminListWebRequests(context),
      "admin-mark-web-request": () => adminMarkWebRequest(context, body),
      "open-studio": () => openStudio(context, body),
      delete: () => deleteImport(context, body),
    }
    if (!handlers[action]) throw new HttpError(400, "unknown_action", "Unknown import action")
    return json(await handlers[action]())
  } catch (error) {
    return publicError(error)
  }
})
