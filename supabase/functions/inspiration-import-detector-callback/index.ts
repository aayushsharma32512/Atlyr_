import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import {
  INSPIRATION_BUCKET, HttpError, adminClient, asObject, constantTimeEqual, env,
  hmacHex, json, publicError, requiredString,
} from "../_shared/inspiration-import.ts"

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

function candidate(value: unknown): DetectorCandidate {
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

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  const uploaded: string[] = []
  try {
    const raw = await req.text()
    if (raw.length > 16 * 1024 * 1024) throw new HttpError(413, "payload_too_large", "Callback payload is too large")
    const timestamp = req.headers.get("X-Inspiration-Timestamp") ?? ""
    const signature = req.headers.get("X-Inspiration-Signature") ?? ""
    const timestampSeconds = Number(timestamp)
    if (!Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
      throw new HttpError(401, "expired_signature", "Callback signature expired")
    }
    const expected = await hmacHex(env("INSPIRATION_MODAL_CALLBACK_SECRET"), `${timestamp}.${raw}`)
    if (!constantTimeEqual(signature, expected)) throw new HttpError(401, "invalid_signature", "Invalid callback signature")
    const body = asObject(JSON.parse(raw))
    const importId = requiredString(body, "importId")
    const attemptId = requiredString(body, "detectionAttemptId")
    const admin = adminClient()
    const { data: importRow, error: importError } = await admin.from("inspiration_imports")
      .select("id,user_id,status,detection_attempt_id").eq("id", importId).maybeSingle()
    if (importError) throw new Error(importError.message)
    if (!importRow || importRow.status !== "detecting" || importRow.detection_attempt_id !== attemptId) {
      return json({ accepted: true, stale: true })
    }
    const status = requiredString(body, "status")
    let persisted: Record<string, unknown>[] = []
    if (status === "succeeded") {
      if (!Array.isArray(body.candidates) || body.candidates.length > 12) {
        throw new HttpError(400, "invalid_candidates", "Detector returned too many candidates")
      }
      const candidates = body.candidates.map(candidate)
      for (const item of candidates) {
        const id = crypto.randomUUID()
        const prefix = `${importRow.user_id}/${importId}/candidates/${id}`
        const retrievalCropPath = `${prefix}/retrieval.webp`
        const { error } = await admin.storage.from(INSPIRATION_BUCKET).upload(
          retrievalCropPath,
          base64Bytes(item.retrievalCropBase64),
          { contentType: "image/webp", upsert: false },
        )
        if (error) throw new Error(`Unable to store candidate crop: ${error.message}`)
        uploaded.push(retrievalCropPath)
        persisted.push({
          id, category: item.category, label: item.label, confidence: item.confidence,
          bbox: item.bbox, boxSource: item.boxSource, retrievalCropPath,
          metrics: item.metrics,
        })
      }
    } else if (status !== "failed") {
      throw new HttpError(400, "invalid_status", "Invalid detector status")
    }
    const noCandidates = status === "succeeded" && persisted.length === 0
    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_inspiration_detection", {
      p_import_id: importId, p_attempt_id: attemptId,
      p_candidates: persisted,
      p_error_code: status === "failed" ? "detector_failed" : noCandidates ? "no_garments_found" : null,
      p_error_message: status === "failed" ? "Garment detection failed. Please try again."
        : noCandidates ? "No top or bottom was found. Try a clearer photo." : null,
    })
    if (finalizeError) throw new Error(finalizeError.message)
    if (!finalized && uploaded.length) await admin.storage.from(INSPIRATION_BUCKET).remove(uploaded)
    return json({ accepted: true, stale: !finalized })
  } catch (error) {
    if (uploaded.length) await adminClient().storage.from(INSPIRATION_BUCKET).remove(uploaded)
    return publicError(error)
  }
})
