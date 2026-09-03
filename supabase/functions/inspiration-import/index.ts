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

async function startDetection(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  await ownedImport(context.admin, context.userId, importId)
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
    const callbackUrl = Deno.env.get("INSPIRATION_CALLBACK_URL")?.trim()
      || `${env("SUPABASE_URL")}/functions/v1/inspiration-import-detector-callback`
    const response = await fetch(`${env("INSPIRATION_MODAL_URL").replace(/\/$/, "")}/detect-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Inspiration-Token": env("INSPIRATION_MODAL_TOKEN") },
      body: JSON.stringify({
        importId, detectionAttemptId: attempt.attempt_id,
        sourceUrl, callbackUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const responseBody = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || typeof responseBody.detectorJobId !== "string") {
      throw new Error("Detector did not accept the job")
    }
    const { error: jobError } = await context.client.rpc("set_inspiration_detector_job", {
      p_import_id: importId, p_attempt_id: attempt.attempt_id, p_job_id: responseBody.detectorJobId,
    })
    queryError(jobError, "Unable to record detector job")
    return { importId, status: "detecting", accepted: true }
  } catch (error) {
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
  if (!uploadResponse.ok || typeof upload.image_id !== "string") throw new Error("SerpApi image upload failed")
  const params = new URLSearchParams({
    engine: "google_lens", image_id: upload.image_id,
    country: Deno.env.get("SERPAPI_COUNTRY") ?? "us", hl: "en", safe: "active", auto_crop: "false",
    api_key: env("SERPAPI_API_KEY"),
  })
  const response = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(25_000) })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || !Array.isArray(payload.visual_matches)) throw new Error("SerpApi Lens search failed")
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

async function stageSelections(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  if (!Array.isArray(body.selections) || body.selections.length < 1 || body.selections.length > 2) {
    throw new HttpError(400, "invalid_web_selections", "Choose at most one online top and one online bottom")
  }
  if (!Array.isArray(body.catalogueSelections) || body.catalogueSelections.length > 1
    || body.catalogueSelections.length + body.selections.length > 2) {
    throw new HttpError(400, "invalid_catalogue_selections", "Choose at most one inventory item per garment")
  }

  const catalogueSelections: Array<{ candidateId: string; productId: string }> = []
  const verified: InspirationWebSelectionPayload[] = []
  const seenCandidates = new Set<string>()
  for (const raw of body.catalogueSelections) {
    const input = asObject(raw)
    const candidateId = requiredString(input, "candidateId")
    const productId = requiredString(input, "productId")
    if (seenCandidates.has(candidateId)) {
      throw new HttpError(400, "invalid_catalogue_selections", "Each garment can have only one final selection")
    }
    seenCandidates.add(candidateId)
    await selectedCandidate(context, importId, candidateId)
    catalogueSelections.push({ candidateId, productId })
  }
  for (const raw of body.selections) {
    const input = asObject(raw)
    const candidateId = requiredString(input, "candidateId")
    const selectionToken = requiredString(input, "selectionToken")
    if (seenCandidates.has(candidateId)) {
      throw new HttpError(400, "invalid_web_selections", "Each garment can have only one final selection")
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

  const { data, error } = await context.admin.rpc("stage_inspiration_import_selections", {
    p_user_id: context.userId,
    p_import_id: importId,
    p_catalogue_results: catalogueSelections,
    p_web_results: verified.map((selection) => ({
      candidateId: selection.candidateId,
      providerResultId: selection.providerResultId,
      rank: selection.rank,
      title: selection.title,
      merchantDomain: selection.merchantDomain,
      listingUrl: selection.listingUrl,
      imageUrl: selection.imageUrl,
    })),
  })
  if (error) throw new HttpError(409, "selection_staging_failed", "The final selections could not be saved")
  return data
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
      get: () => getImport(context, body),
      "select-candidate": () => selectCandidate(context, body),
      "web-search": () => webSearch(context, body),
      "stage-selections": () => stageSelections(context, body),
      "open-studio": () => openStudio(context, body),
      delete: () => deleteImport(context, body),
    }
    if (!handlers[action]) throw new HttpError(400, "unknown_action", "Unknown import action")
    return json(await handlers[action]())
  } catch (error) {
    return publicError(error)
  }
})
