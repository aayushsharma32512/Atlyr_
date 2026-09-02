import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import {
  INSPIRATION_BUCKET, HttpError, asObject, env, json, optionalString, publicError,
  requireUser, requiredString, safeHttpUrl, signedUrl,
} from "../_shared/inspiration-import.ts"

type AnyClient = Awaited<ReturnType<typeof requireUser>>["admin"]
type ImportRow = Record<string, any>
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

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
      p_lease_seconds: Number(Deno.env.get("INSPIRATION_DETECTION_LEASE_S") ?? "300"),
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
  const importRow = await ownedImport(context.admin, context.userId, importId)
  const [candidatesResult, webResult, selectionsResult] = await Promise.all([
    context.admin.from("inspiration_import_candidates").select("*").eq("import_id", importId)
      .order("confidence", { ascending: false }),
    context.admin.from("inspiration_import_web_results").select("*").eq("import_id", importId)
      .gt("expires_at", new Date().toISOString()).order("rank"),
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
        title: result.title, merchantDomain: result.merchant_domain,
        listingUrl, imageUrl, rank: result.rank,
      }]
    }),
    selections: {
      catalogueProductIds: (selectionsResult.data ?? []).filter((row: ImportRow) => row.source === "catalogue").map((row: ImportRow) => row.product_id),
      webResultId: (selectionsResult.data ?? []).find((row: ImportRow) => row.source === "web")?.web_result_id ?? null,
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

function normalizeLens(payload: Record<string, unknown>, imageId: string, maxResults: number) {
  const matches = Array.isArray(payload.visual_matches) ? payload.visual_matches as Record<string, unknown>[] : []
  const seen = new Set<string>()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  return matches.flatMap((raw, index) => {
    const listingUrl = safeHttpUrl(raw.link)
    const imageUrl = safeHttpUrl(raw.image) ?? safeHttpUrl(raw.thumbnail)
    if (!listingUrl || !imageUrl || typeof raw.title !== "string" || seen.has(listingUrl)) return []
    seen.add(listingUrl)
    return [{
      provider: "serpapi_google_lens", provider_result_id: `${imageId}:${String(raw.position ?? index)}`,
      rank: typeof raw.position === "number" ? raw.position : index, title: raw.title,
      merchant_domain: new URL(listingUrl).hostname.replace(/^www\./, ""), listing_url: listingUrl,
      image_url: imageUrl, expires_at: expiresAt,
    }]
  }).slice(0, maxResults)
}

async function webSearch(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const importId = requiredString(body, "importId")
  const candidateId = optionalString(body, "candidateId")
  const current = await selectedCandidate(context, importId, candidateId)
  const { data: cached, error: cachedError } = await context.admin.from("inspiration_import_web_results").select("*")
    .eq("import_id", importId).eq("candidate_id", current.candidate.id).gt("expires_at", new Date().toISOString()).order("rank")
  queryError(cachedError, "Unable to read cached online results")
  const cachedRows = cached ?? []
  const invalidCachedIds = cachedRows
    .filter((row: ImportRow) => !safeHttpUrl(row.listing_url) || !safeHttpUrl(row.image_url))
    .map((row: ImportRow) => row.id as string)
  if (invalidCachedIds.length) {
    const { error } = await context.admin.from("inspiration_import_web_results").delete().in("id", invalidCachedIds)
    queryError(error, "Unable to remove invalid online results")
  }
  if (cachedRows.length > invalidCachedIds.length) {
    return { results: await getImport(context, { importId }).then((record) => record.webResults) }
  }
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
    engine: "google_lens", image_id: upload.image_id, type: "products",
    q: current.candidate.category === "top" ? "clothing top" : "pants skirt",
    country: Deno.env.get("SERPAPI_COUNTRY") ?? "us", hl: "en", safe: "active", auto_crop: "false",
    api_key: env("SERPAPI_API_KEY"),
  })
  const response = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(25_000) })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || !Array.isArray(payload.visual_matches)) throw new Error("SerpApi Lens search failed")
  const stillSelected = await selectedCandidate(context, importId, current.candidate.id)
  if (stillSelected.candidate.id !== current.candidate.id) throw new HttpError(409, "candidate_changed", "The selected garment changed; search again")
  const rows = normalizeLens(payload, upload.image_id, Number(Deno.env.get("SERPAPI_MAX_RESULTS") ?? "20"))
  await context.admin.from("inspiration_import_web_results").delete().eq("import_id", importId).eq("candidate_id", current.candidate.id)
  if (rows.length) {
    const { error } = await context.admin.from("inspiration_import_web_results").insert(
      rows.map((row) => ({ ...row, import_id: importId, candidate_id: current.candidate.id })),
    )
    queryError(error, "Unable to save online results")
  }
  return { results: await getImport(context, { importId }).then((record) => record.webResults) }
}

async function commit(context: Awaited<ReturnType<typeof requireUser>>, body: Record<string, unknown>) {
  const productIds = body.catalogueProductIds
  if (!Array.isArray(productIds) || productIds.some((id) => typeof id !== "string")) {
    throw new HttpError(400, "invalid_products", "catalogueProductIds must be an array")
  }
  const { data, error } = await context.client.rpc("commit_inspiration_import", {
    p_import_id: requiredString(body, "importId"), p_catalogue_product_ids: productIds,
    p_web_result_id: optionalString(body, "webResultId"),
  })
  if (error) throw new HttpError(409, "commit_failed", "Selections could not be saved")
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
      commit: () => commit(context, body),
      delete: () => deleteImport(context, body),
    }
    if (!handlers[action]) throw new HttpError(400, "unknown_action", "Unknown import action")
    return json(await handlers[action]())
  } catch (error) {
    return publicError(error)
  }
})
